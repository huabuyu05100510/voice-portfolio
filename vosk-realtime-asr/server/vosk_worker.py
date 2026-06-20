"""
Vosk Worker Subprocess
独立进程运行 Vosk 引擎, 通过 multiprocessing.Queue 与主进程通信.
优势:
- C++ ASSERTION 失败时只杀掉子进程, 不影响 Flask 主服务
- 模型只在子进程加载, 避免重复占用主进程内存
- 多 worker 横向扩展 (后续可支持)

协议 (JSON over multiprocessing.Queue):
  Request:  {"cmd": "process", "sid": "...", "audio": <bytes>}
            {"cmd": "finalize", "sid": "..."}
            {"cmd": "reset", "sid": "..."}
            {"cmd": "shutdown"}
  Response: {"event": "transcription_result", "sid": "...", "text": "...", "is_final": bool, "latency_ms": float}
            {"event": "error", "sid": "...", "message": "..."}
            {"event": "ready"}
"""

import os
import sys
import json
import time
import signal
import traceback
import multiprocessing as mp


def worker_main(model_path: str, sample_rate: int, request_q, response_q):
    """
    Worker 主循环:
    1. 加载 Vosk 模型
    2. 监听请求队列
    3. 处理音频并发送结果
    """
    # 屏蔽 SIGINT 避免子进程被 Ctrl+C 杀掉
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
        SetLogLevel(0)  # 静默 C++ 日志, 避免污染 response_q
        model = Model(model_path)
        response_q.put({"event": "ready", "model": model_path})
    except Exception as e:
        response_q.put({"event": "fatal", "message": f"Model load failed: {e}"})
        return

    sessions: dict = {}

    def get_recognizer(sid: str):
        if sid not in sessions:
            # SetWords(True) 开启词级时间戳输出
            # result['result'] 里会带 'words': [{word, start, end, conf}]
            rec = KaldiRecognizer(model, sample_rate)
            try:
                rec.SetWords(True)
            except Exception:
                # 兼容老版本 vosk, 没这个方法时不强退
                pass
            sessions[sid] = rec
        return sessions[sid]

    while True:
        try:
            req = request_q.get()
        except (EOFError, KeyboardInterrupt):
            break

        if not isinstance(req, dict):
            continue

        cmd = req.get("cmd")

        if cmd == "shutdown":
            break

        if cmd == "reset":
            sid = req.get("sid")
            sessions.pop(sid, None)
            continue

        if cmd == "process":
            sid = req.get("sid")
            audio = req.get("audio", b"")
            if not audio:
                continue
            start = time.time()
            try:
                rec = get_recognizer(sid)
                if rec.AcceptWaveform(audio):
                    result = json.loads(rec.Result())
                    text = result.get("text", "")
                    latency = (time.time() - start) * 1000
                    if text:
                        # final 末尾自动加标点 (Vosk 不输出标点)
                        text = add_punctuation(text, is_final=True)
                        # 词级时间戳: Vosk 在 SetWords(True) 时, result 里会带 words
                        # 注意: rec.Result() 返回的可能是 {"text":..., "result": {"words":[...]}}
                        # 也可能是顶层 {"text":..., "words":[...]} (Vosk 不同版本有差异)
                        words = _extract_words(result)
                        response_q.put({
                            "event": "transcription_result",
                            "sid": sid,
                            "text": text,
                            "is_final": True,
                            "latency_ms": latency,
                            "words": words,
                        })
                else:
                    partial = json.loads(rec.PartialResult())
                    text = partial.get("partial", "")
                    latency = (time.time() - start) * 1000
                    if text:
                        # partial 不加末尾标点 (句子未完)
                        # Vosk partial 不返回 words, 前端用 final 的累积做高亮
                        response_q.put({
                            "event": "transcription_result",
                            "sid": sid,
                            "text": text,
                            "is_final": False,
                            "latency_ms": latency,
                            "words": [],
                        })
            except Exception as e:
                response_q.put({
                    "event": "error",
                    "sid": sid,
                    "message": f"{type(e).__name__}: {e}",
                    "traceback": traceback.format_exc(),
                })
                # 出错时丢弃该 session, 下次 process 会重建 recognizer
                sessions.pop(sid, None)
            continue

        if cmd == "finalize":
            sid = req.get("sid")
            rec = sessions.pop(sid, None)
            if rec:
                try:
                    final = json.loads(rec.FinalResult())
                    text = final.get("text", "")
                    if text:
                        words = _extract_words(final)
                        response_q.put({
                            "event": "transcription_result",
                            "sid": sid,
                            "text": add_punctuation(text, is_final=True),
                            "is_final": True,
                            "latency_ms": 0,
                            "words": words,
                        })
                except Exception as e:
                    response_q.put({
                        "event": "error",
                        "sid": sid,
                        "message": f"finalize: {e}",
                    })
            continue


