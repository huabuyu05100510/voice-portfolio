"""
file_asr.py — 录音文件识别 2.0 代理 TDD 测试

测试覆盖:
  - 提交: 鉴权 header 正确, URL 提交走通, body 含必要字段
  - 轮询: 状态解析 (queued / running / done / failed)
  - 取结果: 解析 utterances / speakers / words
  - 错误: 4xx / 5xx / 任务失败 都返回明确错误
  - 凭据缺失: 启动时校验

Author: MiniMax-M3 (2026-06-27)
"""
import json
import os
import sys
from unittest.mock import MagicMock, patch

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------
def _reload_module():
    """每次都重 import, 确保环境变量修改生效. 同时给模块装一个 fake requests
    (因为测试环境可能没装真实 requests, 而我们要 mock 它)."""
    import importlib
    if 'file_asr' in sys.modules:
        del sys.modules['file_asr']
    fa = importlib.import_module('file_asr')
    # 装一个 stub requests, 便于 patch.object(fa.requests, 'post', ...)
    if not getattr(fa, '_REQUESTS_AVAILABLE', False):
        class _StubRequests:
            post = None
            get = None
        fa.requests = _StubRequests()
    return fa


def _set_env(monkeypatch, appid='app-123', token='tk-abc', cluster='volc'):
    monkeypatch.setenv('VOLC_FILE_ASR_APP_ID', appid)
    monkeypatch.setenv('VOLC_FILE_ASR_TOKEN', token)
    monkeypatch.setenv('VOLC_FILE_ASR_CLUSTER', cluster)


# ----------------------------------------------------------------------------
# 1) 凭据校验
# ----------------------------------------------------------------------------
def test_load_config_requires_appid_token(monkeypatch):
    """没有 VOLC_FILE_ASR_APP_ID/TOKEN 时, load_config 抛错"""
    monkeypatch.delenv('VOLC_FILE_ASR_APP_ID', raising=False)
    monkeypatch.delenv('VOLC_FILE_ASR_TOKEN', raising=False)
    fa = _reload_module()
    try:
        fa.load_config()
    except RuntimeError as e:
        assert 'APP_ID' in str(e) and 'TOKEN' in str(e)
        return
    raise AssertionError("应该 raise RuntimeError, 但没抛")


def test_load_config_ok(monkeypatch):
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()
    assert cfg['app_id'] == 'app-123'
    assert cfg['token'] == 'tk-abc'
    assert cfg['cluster'] == 'volc'
    assert 'endpoint' in cfg
    assert 'submit_path' in cfg
    assert 'query_path' in cfg


# ----------------------------------------------------------------------------
# 2) Submit (POST)
# ----------------------------------------------------------------------------
def test_submit_file_url_uses_bearer_auth(monkeypatch):
    """URL 提交: 鉴权用 Bearer token, body 含 url + 必要参数"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0,
        'message': 'ok',
        'data': {'task_id': 'tid-001', 'status': 'queued'},
    }
    fake_resp.raise_for_status = MagicMock()

    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured['url'] = url
        captured['headers'] = headers
        captured['json'] = json
        return fake_resp

    with patch.object(fa.requests, 'post', side_effect=fake_post):
        result = fa.submit_file_url(
            cfg,
            file_url='https://example.com/audio.mp3',
            speaker_count=-1,
            enable_diarization=True,
        )
    assert result['task_id'] == 'tid-001'
    assert result['status'] == 'queued'

    # URL 走 submit_path
    assert captured['url'].endswith(cfg['submit_path'])
    # Bearer 鉴权
    assert captured['headers']['Authorization'] == 'Bearer; tk-abc'
    # X-Api-Key / X-Cluster 都带上
    assert captured['headers']['X-Api-Key'] == 'app-123'
    assert captured['headers']['X-Cluster'] == 'volc'
    # body 字段
    body = captured['json']
    assert body['audio']['url'] == 'https://example.com/audio.mp3'
    assert body['audio']['format'] == 'mp3'  # 从 url 推断
    assert body['request']['enable_diarization'] is True
    # 火山 wire 字段名: diarization_speaker_count (也接受 speaker_count 别名)
    spk_cnt = body['request'].get('diarization_speaker_count', body['request'].get('speaker_count'))
    assert spk_cnt == -1


def test_submit_file_url_format_inference(monkeypatch):
    """从 url 推断 format: mp3 / wav / m4a / mp4 / mov"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()
    captured = {}

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0,
        'message': 'ok',
        'data': {'task_id': 'tid', 'status': 'queued'},
    }
    fake_resp.raise_for_status = MagicMock()

    def fake_post(url, headers=None, json=None, timeout=None):
        captured['format'] = json['audio']['format']
        return fake_resp

    for url, expected in [
        ('https://x/a.mp3', 'mp3'),
        ('https://x/a.wav', 'wav'),
        ('https://x/a.m4a', 'm4a'),
        ('https://x/v.mp4', 'mp4'),
        ('https://x/v.mov', 'mov'),
    ]:
        captured.clear()
        with patch.object(fa.requests, 'post', side_effect=fake_post):
            fa.submit_file_url(cfg, file_url=url, enable_diarization=False, speaker_count=0)
        assert captured['format'] == expected, f"url={url} -> {captured['format']}, expected {expected}"


