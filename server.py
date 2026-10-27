# -*- coding: utf-8 -*-
"""幻想乡酒馆 · 本地服务器
纯 Python 标准库：静态站点 + OpenAI 兼容流式代理 + 存档 + 记忆/建议/纠偏。
"""
import json
import gzip
import hmac
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import uuid
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import engine
import offline

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
DATA = os.path.join(ROOT, 'data')
# 云端可把存档/配置挂到持久磁盘；本地默认仍用 data/saves 与 config.json
SAVES = os.environ.get('TAVERN_SAVE_DIR') or os.path.join(DATA, 'saves')
CONFIG_PATH = os.environ.get('TAVERN_CONFIG') or os.path.join(ROOT, 'config.json')
os.makedirs(SAVES, exist_ok=True)
ACCESS_TOKEN = os.environ.get('TAVERN_TOKEN', '')

VERSION = '1.0.0'
DEFAULT_CONFIG = {
    'base_url': 'https://api.deepseek.com/v1',
    'model': 'deepseek-chat',
    'api_key': '',
    'temperature': 0.85,
    'max_tokens': 900,
    'top_p': 0.95,
    'presence_penalty': 0.25,
    'frequency_penalty': 0.25,
    'guard': True,
    'strictness': 2,
    'context_limit': 24000,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding='utf-8') as f:
                cfg.update(json.load(f) or {})
        except Exception:
            pass
    # 云端用环境变量注入，避免把 Key 写进镜像或仓库
    for env_name, key in (
        ('TAVERN_API_KEY', 'api_key'),
        ('DEEPSEEK_API_KEY', 'api_key'),
        ('TAVERN_BASE_URL', 'base_url'),
        ('DEEPSEEK_BASE_URL', 'base_url'),
        ('TAVERN_MODEL', 'model'),
    ):
        val = os.environ.get(env_name)
        if val:
            cfg[key] = val
    return cfg


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_PATH) or '.', exist_ok=True)
    tmp = CONFIG_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    os.replace(tmp, CONFIG_PATH)


def sanitized_config(cfg):
    key = cfg.get('api_key') or ''
    masked = ''
    if key:
        masked = key[:4] + '…' + key[-4:] if len(key) > 10 else '已保存'
    return {
        'base_url': cfg.get('base_url', ''),
        'model': cfg.get('model', ''),
        'has_key': bool(key),
        'masked_key': masked,
        'temperature': cfg.get('temperature', 0.85),
        'max_tokens': cfg.get('max_tokens', 900),
        'top_p': cfg.get('top_p', 0.95),
        'presence_penalty': cfg.get('presence_penalty', 0.25),
        'frequency_penalty': cfg.get('frequency_penalty', 0.25),
        'guard': cfg.get('guard', True),
        'strictness': cfg.get('strictness', 2),
        'context_limit': cfg.get('context_limit', 24000),
    }


def chat_url(base):
    base = (base or '').strip().rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    if re.search(r'/v\d+$', base):
        return base + '/chat/completions'
    return base + '/chat/completions'


def models_url(base):
    base = (base or '').strip().rstrip('/')
    if base.endswith('/chat/completions'):
        base = base[:-len('/chat/completions')]
    if re.search(r'/v\d+$', base):
        return base + '/models'
    return base + '/models'


