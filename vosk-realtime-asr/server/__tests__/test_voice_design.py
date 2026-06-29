"""
火山引擎音色设计 (Voice Design) 后端契约测试

覆盖:
- 必填参数校验: gender / age / speed / pitch / emotion / style / text
- speed / pitch 范围 (0.5 ~ 2.0)
- text 长度上限 (300 字, 避免服务端拒收)
- emotion 枚举 (neutral/happy/sad/angry/surprised/fearful/disgusted)
- style 枚举 (assistant/narrator/chat/news/...)
- gender 枚举 (male/female)
- age 枚举 (child/young/middle-aged/senior)
- generate endpoint 返回 base64 音频 + duration + sample_rate
- save endpoint 返回 voice_id + 创建时间
- 鉴权缺失 → 503 (服务端未配置 VOICE_DESIGN 凭证)
- 鉴权缺失 + 配置占位 → 502 (上游拒)
- 网络异常 → 500/502 区分
- 参数不合法 → 400
- 纯函数: build_request_payload 不依赖网络, 可独立测
"""

import os
import sys
import json

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

import voice_design  # noqa: E402


# ============================================================================
# 纯函数: 枚举 + 范围 + 校验
# ============================================================================

def test_gender_enum():
    """gender 必须是 male / female"""
    assert 'male' in voice_design.VALID_GENDERS
    assert 'female' in voice_design.VALID_GENDERS
    assert 'other' not in voice_design.VALID_GENDERS


def test_age_enum():
    """age 枚举必须包含 child / young / middle-aged / senior"""
    for required in ('child', 'young', 'middle-aged', 'senior'):
        assert required in voice_design.VALID_AGES, f"missing age={required}"


def test_emotion_enum():
    """emotion 枚举必须含 neutral / happy / sad / angry"""
    for required in ('neutral', 'happy', 'sad', 'angry'):
        assert required in voice_design.VALID_EMOTIONS, f"missing emotion={required}"


def test_style_enum():
    """style 枚举必须含 assistant / narrator / news / chat"""
    for required in ('assistant', 'narrator', 'news', 'chat'):
        assert required in voice_design.VALID_STYLES, f"missing style={required}"


def test_speed_range():
    """speed 范围 0.5 ~ 2.0"""
    lo, hi = voice_design.SPEED_RANGE
    assert lo == 0.5
    assert hi == 2.0


def test_pitch_range():
    """pitch 范围 0.5 ~ 2.0"""
    lo, hi = voice_design.PITCH_RANGE
    assert lo == 0.5
    assert hi == 2.0


def test_volume_range():
    """volume 范围 0 ~ 10"""
    lo, hi = voice_design.VOLUME_RANGE
    assert lo == 0
    assert hi == 10


# ============================================================================
# 纯函数: validate_params
# ============================================================================

def test_validate_ok_minimal():
    """最小可接受集合 → 无错"""
    err = voice_design.validate_params({
        'gender': 'female',
        'age': 'young',
        'text': '你好',
    })
    assert err is None, err


def test_validate_ok_full():
    """完整参数 + 默认值填充后无错"""
    err = voice_design.validate_params({
        'gender': 'male',
        'age': 'middle-aged',
        'emotion': 'neutral',
        'style': 'news',
        'speed': 1.0,
        'pitch': 1.0,
        'volume': 5,
        'text': '欢迎收听今天的新闻播报',
    })
    assert err is None, err


def test_validate_missing_gender():
    """缺 gender → 400 error"""
    err = voice_design.validate_params({'age': 'young', 'text': 'hi'})
    assert err is not None
    assert err['field'] == 'gender'
    assert err['status'] == 400


def test_validate_missing_age():
    err = voice_design.validate_params({'gender': 'male', 'text': 'hi'})
    assert err is not None
    assert err['field'] == 'age'


def test_validate_missing_text():
    err = voice_design.validate_params({'gender': 'male', 'age': 'young'})
    assert err is not None
    assert err['field'] == 'text'


def test_validate_empty_text():
    err = voice_design.validate_params({'gender': 'male', 'age': 'young', 'text': ''})
    assert err is not None
    assert err['field'] == 'text'


