"""
Test: 直接连火山引擎 WebSocket 试一下认证 + 一小段音频
"""
import websocket
import json
import time
import sys
import wave
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

APP_KEY = os.environ.get('VOLC_APP_KEY', 'be7a469d-3937-40ff-882a-7d72398c44c6')
ACCESS_TOKEN = os.environ.get('VOLC_ACCESS_TOKEN', APP_KEY)
CLUSTER = os.environ.get('VOLC_CLUSTER', 'volcengine_streaming_common')
MODEL_NAME = os.environ.get("VOLC_MODEL_NAME", "bigmodel")

print(f'APP_KEY 长度: {len(APP_KEY)}')
print(f'CLUSTER: {CLUSTER}')
print(f'MODEL: {MODEL_NAME}')

# 协议版本 1.1, header size 1 (=4 bytes)
# Message types:
#   0x1: client full request
#   0x2: client audio only
#   0x9: server full response
#   0xB: server error
#   0xC: server partial response
#   0xF: server final response
def make_client_full_request(payload: dict) -> bytes:
    body = json.dumps(payload).encode('utf-8')
    # byte 0: 0x11 (version 1.1)
    # byte 1: 0x01 (header size = 1 * 4 = 4 bytes)
    # byte 2: high 4 bits = message type 0x1, low 4 bits = flags 0x0
    # byte 3: payload size high 8 bits
    # bytes 4-5: payload size low 16 bits
    # total header: 6 bytes for payload > 16KB, 4 bytes for < 16KB
    if len(body) < 0xFFFF:
        # small message, 4-byte header
        header = bytes([0x11, 0x01, 0x10, len(body) & 0xFF])
    else:
        # large message, 6-byte header with 24-bit size
        size = len(body)
        header = bytes([
            0x11, 0x02, 0x10,
            (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF,
        ])
    return header + body

def make_client_audio(audio: bytes) -> bytes:
    # byte 2: high 4 bits = 0x2 (audio), low 4 bits = 0x0
    if len(audio) < 0xFFFF:
        header = bytes([0x11, 0x01, 0x20, len(audio) & 0xFF])
    else:
        size = len(audio)
        header = bytes([
            0x11, 0x02, 0x20,
            (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF,
        ])
    return header + audio

def parse_response(data: bytes) -> dict:
    """Parse server response: 4-byte header + JSON payload"""
    if len(data) < 4:
        return {'raw': data.hex()}
    msg_type = (data[2] >> 4) & 0x0F
    flags = data[2] & 0x0F
    if data[1] == 1:
        payload_size = (data[3] << 8) | 0  # high 8 bits only? actually high 4 + 8 = 12 bits
        # Actually the format is:
        # byte 3 = high 8 bits of size
        # bytes 4-5 = low 16 bits (if header size > 1)
        # For header size 1 (4 bytes total), we only have 1 byte for size? That's only 256 bytes max
        # Let me re-read the spec
        payload = data[4:]
    else:
        size = (data[3] << 16) | (data[4] << 8) | data[5]
        payload = data[6:6+size]

    type_names = {0x1: 'full_req', 0x2: 'audio', 0x9: 'full_resp', 0xB: 'error', 0xC: 'partial_resp', 0xF: 'final_resp'}
    type_name = type_names.get(msg_type, f'unknown_0x{msg_type:X}')

    try:
        parsed = json.loads(payload.decode('utf-8'))
    except Exception as e:
        parsed = {'_parse_error': str(e), '_raw': payload[:500].decode('utf-8', errors='replace')}

    return {'type': type_name, 'flags': flags, 'payload': parsed, 'raw_size': len(data)}


def main():
    # 1. 读音频
    audio_path = '/tmp/sample-rolling.wav'
    if not os.path.exists(audio_path):
        print('NO AUDIO')
        return
    w = wave.open(audio_path, 'rb')
    assert w.getnchannels() == 1
    assert w.getframerate() == 16000
    assert w.getsampwidth() == 2
    audio_data = w.readframes(w.getnframes())
    w.close()
    print(f'音频: {len(audio_data)} 字节, {len(audio_data)/32000:.1f}秒')

    # 2. WebSocket 连接
    url = 'wss://openspeech.bytedance.com/api/v2/sauc/bigmodel'
    headers = {
        'Authorization': f'Bearer; {ACCESS_TOKEN}',
        'X-Api-Resource-Id': MODEL_NAME,
        'X-Api-App-Key': APP_KEY,
        'X-Api-Access-Key': ACCESS_TOKEN,
    }
    print(f'\n连接: {url}')
    print(f'Authorization: Bearer; {ACCESS_TOKEN[:10]}...')

    ws = websocket.create_connection(url, header=[f'{k}: {v}' for k, v in headers.items()], timeout=10)
    print('✅ WebSocket 已连接')

    # 3. 发送 full request (config + 第一段音频)
    full_req = {
        'user': {'uid': 'test_user'},
        'namespace': 'Bidirectional',
        'model_name': MODEL_NAME,
        'input': {
            'format': 'pcm_s16le',
            'sample_rate': 16000,
            'channels': 1,
        },
        'parameters': {
            'app': {
                'appid': APP_KEY.split('-')[0] if '-' in APP_KEY else APP_KEY[:8],
                'token': ACCESS_TOKEN,
                'cluster': CLUSTER,
            },
            'show_utterances': True,
            'show_speaker_info': True,  # 关键: 要说话人分离
        },
        'audio': audio_data[:6400].hex(),  # 头一段 200ms
    }
    print('\n发送 full request + 头 200ms 音频...')
    ws.send_binary(make_client_full_request(full_req))

    # 4. 接收响应
    print('\n等待响应...')
    try:
        ws.settimeout(8)
        while True:
            try:
                data = ws.recv()
                if isinstance(data, str):
                    print(f'文本帧: {data[:300]}')
                else:
                    resp = parse_response(data)
                    print(f'\n[响应 type={resp["type"]} flags={resp["flags"]} size={resp["raw_size"]}]')
                    payload = resp['payload']
                    if isinstance(payload, dict):
                        # 打印关键字段
                        for k in ('text', 'utterances', 'result', 'audio_info', 'error', 'message'):
                            if k in payload:
                                v = payload[k]
                                if isinstance(v, str) and len(v) > 200:
                                    v = v[:200] + '...'
                                print(f'  {k}: {v}')
                        if 'result' in payload and isinstance(payload['result'], dict):
                            for k, v in payload['result'].items():
                                if k != 'utterances':
                                    print(f'  result.{k}: {v}')
                    if resp['type'] in ('final_resp', 'error'):
                        break
            except websocket.WebSocketTimeoutException:
                print('(timeout, no more data)')
                break
    finally:
        ws.close()
        print('\n连接关闭')

    # 5. 发送剩余音频
    print('\n发送剩余音频 + audio-only 帧...')
    ws = websocket.create_connection(url, header=[f'{k}: {v}' for k, v in headers.items()], timeout=10)
    try:
        # full request
        full_req['audio'] = audio_data[:6400].hex()
        ws.send_binary(make_client_full_request(full_req))
        time.sleep(0.3)
        # drain initial
        ws.settimeout(2)
        try:
            while ws.recv(): pass
        except: pass
        # chunked audio
        for i in range(6400, len(audio_data), 6400):
            chunk = audio_data[i:i+6400]
            ws.send_binary(make_client_audio(chunk))
            time.sleep(0.05)
            ws.settimeout(0.2)
            try:
                while True:
                    data = ws.recv()
                    resp = parse_response(data)
                    print(f'  [chunk {i//6400}] type={resp["type"]} payload={json.dumps(resp["payload"], ensure_ascii=False)[:200]}')
            except websocket.WebSocketTimeoutException:
                pass
        # finish
        time.sleep(1.5)
        ws.settimeout(2)
        try:
            while True:
                data = ws.recv()
                resp = parse_response(data)
                print(f'  [final] type={resp["type"]} payload={json.dumps(resp["payload"], ensure_ascii=False)[:300]}')
        except: pass
    finally:
        ws.close()


if __name__ == '__main__':
    main()
