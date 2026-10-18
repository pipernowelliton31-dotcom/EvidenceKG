"""Local API settings. Secrets never appear in public settings or the frontend bundle."""
import base64
import ctypes
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

BUILTIN_PROVIDERS = {
    'deepseek': {'label': 'DeepSeek', 'base': 'https://api.deepseek.com',
                 'env': 'BUILTIN_DEEPSEEK_API_KEY', 'models': ['deepseek-flash']},
    'openrouter': {'label': 'OpenRouter', 'base': 'https://openrouter.ai/api/v1',
                   'env': 'BUILTIN_OPENROUTER_API_KEY', 'models': [
                       'nvidia/nemotron-3.5-super-vl:free',
                       'dots-studio/dots-3-note-preview:free',
                       'deepseek/deepseek-v4.1-flash-1017']},
}


def resolve_settings(custom, values):
    """Resolve server-only credentials without copying them into saved settings."""
    providers = [{'id': name, 'label': item['label'], 'models': item['models'],
                  'configured': bool(str(values.get(item['env']) or '').strip())}
                 for name, item in BUILTIN_PROVIDERS.items()]
    config = {**custom, 'mode': custom.get('mode', 'custom'),
              'builtin_providers': providers, '_custom': custom}
    if config['mode'] == 'builtin':
        provider = custom.get('builtin_provider', 'deepseek')
        item = BUILTIN_PROVIDERS.get(provider)
        model = custom.get('builtin_model')
        # A changed or invalid local selection must never expand the allowlist.
        if item is None or model not in item['models']:
            provider, item = 'deepseek', BUILTIN_PROVIDERS['deepseek']
            model = item['models'][0]
        config.update(base=item['base'], model=model, builtin_provider=provider,
                      builtin_model=model, key=str(values.get(item['env']) or '').strip(), key_warning='')
    return config


class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(value, decrypt=False):
    if os.name != 'nt':
        raise ValueError('持久保存密钥目前需要 Windows；其他系统可使用服务端 .env')
    raw = base64.b64decode(value) if decrypt else value.encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    incoming = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    method = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not method(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ValueError('Windows 密钥保护失败，请使用本机 .env 配置')
    try:
        result = ctypes.string_at(outgoing.data, outgoing.size)
        return result.decode('utf-8') if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.data)


def stored_settings(directory):
    path = Path(directory) / 'local_api.json'
    if not path.is_file():
        return {}
    config = json.loads(path.read_text(encoding='utf-8'))
    encrypted = config.pop('protected_key', '')
    if encrypted:
        try:
            config['key'] = protect(encrypted, decrypt=True)
        except (ValueError, TypeError, OSError):
            # DPAPI keys can belong to another Windows account/computer after a
            # portable folder is copied. Keep its nonsecret settings and file;
            # omit the unusable key so .env and a newly entered key still work.
            config.pop('key', None)
            config['key_warning'] = '原密钥无法在当前 Windows 账户或电脑解密，请在模型设置中重新填写并保存本机 API 密钥。'
    return config


def save_settings(directory, current, body):
    if body.mode == 'builtin':
        item = BUILTIN_PROVIDERS.get(body.builtin_provider)
        if item is None:
            raise ValueError('请选择有效的内置服务商')
        if body.model not in item['models']:
            raise ValueError('此模型不在该服务商的内置测试列表中')
        ready = next((p['configured'] for p in current.get('builtin_providers', [])
                      if p['id'] == body.builtin_provider), False)
        if not ready:
            raise ValueError(f"{item['label']} 内置密钥尚未配置，请先填写服务端 .env")
        if body.key or body.clear_key:
            raise ValueError('内置测试模式不接受修改密钥')
        path = Path(directory) / 'local_api.json'
        config = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
        config.update(mode='builtin', builtin_provider=body.builtin_provider, builtin_model=body.model,
                      effort=body.effort, max_tokens=body.max_tokens, auto_continue=body.auto_continue)
        persist_settings(path, config)
        return config
    current = current.get('_custom', current)
    base = body.base.strip().rstrip('/')
    url = urlsplit(base)
    if url.scheme not in {'https', 'http'} or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('API 地址需为不含密钥的 http(s) Base URL，例如 https://openrouter.ai/api/v1')
    if url.scheme == 'http' and url.hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('远程 API 请使用 HTTPS；HTTP 仅用于本机模型')
    if not body.model.strip():
        raise ValueError('请填写模型 ID')
    key = '' if body.clear_key else body.key.strip() or current['key']
    config = {'mode': 'custom', 'base': base, 'model': body.model.strip(), 'effort': body.effort,
              'max_tokens': body.max_tokens, 'auto_continue': body.auto_continue}
    if key:
        config['protected_key'] = protect(key)
    elif body.clear_key:
        config['key'] = ''
    path = Path(directory) / 'local_api.json'
    persist_settings(path, config)
    return {**config, 'key': key}


def persist_settings(path, config):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def public_settings(config):
    warning = config.get('key_warning', '')
    public = {'base': config['base'], 'model': config['model'], 'effort': config['effort'],
            'max_tokens': config.get('max_tokens', 16384), 'auto_continue': config.get('auto_continue', 2),
            'api_configured': bool(config['key']), 'key_warning': warning,
            'key_hint': '已配置 · 密钥不回传' if config['key'] else '原密钥无法读取 · 请重新填写' if warning else '尚未配置密钥'}
    public.update(mode=config.get('mode', 'custom'), builtin_provider=config.get('builtin_provider', 'deepseek'),
                  builtin_providers=config.get('builtin_providers', []))
    custom = config.get('_custom', config)
    public['custom'] = {name: custom[name] for name in ('base', 'model')}
    public['custom'].update(api_configured=bool(custom['key']),
                            key_hint='已配置 · 密钥不回传' if custom['key'] else '尚未配置密钥')
    return public