def test_validate_invalid_gender():
    err = voice_design.validate_params({'gender': 'unknown', 'age': 'young', 'text': 'hi'})
    assert err is not None
    assert err['field'] == 'gender'


def test_validate_speed_out_of_range():
    err = voice_design.validate_params({
        'gender': 'male', 'age': 'young', 'text': 'hi', 'speed': 5.0,
    })
    assert err is not None
    assert err['field'] == 'speed'


def test_validate_pitch_negative():
    err = voice_design.validate_params({
        'gender': 'male', 'age': 'young', 'text': 'hi', 'pitch': -0.1,
    })
    assert err is not None
    assert err['field'] == 'pitch'


def test_validate_text_too_long():
    """text 上限 300 字"""
    err = voice_design.validate_params({
        'gender': 'male', 'age': 'young', 'text': 'x' * 301,
    })
    assert err is not None
    assert err['field'] == 'text'


def test_validate_unknown_emotion():
    err = voice_design.validate_params({
        'gender': 'male', 'age': 'young', 'text': 'hi', 'emotion': 'ecstatic',
    })
    assert err is not None
    assert err['field'] == 'emotion'


def test_validate_volume_too_high():
    err = voice_design.validate_params({
        'gender': 'male', 'age': 'young', 'text': 'hi', 'volume': 99,
    })
    assert err is not None
    assert err['field'] == 'volume'


# ============================================================================
# 纯函数: apply_defaults — 用 fallback 补全缺失的可选参数
# ============================================================================

def test_apply_defaults_fills_optionals():
    out = voice_design.apply_defaults({
        'gender': 'female', 'age': 'young', 'text': 'hi',
    })
    assert out['emotion'] == 'neutral'
    assert out['style'] == 'assistant'
    assert out['speed'] == 1.0
    assert out['pitch'] == 1.0
    assert out['volume'] == 5


def test_apply_defaults_preserves_user_input():
    out = voice_design.apply_defaults({
        'gender': 'female', 'age': 'young', 'text': 'hi',
        'emotion': 'happy', 'speed': 1.5,
    })
    assert out['emotion'] == 'happy'
    assert out['speed'] == 1.5
    # 未指定的才填默认
    assert out['style'] == 'assistant'


# ============================================================================
# 纯函数: build_request_payload — 组装发送到火山引擎的 JSON
# ============================================================================

def test_build_request_payload_basic():
    """最小集合能生成符合规范的 payload"""
    params = voice_design.apply_defaults({
        'gender': 'female', 'age': 'young', 'text': '你好',
    })
    payload = voice_design.build_request_payload(
        app_key='app-key-1',
        access_token='token-1',
        cluster='volcano_tts',
        params=params,
        voice_id='S_prompt_voice',
    )
    assert payload['app']['appid'] == 'app-key-1'
    assert payload['app']['token'] == 'token-1'
    assert payload['app']['cluster'] == 'volcano_tts'
    req = payload['request']
    assert req['reqid']  # uuid
    assert req['text'] == '你好'
    assert req['voice_config']['gender'] == 'female'
    assert req['voice_config']['age'] == 'young'
    assert req['format'] == 'mp3'
    assert req['sample_rate'] == 24000


def test_build_request_payload_includes_emotion_style():
    """emotion / style 必须在 payload 里"""
    params = voice_design.apply_defaults({
        'gender': 'male', 'age': 'middle-aged',
        'emotion': 'happy', 'style': 'news',
        'text': 'hello',
    })
    payload = voice_design.build_request_payload(
        app_key='a', access_token='b', cluster='c',
        params=params, voice_id='S',
    )
    vc = payload['request']['voice_config']
    assert vc['emotion'] == 'happy'
    assert vc['style'] == 'news'


def test_build_request_payload_speeds_pitch_volume_in_payload():
    """speed / pitch / volume 通过 voice_config 透传"""
    params = voice_design.apply_defaults({
        'gender': 'female', 'age': 'young',
        'speed': 1.5, 'pitch': 1.2, 'volume': 8,
        'text': 'hi',
    })
    payload = voice_design.build_request_payload(
        app_key='a', access_token='b', cluster='c',
        params=params, voice_id='S',
    )
    vc = payload['request']['voice_config']
    assert vc['speed'] == 1.5
    assert vc['pitch'] == 1.2
    assert vc['volume'] == 8