def test_submit_file_url_http_error(monkeypatch):
    """HTTP 4xx/5xx 抛 FileAsrError"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()

    fake_resp = MagicMock()
    fake_resp.status_code = 401
    fake_resp.raise_for_status.side_effect = Exception('401 Unauthorized')

    with patch.object(fa.requests, 'post', return_value=fake_resp):
        try:
            fa.submit_file_url(cfg, file_url='https://x/a.mp3', enable_diarization=False, speaker_count=0)
        except fa.FileAsrError as e:
            assert 'submit' in str(e).lower()
            return
    raise AssertionError("FileAsrError not raised")


def test_submit_file_url_business_error(monkeypatch):
    """HTTP 200 但 code != 0 也算错"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {'code': 1001, 'message': 'invalid file url'}
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'post', return_value=fake_resp):
        try:
            fa.submit_file_url(cfg, file_url='https://x/a.mp3', enable_diarization=False, speaker_count=0)
        except fa.FileAsrError as e:
            assert 'invalid file url' in str(e)
            return
    raise AssertionError("FileAsrError not raised")


# ----------------------------------------------------------------------------
# 3) Query (GET)
# ----------------------------------------------------------------------------
def test_query_normalizes_status(monkeypatch):
    """query 解析并归一化 status: running / done / failed"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()

    captured = {}

    def fake_get(url, headers=None, params=None, timeout=None):
        captured['url'] = url
        captured['params'] = params
        captured['headers'] = headers
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            'code': 0,
            'message': 'ok',
            'data': {'task_id': 'tid-1', 'status': 'Running'},
        }
        resp.raise_for_status = MagicMock()
        return resp

    with patch.object(fa.requests, 'get', side_effect=fake_get):
        s = fa.query_task(cfg, task_id='tid-1')
    assert s['status'] == 'running'
    assert s['task_id'] == 'tid-1'
    assert captured['params']['task_id'] == 'tid-1'
    assert captured['url'].endswith(cfg['query_path'])


def test_query_done_includes_utterances(monkeypatch):
    """done 时 query 应当返回 utterances"""
    _set_env(monkeypatch)
    fa = _reload_module()
    cfg = fa.load_config()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0,
        'message': 'ok',
        'data': {
            'task_id': 'tid-2',
            'status': 'Done',
            'utterances': [
                {
                    'text': '你好',
                    'start_time': 0,
                    'end_time': 1000,
                    'speaker_id': 'spk0',
                    'definite': True,
                }
            ],
        },
    }
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'get', return_value=fake_resp):
        s = fa.query_task(cfg, task_id='tid-2')
    assert s['status'] == 'done'
    assert s['utterances'][0]['text'] == '你好'
    assert s['utterances'][0]['speaker_id'] == 'spk0'


# ----------------------------------------------------------------------------
# 4) Result 解析
# ----------------------------------------------------------------------------
def test_parse_result_extracts_speakers_and_text():
    """纯函数: parse_result 提取 speakers / text / utterances"""
    fa = _reload_module()
    raw = {
        'utterances': [
            {
                'text': '你好',
                'start_time': 0,
                'end_time': 1000,
                'speaker_id': 'spk0',
                'words': [
                    {'text': '你', 'start_time': 0, 'end_time': 500},
                    {'text': '好', 'start_time': 500, 'end_time': 1000},
                ],
            },
            {
                'text': '世界',
                'start_time': 1500,
                'end_time': 2500,
                'speaker_id': 'spk1',
            },
        ]
    }
    out = fa.parse_result(raw)
    assert out['text'] == '你好世界'
    assert out['utterances'][0]['text'] == '你好'
    assert out['utterances'][1]['speaker_id'] == 'spk1'
    # 2 个不同 speaker
    assert out['speakers'] == [{'id': 'spk0'}, {'id': 'spk1'}]


def test_parse_result_clamps_malformed():
    """缺字段 / 字段错时, parse_result 不抛, 走兜底"""
    fa = _reload_module()
    out = fa.parse_result({})
    assert out['text'] == ''
    assert out['utterances'] == []
    assert out['speakers'] == []


# ----------------------------------------------------------------------------
# 5) 文件大小 / 时长限制
# ----------------------------------------------------------------------------
def test_file_size_limit_constant():
    fa = _reload_module()
    assert fa.MAX_FILE_BYTES >= 100 * 1024 * 1024  # 至少 100MB
    assert fa.MAX_DURATION_SEC > 0


def test_validate_file_accepts_supported():
    fa = _reload_module()
    # 实际只校验扩展名 + size
    for ext in ('.mp3', '.wav', '.m4a', '.mp4', '.mov'):
        ok, why = fa.validate_file_meta(
            filename=f'audio{ext}',
            size_bytes=1_000_000,
            duration_sec=60,
        )
        assert ok is True, f"{ext} should be supported: {why}"


def test_validate_file_rejects_unsupported():
    fa = _reload_module()
    ok, why = fa.validate_file_meta(filename='a.txt', size_bytes=10, duration_sec=1)
    assert ok is False
    assert 'unsupported' in why.lower() or 'format' in why.lower() or 'not' in why.lower()


def test_validate_file_rejects_oversize():
    fa = _reload_module()
    ok, why = fa.validate_file_meta(
        filename='a.mp3',
        size_bytes=fa.MAX_FILE_BYTES + 1,
        duration_sec=60,
    )
    assert ok is False
    assert 'size' in why.lower() or 'large' in why.lower()


# ----------------------------------------------------------------------------
# 6) Endpoints (Flask test_client)
# ----------------------------------------------------------------------------
def _client():
    """构造一个最小 Flask test_client, 挂上 file_asr endpoints"""
    from flask import Flask
    from file_asr import register_routes
    app = Flask(__name__)
    register_routes(app)
    return app.test_client()


def test_endpoint_submit_url(monkeypatch):
    _set_env(monkeypatch)
    fa = _reload_module()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0, 'message': 'ok',
        'data': {'task_id': 'tid-x', 'status': 'queued'},
    }
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'post', return_value=fake_resp):
        c = _client()
        r = c.post('/api/file-asr/submit', json={
            'file_url': 'https://x/a.mp3',
            'enable_diarization': True,
            'speaker_count': -1,
        })
    assert r.status_code == 200
    body = r.get_json()
    assert body['task_id'] == 'tid-x'
    assert body['status'] == 'queued'


def test_endpoint_submit_rejects_missing_url(monkeypatch):
    _set_env(monkeypatch)
    c = _client()
    r = c.post('/api/file-asr/submit', json={'enable_diarization': True})
    assert r.status_code == 400


def test_endpoint_status(monkeypatch):
    _set_env(monkeypatch)
    fa = _reload_module()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0, 'message': 'ok',
        'data': {'task_id': 'tid-s', 'status': 'Done'},
    }
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'get', return_value=fake_resp):
        c = _client()
        r = c.get('/api/file-asr/status/tid-s')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'done'


def test_endpoint_result(monkeypatch):
    _set_env(monkeypatch)
    fa = _reload_module()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0, 'message': 'ok',
        'data': {
            'task_id': 'tid-r',
            'utterances': [
                {'text': 'hi', 'start_time': 0, 'end_time': 100, 'speaker_id': 's0'},
            ],
        },
    }
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'get', return_value=fake_resp):
        c = _client()
        r = c.get('/api/file-asr/result/tid-r')
    assert r.status_code == 200
    body = r.get_json()
    assert body['text'] == 'hi'
    assert body['utterances'][0]['speaker_id'] == 's0'
    assert body['speakers'] == [{'id': 's0'}]


def test_endpoint_status_failed_task(monkeypatch):
    _set_env(monkeypatch)
    fa = _reload_module()

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        'code': 0, 'message': 'ok',
        'data': {'task_id': 'tid-f', 'status': 'Failed', 'error': 'bad audio'},
    }
    fake_resp.raise_for_status = MagicMock()

    with patch.object(fa.requests, 'get', return_value=fake_resp):
        c = _client()
        r = c.get('/api/file-asr/status/tid-f')
    assert r.status_code == 200
    body = r.get_json()
    assert body['status'] == 'failed'
    assert 'bad audio' in body.get('error', '')