def _extract_words(result: dict) -> list:
    """
    从 Vosk 返回的 result 字典里提取词级时间戳.
    兼容三种实际格式:
    - vosk 0.22 中文: result['result'] 是 LIST of {word,start,end,conf} ← 最常见
    - 旧版: result['result']['words'] 是 LIST
    - 顶层: result['words'] 是 LIST
    """
    if not isinstance(result, dict):
        return []
    candidates = []
    r = result.get("result")
    if isinstance(r, list):
        # vosk 0.22 中文: result.result 是个词列表
        candidates = r
    elif isinstance(r, dict):
        # 部分版本: result.result.words
        candidates = r.get("words") or []
    if not candidates:
        candidates = result.get("words") or []
    if not isinstance(candidates, list):
        return []
    out = []
    for w in candidates:
        if not isinstance(w, dict):
            continue
        word = w.get("word")
        if word is None or not str(word).strip():
            continue
        out.append({
            "word": str(word).strip(),
            "start": float(w.get("start", 0.0)),
            "end": float(w.get("end", 0.0)),
            "conf": float(w.get("conf", 0.0)),
        })
    return out


def start_worker(model_path: str, sample_rate: int = 16000):
    """
    启动 worker 子进程并返回 (process, request_q, response_q)
    """
    ctx = mp.get_context("spawn")  # macOS/Linux 通用
    request_q = ctx.Queue(maxsize=200)
    response_q = ctx.Queue(maxsize=200)
    p = ctx.Process(
        target=worker_main,
        args=(model_path, sample_rate, request_q, response_q),
        daemon=True,
        name="vosk-worker",
    )
    p.start()
    return p, request_q, response_q


if __name__ == "__main__":
    MODEL = os.path.join(os.path.dirname(__file__), "models", "vosk-model-cn-0.22")
    start_worker(MODEL)


# ============================================================================
# 标点恢复: Vosk 中文模型不输出标点, 简单的启发式加末尾标点
# 规则: final 末尾加 。, 中间按语气词加 ，, 疑问加 ？
# ============================================================================

# 中文语气词, 这些词之前加逗号
_PAUSE_BEFORE = ("但是", "不过", "因为", "所以", "如果", "虽然", "然而", "于是", "然后", "而且", "并且", "虽然说", "不但", "不仅", "只是")

# 疑问词, 整句加 ?
_QUESTION_WORDS = ("吗", "呢", "什么", "怎么", "哪", "谁", "为什么", "多少", "几", "如何")


def add_punctuation(text: str, is_final: bool = True) -> str:
    """给 final 转写结果加标点, partial 不动"""
    if not text or not is_final:
        return text
    text = text.strip()
    if not text:
        return text

    # 1. 整句末标点
    has_existing_punct = any(p in text[-1] for p in "。！？，；")
    if not has_existing_punct:
        # 疑问
        if any(w in text for w in _QUESTION_WORDS):
            text += "？"
        else:
            text += "。"

    # 2. 中间语气词前加逗号
    parts = text.split(" ")
    for i, w in enumerate(parts):
        if i > 0 and w in _PAUSE_BEFORE:
            if not parts[i - 1].endswith(("，", "。", "？", "！")):
                parts[i - 1] = parts[i - 1] + "，"
    text = "".join(parts)

    return text