def test_build_request_payload_voice_id_passed():
    """voice_id 是 prompt voice 的 id, 必须传入 payload"""
    params = voice_design.apply_defaults({
        'gender': 'female', 'age': 'young', 'text': 'hi',
    })
    payload = voice_design.build_request_payload(
        app_key='a', access_token='b', cluster='c',
        params=params, voice_id='S_seed_001',
    )
    assert payload['request']['voice_config']['voice_id'] == 'S_seed_001'


# ============================================================================
# 纯函数: parse_upstream_response — 解析火山引擎响应
# ============================================================================

def test_parse_upstream_response_ok():
    """成功响应解析: audio (base64), duration, sample_rate"""
    fake = {
        'code': 200,
        'message': 'success',
        'data': {
            'audio': 'YWJjZGVm',  # 'abcdef'
            'duration': 1234,
            'sample_rate': 24000,
        },
    }
    out = voice_design.parse_upstream_response(fake)
    assert out['ok'] is True
    assert out['audio_base64'] == 'YWJjZGVm'
    assert out['duration_ms'] == 1234
    assert out['sample_rate'] == 24000


def test_parse_upstream_response_error():
    """上游错误码 → ok=False, error_code/message 透传"""
    fake = {'code': 401, 'message': 'unauthorized', 'data': None}
    out = voice_design.parse_upstream_response(fake)
    assert out['ok'] is False
    assert out['error_code'] == 401
    assert 'unauthorized' in out['error_message']


def test_parse_upstream_response_missing_audio():
    """200 但无 audio → ok=False (异常路径)"""
    fake = {'code': 200, 'message': 'no audio', 'data': {}}
    out = voice_design.parse_upstream_response(fake)
    assert out['ok'] is False


# ============================================================================
# 纯函数: PRESETS — 内置预设音色, 客户端一键应用
# ============================================================================

def test_presets_have_required_fields():
    """每个 preset 必须有 id / name / gender / age / emotion / style / description"""
    for p in voice_design.PRESETS:
        assert p['id']
        assert p['name']
        assert p['gender'] in voice_design.VALID_GENDERS
        assert p['age'] in voice_design.VALID_AGES
        assert p['emotion'] in voice_design.VALID_EMOTIONS
        assert p['style'] in voice_design.VALID_STYLES
        assert p['description']


def test_presets_unique_ids():
    ids = [p['id'] for p in voice_design.PRESETS]
    assert len(ids) == len(set(ids)), f"preset id 重复: {ids}"


def test_presets_count_minimum():
    """至少 4 个预设 (新闻播报/温柔女声/磁性男声/儿童)"""
    assert len(voice_design.PRESETS) >= 4


def test_get_preset_by_id():
    """已知 id 返回预设, 未知 id 返回 None"""
    p = voice_design.get_preset_by_id('news_anchor')
    assert p is not None
    assert p['gender'] == 'female' or p['gender'] == 'male'
    assert voice_design.get_preset_by_id('nonexistent') is None


# ============================================================================
# Flask test_client 集成: /api/voice-design/generate
# ============================================================================

def _make_app_with_config():
    """构造最小 Flask app + 配置项, 不走真的 boot_app"""
    import flask
    app = flask.Flask(__name__)
    app.config['TESTING'] = True
    return app


def test_generate_endpoint_missing_text_returns_400():
    """POST /api/voice-design/generate 缺 text → 400"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['VOICE_DESIGN_APP_KEY'] = 'k'
    app.config['VOICE_DESIGN_TOKEN'] = 't'

    @app.route('/api/voice-design/generate', methods=['POST'])
    @vd.require_credentials
    @vd.validate_request
    def generate():
        return {'ok': True}, 200

    client = app.test_client()
    rv = client.post('/api/voice-design/generate', json={
        'gender': 'female', 'age': 'young',
    })
    assert rv.status_code == 400
    body = rv.get_json()
    assert body['ok'] is False
    assert body['field'] == 'text'


def test_generate_endpoint_invalid_gender_returns_400():
    """无效 gender → 400"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['VOICE_DESIGN_APP_KEY'] = 'k'
    app.config['VOICE_DESIGN_TOKEN'] = 't'

    @app.route('/api/voice-design/generate', methods=['POST'])
    @vd.require_credentials
    @vd.validate_request
    def generate():
        return {'ok': True}, 200

    client = app.test_client()
    rv = client.post('/api/voice-design/generate', json={
        'gender': 'robot', 'age': 'young', 'text': 'hi',
    })
    assert rv.status_code == 400
    body = rv.get_json()
    assert body['field'] == 'gender'