def provider_error_message(code, body):
    body = (body or '')[:500]
    hints = {
        401: 'API Key 无效或已过期，请到设置里重新填写。',
        403: '这个 Key 没有访问该模型的权限。',
        404: '接口地址不存在，请检查 Base URL（通常以 /v1 结尾）。',
        429: '请求太频繁或额度用完了，稍后再试。',
        500: '模型服务端出错了，稍后再试。',
        502: '网关错误，检查 Base URL 或代理。',
        503: '模型服务暂时不可用。',
    }
    hint = hints.get(code, f'HTTP {code}')
    return f'{hint}\n{body}'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'GensokyoTavern/' + VERSION

    # ------------------------------------------------------------ 基础
    def log_message(self, fmt, *args):
        sys.stdout.write('%s  %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    def _send(self, code, body=b'', ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        extra = dict(extra or {})
        if len(body) > 1024 and 'gzip' in (self.headers.get('Accept-Encoding') or ''):
            body = gzip.compress(body, 5)
            extra['Content-Encoding'] = 'gzip'
            extra['Vary'] = 'Accept-Encoding'
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json_body(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n > 4 * 1024 * 1024:
            raise ValueError('请求过大')
        raw = self.rfile.read(n) if n else b'{}'
        return json.loads(raw.decode('utf-8') or '{}')

    def _cors(self):
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ------------------------------------------------------------ 访问令牌
    def _login_page(self, message=''):
        msg = ('<p class="err">' + message + '</p>') if message else '<p class="hint">输入部署时设置的 TAVERN_TOKEN。</p>'
        html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>幻想乡酒馆 · 访问令牌</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#140d0a;color:#f3e6d6;font-family:system-ui,"Microsoft YaHei",sans-serif}
.box{width:min(92vw,360px);padding:28px;border:1px solid rgba(217,176,106,.3);border-radius:18px;background:#1d1410}
h1{font-size:22px;margin:0 0 8px}.hint{color:#bfae9c;font-size:13px;line-height:1.7}.err{color:#ffb9b1;font-size:13px}
input{width:100%;box-sizing:border-box;margin:14px 0;padding:11px 12px;border-radius:9px;border:1px solid #5a4436;background:#100b09;color:#f3e6d6;font-size:15px}
button{width:100%;padding:11px;border:0;border-radius:9px;background:#c9534f;color:#fff;font-size:15px;cursor:pointer}
</style>
<form class="box" method="post" action="/login">
<h1>幻想乡酒馆</h1>__MSG__
<input name="token" type="password" placeholder="访问令牌" autofocus autocomplete="current-password">
<button type="submit">进入酒馆</button>
</form></html>'''.replace('__MSG__', msg)
        self._send(401, html, 'text/html; charset=utf-8')

    def _redirect_auth(self, location):
        self.send_response(302)
        self.send_header('Set-Cookie', 'tavern_auth=' + ACCESS_TOKEN + '; Path=/; HttpOnly; SameSite=Lax')
        self.send_header('Location', location or '/')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _check_auth(self):
        if not ACCESS_TOKEN:
            return True
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            if '=' in part:
                k, v = part.strip().split('=', 1)
                if k == 'tavern_auth' and hmac.compare_digest(v, ACCESS_TOKEN):
                    return True
        qs = parse_qs(urlparse(self.path).query)
        supplied = (qs.get('token') or [''])[0]
        if supplied and hmac.compare_digest(supplied, ACCESS_TOKEN):
            self._redirect_auth(urlparse(self.path).path or '/')
            return False
        self._login_page()
        return False

    def _handle_login(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(n).decode('utf-8', 'replace') if n else ''
        supplied = (parse_qs(raw).get('token') or [''])[0]
        if supplied and hmac.compare_digest(supplied, ACCESS_TOKEN):
            self._redirect_auth('/')
        else:
            self._login_page('令牌不对，再试一次。')

    # ------------------------------------------------------------ 路由
    def do_OPTIONS(self):
        self._cors()

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        try:
            if path == '/api/health':
                return self._send(200, {'ok': True, 'version': VERSION, 'time': int(time.time())})
            if path == '/login':
                return self._login_page()
            if not self._check_auth():
                return
            if path == '/api/bootstrap':
                cards = []
                for c in engine.characters():
                    # 前端只展示卡面；system_prompt 留在服务端，避免 bootstrap 过大
                    cards.append({k: v for k, v in c.items() if k not in ('system_prompt', 'deep_persona')})
                return self._send(200, {
                    'version': VERSION,
                    'characters': cards,
                    'scenarios': engine.scenarios(),
                    'scenes': engine.scenes(),
                    'lore': [{'id': e.get('id'), 'title': e.get('title')} for e in engine.lorebook()],
                    'map': engine.map_data(),
                    'config': sanitized_config(load_config()),
                    'saves': list_saves(),
                })
            if path == '/api/saves':
                return self._send(200, {'saves': list_saves()})
            if path.startswith('/api/saves/'):
                sid = path.split('/')[-1]
                return self._send(200, read_save(sid))
            if path == '/api/config':
                return self._send(200, sanitized_config(load_config()))
            return self.serve_static(path)
        except FileNotFoundError:
            self._send(404, {'error': '没有找到这个文件'})
        except Exception as e:
            self._send(500, {'error': str(e)})

    def do_HEAD(self):
        self.do_GET()

    def do_DELETE(self):
        u = urlparse(self.path)
        if not self._check_auth():
            return
        if u.path.startswith('/api/saves/'):
            sid = u.path.split('/')[-1]
            p = os.path.join(SAVES, os.path.basename(sid) + '.json')
            if os.path.exists(p):
                os.remove(p)
            return self._send(200, {'ok': True})
        self._send(404, {'error': '未知接口'})

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        if path == '/login':
            return self._handle_login()
        if not self._check_auth():
            return
        try:
            body = self._json_body()
        except Exception as e:
            return self._send(400, {'error': '请求格式错误：' + str(e)})
        try:
            if path == '/api/config':
                return self.handle_config(body)
            if path == '/api/chat':
                return self.handle_chat(body)
            if path == '/api/suggest':
                return self.handle_suggest(body)
            if path == '/api/summary':
                return self.handle_summary(body)
            if path == '/api/guard':
                return self.handle_guard(body)
            if path == '/api/test':
                return self.handle_test(body)
            if path == '/api/saves':
                return self.handle_save(body)
            self._send(404, {'error': '未知接口'})
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self._send(500, {'error': '服务器错误：' + str(e)})
            except Exception:
                pass

    # ------------------------------------------------------------ 静态
    def serve_static(self, path):
        if path in ('/', ''):
            path = '/index.html'
        rel = path.lstrip('/')
        full = os.path.realpath(os.path.join(WEB, rel))
        if not full.startswith(os.path.realpath(WEB) + os.sep):
            return self._send(403, {'error': '禁止访问'})
        if not os.path.isfile(full):
            # SPA 回退
            if '.' not in rel:
                full = os.path.join(WEB, 'index.html')
            else:
                raise FileNotFoundError(path)
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if full.endswith('.svg'):
            ctype = 'image/svg+xml'
        if full.endswith('.js'):
            ctype = 'application/javascript; charset=utf-8'
        if full.endswith('.css'):
            ctype = 'text/css; charset=utf-8'
        with open(full, 'rb') as f:
            data = f.read()
        extra = {'Cache-Control': 'public, max-age=3600'} if '/assets/' in path else {}
        self._send(200, data, ctype, extra)

    # ------------------------------------------------------------ 配置
    def handle_config(self, body):
        cfg = load_config()
        for k in ('base_url', 'model'):
            if isinstance(body.get(k), str) and body[k].strip():
                cfg[k] = body[k].strip()
        if body.get('clear_key'):
            cfg['api_key'] = ''
        elif isinstance(body.get('api_key'), str) and body['api_key'].strip():
            cfg['api_key'] = body['api_key'].strip()
        for k in ('temperature', 'top_p', 'presence_penalty', 'frequency_penalty'):
            if isinstance(body.get(k), (int, float)):
                cfg[k] = float(body[k])
        for k in ('max_tokens', 'strictness', 'context_limit'):
            if isinstance(body.get(k), (int, float)):
                cfg[k] = int(body[k])
        if isinstance(body.get('guard'), bool):
            cfg['guard'] = body['guard']
        save_config(cfg)
        self._send(200, {'ok': True, 'config': sanitized_config(cfg)})

    # ------------------------------------------------------------ LLM
    def _llm_request(self, cfg, payload, stream=True, timeout=180):
        key = cfg.get('api_key') or ''
        url = chat_url(cfg.get('base_url'))
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', 'Bearer ' + key)
        req.add_header('Accept', 'text/event-stream' if stream else 'application/json')
        return urllib.request.urlopen(req, timeout=timeout)

    def _payload(self, cfg, messages, stream, temperature=None, max_tokens=None, json_mode=False):
        p = {
            'model': cfg.get('model') or 'deepseek-chat',
            'messages': messages,
            'stream': stream,
            'temperature': cfg.get('temperature', 0.85) if temperature is None else temperature,
            'max_tokens': cfg.get('max_tokens', 900) if max_tokens is None else max_tokens,
            'top_p': cfg.get('top_p', 0.95),
            'presence_penalty': cfg.get('presence_penalty', 0.25),
            'frequency_penalty': cfg.get('frequency_penalty', 0.25),
        }
        if json_mode:
            p['response_format'] = {'type': 'json_object'}
        return p

    def _llm_once(self, cfg, messages, temperature=0.6, max_tokens=800, json_mode=False):
        payload = self._payload(cfg, messages, False, temperature, max_tokens, json_mode)
        try:
            with self._llm_request(cfg, payload, stream=False) as resp:
                raw = resp.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')
            raise RuntimeError(provider_error_message(e.code, body))
        obj = json.loads(raw)
        return (obj.get('choices') or [{}])[0].get('message', {}).get('content', '') or ''

    def handle_chat(self, body):
        cfg = load_config()
        state = body.get('state') or body
        advance = bool(body.get('advance'))
        want_offline = bool(body.get('offline')) or not cfg.get('api_key')
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('Connection', 'close')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        self.close_connection = True

        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj, ensure_ascii=False) + '\n\n').encode('utf-8'))
            self.wfile.flush()

        def chunks(text, size=14):
            for i in range(0, len(text), size):
                yield text[i:i + size]

        try:
            if not state.get('history') and not state.get('user_message'):
                text = offline.opening(state)
                send({'type': 'start', 'offline': True})
                for c in chunks(text):
                    send({'type': 'delta', 'text': c})
                    time.sleep(0.012)
                send({'type': 'done', 'offline': True})
                return
            if want_offline:
                text = offline.reply(state)
                send({'type': 'start', 'offline': True})
                for c in chunks(text):
                    send({'type': 'delta', 'text': c})
                    time.sleep(0.014)
                g = engine.guard_check(text, (engine.character_map().get((state.get('character_ids') or [''])[0])))
                send({'type': 'guard', 'guard': g})
                send({'type': 'done', 'offline': True})
                return

            messages, sys_prompt = engine.build_messages(state, advance=advance)
            payload = self._payload(cfg, messages, True)
            send({'type': 'start', 'model': cfg.get('model'), 'prompt_tokens': engine.est_tokens(sys_prompt)})
            full = []
            try:
                with self._llm_request(cfg, payload, stream=True) as resp:
                    for raw in resp:
                        line = raw.decode('utf-8', 'replace').strip()
                        if not line or not line.startswith('data:'):
                            continue
                        data = line[5:].strip()
                        if data == '[DONE]':
                            break
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = obj.get('choices') or []
                        if not choices:
                            continue
                        delta = choices[0].get('delta') or {}
                        piece = delta.get('content') or ''
                        if piece:
                            full.append(piece)
                            send({'type': 'delta', 'text': piece})
                        rc = delta.get('reasoning_content')
                        if rc:
                            send({'type': 'reasoning', 'text': rc})
                        if choices[0].get('finish_reason'):
                            send({'type': 'finish_reason', 'value': choices[0]['finish_reason']})
            except urllib.error.HTTPError as e:
                body_txt = e.read().decode('utf-8', 'replace')
                send({'type': 'error', 'message': provider_error_message(e.code, body_txt)})
                return
            text = ''.join(full).strip()
            if not text:
                send({'type': 'error', 'message': '模型没有返回内容。可能是 Key 额度不足、模型名不对，或接口不兼容。'})
                return
            if cfg.get('guard', True):
                card = engine.character_map().get((state.get('character_ids') or [''])[0])
                send({'type': 'guard', 'guard': engine.guard_check(text, card)})
            send({'type': 'done', 'chars': len(text)})
        except BrokenPipeError:
            return
        except Exception as e:
            try:
                send({'type': 'error', 'message': '生成失败：' + str(e)})
            except Exception:
                pass

    def handle_suggest(self, body):
        cfg = load_config()
        state = body.get('state') or body
        if not cfg.get('api_key'):
            return self._send(200, {'choices': offline.suggest(state), 'offline': True})
        cmap = engine.character_map()
        cards = [cmap[i] for i in state.get('character_ids') or [] if i in cmap]
        sc = engine.scenario_map().get(state.get('scenario_id') or '')
        act = ''
        if sc:
            idx = max(0, min(int(state.get('act_index') or 0), len(sc['acts']) - 1))
            a = sc['acts'][idx]
            act = f'当前剧本：{sc["title"]}\n当前幕：{a["title"]}｜目标：{a.get("goal","")}\n玩家身份：{sc.get("player_role","")}'
        convo = '\n'.join(
            f'{"玩家" if m.get("role")=="user" else "角色"}：{engine.clip(m.get("content",""), 200)}'
            for m in (state.get('history') or [])[-4:])
        prompt = f'''你是角色扮演的"行动建议"生成器。根据下面的场景，为玩家生成 3 个可以立刻发送的中文行动/台词选项。
要求：每个 10～28 字；第一人称或祈使句；风格符合玩家身份；三个选项方向不同（1 个稳妥、1 个大胆、1 个情感向）；只输出 JSON：{{"choices":["...","...","..."]}}。
{act}
在场角色：{'、'.join(c['name'] for c in cards)}
最近对话：
{convo}'''
        try:
            raw = self._llm_once(cfg, [{'role': 'user', 'content': prompt}], temperature=0.9, max_tokens=260, json_mode=True)
            obj = parse_json_loose(raw)
            choices = [str(x).strip() for x in (obj.get('choices') or []) if str(x).strip()][:3]
            if len(choices) < 3:
                raise ValueError('数量不足')
            return self._send(200, {'choices': choices})
        except Exception:
            return self._send(200, {'choices': offline.suggest(state), 'offline': True})

    def handle_summary(self, body):
        cfg = load_config()
        state = body.get('state') or body
        history = state.get('history') or []
        cmap = engine.character_map()
        cards = [cmap[i] for i in state.get('character_ids') or [] if i in cmap]
        name = cards[0]['name'] if cards else ''
        if not cfg.get('api_key') or not history:
            return self._send(200, {'summary': '', 'facts': [], 'relations': {}, 'offline': True})
        prompt = engine.memory_prompt(history, name)
        try:
            raw = self._llm_once(cfg, [{'role': 'user', 'content': prompt}], temperature=0.3, max_tokens=600, json_mode=True)
            obj = parse_json_loose(raw)
            out = {
                'summary': str(obj.get('summary') or '')[:800],
                'facts': [str(x)[:80] for x in (obj.get('facts') or [])][:8],
                'relations': obj.get('relations') if isinstance(obj.get('relations'), dict) else {},
            }
            return self._send(200, out)
        except Exception as e:
            return self._send(200, {'summary': '', 'facts': [], 'relations': {}, 'error': str(e)})

    def handle_guard(self, body):
        cfg = load_config()
        text = (body.get('text') or '').strip()
        ids = body.get('character_ids') or []
        cmap = engine.character_map()
        card = cmap.get(ids[0]) if ids else None
        g = engine.guard_check(text, card)
        if not body.get('rewrite'):
            return self._send(200, {'guard': g})
        if not cfg.get('api_key'):
            return self._send(200, {'guard': g, 'text': text, 'offline': True})
        prompt = f'''下面是一段角色扮演回复，出现了"出戏"问题：{'、'.join(g['issues']) or '风格不稳定'}。
请在不改变剧情内容的前提下重写，要求：
- 保持角色「{card["name"] if card else "角色"}」的口吻与格式：台词用「」，动作用（），旁白用【】；
- 删除所有 AI/程序/设定/提示词相关的自我指涉；
- 不替玩家说话，不重复玩家台词；
- 长度与原文接近；只输出重写后的正文，不要解释。
原文：
{text}'''
        try:
            out = self._llm_once(cfg, [{'role': 'user', 'content': prompt}], temperature=0.55, max_tokens=min(1200, len(text) * 2 + 200))
            return self._send(200, {'guard': g, 'text': out.strip()})
        except Exception as e:
            return self._send(200, {'guard': g, 'text': text, 'error': str(e)})

    def handle_test(self, body):
        cfg = load_config()
        if body.get('base_url'):
            cfg['base_url'] = body['base_url']
        if body.get('model'):
            cfg['model'] = body['model']
        if body.get('api_key'):
            cfg['api_key'] = body['api_key']
        if not cfg.get('api_key'):
            return self._send(200, {'ok': False, 'message': '还没有填写 API Key。'})
        try:
            req = urllib.request.Request(models_url(cfg['base_url']))
            req.add_header('Authorization', 'Bearer ' + cfg['api_key'])
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode('utf-8', 'replace'))
            models = [m.get('id') for m in (data.get('data') or []) if isinstance(m, dict)][:8]
            return self._send(200, {'ok': True, 'message': '连接成功', 'models': models})
        except urllib.error.HTTPError as e:
            if e.code in (404, 405):
                try:
                    out = self._llm_once(cfg, [{'role': 'user', 'content': '回复"ok"'}], temperature=0, max_tokens=8)
                    return self._send(200, {'ok': True, 'message': '连接成功（已通过对话测试）', 'sample': out[:40]})
                except Exception as e2:
                    return self._send(200, {'ok': False, 'message': str(e2)})
            return self._send(200, {'ok': False, 'message': provider_error_message(e.code, e.read().decode('utf-8', 'replace'))})
        except Exception as e:
            return self._send(200, {'ok': False, 'message': str(e)})

    # ------------------------------------------------------------ 存档
    def handle_save(self, body):
        state = body.get('state') or body
        sid = re.sub(r'[^a-zA-Z0-9_-]', '', str(body.get('id') or state.get('id') or '')) or uuid.uuid4().hex[:12]
        record = {
            'id': sid,
            'title': str(body.get('title') or state.get('title') or '未命名会话')[:80],
            'mode': state.get('mode') or 'character',
            'scenario_id': state.get('scenario_id') or state.get('scenarioId') or '',
            'character_ids': state.get('character_ids') or state.get('characterIds') or [],
            'updated_at': int(time.time()),
            'turns': len([m for m in (state.get('messages') or []) if m.get('role') == 'user']),
            'state': state,
        }
        p = os.path.join(SAVES, sid + '.json')
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(record, f, ensure_ascii=False)
        os.replace(tmp, p)
        self._send(200, {'ok': True, 'id': sid, 'saves': list_saves()})


# ---------------------------------------------------------------- 工具
def parse_json_loose(raw):
    raw = (raw or '').strip()
    raw = re.sub(r'^```(?:json)?', '', raw).strip()
    raw = re.sub(r'```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r'\{.*\}', raw, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def list_saves():
    out = []
    for name in os.listdir(SAVES):
        if not name.endswith('.json'):
            continue
        try:
            with open(os.path.join(SAVES, name), encoding='utf-8') as f:
                d = json.load(f)
            out.append({k: d.get(k) for k in ('id', 'title', 'mode', 'scenario_id', 'character_ids', 'updated_at', 'turns')})
        except Exception:
            continue
    out.sort(key=lambda x: -(x.get('updated_at') or 0))
    return out


def read_save(sid):
    sid = os.path.basename(sid)
    p = os.path.join(SAVES, sid + '.json')
    if not os.path.exists(p):
        raise FileNotFoundError(sid)
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    global ACCESS_TOKEN
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    port = int(os.environ.get('PORT', '8765'))
    host = '127.0.0.1'
    for i, arg in enumerate(sys.argv):
        if arg == '--port' and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
        if arg == '--host' and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
        if arg == '--token' and i + 1 < len(sys.argv):
            ACCESS_TOKEN = sys.argv[i + 1]
        if arg == '--lan':
            host = '0.0.0.0'
    cfg = load_config()
    if not os.path.exists(CONFIG_PATH):
        try:
            save_config(cfg)
        except Exception:
            pass
    httpd = None
    for p in range(port, port + 12):
        try:
            httpd = ThreadingHTTPServer((host, p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print('端口都被占用了，请用 --port 换一个端口。')
        return
    local_url = 'http://127.0.0.1:%d' % port
    lan_url = local_url
    if host in ('0.0.0.0', '::'):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            lan_url = 'http://%s:%d' % (s.getsockname()[0], port)
            s.close()
        except Exception:
            lan_url = 'http://<电脑局域网IP>:%d' % port
    try:
        with open(os.path.join(ROOT, 'runtime_url.txt'), 'w', encoding='utf-8') as f:
            f.write(local_url + '\n')
    except Exception:
        pass
    print('=' * 52)
    print('  幻想乡酒馆 · Gensokyo Tavern  v%s' % VERSION)
    print('  电脑访问：' + local_url)
    if host in ('0.0.0.0', '::'):
        print('  手机访问：' + lan_url)
        print('  （手机与电脑需在同一 Wi-Fi；仅局域网可见）')
    print('  角色 %d · 剧本 %d · 模型 %s' % (len(engine.characters()), len(engine.scenarios()), cfg.get('model')))
    print('  API Key: %s' % ('已配置' if cfg.get('api_key') else '未配置（离线演示模式）'))
    print('  访问令牌: %s' % ('已启用' if ACCESS_TOKEN else '未设置（仅适合本机/可信局域网）'))
    print('  关闭窗口即可停止服务')
    print('=' * 52)
    if '--open' in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(local_url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')


if __name__ == '__main__':
    main()