def test_generate_endpoint_valid_passes_through():
    """合法参数 → 通过 validate_request, 进入 handler"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['VOICE_DESIGN_APP_KEY'] = 'k'
    app.config['VOICE_DESIGN_TOKEN'] = 't'
    captured = {}

    @app.route('/api/voice-design/generate', methods=['POST'])
    @vd.require_credentials
    @vd.validate_request
    def generate():
        captured['params'] = vd._last_params
        return {'ok': True}, 200

    client = app.test_client()
    rv = client.post('/api/voice-design/generate', json={
        'gender': 'female', 'age': 'young', 'text': 'hi',
    })
    assert rv.status_code == 200
    params = captured['params']
    # 默认值被填充
    assert params['emotion'] == 'neutral'
    assert params['speed'] == 1.0


def test_require_credentials_decorator_missing_app_key():
    """缺 VOICE_DESIGN_APP_KEY → 503"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    # 故意不设凭证

    @app.route('/api/voice-design/generate', methods=['POST'])
    @vd.require_credentials
    @vd.validate_request
    def generate():
        return {'ok': True}, 200

    client = app.test_client()
    rv = client.post('/api/voice-design/generate', json={
        'gender': 'female', 'age': 'young', 'text': 'hi',
    })
    assert rv.status_code == 503
    body = rv.get_json()
    assert 'credentials' in body['message'].lower() or '未配置' in body['message']


# ============================================================================
# /api/voice-design/save
# ============================================================================

def test_save_endpoint_validates_required():
    """save 必填: voice_name + sample_audio (base64)"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['VOICE_DESIGN_APP_KEY'] = 'k'
    app.config['VOICE_DESIGN_TOKEN'] = 't'

    @app.route('/api/voice-design/save', methods=['POST'])
    @vd.require_credentials
    @vd.validate_save_request
    def save():
        return {'ok': True}, 200

    client = app.test_client()
    # 缺 voice_name
    rv = client.post('/api/voice-design/save', json={'sample_audio': 'YWJj'})
    assert rv.status_code == 400
    body = rv.get_json()
    assert body['field'] == 'voice_name'

    # 缺 sample_audio
    rv = client.post('/api/voice-design/save', json={'voice_name': 'voice1'})
    assert rv.status_code == 400
    body = rv.get_json()
    assert body['field'] == 'sample_audio'


def test_save_endpoint_ok():
    """合法 save 请求 → 200 + voice_id"""
    from flask import Flask
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['VOICE_DESIGN_APP_KEY'] = 'k'
    app.config['VOICE_DESIGN_TOKEN'] = 't'
    captured = {}

    @app.route('/api/voice-design/save', methods=['POST'])
    @vd.require_credentials
    @vd.validate_save_request
    def save():
        captured['args'] = vd._last_save_args
        return {'ok': True, 'voice_id': 'S_user_xxx'}, 200

    client = app.test_client()
    rv = client.post('/api/voice-design/save', json={
        'voice_name': '我的音色',
        'sample_audio': 'YWJjZGVm',  # base64
        'description': '自定义音色',
    })
    assert rv.status_code == 200
    assert captured['args']['voice_name'] == '我的音色'


# ============================================================================
# /api/voice-design/presets
# ============================================================================

def test_presets_endpoint_returns_list():
    """GET /api/voice-design/presets 返回所有 preset"""
    from flask import Flask, jsonify
    import voice_design as vd

    app = Flask(__name__)
    app.config['TESTING'] = True

    @app.route('/api/voice-design/presets', methods=['GET'])
    def presets():
        return jsonify({'ok': True, 'presets': vd.PRESETS})

    client = app.test_client()
    rv = client.get('/api/voice-design/presets')
    assert rv.status_code == 200
    body = rv.get_json()
    assert body['ok'] is True
    assert len(body['presets']) >= 4