import argparse
import asyncio
import base64
from collections import deque
import hashlib
import hmac
import importlib
import json
import mimetypes
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import urlsplit

try:
    import tomllib
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    from PIL import Image
except Exception:  # Pillow is already a project dependency, but keep startup resilient.
    Image = None

APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent
UI_DIST = APP_DIR / "ui" / "dist"
SETTINGS_FILE = PROJECT_ROOT / "settings.json"
RECENT_PROJECTS_FILE = PROJECT_ROOT / "settings_web_recent_projects.json"
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

WEB_AUTH_MODE = os.environ.get("DIFFPIPE_WEB_AUTH", "off").strip().casefold()
WEB_AUTH_COOKIE_NAME = "diffpipe_session"
WEB_AUTH_LOGIN_MAX_BODY_BYTES = 8192
WEB_AUTH_LOGIN_BODY_TIMEOUT_SECONDS = 8.0
WEB_AUTH_SESSION_SECONDS = int(os.environ.get("DIFFPIPE_WEB_AUTH_SESSION_SECONDS", str(12 * 60 * 60)))
WEB_AUTH_LOGIN_WINDOW_SECONDS = int(os.environ.get("DIFFPIPE_WEB_AUTH_LOGIN_WINDOW_SECONDS", "60"))
WEB_AUTH_LOGIN_MAX_ATTEMPTS = int(os.environ.get("DIFFPIPE_WEB_AUTH_LOGIN_MAX_ATTEMPTS", "5"))
WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS = int(
    os.environ.get("DIFFPIPE_WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS", "10")
)
WEB_AUTH_MAX_SESSIONS = int(os.environ.get("DIFFPIPE_WEB_AUTH_MAX_SESSIONS", "64"))
WEB_AUTH_YOUYUN_TIMEOUT_SECONDS = float(os.environ.get("DIFFPIPE_WEB_AUTH_YOUYUN_TIMEOUT_SECONDS", "15"))

if WEB_AUTH_MODE not in {"off", "system", "youyun"}:
    raise RuntimeError("DIFFPIPE_WEB_AUTH must be 'off', 'system', or 'youyun'")
if WEB_AUTH_SESSION_SECONDS < 60 or WEB_AUTH_SESSION_SECONDS > 7 * 24 * 60 * 60:
    raise RuntimeError("DIFFPIPE_WEB_AUTH_SESSION_SECONDS must be between 60 and 604800")
if WEB_AUTH_LOGIN_WINDOW_SECONDS < 1:
    raise RuntimeError("DIFFPIPE_WEB_AUTH_LOGIN_WINDOW_SECONDS must be positive")
if WEB_AUTH_LOGIN_MAX_ATTEMPTS < 1 or WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS < 1:
    raise RuntimeError("Web login attempt limits must be positive")
if WEB_AUTH_MAX_SESSIONS < 1:
    raise RuntimeError("DIFFPIPE_WEB_AUTH_MAX_SESSIONS must be positive")
if WEB_AUTH_YOUYUN_TIMEOUT_SECONDS < 5 or WEB_AUTH_YOUYUN_TIMEOUT_SECONDS > 30:
    raise RuntimeError("DIFFPIPE_WEB_AUTH_YOUYUN_TIMEOUT_SECONDS must be between 5 and 30")

_web_auth_secret = secrets.token_bytes(32)
_web_auth_state_lock = threading.Lock()
_web_auth_sessions: dict[str, int] = {}
_web_auth_attempts_by_client: dict[str, deque[float]] = {}
_web_auth_global_attempts: deque[float] = deque()
_youyun_auth_slots = threading.BoundedSemaphore(2)
_system_password_hash: str | None = None
_system_crypt: Any = None
_youyun_hostname: str | None = None
_youyun_ssh_host_public_key: str | None = None


def _load_system_password_auth() -> tuple[str, Any]:
    if os.name != "posix" or platform.system() != "Linux":
        raise RuntimeError("DIFFPIPE_WEB_AUTH=system requires a Linux host")
    try:
        crypt_module = importlib.import_module("crypt")
    except (ImportError, OSError) as exc:
        raise RuntimeError(
            "DIFFPIPE_WEB_AUTH=system requires Python crypt support backed by the system libcrypt"
        ) from exc

    try:
        shadow_lines = Path("/etc/shadow").read_text(encoding="utf-8", errors="strict").splitlines()
    except (OSError, UnicodeError) as exc:
        raise RuntimeError(
            "DIFFPIPE_WEB_AUTH=system must run with permission to read /etc/shadow"
        ) from exc

    password_hash = next(
        (line.split(":", 2)[1] for line in shadow_lines if line.startswith("root:")),
        None,
    )
    if not password_hash or password_hash.startswith(("!", "*")):
        raise RuntimeError(
            "DIFFPIPE_WEB_AUTH=system requires the Linux root account to have an active password"
        )
    try:
        probe = crypt_module.crypt("diffpipe-auth-support-check", password_hash)
    except (OSError, ValueError) as exc:
        raise RuntimeError("The Linux root password hash is not supported by system libcrypt") from exc
    if not probe or probe.startswith("*0"):
        raise RuntimeError("The Linux root password hash is not supported by system libcrypt")
    return password_hash, crypt_module


if WEB_AUTH_MODE == "system":
    _system_password_hash, _system_crypt = _load_system_password_auth()
elif WEB_AUTH_MODE == "youyun":
    _youyun_hostname = socket.gethostname()
    if re.fullmatch(r"cpod-[a-z0-9]+", _youyun_hostname) is None:
        raise RuntimeError(
            "DIFFPIPE_WEB_AUTH=youyun requires a platform hostname matching cpod-[a-z0-9]+"
        )
    for executable in (Path("/usr/bin/ssh"), Path("/usr/bin/setsid")):
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise RuntimeError(f"DIFFPIPE_WEB_AUTH=youyun requires {executable}")
    try:
        public_key_fields = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text(
            encoding="ascii",
            errors="strict",
        ).split()
        if len(public_key_fields) < 2 or public_key_fields[0] != "ssh-ed25519":
            raise ValueError("not an Ed25519 host key")
        base64.b64decode(public_key_fields[1], validate=True)
        _youyun_ssh_host_public_key = f"{public_key_fields[0]} {public_key_fields[1]}"
    except (OSError, UnicodeError, ValueError) as exc:
        raise RuntimeError(
            "DIFFPIPE_WEB_AUTH=youyun requires a readable Ed25519 OpenSSH host public key"
        ) from exc


def _web_auth_enabled() -> bool:
    return WEB_AUTH_MODE in {"system", "youyun"}


def _verify_system_password(password: str) -> bool:
    if not _system_password_hash or _system_crypt is None:
        return False
    try:
        candidate = _system_crypt.crypt(password, _system_password_hash)
    except (OSError, ValueError):
        return False
    return bool(candidate) and hmac.compare_digest(candidate, _system_password_hash)


def _verify_youyun_ssh_credentials(ssh_port: Any, password: str) -> bool:
    hostname = _youyun_hostname
    host_public_key = _youyun_ssh_host_public_key
    if (
        hostname is None
        or re.fullmatch(r"cpod-[a-z0-9]+", hostname) is None
        or not host_public_key
    ):
        return False
    if isinstance(ssh_port, bool) or not isinstance(ssh_port, (int, str)):
        return False
    port_raw = str(ssh_port)
    if re.fullmatch(r"[0-9]{1,5}", port_raw) is None:
        return False
    port = int(port_raw)
    if port < 1 or port > 65535:
        return False
    if not isinstance(password, str) or not password:
        return False
    try:
        if len(password.encode("utf-8")) > 4096:
            return False
    except UnicodeError:
        return False
    if not _youyun_auth_slots.acquire(blocking=False):
        return False

    target = f"{hostname}.podtcp.compshare.cn"
    try:
        with tempfile.TemporaryDirectory(prefix="diffpipe-web-auth-") as temp_dir_raw:
            temp_dir = Path(temp_dir_raw)
            os.chmod(temp_dir, 0o700)
            known_hosts = temp_dir / "known_hosts"
            askpass = temp_dir / "askpass.sh"
            known_hosts.write_text(
                f"[{target}]:{port} {host_public_key}\n",
                encoding="ascii",
            )
            askpass.write_text(
                '#!/bin/sh\nprintf %s "$DIFFPIPE_SSH_PASSWORD"\n',
                encoding="ascii",
            )
            os.chmod(known_hosts, 0o600)
            os.chmod(askpass, 0o700)
            command = [
                "/usr/bin/setsid",
                "--wait",
                "/usr/bin/ssh",
                "-F",
                "/dev/null",
                "-o",
                f"UserKnownHostsFile={known_hosts}",
                "-o",
                "GlobalKnownHostsFile=/dev/null",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "BatchMode=no",
                "-o",
                "PreferredAuthentications=password",
                "-o",
                "PasswordAuthentication=yes",
                "-o",
                "PubkeyAuthentication=no",
                "-o",
                "KbdInteractiveAuthentication=no",
                "-o",
                "HostKeyAlgorithms=ssh-ed25519",
                "-o",
                "UpdateHostKeys=no",
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ConnectionAttempts=1",
                "-o",
                "LogLevel=ERROR",
                "-p",
                str(port),
                f"root@{target}",
                "true",
            ]
            child_env = {
                "PATH": "/usr/bin:/bin",
                "LANG": "C",
                "DISPLAY": "diffpipe-auth:0",
                "SSH_ASKPASS": str(askpass),
                "SSH_ASKPASS_REQUIRE": "force",
                "DIFFPIPE_SSH_PASSWORD": password,
            }
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=child_env,
                timeout=WEB_AUTH_YOUYUN_TIMEOUT_SECONDS,
                check=False,
            )
            return result.returncode == 0
    except Exception:
        # Authentication fails closed. In particular, never propagate an SSH
        # exception whose text could contain environment or connection data.
        return False
    finally:
        _youyun_auth_slots.release()


def _verify_web_auth_credentials(payload: dict[str, Any]) -> bool:
    if WEB_AUTH_MODE == "system":
        credential = payload.get("credential")
        return isinstance(credential, str) and _verify_system_password(credential)
    if WEB_AUTH_MODE == "youyun":
        password = payload.get("password")
        return isinstance(password, str) and _verify_youyun_ssh_credentials(
            payload.get("ssh_port"),
            password,
        )
    return False


def _prune_web_auth_sessions(now: int) -> None:
    expired = [nonce for nonce, expires_at in _web_auth_sessions.items() if expires_at <= now]
    for nonce in expired:
        _web_auth_sessions.pop(nonce, None)


def _issue_web_auth_session(now: int | None = None) -> str:
    issued_at = int(time.time()) if now is None else now
    expires_at = issued_at + WEB_AUTH_SESSION_SECONDS
    nonce = secrets.token_urlsafe(24)
    payload = f"v1.{expires_at}.{nonce}"
    signature = hmac.new(_web_auth_secret, payload.encode("ascii"), hashlib.sha256).hexdigest()
    with _web_auth_state_lock:
        _prune_web_auth_sessions(issued_at)
        while len(_web_auth_sessions) >= WEB_AUTH_MAX_SESSIONS:
            oldest = min(_web_auth_sessions, key=_web_auth_sessions.get)  # type: ignore[arg-type]
            _web_auth_sessions.pop(oldest, None)
        _web_auth_sessions[nonce] = expires_at
    return f"{payload}.{signature}"


def _web_auth_session_details(token: str | None, now: int | None = None) -> tuple[str, int] | None:
    if not token or len(token) > 512:
        return None
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v1":
        return None
    _, expires_raw, nonce, signature = parts
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", nonce):
        return None
    if not re.fullmatch(r"[a-f0-9]{64}", signature):
        return None
    try:
        expires_at = int(expires_raw)
    except ValueError:
        return None
    current = int(time.time()) if now is None else now
    if expires_at <= current:
        return None
    payload = f"v1.{expires_at}.{nonce}"
    expected = hmac.new(_web_auth_secret, payload.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    with _web_auth_state_lock:
        _prune_web_auth_sessions(current)
        if _web_auth_sessions.get(nonce) != expires_at:
            return None
    return nonce, expires_at


def _revoke_web_auth_session(token: str | None) -> None:
    details = _web_auth_session_details(token)
    if details is None:
        return
    with _web_auth_state_lock:
        _web_auth_sessions.pop(details[0], None)


def _canonical_authority(value: str) -> tuple[str, int | None] | None:
    try:
        parsed = urlsplit(f"//{value.strip()}")
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if not hostname or parsed.username or parsed.password:
        return None
    return hostname.rstrip(".").casefold(), port


def _origin_matches_host(headers: Any) -> bool:
    origin = str(headers.get("origin") or "").strip()
    try:
        parsed_origin = urlsplit(origin)
        origin_authority = _canonical_authority(parsed_origin.netloc)
    except ValueError:
        return False
    if parsed_origin.scheme not in {"http", "https"} or origin_authority is None:
        return False
    if parsed_origin.path not in {"", "/"} or parsed_origin.query or parsed_origin.fragment:
        return False

    candidates: set[tuple[str, int | None]] = set()
    for header_name in ("host", "x-forwarded-host"):
        raw = str(headers.get(header_name) or "")
        for value in raw.split(","):
            authority = _canonical_authority(value)
            if authority is not None:
                candidates.add(authority)
    if origin_authority in candidates:
        return True

    # A trusted TLS proxy commonly forwards an HTTPS origin to an HTTP
    # application and may add or remove the default port.
    origin_host, origin_port = origin_authority
    normalized_origin_port = origin_port or (443 if parsed_origin.scheme == "https" else 80)
    for candidate_host, candidate_port in candidates:
        if candidate_host != origin_host:
            continue
        if candidate_port is None or candidate_port == normalized_origin_port:
            return True
    return False


def _consume_login_attempt(client_key: str, now: float | None = None) -> int | None:
    current = time.monotonic() if now is None else now
    cutoff = current - WEB_AUTH_LOGIN_WINDOW_SECONDS
    with _web_auth_state_lock:
        while _web_auth_global_attempts and _web_auth_global_attempts[0] <= cutoff:
            _web_auth_global_attempts.popleft()
        attempts = _web_auth_attempts_by_client.setdefault(client_key, deque())
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if (
            len(attempts) >= WEB_AUTH_LOGIN_MAX_ATTEMPTS
            or len(_web_auth_global_attempts) >= WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS
        ):
            waits: list[float] = []
            if len(attempts) >= WEB_AUTH_LOGIN_MAX_ATTEMPTS:
                waits.append(attempts[0] + WEB_AUTH_LOGIN_WINDOW_SECONDS - current)
            if len(_web_auth_global_attempts) >= WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS:
                waits.append(_web_auth_global_attempts[0] + WEB_AUTH_LOGIN_WINDOW_SECONDS - current)
            return max(1, int(max(waits, default=1)) + 1)
        attempts.append(current)
        _web_auth_global_attempts.append(current)
        if len(_web_auth_attempts_by_client) > 1024:
            for key in list(_web_auth_attempts_by_client):
                if not _web_auth_attempts_by_client[key]:
                    _web_auth_attempts_by_client.pop(key, None)
        return None


WEB_AUTH_LOGIN_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DiffPipe Forge</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b10;color:#f7f7f8}
    main{width:min(92vw,430px);padding:34px;border:1px solid #2b303b;border-radius:18px;background:#12151c;box-shadow:0 24px 70px #0008}
    h1{margin:0 0 8px;font-size:25px}p{margin:0 0 24px;color:#aeb5c2;line-height:1.55}
    label{display:block;margin:14px 0 8px;font-size:14px}input,button{width:100%;height:46px;border-radius:10px;font:inherit}
    input{border:1px solid #39404d;background:#090b10;color:#fff;padding:0 13px;outline:none}input:focus{border-color:#738cff;box-shadow:0 0 0 3px #5269ff33}
    button{margin-top:14px;border:0;background:#6377f2;color:#fff;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}
    #message{min-height:22px;margin:13px 0 0;color:#ff9c9c;font-size:13px}
    small{display:block;margin-top:20px;color:#747d8d}
  </style>
</head>
<body><main>
  <h1>DiffPipe Forge</h1>
  <p>__AUTH_INTRO__</p>
  <form id="login">__AUTH_FIELDS__
    <button id="submit" type="submit">登录 / Sign in</button><div id="message" role="alert" aria-live="polite"></div>
  </form><small>__AUTH_HELP__</small>
</main><script>
const form=document.getElementById('login'),button=document.getElementById('submit'),message=document.getElementById('message');
form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;message.textContent='';
try{const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});
if(response.ok){location.replace('/');return;}const data=await response.json().catch(()=>({}));message.textContent=data.detail||'登录失败 / Sign-in failed';}
catch(_error){message.textContent='网络连接失败，请重试 / Network error, please retry';}finally{button.disabled=false;}});
</script></body></html>"""


def _login_page_response() -> HTMLResponse:
    if WEB_AUTH_MODE == "youyun":
        intro = (
            "请从当前实例卡片复制 SSH 端口和实例密码。这里只用于验证身份，不需要打开终端。"
            "<br>Copy the SSH port and instance password from this instance card. No terminal is needed."
        )
        fields = (
            '<label for="ssh_port">SSH 端口 / SSH port</label>'
            '<input id="ssh_port" name="ssh_port" type="text" inputmode="numeric" pattern="[0-9]{1,5}" '
            'maxlength="5" autocomplete="off" required autofocus>'
            '<label for="password">实例密码 / Instance password</label>'
            '<input id="password" name="password" type="password" autocomplete="current-password" '
            'maxlength="1024" required>'
        )
        help_text = (
            "端口和密码只用于本次登录校验，不会写入项目或日志。 / These values are not written to projects or logs."
        )
    else:
        intro = "请输入算力实例密码以进入训练界面。<br>Enter the compute instance password to continue."
        fields = (
            '<label for="credential">实例密码 / Instance password</label>'
            '<input id="credential" name="credential" type="password" autocomplete="current-password" '
            'maxlength="1024" required autofocus>'
        )
        help_text = "会话仅保存在当前浏览器中。 / The session stays in this browser."
    html = (
        WEB_AUTH_LOGIN_HTML.replace("__AUTH_INTRO__", intro)
        .replace("__AUTH_FIELDS__", fields)
        .replace("__AUTH_HELP__", help_text)
    )
    response = HTMLResponse(html, status_code=200)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
        "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _auth_error(status_code: int, detail: str, *, retry_after: int | None = None) -> JSONResponse:
    response = JSONResponse({"detail": detail}, status_code=status_code)
    response.headers["Cache-Control"] = "no-store"
    if retry_after is not None:
        response.headers["Retry-After"] = str(retry_after)
    return response


class _LoginBodyTooLarge(Exception):
    pass


async def _read_login_payload(request: Request) -> tuple[dict[str, Any] | None, JSONResponse | None]:
    content_type = str(request.headers.get("content-type") or "")
    media_type, _, parameters = content_type.partition(";")
    if media_type.strip().casefold() != "application/json":
        return None, _auth_error(415, "登录请求必须使用 application/json / Login requires application/json")
    if parameters:
        charset_values = [
            item.split("=", 1)[1].strip().strip('"').casefold()
            for item in parameters.split(";")
            if item.strip().casefold().startswith("charset=")
        ]
        if any(value not in {"utf-8", "utf8"} for value in charset_values):
            return None, _auth_error(415, "登录请求必须使用 UTF-8 JSON / Login requires UTF-8 JSON")
    if "content-encoding" in request.headers:
        return None, _auth_error(415, "登录请求不支持内容编码 / Content encoding is not supported")

    declared_length_raw = request.headers.get("content-length")
    if declared_length_raw is not None:
        declared_length_raw = declared_length_raw.strip()
        if re.fullmatch(r"[0-9]+", declared_length_raw) is None:
            return None, _auth_error(400, "登录请求格式无效 / Invalid login request")
        normalized_length = declared_length_raw.lstrip("0") or "0"
        limit_raw = str(WEB_AUTH_LOGIN_MAX_BODY_BYTES)
        if len(normalized_length) > len(limit_raw) or (
            len(normalized_length) == len(limit_raw) and normalized_length > limit_raw
        ):
            return None, _auth_error(413, "登录请求过大 / Login request is too large")

    async def collect() -> bytes:
        body = bytearray()
        async for chunk in request.stream():
            if not chunk:
                continue
            if len(body) + len(chunk) > WEB_AUTH_LOGIN_MAX_BODY_BYTES:
                raise _LoginBodyTooLarge
            body.extend(chunk)
        return bytes(body)

    try:
        raw_body = await asyncio.wait_for(collect(), timeout=WEB_AUTH_LOGIN_BODY_TIMEOUT_SECONDS)
    except _LoginBodyTooLarge:
        return None, _auth_error(413, "登录请求过大 / Login request is too large")
    except TimeoutError:
        return None, _auth_error(408, "登录请求读取超时 / Login request timed out")
    except Exception:
        return None, _auth_error(400, "登录请求格式无效 / Invalid login request")

    try:
        payload = json.loads(raw_body.decode("utf-8", errors="strict"))
    except (UnicodeError, ValueError, RecursionError):
        return None, _auth_error(400, "登录请求必须是有效 JSON / Login request must be valid JSON")
    if not isinstance(payload, dict):
        return None, _auth_error(400, "登录请求必须是 JSON 对象 / Login request must be a JSON object")
    return payload, None

app = FastAPI(title="DiffPipe Forge WebUI")
web_cors_origins = [
    item.strip()
    for item in os.environ.get("DIFFPIPE_WEB_CORS_ORIGINS", "").split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    # The browser build uses same-origin URLs (the Vite development server
    # proxies /api and /ws), so cross-origin access is opt-in.  This prevents
    # an unrelated web page from driving the powerful local IPC bridge.
    allow_origins=web_cors_origins,
    allow_credentials=bool(web_cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def web_auth_middleware(request: Request, call_next: Callable[..., Any]):
    if not _web_auth_enabled():
        return await call_next(request)

    path = request.url.path
    method = request.method.upper()
    if path == "/healthz" and method in {"GET", "HEAD"}:
        return await call_next(request)
    if path == "/auth/login" and method == "POST":
        if not _origin_matches_host(request.headers):
            return _auth_error(403, "请求来源无效 / Invalid request origin")
        return await call_next(request)
    if path == "/auth/logout" and method == "POST":
        if not _origin_matches_host(request.headers):
            return _auth_error(403, "请求来源无效 / Invalid request origin")
        return await call_next(request)

    token = request.cookies.get(WEB_AUTH_COOKIE_NAME)
    if _web_auth_session_details(token) is None:
        if path == "/" and method == "GET":
            return _login_page_response()
        return _auth_error(401, "请先登录 / Authentication required")

    if method not in {"GET", "HEAD", "OPTIONS"} and not _origin_matches_host(request.headers):
        return _auth_error(403, "请求来源无效 / Invalid request origin")
    return await call_next(request)


@app.get("/healthz")
def web_healthcheck():
    return {"status": "ok"}


@app.post("/auth/login")
async def web_auth_login(request: Request):
    if not _web_auth_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    client_key = request.client.host if request.client is not None else "unknown"
    retry_after = _consume_login_attempt(client_key)
    if retry_after is not None:
        return _auth_error(
            429,
            "尝试次数过多，请稍后再试 / Too many attempts, please try again later",
            retry_after=retry_after,
        )

    payload, body_error = await _read_login_payload(request)
    if body_error is not None:
        return body_error
    if payload is None:  # Defensive; _read_login_payload returns one side of the tuple.
        return _auth_error(400, "登录请求格式无效 / Invalid login request")
    secret = payload.get("password" if WEB_AUTH_MODE == "youyun" else "credential")
    if not isinstance(secret, str) or not secret:
        payload.clear()
        return _auth_error(401, "登录凭据不正确 / Incorrect sign-in credential")
    try:
        secret_too_large = len(secret.encode("utf-8")) > 4096
    except UnicodeError:
        secret_too_large = True
    if secret_too_large:
        payload.clear()
        return _auth_error(401, "登录凭据不正确 / Incorrect sign-in credential")
    try:
        authenticated = await asyncio.to_thread(_verify_web_auth_credentials, payload)
    except Exception:
        authenticated = False
    finally:
        secret = ""
        payload.clear()
    if not authenticated:
        return _auth_error(401, "登录凭据不正确 / Incorrect sign-in credential")

    token = _issue_web_auth_session()
    response = JSONResponse({"ok": True})
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        WEB_AUTH_COOKIE_NAME,
        token,
        max_age=WEB_AUTH_SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return response


@app.post("/auth/logout")
def web_auth_logout(request: Request):
    if not _web_auth_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    _revoke_web_auth_session(request.cookies.get(WEB_AUTH_COOKIE_NAME))
    response = JSONResponse({"ok": True})
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(
        WEB_AUTH_COOKIE_NAME,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return response

handlers: dict[str, Callable[..., Any]] = {}
clients: set[WebSocket] = set()

active_backend_process: asyncio.subprocess.Process | None = None
active_tensorboard_process: asyncio.subprocess.Process | None = None
active_tool_process: asyncio.subprocess.Process | None = None
active_tool_script_name: str | None = None
is_tool_manually_stopped = False
tool_log_buffer: list[str] = []

training_process: asyncio.subprocess.Process | None = None
training_start_lock = asyncio.Lock()
TRAINING_SESSION_NAME_PATTERN = re.compile(r"^\d{8}_\d{2}-\d{2}-\d{2}$")
training_log_queue: list[str] = []
current_log_file_path: str | None = None
cached_output_folder: str | None = None
latest_monitor_stats: Any = None
active_monitor_process: asyncio.subprocess.Process | None = None
tensorboard_url = ""

WEB_MODEL_EXTENSIONS = {
    ".safetensors",
    ".pt",
    ".pth",
    ".ckpt",
    ".bin",
    ".gguf",
}
WEB_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi"}
WEB_UPLOAD_FILE_EXTENSIONS = WEB_VIDEO_EXTENSIONS | {".txt"}
WEB_MAX_UPLOAD_FILE_BYTES = int(os.environ.get("DIFFPIPE_WEB_MAX_UPLOAD_FILE_BYTES", str(8 * 1024**3)))
WEB_MAX_UPLOAD_SESSION_BYTES = int(os.environ.get("DIFFPIPE_WEB_MAX_UPLOAD_SESSION_BYTES", str(100 * 1024**3)))
WEB_MAX_CAPTION_BYTES = int(os.environ.get("DIFFPIPE_WEB_MAX_CAPTION_BYTES", str(4 * 1024**2)))
WEB_MAX_PENDING_UPLOAD_SESSIONS = int(os.environ.get("DIFFPIPE_WEB_MAX_PENDING_UPLOAD_SESSIONS", "8"))
WEB_MAX_PENDING_UPLOAD_BYTES = int(
    os.environ.get("DIFFPIPE_WEB_MAX_PENDING_UPLOAD_BYTES", str(WEB_MAX_UPLOAD_SESSION_BYTES))
)
WEB_MAX_BROWSE_ENTRIES = 500
WEB_MAX_SEARCH_RESULTS = 200
WEB_MAX_SEARCH_SCANNED = 50_000
WEB_MAX_SEARCH_DEPTH = 8
WEB_UPLOAD_STALE_SECONDS = int(os.environ.get("DIFFPIPE_WEB_UPLOAD_STALE_SECONDS", str(24 * 60 * 60)))
WEB_UPLOAD_IN_PROGRESS_MARKER = ".diffpipe-upload-in-progress.json"
WEB_UPLOAD_COMPLETE_MARKER = ".diffpipe-upload-complete.json"
WEB_UPLOAD_SESSION_PATTERN = re.compile(r"^dataset-\d{8}-\d{6}-[a-f0-9]{10}$")

MINIMAX_H3_FILES: dict[str, dict[str, Any]] = {
    "diffusion_model": {
        "path": "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
        "size": 20_970_379_616,
        "sha256": "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a",
    },
    "text_encoder_path": {
        "path": "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
        "size": 27_141_342_152,
        "sha256": "bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923",
    },
    "vae": {
        "path": "vae/minimax_h3_video_vae_fp16.safetensors",
        "size": 5_207_808_496,
        "sha256": "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522",
    },
    "audio_vae": {
        "path": "vae/minimax_h3_audio_vae_fp32.safetensors",
        "size": 605_254_808,
        "sha256": "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
    },
}

model_download_jobs: dict[str, dict[str, Any]] = {}
model_download_tasks: dict[str, asyncio.Task[Any]] = {}
minimax_hash_cache: dict[tuple[str, int, int, str], bool] = {}
upload_lock = asyncio.Lock()
model_download_start_lock = asyncio.Lock()


def channel(name: str):
    def decorator(fn: Callable[..., Any]):
        handlers[name] = fn
        return fn

    return decorator


def _split_env_paths(name: str) -> list[Path]:
    raw = os.environ.get(name, "")
    return [Path(item).expanduser() for item in raw.split(os.pathsep) if item.strip()]


def _nearest_existing_parent(path: Path) -> Path | None:
    candidate = path.expanduser()
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate if candidate.exists() else None


def _ensure_upload_disk_space(path: Path, bytes_needed: int) -> None:
    anchor = _nearest_existing_parent(path)
    if anchor is None:
        raise HTTPException(status_code=400, detail="Upload target has no existing parent")
    reserve = int(os.environ.get("DIFFPIPE_WEB_UPLOAD_FREE_RESERVE_BYTES", str(1024**3)))
    if shutil.disk_usage(anchor).free < max(0, bytes_needed) + max(0, reserve):
        raise HTTPException(status_code=507, detail="Not enough free space for this dataset upload")


def _is_writable_path(path: Path) -> bool:
    anchor = path if path.exists() else _nearest_existing_parent(path)
    return bool(anchor and anchor.is_dir() and os.access(anchor, os.W_OK | os.X_OK))


def _canonical_existing_directory(path: Path) -> Path | None:
    try:
        resolved = path.expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return resolved if resolved.is_dir() else None


def _path_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _mount_info(path: Path) -> dict[str, str]:
    if os.name == "nt":
        return {"source": path.drive or "local", "filesystem": "windows", "mountPoint": path.drive or ""}

    best: tuple[int, str, str, str] | None = None
    try:
        for line in Path("/proc/self/mountinfo").read_text(encoding="utf-8", errors="replace").splitlines():
            left, right = line.split(" - ", 1)
            left_fields = left.split()
            right_fields = right.split()
            if len(left_fields) < 5 or len(right_fields) < 2:
                continue
            mount_point = Path(
                left_fields[4]
                .replace("\\040", " ")
                .replace("\\011", "\t")
                .replace("\\134", "\\")
            ).resolve(strict=False)
            if _path_within(path, mount_point):
                score = len(mount_point.parts)
                if best is None or score > best[0]:
                    best = (score, right_fields[1], right_fields[0], str(mount_point))
    except (OSError, ValueError):
        pass
    if best:
        return {"source": best[1], "filesystem": best[2], "mountPoint": best[3]}
    return {"source": "local", "filesystem": "unknown", "mountPoint": ""}


def _is_platform_persistent_base(path: Path) -> bool:
    resolved = _canonical_existing_directory(path)
    if resolved is None or os.name == "nt":
        return False
    mount_point_raw = _mount_info(resolved).get("mountPoint", "")
    if not mount_point_raw:
        return False
    mount_point = Path(mount_point_raw).resolve(strict=False)
    return mount_point != Path("/") and _path_within(resolved, mount_point)


def _storage_kind(path: Path) -> str:
    posix = path.as_posix()
    if (posix == "/cloud" or posix.startswith("/cloud/")) and _is_platform_persistent_base(Path("/cloud")):
        return "persistent"
    if (posix == "/usrdata" or posix.startswith("/usrdata/")) and _is_platform_persistent_base(Path("/usrdata")):
        return "persistent"
    if posix in {"/model", "/models"} or posix.startswith("/model/") or posix.startswith("/models/"):
        return "public_models"
    if posix == "/workspace" or posix.startswith("/workspace/"):
        return "temporary"
    return "local"


def _web_upload_root() -> Path:
    configured = os.environ.get("DIFFPIPE_WEB_UPLOAD_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    if os.name != "nt":
        for base in (Path("/cloud"), Path("/usrdata")):
            if _is_platform_persistent_base(base) and _is_writable_path(base):
                return (base / "DiffPipeForge" / "uploads").resolve(strict=False)
    return (PROJECT_ROOT / "web_uploads").resolve(strict=False)


def _recommended_output_base() -> Path:
    configured = os.environ.get("DIFFPIPE_WEB_OUTPUT_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    if os.name != "nt":
        for base in (Path("/cloud"), Path("/usrdata"), Path("/workspace")):
            mounted_or_workspace = base == Path("/workspace") or _is_platform_persistent_base(base)
            if mounted_or_workspace and _canonical_existing_directory(base) and _is_writable_path(base):
                return (base / "DiffPipeForge").resolve(strict=False)
    return PROJECT_ROOT.resolve()


def _recommended_model_base() -> Path:
    configured = os.environ.get("DIFFPIPE_WEB_MODEL_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    if os.name != "nt":
        for base, relative in ((Path("/cloud"), "DiffPipeForge/models"), (Path("/usrdata"), "models")):
            if _is_platform_persistent_base(base) and _is_writable_path(base):
                return (base / relative).resolve(strict=False)
    return (PROJECT_ROOT / "models").resolve(strict=False)


def _web_root_candidates() -> list[tuple[Path, str]]:
    candidates: list[tuple[Path, str]] = [
        (PROJECT_ROOT, "project"),
        (_web_upload_root(), "uploads"),
    ]
    if os.name != "nt":
        candidates.extend(
            [
                *(([(Path("/cloud"), "cloud")] if _is_platform_persistent_base(Path("/cloud")) else [])),
                *(([(Path("/usrdata"), "usrdata")] if _is_platform_persistent_base(Path("/usrdata")) else [])),
                (Path("/model"), "model"),
                (Path("/models"), "models"),
            ]
        )
    candidates.extend((path, "configured") for path in _split_env_paths("DIFFPIPE_WEB_BROWSE_ROOTS"))

    deduped: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for candidate, role in candidates:
        resolved = _canonical_existing_directory(candidate)
        if resolved is None:
            continue
        key = os.path.normcase(str(resolved))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((resolved, role))
    return deduped


def _download_roots() -> list[Path]:
    configured_single = os.environ.get("DIFFPIPE_WEB_MODEL_ROOT", "").strip()
    candidates = [
        PROJECT_ROOT / "models",
        *([Path(configured_single).expanduser()] if configured_single else []),
        *_split_env_paths("DIFFPIPE_WEB_MODEL_ROOTS"),
    ]
    if os.name != "nt":
        mounted_candidates: list[Path] = []
        if _is_platform_persistent_base(Path("/cloud")):
            mounted_candidates.append(Path("/cloud/DiffPipeForge/models"))
        if _is_platform_persistent_base(Path("/usrdata")):
            mounted_candidates.append(Path("/usrdata/models"))
        candidates[:0] = mounted_candidates
    roots: list[Path] = []
    for candidate in candidates:
        resolved = candidate.expanduser().resolve(strict=False)
        if _nearest_existing_parent(resolved) and _is_writable_path(resolved):
            roots.append(resolved)
    return roots


def _root_record(path: Path, role: str) -> dict[str, Any]:
    mount = _mount_info(path)
    kind = "public_models" if role in {"model", "models"} else _storage_kind(path)
    writable = _is_writable_path(path) and kind != "public_models"
    root_id = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:12]
    return {
        "id": root_id,
        "path": str(path),
        "name": path.name or str(path),
        "role": role,
        "storageKind": kind,
        "writable": writable,
        "source": mount["source"],
        "filesystem": mount["filesystem"],
    }


def _browse_root_role(root: Path) -> str | None:
    root_key = os.path.normcase(str(root.resolve(strict=False)))
    for candidate, role in _web_root_candidates():
        if os.path.normcase(str(candidate)) == root_key:
            return role
    return None


def _resolve_browse_path(raw_path: str, *, must_exist: bool = True) -> tuple[Path, Path]:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Path is required")
    candidate = Path(raw_path.strip()).expanduser()
    if not candidate.is_absolute():
        raise HTTPException(status_code=400, detail="Only absolute server paths are allowed")
    try:
        resolved = candidate.resolve(strict=must_exist)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid server path: {exc}") from exc

    containing = [root for root, _role in _web_root_candidates() if _path_within(resolved, root)]
    if not containing:
        raise HTTPException(status_code=403, detail="Path is outside the allowed WebUI roots")
    root = max(containing, key=lambda item: len(item.parts))
    if must_exist and not resolved.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")
    return resolved, root


def _validate_leaf_name(name: str) -> str:
    if not isinstance(name, str):
        raise HTTPException(status_code=400, detail="Invalid file or folder name")
    name = name.strip()
    if not name or name in {".", ".."} or len(name) > 255:
        raise HTTPException(status_code=400, detail="Invalid file or folder name")
    if "/" in name or "\\" in name or ":" in name or any(ord(char) < 32 for char in name):
        raise HTTPException(status_code=400, detail="Names cannot contain path separators or control characters")
    if os.name == "nt":
        stem = name.split(".", 1)[0].casefold()
        reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
        if name.endswith((".", " ")) or stem in reserved:
            raise HTTPException(status_code=400, detail="This name is reserved by Windows")
    return name


def _entry_payload(path: Path) -> dict[str, Any]:
    stat_result = path.stat(follow_symlinks=False)
    is_dir = path.is_dir() and not path.is_symlink()
    suffix = path.suffix.lower() if not is_dir else ""
    return {
        "name": path.name,
        "path": str(path.resolve(strict=True)),
        "type": "directory" if is_dir else "file",
        "size": 0 if is_dir else stat_result.st_size,
        "modified": stat_result.st_mtime,
        "extension": suffix,
        "modelCandidate": (not is_dir and suffix in WEB_MODEL_EXTENSIONS),
    }


def _safe_relative_repo_file(raw_path: str) -> str:
    value = raw_path.strip().replace("\\", "/")
    pure = PurePosixPath(value)
    if (
        not value
        or value.startswith("/")
        or len(value) > 500
        or ":" in value
        or any(part in {"", ".", ".."} for part in pure.parts)
        or any(ord(char) < 32 for char in value)
    ):
        raise HTTPException(status_code=400, detail=f"Invalid repository file path: {raw_path}")
    return pure.as_posix()


def _download_file_path(target_dir: Path, relative_path: str) -> Path:
    target_root = target_dir.resolve(strict=False)
    candidate = (target_root / Path(relative_path)).resolve(strict=False)
    if not _path_within(candidate, target_root):
        raise RuntimeError(f"Repository file leaves the selected model directory: {relative_path}")
    return candidate


def _resolve_download_target(raw_path: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Download target directory is required")
    candidate = Path(raw_path.strip()).expanduser()
    if not candidate.is_absolute():
        raise HTTPException(status_code=400, detail="Download target must be an absolute server path")
    try:
        resolved = candidate.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid download target: {exc}") from exc
    if not any(_path_within(resolved, root) for root in _download_roots()):
        raise HTTPException(status_code=403, detail="Download target is outside the allowed model roots")
    if not _is_writable_path(resolved):
        raise HTTPException(status_code=403, detail="Download target is not writable")
    return resolved


def _directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for root, _dirs, files in os.walk(path):
        for filename in files:
            try:
                total += (Path(root) / filename).stat().st_size
            except OSError:
                continue
    return total


def _download_progress_bytes(target_dir: Path, files: list[dict[str, Any]]) -> int:
    total = 0
    for item in files:
        try:
            path = _download_file_path(target_dir, item["path"])
            if path.is_file():
                total += path.stat().st_size
        except (OSError, RuntimeError):
            continue
    cache_root = target_dir / ".cache"
    if cache_root.is_dir():
        for path in cache_root.rglob("*"):
            try:
                if path.is_file() and path.name.endswith((".incomplete", ".partial", ".part")):
                    total += path.stat().st_size
            except OSError:
                continue
    return total


def _discover_minimax_h3_files() -> dict[str, Any]:
    by_filename = {Path(item["path"]).name: (field, item) for field, item in MINIMAX_H3_FILES.items()}
    roots: list[Path] = []
    configured_single = os.environ.get("DIFFPIPE_WEB_MODEL_ROOT", "").strip()
    discovery_candidates: list[Path] = [
        PROJECT_ROOT / "models",
        *([Path(configured_single).expanduser()] if configured_single else []),
        *_split_env_paths("DIFFPIPE_WEB_MODEL_ROOTS"),
    ]
    if os.name != "nt":
        platform_candidates = [Path("/model"), Path("/models")]
        platform_candidates.extend(
            base for base in (Path("/cloud"), Path("/usrdata")) if _is_platform_persistent_base(base)
        )
        discovery_candidates[:0] = platform_candidates
    for candidate in discovery_candidates:
        resolved = _canonical_existing_directory(candidate)
        if resolved and resolved not in roots:
            roots.append(resolved)

    candidates: dict[str, list[str]] = {field: [] for field in MINIMAX_H3_FILES}
    scanned = 0
    pruned_names = {".git", ".cache", ".venv", "node_modules", "__pycache__", "cache"}
    for root in roots:
        for current, dirs, files in os.walk(root, followlinks=False):
            current_path = Path(current)
            try:
                depth = len(current_path.relative_to(root).parts)
            except ValueError:
                continue
            dirs[:] = [
                name
                for name in dirs
                if name not in pruned_names and not name.startswith(".") and depth < 10
            ]
            for filename in files:
                scanned += 1
                match = by_filename.get(filename)
                if match:
                    field, metadata = match
                    path = current_path / filename
                    try:
                        if path.is_symlink() or not path.is_file() or path.stat().st_size != metadata["size"]:
                            continue
                        resolved_path = path.resolve(strict=True)
                        if not _path_within(resolved_path, root):
                            continue
                        stat_result = resolved_path.stat()
                        cache_key = (
                            str(resolved_path),
                            stat_result.st_size,
                            stat_result.st_mtime_ns,
                            metadata["sha256"],
                        )
                        valid_hash = minimax_hash_cache.get(cache_key)
                        if valid_hash is None:
                            digest = hashlib.sha256()
                            with resolved_path.open("rb") as stream:
                                for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                                    digest.update(chunk)
                            valid_hash = digest.hexdigest().lower() == metadata["sha256"].lower()
                            minimax_hash_cache[cache_key] = valid_hash
                        if valid_hash:
                            candidates[field].append(str(resolved_path))
                    except OSError:
                        pass
                if scanned >= 250_000:
                    break
            if scanned >= 250_000:
                break
        if scanned >= 250_000:
            break

    grouped: dict[str, dict[str, str]] = {}
    for field, paths in candidates.items():
        category = Path(MINIMAX_H3_FILES[field]["path"]).parts[0]
        for raw_path in paths:
            path = Path(raw_path)
            base = path.parent.parent if path.parent.name == category else path.parent
            grouped.setdefault(str(base), {})[field] = raw_path
    complete_groups = [mapping for mapping in grouped.values() if set(mapping) == set(MINIMAX_H3_FILES)]
    complete_groups.sort(
        key=lambda mapping: (
            0 if _storage_kind(Path(mapping["diffusion_model"])) == "persistent" else 1,
            mapping["diffusion_model"],
        )
    )
    path_map = complete_groups[0] if complete_groups else {
        field: paths[0] for field, paths in candidates.items() if paths
    }
    return {
        "complete": set(path_map) == set(MINIMAX_H3_FILES),
        "pathMap": path_map,
        "candidates": candidates,
        "verifiedBy": "sha256",
        "scanned": scanned,
        "truncated": scanned >= 250_000,
    }


def _redact_download_error(message: str) -> str:
    redacted = message
    for env_name in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "MODELSCOPE_API_TOKEN"):
        secret = os.environ.get(env_name, "")
        if secret:
            redacted = redacted.replace(secret, "[REDACTED]")
    redacted = re.sub(r"hf_[A-Za-z0-9]{8,}", "hf_[REDACTED]", redacted)
    redacted = re.sub(r"(?i)(authorization\s*[:=]\s*)([^\s,;]+)", r"\1[REDACTED]", redacted)
    return redacted[:2000]


def _verify_download(path: Path, expected_size: int | None, expected_sha256: str | None) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"Downloaded file is missing: {path.name}")
    if expected_size is not None and path.stat().st_size != expected_size:
        raise RuntimeError(
            f"Size verification failed for {path.name}: expected {expected_size}, got {path.stat().st_size}"
        )
    if expected_sha256:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        actual = digest.hexdigest()
        if actual.lower() != expected_sha256.lower():
            raise RuntimeError(f"SHA-256 verification failed for {path.name}")


def _quarantine_invalid_download(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = path.with_name(f"{path.name}.invalid-{timestamp}")
    counter = 1
    while candidate.exists():
        candidate = path.with_name(f"{path.name}.invalid-{timestamp}-{counter}")
        counter += 1
    path.replace(candidate)
    return candidate


def _download_model_file(
    source: str,
    repo_id: str,
    revision: str,
    relative_path: str,
    target_dir: Path,
) -> Path:
    target_dir = _resolve_download_target(str(target_dir))
    expected_path = _download_file_path(target_dir, relative_path)
    expected_path.parent.mkdir(parents=True, exist_ok=True)
    if source == "huggingface":
        from huggingface_hub import hf_hub_download

        result = hf_hub_download(
            repo_id=repo_id,
            filename=relative_path,
            revision=revision,
            local_dir=str(target_dir),
            token=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or None,
        )
    elif source == "modelscope":
        token = os.environ.get("MODELSCOPE_API_TOKEN") or None
        cookies = None
        if token:
            from modelscope.hub.api import HubApi

            cookies = HubApi().get_cookies(token)
        from modelscope.hub.file_download import model_file_download

        result = model_file_download(
            model_id=repo_id,
            file_path=relative_path,
            revision=revision,
            local_dir=str(target_dir),
            cookies=cookies,
        )
    else:  # Defensive guard; the request validator rejects this earlier.
        raise RuntimeError("Unsupported model source")

    target_dir = _resolve_download_target(str(target_dir))
    expected_path = _download_file_path(target_dir, relative_path)
    result_path = Path(result).resolve(strict=True) if result else expected_path.resolve(strict=True)
    if not expected_path.exists() and result_path.is_file():
        expected_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(result_path, expected_path)
    final_path = expected_path.resolve(strict=True)
    if not _path_within(final_path, target_dir):
        raise RuntimeError(f"Downloaded file leaves the selected model directory: {relative_path}")
    return final_path


async def _run_model_download(job_id: str, spec: dict[str, Any]) -> None:
    job = model_download_jobs[job_id]
    target_dir = Path(spec["targetDir"])
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        job.update(status="running", updatedAt=time.time())
        for index, item in enumerate(spec["files"]):
            target_dir = _resolve_download_target(str(spec["targetDir"]))
            relative_path = item["path"]
            expected_path = _download_file_path(target_dir, relative_path)
            expected_size = item.get("size")
            expected_sha256 = item.get("sha256")
            job.update(currentFile=relative_path, currentFileIndex=index, updatedAt=time.time())

            # Only a content hash can prove that an existing same-name file
            # belongs to this manifest/revision. Size alone is not a safe
            # fast-path; let the official client validate/refetch it.
            if expected_path.is_file() and expected_sha256 is not None:
                try:
                    await asyncio.to_thread(_verify_download, expected_path, expected_size, expected_sha256)
                    job["completedFiles"] = index + 1
                    job["bytesDownloaded"] = await asyncio.to_thread(_download_progress_bytes, target_dir, spec["files"])
                    field_name = item.get("field")
                    if field_name:
                        job["pathMap"][field_name] = str(expected_path.resolve(strict=True))
                    continue
                except RuntimeError:
                    # Keep the bad artifact recoverable, then let the official
                    # client resume/redownload without requiring shell access.
                    await asyncio.to_thread(_quarantine_invalid_download, expected_path)

            future = asyncio.create_task(
                asyncio.to_thread(
                    _download_model_file,
                    spec["source"],
                    spec["repoId"],
                    spec["revision"],
                    relative_path,
                    target_dir,
                )
            )
            while not future.done():
                job["bytesDownloaded"] = await asyncio.to_thread(_download_progress_bytes, target_dir, spec["files"])
                job["updatedAt"] = time.time()
                await asyncio.sleep(1)
            downloaded_path = await future
            await asyncio.to_thread(_verify_download, downloaded_path, expected_size, expected_sha256)
            job["completedFiles"] = index + 1
            job["bytesDownloaded"] = await asyncio.to_thread(_download_progress_bytes, target_dir, spec["files"])
            field_name = item.get("field")
            if field_name:
                job["pathMap"][field_name] = str(downloaded_path)

        job.update(
            status="completed",
            currentFile=None,
            completedFiles=len(spec["files"]),
            bytesDownloaded=await asyncio.to_thread(_download_progress_bytes, target_dir, spec["files"]),
            updatedAt=time.time(),
        )
    except asyncio.CancelledError:
        job.update(status="interrupted", error="Download task was interrupted; start it again to resume.", updatedAt=time.time())
        raise
    except Exception as exc:
        job.update(status="error", error=_redact_download_error(str(exc)), updatedAt=time.time())
    finally:
        model_download_tasks.pop(job_id, None)


def load_settings() -> dict[str, Any]:
    try:
        if SETTINGS_FILE.exists():
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[WebUI] Failed to load settings: {exc}")
    return {}


def save_settings(settings: dict[str, Any]) -> None:
    SETTINGS_FILE.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_backend_path(sub_path: str) -> Path:
    return APP_DIR / sub_path


def get_training_output_directory(config_path: str | Path) -> Path:
    config_path = Path(config_path)
    config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    configured_output_dir = config.get("output_dir")
    if not isinstance(configured_output_dir, str) or not configured_output_dir.strip():
        raise ValueError("trainconfig.toml 中缺少 output_dir")

    output_dir = Path(configured_output_dir.strip())
    if output_dir.is_absolute():
        return output_dir.resolve()

    is_linux = sys.platform.startswith("linux")
    training_script = resolve_backend_path("backend/core_linux/train.py" if is_linux else "backend/core/train.py")
    return (training_script.parent / output_dir).resolve()


def inspect_training_checkpoint_directory(run_directory: str | Path) -> dict[str, Any]:
    run_directory = Path(run_directory).resolve()
    if not run_directory.exists():
        return {
            "valid": False,
            "path": str(run_directory),
            "errorCode": "checkpoint_not_directory",
            "message": "检查点目录不存在。请选择包含 latest 文件的训练运行目录。",
        }
    if not run_directory.is_dir():
        return {
            "valid": False,
            "path": str(run_directory),
            "errorCode": "checkpoint_not_directory",
            "message": "检查点必须是文件夹，不能选择文件。",
        }

    latest_path = run_directory / "latest"
    if not latest_path.is_file():
        selected_tag_folder = run_directory.name.startswith("global_step") and (run_directory.parent / "latest").is_file()
        return {
            "valid": False,
            "path": str(run_directory),
            "errorCode": "checkpoint_select_run_root" if selected_tag_folder else "checkpoint_missing_latest",
            "message": (
                f"请选择上一级训练运行目录 {run_directory.parent}，不要直接选择 {run_directory.name}。"
                if selected_tag_folder
                else "该文件夹不是可恢复的训练运行目录：缺少 latest 文件。"
            ),
        }

    if latest_path.stat().st_size > 4096:
        return {
            "valid": False,
            "path": str(run_directory),
            "errorCode": "checkpoint_invalid_latest",
            "message": "latest 文件内容异常，无法作为检查点标签读取。",
        }

    try:
        latest_tag = latest_path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        latest_tag = ""
    if not latest_tag or latest_tag in {".", ".."} or re.fullmatch(r"[A-Za-z0-9._-]+", latest_tag) is None:
        return {
            "valid": False,
            "path": str(run_directory),
            "errorCode": "checkpoint_invalid_latest",
            "message": "latest 文件中的检查点标签无效。",
        }

    tag_directory = run_directory / latest_tag
    if not tag_directory.is_dir():
        return {
            "valid": False,
            "path": str(run_directory),
            "latestTag": latest_tag,
            "errorCode": "checkpoint_missing_tag_directory",
            "message": f"latest 指向的检查点文件夹 {latest_tag} 不存在。",
        }

    if not any(candidate.is_file() and candidate.stat().st_size > 0 for candidate in tag_directory.glob("*_model_states.pt")):
        return {
            "valid": False,
            "path": str(run_directory),
            "latestTag": latest_tag,
            "errorCode": "checkpoint_missing_model_state",
            "message": f"检查点文件夹 {latest_tag} 中没有 DeepSpeed model state。",
        }

    step = None
    if latest_tag.startswith("global_step") and latest_tag.removeprefix("global_step").isdigit():
        step = int(latest_tag.removeprefix("global_step"))

    modified_at = max(run_directory.stat().st_mtime, latest_path.stat().st_mtime, tag_directory.stat().st_mtime) * 1000
    return {
        "valid": True,
        "path": str(run_directory),
        "latestTag": latest_tag,
        "step": step,
        "modifiedAt": modified_at,
    }


def resolve_resume_checkpoint(config_path: str | Path, requested_path: str) -> dict[str, Any]:
    output_dir = get_training_output_directory(config_path)
    trimmed_path = requested_path.strip()
    checkpoint_path = Path(trimmed_path)
    if not checkpoint_path.is_absolute():
        if trimmed_path in {".", ".."} or re.fullmatch(r"[A-Za-z0-9._-]+", trimmed_path) is None:
            return {
                "valid": False,
                "path": trimmed_path,
                "errorCode": "checkpoint_relative_name_only",
                "message": "相对路径只能填写输出目录下的运行文件夹名称；其他位置请填写绝对路径。",
            }
        checkpoint_path = output_dir / checkpoint_path
    try:
        return inspect_training_checkpoint_directory(checkpoint_path)
    except (OSError, UnicodeError):
        return {
            "valid": False,
            "path": str(checkpoint_path.resolve()),
            "errorCode": "checkpoint_unreadable",
            "message": "检查点目录无法读取或内容不完整。",
        }


def list_training_checkpoints(config_path: str | Path) -> dict[str, Any]:
    output_dir = get_training_output_directory(config_path)
    checkpoints: list[dict[str, Any]] = []
    if output_dir.is_dir():
        for child in output_dir.iterdir():
            if not child.is_dir():
                continue
            try:
                inspection = inspect_training_checkpoint_directory(child)
            except (OSError, UnicodeError):
                continue
            if not inspection["valid"]:
                continue
            checkpoints.append({
                "name": child.name,
                "path": inspection["path"],
                "latestTag": inspection["latestTag"],
                "step": inspection.get("step"),
                "modifiedAt": inspection["modifiedAt"],
            })
    checkpoints.sort(key=lambda checkpoint: checkpoint["modifiedAt"], reverse=True)
    return {"outputDir": str(output_dir), "checkpoints": checkpoints}


def resolve_models_root() -> dict[str, str]:
    return {"projectRoot": str(PROJECT_ROOT), "modelsRoot": str(PROJECT_ROOT / "models")}


def get_python_exe(project_root: str | Path) -> str:
    project_root = Path(project_root)
    settings = load_settings()
    user_path = settings.get("userPythonPath")
    if user_path and Path(user_path).exists():
        return str(user_path)

    is_win = os.name == "nt"

    def sub_path(base: str) -> Path:
        return Path(base) / ("Scripts/python.exe" if is_win else "bin/python")

    conda_prefix = os.environ.get("CONDA_PREFIX")
    if conda_prefix and sub_path(conda_prefix).exists():
        return str(sub_path(conda_prefix))

    virtual_env = os.environ.get("VIRTUAL_ENV")
    if virtual_env and sub_path(virtual_env).exists():
        return str(sub_path(virtual_env))

    for root in (project_root, project_root.parent):
        embedded = root / ("python_embeded_DP/python.exe" if is_win else "python_embeded_DP/bin/python")
        if embedded.exists():
            return str(embedded)

    local = project_root / ("python/python.exe" if is_win else "python/bin/python")
    if local.exists():
        return str(local)

    return "python" if is_win else "python3"


def scan_python_environments(project_root: str | Path) -> list[dict[str, str]]:
    project_root = Path(project_root)
    envs: list[dict[str, str]] = []
    if not project_root.exists():
        return envs
    for child in project_root.iterdir():
        if not child.is_dir() or not (child.name == "python" or child.name.startswith("python_")):
            continue
        exe = child / ("python.exe" if os.name == "nt" else "bin/python")
        if exe.exists():
            envs.append({"name": child.name, "path": str(exe)})
    return envs


async def scan_conda_environments() -> list[dict[str, str]]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "conda",
            "env",
            "list",
            "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        data = json.loads(stdout.decode("utf-8", errors="ignore") or "{}")
        envs = []
        for env_path in data.get("envs", []):
            exe = Path(env_path) / ("python.exe" if os.name == "nt" else "bin/python")
            if exe.exists():
                envs.append({"name": f"{Path(env_path).name} [Conda]", "path": str(exe)})
        return envs
    except Exception:
        return []


def kill_process_tree(process_obj: asyncio.subprocess.Process | None) -> None:
    if not process_obj or not process_obj.pid:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/pid", str(process_obj.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(process_obj.pid, 9)
        except Exception:
            process_obj.kill()


async def broadcast(channel_name: str, *args: Any) -> None:
    if not clients:
        return
    payload = json.dumps({"channel": channel_name, "args": list(args)}, ensure_ascii=False)
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def read_stream_lines(stream: asyncio.StreamReader | None, on_line: Callable[[str], Any]) -> None:
    if stream is None:
        return
    while True:
        data = await stream.readline()
        if not data:
            break
        line = data.decode("utf-8", errors="replace").rstrip("\r\n")
        if line.strip():
            result = on_line(line)
            if asyncio.iscoroutine(result):
                await result


def get_today_output_folder(project_root: str | Path) -> str:
    global cached_output_folder
    if cached_output_folder and Path(cached_output_folder).exists():
        return cached_output_folder
    timestamp = datetime.now().strftime("%Y%m%d_%H-%M-%S")
    folder = Path(project_root) / "output" / timestamp
    folder.mkdir(parents=True, exist_ok=True)
    cached_output_folder = str(folder)
    return cached_output_folder


@app.post("/api/ipc/{channel_name}")
async def ipc_call(channel_name: str, args: list[Any]):
    handler = handlers.get(channel_name)
    if handler is None:
        return {"error": f"WebUI channel not implemented: {channel_name}"}
    try:
        result = handler(*args)
        if asyncio.iscoroutine(result):
            result = await result
        return {"data": result}
    except Exception as exc:
        traceback.print_exc()
        return {"error": str(exc)}


@app.get("/api/web-resources/roots")
def web_resource_roots():
    roots = [_root_record(path, role) for path, role in _web_root_candidates()]
    recommended_output = _recommended_output_base()
    recommended_model = _recommended_model_base()
    return {
        "roots": roots,
        "uploadRoot": str(_web_upload_root()),
        "recommendedOutputBase": {
            "path": str(recommended_output),
            "exists": recommended_output.is_dir(),
            "writable": _is_writable_path(recommended_output),
            "storageKind": _storage_kind(recommended_output),
        },
        "recommendedModelBase": {
            "path": str(recommended_model),
            "exists": recommended_model.is_dir(),
            "writable": _is_writable_path(recommended_model),
            "storageKind": _storage_kind(recommended_model),
        },
        "modelExtensions": sorted(WEB_MODEL_EXTENSIONS),
        "uploadLimits": {
            "maxFileBytes": WEB_MAX_UPLOAD_FILE_BYTES,
            "maxSessionBytes": WEB_MAX_UPLOAD_SESSION_BYTES,
            "maxCaptionBytes": WEB_MAX_CAPTION_BYTES,
        },
        "presets": {
            "minimaxH3": {
                "repoId": "Comfy-Org/MiniMax-H3",
                "huggingfaceRevision": "014cd40f7e177756c6b2473c0d93b1c89a790dd2",
                "modelscopeRevision": "master",
                "files": [
                    {"field": field, **metadata}
                    for field, metadata in MINIMAX_H3_FILES.items()
                ],
            }
        },
    }


@app.get("/api/web-resources/presets/minimax-h3/discover")
async def discover_minimax_h3():
    return await asyncio.to_thread(_discover_minimax_h3_files)


@app.post("/api/web-resources/list")
def web_resource_list(payload: dict[str, Any]):
    path, allowed_root = _resolve_browse_path(str(payload.get("path") or ""))
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="The selected path is not a directory")
    model_only = bool(payload.get("modelOnly", False))
    show_hidden = bool(payload.get("showHidden", False))

    entries: list[dict[str, Any]] = []
    truncated = False
    try:
        children = sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold()))
        for child in children:
            if child.is_symlink() or (not show_hidden and child.name.startswith(".")):
                continue
            if child.is_file() and model_only and child.suffix.lower() not in WEB_MODEL_EXTENSIONS:
                continue
            if not child.is_dir() and not child.is_file():
                continue
            try:
                entries.append(_entry_payload(child))
            except OSError:
                continue
            if len(entries) >= WEB_MAX_BROWSE_ENTRIES:
                truncated = True
                break
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="The server cannot read this directory") from exc

    parent: str | None = None
    if path != allowed_root:
        candidate_parent = path.parent.resolve(strict=True)
        if _path_within(candidate_parent, allowed_root):
            parent = str(candidate_parent)
    return {
        "path": str(path),
        "root": str(allowed_root),
        "parent": parent,
        "entries": entries,
        "truncated": truncated,
    }


def _search_web_resources(payload: dict[str, Any]) -> dict[str, Any]:
    start, allowed_root = _resolve_browse_path(str(payload.get("path") or ""))
    if not start.is_dir():
        raise HTTPException(status_code=400, detail="Search path must be a directory")
    query = str(payload.get("query") or "").strip().casefold()
    if len(query) < 2 or len(query) > 100:
        raise HTTPException(status_code=400, detail="Search text must contain 2 to 100 characters")
    mode = str(payload.get("mode") or "model")
    if mode not in {"model", "file", "directory"}:
        raise HTTPException(status_code=400, detail="Invalid search mode")

    results: list[dict[str, Any]] = []
    scanned = 0
    queue: deque[tuple[Path, int]] = deque([(start, 0)])
    while queue and scanned < WEB_MAX_SEARCH_SCANNED and len(results) < WEB_MAX_SEARCH_RESULTS:
        current, depth = queue.popleft()
        try:
            with os.scandir(current) as iterator:
                for entry in iterator:
                    scanned += 1
                    if scanned > WEB_MAX_SEARCH_SCANNED:
                        break
                    if entry.name.startswith(".") or entry.is_symlink():
                        continue
                    entry_path = Path(entry.path)
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if depth < WEB_MAX_SEARCH_DEPTH:
                                queue.append((entry_path, depth + 1))
                            if mode in {"directory", "model"} and query in entry.name.casefold():
                                results.append(_entry_payload(entry_path))
                        elif entry.is_file(follow_symlinks=False):
                            suffix = entry_path.suffix.lower()
                            matches_mode = mode == "file" or (mode == "model" and suffix in WEB_MODEL_EXTENSIONS)
                            if matches_mode and query in entry.name.casefold():
                                results.append(_entry_payload(entry_path))
                    except OSError:
                        continue
                    if len(results) >= WEB_MAX_SEARCH_RESULTS:
                        break
        except (OSError, PermissionError):
            continue
    return {
        "path": str(start),
        "root": str(allowed_root),
        "entries": sorted(results, key=lambda item: (item["type"] != "directory", item["name"].casefold())),
        "scanned": scanned,
        "truncated": bool(queue) or scanned >= WEB_MAX_SEARCH_SCANNED,
    }


@app.post("/api/web-resources/search")
async def web_resource_search(payload: dict[str, Any]):
    return await asyncio.to_thread(_search_web_resources, payload)


@app.post("/api/web-resources/mkdir")
def web_resource_mkdir(payload: dict[str, Any]):
    parent, allowed_root = _resolve_browse_path(str(payload.get("parent") or ""))
    if (
        not parent.is_dir()
        or not _is_writable_path(parent)
        or _storage_kind(parent) == "public_models"
        or _browse_root_role(allowed_root) in {"model", "models"}
    ):
        raise HTTPException(status_code=403, detail="Parent directory is not writable")
    name = _validate_leaf_name(str(payload.get("name") or ""))
    target = (parent / name).resolve(strict=False)
    _resolve_browse_path(str(parent), must_exist=True)
    if not any(_path_within(target, root) for root, _role in _web_root_candidates()):
        raise HTTPException(status_code=403, detail="New directory would leave the allowed roots")
    try:
        target.mkdir(mode=0o755, parents=False, exist_ok=False)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="A file or directory with this name already exists") from exc
    return {"path": str(target.resolve(strict=True))}


@app.post("/api/web-resources/ensure-directory")
def web_resource_ensure_directory(payload: dict[str, Any]):
    raw_path = str(payload.get("path") or "")
    if not raw_path:
        raise HTTPException(status_code=400, detail="Directory path is required")
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        raise HTTPException(status_code=400, detail="Only absolute server paths are allowed")
    resolved = candidate.resolve(strict=False)
    configured_single = os.environ.get("DIFFPIPE_WEB_OUTPUT_ROOT", "").strip()
    allowed_bases = [
        PROJECT_ROOT.resolve(),
        *([Path(configured_single).expanduser()] if configured_single else []),
        *_split_env_paths("DIFFPIPE_WEB_OUTPUT_ROOTS"),
    ]
    if os.name != "nt":
        mounted_bases: list[Path] = []
        for base in (Path("/cloud"), Path("/usrdata"), Path("/workspace")):
            mounted_or_workspace = base == Path("/workspace") or _is_platform_persistent_base(base)
            if mounted_or_workspace and _canonical_existing_directory(base):
                mounted_bases.append((base / "DiffPipeForge").resolve(strict=False))
        allowed_bases[:0] = mounted_bases
    if not any(_path_within(resolved, base.resolve(strict=False)) for base in allowed_bases):
        raise HTTPException(status_code=403, detail="Output directory is outside the allowed output roots")
    if not _is_writable_path(resolved):
        raise HTTPException(status_code=403, detail="Output directory is not writable")
    resolved.mkdir(parents=True, exist_ok=True)
    if not resolved.is_dir() or not _is_writable_path(resolved):
        raise HTTPException(status_code=500, detail="Failed to create a writable output directory")
    return {"path": str(resolved.resolve(strict=True))}


def _pending_upload_sessions(root: Path) -> list[Path]:
    return [
        candidate
        for candidate in root.iterdir()
        if candidate.is_dir()
        and WEB_UPLOAD_SESSION_PATTERN.fullmatch(candidate.name)
        and (candidate / WEB_UPLOAD_IN_PROGRESS_MARKER).is_file()
        and not (candidate / WEB_UPLOAD_COMPLETE_MARKER).exists()
    ]


@app.post("/api/web-resources/upload-session")
async def create_upload_session():
    root = _web_upload_root()
    if not _is_writable_path(root):
        raise HTTPException(status_code=403, detail="The configured WebUI upload root is not writable")
    async with upload_lock:
        root.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - max(60, WEB_UPLOAD_STALE_SECONDS)
        for candidate in _pending_upload_sessions(root):
            try:
                if candidate.stat().st_mtime < cutoff:
                    shutil.rmtree(candidate)
            except OSError:
                continue
        pending_sessions = _pending_upload_sessions(root)
        if len(pending_sessions) >= max(1, WEB_MAX_PENDING_UPLOAD_SESSIONS):
            raise HTTPException(status_code=429, detail="Too many unfinished dataset upload sessions")
        pending_bytes = sum(_directory_bytes(candidate) for candidate in pending_sessions)
        if pending_bytes >= max(1, WEB_MAX_PENDING_UPLOAD_BYTES):
            raise HTTPException(status_code=507, detail="Unfinished dataset uploads reached the configured storage limit")
        session_id = f"dataset-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:10]}"
        session_dir = root / session_id
        session_dir.mkdir(mode=0o755, parents=False, exist_ok=False)
        (session_dir / WEB_UPLOAD_IN_PROGRESS_MARKER).write_text(
            json.dumps({"createdAt": datetime.now().isoformat(timespec="seconds")}),
            encoding="utf-8",
        )
        return {"sessionId": session_id, "path": str(session_dir.resolve(strict=True))}


def _upload_session_directory(session_id: str) -> Path:
    if WEB_UPLOAD_SESSION_PATTERN.fullmatch(session_id) is None:
        raise HTTPException(status_code=400, detail="Invalid upload session")
    root = _web_upload_root()
    session_dir = (root / session_id).resolve(strict=False)
    if not _path_within(session_dir, root.resolve(strict=False)) or not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="Upload session not found")
    return session_dir


@app.put("/api/web-resources/upload/{session_id}")
async def upload_dataset_file(session_id: str, request: Request, filename: str):
    safe_name = _validate_leaf_name(filename)
    actual_extension = Path(safe_name).suffix
    extension = actual_extension.lower()
    if extension not in WEB_UPLOAD_FILE_EXTENSIONS or (extension == ".txt" and actual_extension != ".txt"):
        raise HTTPException(status_code=400, detail="Only supported video files and .txt captions can be uploaded")
    file_limit = WEB_MAX_CAPTION_BYTES if extension == ".txt" else WEB_MAX_UPLOAD_FILE_BYTES
    content_length = request.headers.get("content-length")
    declared_size: int | None = None
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length") from exc
        if declared_size < 0 or declared_size > file_limit:
            raise HTTPException(status_code=413, detail="The selected file exceeds the upload limit")

    async with upload_lock:
        session_dir = _upload_session_directory(session_id)
        if (session_dir / WEB_UPLOAD_COMPLETE_MARKER).exists():
            raise HTTPException(status_code=409, detail="This dataset upload is already complete")
        if not (session_dir / WEB_UPLOAD_IN_PROGRESS_MARKER).is_file():
            raise HTTPException(status_code=409, detail="This is not an active dataset upload session")
        target = (session_dir / safe_name).resolve(strict=False)
        resolved_session = session_dir.resolve(strict=True)
        if not _path_within(target, resolved_session) or target.parent != resolved_session:
            raise HTTPException(status_code=400, detail="Invalid upload target")
        if target.is_symlink():
            raise HTTPException(status_code=400, detail="Symbolic links are not valid upload targets")

        root = _web_upload_root()
        pending_sessions = _pending_upload_sessions(root)
        global_pending_bytes = sum(_directory_bytes(candidate) for candidate in pending_sessions)
        existing_total = _directory_bytes(session_dir)
        replaced_bytes = target.stat().st_size if target.is_file() else 0
        remaining_session = WEB_MAX_UPLOAD_SESSION_BYTES - (existing_total - replaced_bytes)
        remaining_global = WEB_MAX_PENDING_UPLOAD_BYTES - (global_pending_bytes - replaced_bytes)
        if declared_size is not None:
            if declared_size > remaining_session or declared_size > remaining_global:
                raise HTTPException(status_code=413, detail="The upload exceeds the configured size limit")
            _ensure_upload_disk_space(session_dir, declared_size)
        temporary = session_dir / f".{safe_name}.{uuid.uuid4().hex}.part"
        received = 0
        try:
            with temporary.open("xb") as output:
                async for chunk in request.stream():
                    received += len(chunk)
                    projected_session = existing_total - replaced_bytes + received
                    projected_global = global_pending_bytes - replaced_bytes + received
                    if (
                        received > file_limit
                        or projected_session > WEB_MAX_UPLOAD_SESSION_BYTES
                        or projected_global > WEB_MAX_PENDING_UPLOAD_BYTES
                    ):
                        raise HTTPException(status_code=413, detail="The upload exceeds the configured size limit")
                    if declared_size is None:
                        # Streaming clients do not announce a final length. Check
                        # immediately before every write so they cannot consume
                        # the filesystem's configured emergency reserve.
                        _ensure_upload_disk_space(session_dir, len(chunk))
                    output.write(chunk)
            if received <= 0:
                raise HTTPException(status_code=400, detail="Empty files are not accepted")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return {"name": safe_name, "size": received, "path": str(target.resolve(strict=True))}


def _finalize_upload_session_locked(session_id: str):
    session_dir = _upload_session_directory(session_id)
    if (session_dir / WEB_UPLOAD_COMPLETE_MARKER).exists():
        raise HTTPException(status_code=409, detail="This dataset upload is already complete")
    if not (session_dir / WEB_UPLOAD_IN_PROGRESS_MARKER).is_file():
        raise HTTPException(status_code=409, detail="This is not an active dataset upload session")
    files = [path for path in session_dir.iterdir() if path.is_file() and not path.name.startswith(".")]
    videos = [path for path in files if path.suffix.lower() in WEB_VIDEO_EXTENSIONS]
    captions = [path for path in files if path.suffix.lower() == ".txt"]
    # Linux dataset loading uses Path.with_suffix('.txt'), which is
    # case-sensitive. Require the caption stem to match the video exactly.
    video_stems = {path.stem: path.stem for path in videos}
    caption_stems = {path.stem: path.stem for path in captions}
    missing = sorted(video_stems[key] for key in video_stems.keys() - caption_stems.keys())
    orphaned = sorted(caption_stems[key] for key in caption_stems.keys() - video_stems.keys())
    if not videos:
        raise HTTPException(status_code=400, detail="Upload at least one video and its matching .txt caption")
    if missing or orphaned or len(video_stems) != len(videos) or len(caption_stems) != len(captions):
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Every video must have exactly one same-name .txt caption",
                "missingCaptions": missing,
                "orphanCaptions": orphaned,
            },
        )
    (session_dir / WEB_UPLOAD_COMPLETE_MARKER).write_text(
        json.dumps({"completedAt": datetime.now().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    (session_dir / WEB_UPLOAD_IN_PROGRESS_MARKER).unlink(missing_ok=True)
    return {
        "path": str(session_dir.resolve(strict=True)),
        "videoCount": len(videos),
        "captionCount": len(captions),
        "totalBytes": sum(path.stat().st_size for path in files),
    }


@app.post("/api/web-resources/upload/{session_id}/finalize")
async def finalize_upload_session(session_id: str):
    async with upload_lock:
        return _finalize_upload_session_locked(session_id)


def _cancel_upload_session_locked(session_id: str):
    session_dir = _upload_session_directory(session_id)
    if (session_dir / WEB_UPLOAD_COMPLETE_MARKER).exists():
        raise HTTPException(status_code=409, detail="Completed datasets cannot be removed from the upload API")
    if not (session_dir / WEB_UPLOAD_IN_PROGRESS_MARKER).is_file():
        raise HTTPException(status_code=409, detail="This is not an active dataset upload session")
    shutil.rmtree(session_dir)
    return {"success": True}


@app.delete("/api/web-resources/upload/{session_id}")
async def cancel_upload_session(session_id: str):
    async with upload_lock:
        return _cancel_upload_session_locked(session_id)


@app.post("/api/web-resources/model-downloads")
async def start_model_download(payload: dict[str, Any]):
    source = str(payload.get("source") or "").strip().lower()
    if source not in {"huggingface", "modelscope"}:
        raise HTTPException(status_code=400, detail="Source must be huggingface or modelscope")
    repo_id = str(payload.get("repoId") or "").strip()
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}", repo_id) is None:
        raise HTTPException(status_code=400, detail="Repository ID must use the owner/name form")
    revision = str(payload.get("revision") or "").strip()
    if (
        not revision
        or len(revision) > 200
        or revision.startswith("/")
        or ".." in PurePosixPath(revision).parts
        or re.fullmatch(r"[A-Za-z0-9._/-]+", revision) is None
    ):
        raise HTTPException(status_code=400, detail="Invalid repository revision")
    target_dir = _resolve_download_target(str(payload.get("targetDir") or ""))

    raw_files = payload.get("files")
    if not isinstance(raw_files, list) or not raw_files or len(raw_files) > 256:
        raise HTTPException(status_code=400, detail="Provide between 1 and 256 repository files")
    files: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for raw_item in raw_files:
        item = {"path": raw_item} if isinstance(raw_item, str) else raw_item
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid repository file entry")
        relative_path = _safe_relative_repo_file(str(item.get("path") or ""))
        try:
            _download_file_path(target_dir, relative_path)
        except RuntimeError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        if relative_path.casefold() in seen_paths:
            raise HTTPException(status_code=400, detail=f"Duplicate repository file: {relative_path}")
        seen_paths.add(relative_path.casefold())
        normalized: dict[str, Any] = {"path": relative_path}
        if item.get("size") is not None:
            try:
                size = int(item["size"])
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=f"Invalid expected size for {relative_path}") from exc
            if size <= 0:
                raise HTTPException(status_code=400, detail=f"Invalid expected size for {relative_path}")
            normalized["size"] = size
        if item.get("sha256"):
            sha256 = str(item["sha256"]).lower()
            if re.fullmatch(r"[a-f0-9]{64}", sha256) is None:
                raise HTTPException(status_code=400, detail=f"Invalid SHA-256 for {relative_path}")
            normalized["sha256"] = sha256
        if "size" not in normalized:
            raise HTTPException(
                status_code=400,
                detail=f"Each repository file requires its expected byte size: {relative_path}",
            )
        if item.get("field"):
            field_name = str(item["field"])
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", field_name) is None:
                raise HTTPException(status_code=400, detail=f"Invalid field mapping for {relative_path}")
            normalized["field"] = field_name
        files.append(normalized)

    # Hashing an existing multi-GB artifact yields the event loop, so the
    # overlap/parallel checks and job reservation must share one lock. Without
    # it two tabs can both pass the checks and write the same target tree.
    async with model_download_start_lock:
        running = [job for job in model_download_jobs.values() if job.get("status") in {"queued", "running"}]
        max_parallel = max(1, int(os.environ.get("DIFFPIPE_WEB_MAX_MODEL_DOWNLOADS", "2")))
        if len(running) >= max_parallel:
            raise HTTPException(status_code=409, detail="The maximum number of model download tasks is already running")
        if any(
            _path_within(Path(str(job.get("targetDir"))).resolve(strict=False), target_dir)
            or _path_within(target_dir, Path(str(job.get("targetDir"))).resolve(strict=False))
            for job in running
        ):
            raise HTTPException(status_code=409, detail="A download task is already using this target directory")

        expected_total = sum(int(item["size"]) for item in files)
        required = 0
        for item in files:
            existing_path = _download_file_path(target_dir, item["path"])
            existing_valid = False
            if existing_path.is_file() and item.get("sha256"):
                try:
                    await asyncio.to_thread(
                        _verify_download,
                        existing_path,
                        item.get("size"),
                        item.get("sha256"),
                    )
                    existing_valid = True
                except RuntimeError:
                    pass
            if not existing_valid:
                required += int(item["size"])
        anchor = _nearest_existing_parent(target_dir)
        if anchor is None:
            raise HTTPException(status_code=400, detail="Download target has no existing parent")
        free = shutil.disk_usage(anchor).free
        reserve = int(os.environ.get("DIFFPIPE_WEB_DOWNLOAD_FREE_RESERVE_BYTES", str(1024**3)))
        if free < required + reserve:
            raise HTTPException(status_code=507, detail="Not enough free space for the requested model files")

        target_dir.mkdir(parents=True, exist_ok=True)
        job_id = uuid.uuid4().hex
        now = time.time()
        public_job = {
            "id": job_id,
            "source": source,
            "repoId": repo_id,
            "revision": revision,
            "targetDir": str(target_dir),
            "status": "queued",
            "totalFiles": len(files),
            "completedFiles": 0,
            "currentFile": None,
            "currentFileIndex": 0,
            "bytesDownloaded": _download_progress_bytes(target_dir, files),
            "totalBytes": expected_total,
            "pathMap": {},
            "error": None,
            "createdAt": now,
            "updatedAt": now,
            "resumable": True,
        }
        model_download_jobs[job_id] = public_job
        spec = {
            "source": source,
            "repoId": repo_id,
            "revision": revision,
            "targetDir": str(target_dir),
            "files": files,
        }
        task = asyncio.create_task(_run_model_download(job_id, spec))
        model_download_tasks[job_id] = task
        return public_job


@app.get("/api/web-resources/model-downloads/{job_id}")
def get_model_download(job_id: str):
    if re.fullmatch(r"[a-f0-9]{32}", job_id) is None or job_id not in model_download_jobs:
        raise HTTPException(status_code=404, detail="Model download task not found")
    return model_download_jobs[job_id]


@app.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
    if _web_auth_enabled():
        if _web_auth_session_details(ws.cookies.get(WEB_AUTH_COOKIE_NAME)) is None:
            await ws.close(code=4401)
            return
        if not _origin_matches_host(ws.headers):
            await ws.close(code=4403)
            return
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


@channel("window-minimize")
@channel("window-toggle-maximize")
@channel("window-close")
def window_noop():
    return {"success": True, "web": True}


@channel("dialog:openFile")
def dialog_open_file(_options: dict[str, Any] | None = None):
    return {"canceled": True, "filePaths": [], "message": "WebUI uses browser/server path input instead of native Electron dialogs."}


@channel("dialog:showMessageBox")
def dialog_show_message_box(_options: dict[str, Any] | None = None):
    return {"response": 0}


@channel("get-file-url")
def get_file_url(file_path: str):
    return Path(file_path).resolve().as_uri()


def _validate_toml_before_save(filename: str, content: str) -> None:
    if Path(filename).name.casefold() != "trainconfig.toml":
        return
    parsed = tomllib.loads(content)
    forbidden = {"output_base_dir"} & set(parsed)
    if forbidden:
        raise ValueError(f"UI-only fields cannot be written to trainconfig.toml: {', '.join(sorted(forbidden))}")


@channel("save-file")
def save_file(file_path: str, content: str):
    _validate_toml_before_save(file_path, content)
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)
    Path(file_path).write_text(content, encoding="utf-8")
    return True


@channel("ensure-dir")
def ensure_dir(dir_path: str):
    Path(dir_path).mkdir(parents=True, exist_ok=True)
    return True


@channel("get-paths")
def get_paths():
    return {"projectRoot": str(PROJECT_ROOT), "outputDir": str(PROJECT_ROOT / "output")}


@channel("get-platform")
def get_platform():
    return sys.platform


@channel("get-language")
def get_language():
    return load_settings().get("language", "zh")


@channel("set-language")
def set_language(lang: str):
    settings = load_settings()
    settings["language"] = lang
    save_settings(settings)
    return {"success": True}


@channel("get-theme")
def get_theme():
    return load_settings().get("theme", "dark")


@channel("set-theme")
def set_theme(theme: str):
    settings = load_settings()
    settings["theme"] = theme
    save_settings(settings)
    return {"success": True}


@channel("get-project-launch-params")
def get_project_launch_params(project_path: str):
    settings = load_settings()
    normalized = project_path.replace("\\", "/").lower()
    return settings.get("projectLaunchParams", {}).get(normalized, {})


@channel("save-project-launch-params")
def save_project_launch_params(payload: dict[str, Any]):
    settings = load_settings()
    settings.setdefault("projectLaunchParams", {})
    normalized = payload.get("projectPath", "").replace("\\", "/").lower()
    settings["projectLaunchParams"][normalized] = payload.get("params", {})
    save_settings(settings)
    return {"success": True}


@channel("get-tool-settings")
def get_tool_settings(tool_id: str):
    return load_settings().get("toolSettings", {}).get(tool_id, {})


@channel("save-tool-settings")
def save_tool_settings(payload: dict[str, Any]):
    settings = load_settings()
    settings.setdefault("toolSettings", {})
    settings["toolSettings"][payload.get("toolId")] = payload.get("settings", {})
    save_settings(settings)
    return {"success": True}


@channel("get-python-status")
async def get_python_status():
    project_root = PROJECT_ROOT
    python_exe = get_python_exe(project_root)
    local_envs = scan_python_environments(project_root)
    conda_envs = await scan_conda_environments()
    available_envs = local_envs + conda_envs
    is_ready = python_exe in ("python", "python3") or Path(python_exe).exists()
    embedded = str(project_root / "python_embeded_DP" / ("python.exe" if os.name == "nt" else "bin/python"))
    display_name = "System Python" if python_exe in ("python", "python3") else Path(python_exe).parent.name
    return {"path": python_exe, "displayName": display_name, "status": "ready" if is_ready else "missing", "isInternal": python_exe == embedded, "availableEnvs": available_envs}


@channel("set-python-env")
async def set_python_env(file_path: str):
    settings = load_settings()
    settings["userPythonPath"] = file_path
    save_settings(settings)
    status = await get_python_status()
    await broadcast("python-status-changed", {k: status[k] for k in ("path", "displayName", "status", "isInternal")})
    return {"success": True, **status}


@channel("pick-python-exe")
def pick_python_exe():
    return {"canceled": True, "message": "WebUI: please paste a Python path in the UI once a path input is added."}


@channel("check-file-exists")
def check_file_exists(file_path: str):
    return bool(file_path and Path(file_path).exists())


@channel("open-path")
@channel("open-folder")
@channel("open-external")
def open_path(path_str: str):
    try:
        if path_str.startswith("http://") or path_str.startswith("https://"):
            webbrowser.open(path_str)
            return True
        if not Path(path_str).exists():
            return {"success": False, "error": "路径不存在"}
        os.startfile(path_str) if os.name == "nt" else subprocess.Popen(["xdg-open", path_str])
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@channel("read-file")
def read_file(file_path: str):
    p = Path(file_path)
    if not file_path or not p.exists():
        return None
    return p.read_text(encoding="utf-8")


@channel("read-project-folder")
def read_project_folder(folder_path: str):
    folder = Path(folder_path)
    if not folder.exists():
        return {"error": "Folder not found"}

    def try_read(candidates: list[str]):
        for rel in candidates:
            path = folder / rel
            if path.exists():
                return path.read_text(encoding="utf-8")
        return None

    return {
        "datasetConfig": try_read(["dataset.toml", "dataset/dataset.toml"]),
        "evalDatasetConfig": try_read(["evaldataset.toml", "dataset/evaldataset.toml"]),
        "trainConfig": try_read(["trainconfig.toml", "train_config/trainconfig.toml"]),
    }


@channel("set-session-folder")
def set_session_folder(folder_path: str | None):
    global cached_output_folder
    if not folder_path:
        cached_output_folder = None
        return {"success": True}
    if Path(folder_path).exists():
        cached_output_folder = folder_path
        return {"success": True}
    return {"success": False, "error": "Invalid path"}


@channel("create-new-project")
def create_new_project():
    global cached_output_folder
    cached_output_folder = None
    folder = Path(get_today_output_folder(PROJECT_ROOT))
    (folder / "trainconfig.toml").write_text("""[model]
type = 'sdxl'
checkpoint_path = ''
unet_lr = 4e-05
text_encoder_1_lr = 2e-05
text_encoder_2_lr = 2e-05
min_snr_gamma = 5
dtype = 'bfloat16'

[optimizer]
type = 'adamw_optimi'
lr = 2e-5
betas = [0.9, 0.99]
weight_decay = 0.01
eps = 1e-8

[adapter]
type = 'lora'
rank = 32
dtype = 'bfloat16'

epochs = 10
micro_batch_size_per_gpu = 1
gradient_accumulation_steps = 1
""", encoding="utf-8")
    (folder / "dataset.toml").write_text("""[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
min_ar = 0.5
max_ar = 2.0
num_repeats = 1
""", encoding="utf-8")
    (folder / "evaldataset.toml").write_text("""[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
""", encoding="utf-8")
    return {"success": True, "path": str(folder)}


@channel("save-to-date-folder")
def save_to_date_folder(payload: dict[str, Any]):
    folder = Path(get_today_output_folder(PROJECT_ROOT))
    file_path = folder / payload["filename"]
    content = payload.get("content", "")
    _validate_toml_before_save(str(file_path), content)
    file_path.write_text(content, encoding="utf-8")
    return {"success": True, "path": str(file_path).replace("\\", "/"), "folder": str(folder).replace("\\", "/")}


@channel("delete-from-date-folder")
def delete_from_date_folder(payload: dict[str, Any]):
    file_path = Path(get_today_output_folder(PROJECT_ROOT)) / payload["filename"]
    if file_path.exists():
        file_path.unlink()
        return {"success": True}
    return {"success": False, "error": "File not found"}


@channel("copy-to-date-folder")
def copy_to_date_folder(payload: dict[str, Any]):
    source = Path(payload["sourcePath"])
    folder = Path(get_today_output_folder(PROJECT_ROOT))
    dest = folder / payload.get("filename", source.name)
    shutil.copyfile(source, dest)
    return {"success": True, "path": str(dest)}


@channel("copy-folder-configs-to-date")
def copy_folder_configs_to_date(payload: dict[str, Any]):
    source_folder = Path(payload["sourceFolderPath"])
    if not source_folder.is_dir():
        return {"success": False, "error": "Source is not a directory"}
    folder = Path(get_today_output_folder(PROJECT_ROOT))
    copied: list[str] = []
    config_files = ["trainconfig.toml", "dataset.toml", "evaldataset.toml"]
    for name in config_files:
        src = source_folder / name
        if src.exists():
            shutil.copyfile(src, folder / name)
            copied.append(name)
    for src in source_folder.rglob("*.toml"):
        if len(copied) >= 3:
            break
        content = src.read_text(encoding="utf-8", errors="ignore")
        target = ""
        if "[model]" in content and "type" in content:
            target = "trainconfig.toml"
        elif "[[datasets]]" in content or "[dataset]" in content:
            target = "dataset.toml" if "dataset.toml" not in copied else "evaldataset.toml"
        if target and target not in copied:
            shutil.copyfile(src, folder / target)
            copied.append(target)
    return {"success": True, "copiedFiles": copied, "outputFolder": str(folder)}


@channel("list-images")
def list_images(payload: dict[str, Any]):
    dir_path = Path(payload.get("dirPath", ""))
    limit = int(payload.get("limit", 20))
    if not dir_path.exists():
        return {"success": True, "images": [], "total": 0}
    exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"}
    images = sorted([str(p) for p in dir_path.iterdir() if p.suffix.lower() in exts], key=lambda x: x.lower())
    return {"success": True, "images": images[:limit], "total": len(images)}


@channel("list-media")
def list_media(payload: dict[str, Any]):
    dir_path = Path(payload.get("dirPath", ""))
    limit = int(payload.get("limit", 20))
    if not dir_path.exists():
        return {"success": True, "files": [], "total": 0, "imageTotal": 0, "videoTotal": 0}
    image_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"}
    video_exts = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wmv"}
    files = sorted([p for p in dir_path.iterdir() if p.suffix.lower() in image_exts or p.suffix.lower() in video_exts], key=lambda x: str(x).lower())
    image_total = sum(1 for p in files if p.suffix.lower() in image_exts)
    video_total = sum(1 for p in files if p.suffix.lower() in video_exts)
    return {"success": True, "files": [str(p) for p in files[:limit]], "total": len(files), "imageTotal": image_total, "videoTotal": video_total}


def image_data_url(file_path: str) -> str:
    path = Path(file_path)
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    if Image is None:
        return path.resolve().as_uri()
    try:
        with Image.open(path) as img:
            img.thumbnail((200, 200))
            from io import BytesIO
            buf = BytesIO()
            fmt = "PNG" if img.mode in ("RGBA", "P") else "JPEG"
            img.convert("RGBA" if fmt == "PNG" else "RGB").save(buf, format=fmt)
            mime = "image/png" if fmt == "PNG" else "image/jpeg"
            return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return path.resolve().as_uri()


@channel("get-thumbnail")
def get_thumbnail(file_path: str):
    return image_data_url(file_path)


@channel("get-mask-thumbnail")
def get_mask_thumbnail(payload: dict[str, Any]):
    original = Path(payload["originalPath"])
    mask_filename = original.with_suffix(".png").name
    if payload.get("overrideMaskPath"):
        mask_path = Path(payload["overrideMaskPath"]) / mask_filename
    elif payload.get("maskDirName"):
        mask_path = original.parent / payload["maskDirName"] / mask_filename
    else:
        mask_path = Path(str(original.parent) + "_masks") / mask_filename
    if not mask_path.exists():
        return {"success": False}
    return {"success": True, "thumbnail": image_data_url(str(mask_path)), "maskPath": str(mask_path)}


@channel("read-caption")
def read_caption(image_path: str):
    caption = Path(image_path).with_suffix(".txt")
    if caption.exists():
        return {"exists": True, "content": caption.read_text(encoding="utf-8").strip()}
    return {"exists": False, "content": ""}


@channel("write-caption")
def write_caption(payload: dict[str, Any]):
    Path(payload["imagePath"]).with_suffix(".txt").write_text(payload.get("content", ""), encoding="utf-8")
    return {"success": True}


@channel("restore-files")
def restore_files(file_paths: list[str]):
    count = 0
    for file_path in file_paths:
        src = Path(file_path)
        if not src.exists():
            continue
        dest = src.parent.parent / src.name
        if dest.exists():
            dest = src.parent.parent / f"{src.stem}_restored_{int(time.time())}{src.suffix}"
        src.rename(dest)
        count += 1
    return {"success": True, "count": count}


@channel("cache-video")
def cache_video(file_path: str):
    source = Path(file_path)
    cache_dir = PROJECT_ROOT / ".cache"
    cache_dir.mkdir(exist_ok=True)
    normalized = str(source.resolve())
    if str(cache_dir.resolve()) in normalized:
        return normalized
    hashed = hashlib.md5(normalized.encode("utf-8")).hexdigest()[:12]
    dest = cache_dir / f"{hashed}_{source.name}"
    if not dest.exists():
        shutil.copyfile(source, dest)
    return str(dest)


@channel("check-style-model")
def check_style_model():
    model_path = PROJECT_ROOT / "tools" / "filter_style" / "clip-vit-base-patch32"
    return model_path.exists() and (model_path / "config.json").exists() and ((model_path / "pytorch_model.bin").exists() or (model_path / "model.safetensors").exists())


@channel("get-recent-projects")
def get_recent_projects():
    projects = []
    if RECENT_PROJECTS_FILE.exists():
        try:
            projects = json.loads(RECENT_PROJECTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            projects = []
    output_dir = PROJECT_ROOT / "output"
    if output_dir.exists():
        seen = {str(Path(p.get("path", "")).resolve()).lower() for p in projects if p.get("path")}
        for entry in output_dir.iterdir():
            if entry.is_dir() and str(entry.resolve()).lower() not in seen:
                projects.append({"name": entry.name, "path": str(entry), "lastModified": datetime.fromtimestamp(entry.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    verified = []
    for p in projects:
        path = Path(p.get("path", ""))
        if path.exists():
            p["timestamp"] = path.stat().st_mtime * 1000
            p["lastModified"] = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            verified.append(p)
    verified.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return verified


@channel("add-recent-project")
def add_recent_project(project: dict[str, Any]):
    projects = [p for p in get_recent_projects() if p.get("path", "").lower() != project.get("path", "").lower()]
    projects.insert(0, project)
    RECENT_PROJECTS_FILE.write_text(json.dumps(projects[:20], ensure_ascii=False, indent=2), encoding="utf-8")
    return get_recent_projects()


@channel("remove-recent-project")
def remove_recent_project(project_path: str):
    projects = [p for p in get_recent_projects() if p.get("path", "").lower() != project_path.lower()]
    RECENT_PROJECTS_FILE.write_text(json.dumps(projects, ensure_ascii=False, indent=2), encoding="utf-8")
    return get_recent_projects()


@channel("delete-project-folder")
def delete_project_folder(project_path: str):
    path = Path(project_path)
    remove_recent_project(project_path)
    if path.exists():
        shutil.rmtree(path)
        return {"success": True, "projects": get_recent_projects()}
    return {"success": False, "error": "Path does not exist", "projects": get_recent_projects()}


@channel("rename-project-folder")
def rename_project_folder(payload: dict[str, str]):
    old_path = Path(payload["oldPath"])
    new_path = old_path.parent / payload["newName"]
    if not old_path.exists():
        return {"success": False, "error": "Path does not exist"}
    if new_path.exists() and old_path.resolve() != new_path.resolve():
        return {"success": False, "error": "Target name already exists"}
    old_path.rename(new_path)
    return {"success": True, "newPath": str(new_path), "projects": get_recent_projects()}


@channel("get-training-status")
def get_training_status():
    return {"running": training_process is not None, "pid": getattr(training_process, "pid", None), "currentLogFilePath": current_log_file_path, "logs": training_log_queue}


@channel("list-resume-checkpoints")
def list_resume_checkpoints(config_path: str):
    if not config_path or not Path(config_path).is_file():
        raise ValueError("Missing or invalid configPath")
    try:
        return list_training_checkpoints(config_path)
    except ValueError as exc:
        # A newly-created project has no output_dir until the training page is
        # saved. Treat that state as "no checkpoints yet" in the browser UI.
        if "output_dir" in str(exc):
            return {"outputDir": "", "checkpoints": []}
        raise


@channel("validate-resume-checkpoint")
def validate_resume_checkpoint(payload: dict[str, Any]):
    config_path = payload.get("configPath", "")
    checkpoint_path = payload.get("checkpointPath", "")
    if not config_path or not Path(config_path).is_file():
        return {"valid": False, "errorCode": "checkpoint_invalid_config", "message": "训练配置文件不存在。"}
    if not isinstance(checkpoint_path, str) or not checkpoint_path.strip():
        return {"valid": True, "path": ""}
    return resolve_resume_checkpoint(config_path, checkpoint_path)


@channel("get-training-logs")
def get_training_logs(log_path: str):
    if not log_path or not Path(log_path).exists():
        return []
    return [line for line in Path(log_path).read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]


@channel("get-training-sessions")
def get_training_sessions(config_path: str):
    if not config_path:
        return []
    config_dir = Path(config_path).parent
    if not config_dir.exists():
        return []
    sessions = []
    for log_file in sorted(config_dir.glob("*.log"), reverse=True):
        if TRAINING_SESSION_NAME_PATTERN.fullmatch(log_file.stem):
            sessions.append({"id": log_file.stem, "path": str(log_file), "timestamp": log_file.stat().st_mtime * 1000, "hasLog": True})
    return sessions


async def training_reader(line: str, log_buffer: list[str]) -> None:
    global current_log_file_path
    training_log_queue.append(line)
    if len(training_log_queue) > 2000:
        del training_log_queue[: len(training_log_queue) - 2000]
    await broadcast("training-output", line)
    match = None
    try:
        import re
        match = re.search(r"iter time \(s\):\s*([\d.]+)\s*samples/sec:\s*([\d.]+)", line)
    except Exception:
        pass
    if match:
        await broadcast("training-speed", {"iterTime": float(match.group(1)), "samplesPerSec": float(match.group(2))})
    if current_log_file_path:
        try:
            Path(current_log_file_path).parent.mkdir(parents=True, exist_ok=True)
            with open(current_log_file_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError as exc:
            print(f"[WebUI] Failed to persist training log, continuing in memory: {exc}")
            current_log_file_path = None
            log_buffer.append(line)
    else:
        log_buffer.append(line)


async def detect_training_log(config_path: Path, base_output_dir: str, start_time: float, log_buffer: list[str]) -> None:
    global current_log_file_path, training_process
    attempts = 0
    base = Path(base_output_dir) if base_output_dir else None
    while training_process is not None and not current_log_file_path and base and attempts < 60:
        attempts += 1
        await asyncio.sleep(5)
        if not base.exists():
            continue
        sessions = [p for p in base.iterdir() if p.is_dir() and TRAINING_SESSION_NAME_PATTERN.fullmatch(p.name)]
        if not sessions:
            continue
        newest = sorted(sessions, key=lambda p: p.name, reverse=True)[0]
        if newest.stat().st_ctime >= start_time - 30:
            current_log_file_path = str(config_path.parent / f"{newest.name}.log")
            if log_buffer:
                Path(current_log_file_path).write_text("\n".join(log_buffer) + "\n", encoding="utf-8")
                log_buffer.clear()


async def _start_training(payload: dict[str, Any]):
    global training_process, current_log_file_path, training_log_queue
    if training_process is not None:
        return {"success": False, "message": "训练已经在进行中"}
    config_path = Path(payload.get("configPath", ""))
    if not config_path.exists():
        return {"success": False, "error": "Missing or invalid configPath"}

    base_output_dir = ""
    try:
        base_output_dir = str(get_training_output_directory(config_path))
    except Exception as exc:
        return {"success": False, "error": f"Failed to resolve output_dir: {exc}"}

    project_root = PROJECT_ROOT
    python_exe = get_python_exe(project_root)
    if python_exe not in ("python", "python3") and not Path(python_exe).exists():
        return {"success": False, "error": f"Python interpreter not found at {python_exe}"}

    is_linux = sys.platform.startswith("linux")
    script_path = resolve_backend_path("backend/core_linux/train.py" if is_linux else "backend/core/train.py")
    if not script_path.exists():
        return {"success": False, "error": f"Train script not found at {script_path}"}

    validated_resume_checkpoint = ""
    requested_resume_checkpoint = payload.get("resume_from_checkpoint")
    if isinstance(requested_resume_checkpoint, str) and requested_resume_checkpoint.strip():
        inspection = resolve_resume_checkpoint(config_path, requested_resume_checkpoint)
        if not inspection["valid"]:
            return {
                "success": False,
                "code": inspection.get("errorCode"),
                "message": inspection.get("message", "检查点目录无效。"),
            }
        validated_resume_checkpoint = inspection["path"]

    python_args = [str(script_path), "--config", str(config_path)]
    if validated_resume_checkpoint:
        python_args.extend(["--resume_from_checkpoint", validated_resume_checkpoint])
    mapping = {
        "dump_dataset": "--dump_dataset",
    }
    for key, flag in mapping.items():
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            python_args.extend([flag, value.strip()])
    for key, flag in {
        "reset_dataloader": "--reset_dataloader",
        "reset_optimizer_params": "--reset_optimizer_params",
        "cache_only": "--cache_only",
        "i_know_what_i_am_doing": "--i_know_what_i_am_doing",
        "regenerate_cache": "--regenerate_cache",
        "trust_cache": "--trust_cache",
    }.items():
        if payload.get(key):
            python_args.append(flag)
    python_args.append("--deepspeed")

    spawn_exe = python_exe
    spawn_args = python_args
    if is_linux:
        deepspeed = Path(python_exe).parent / "deepspeed"
        spawn_exe = str(deepspeed if deepspeed.exists() else "deepspeed")
        spawn_args = [f"--num_gpus={payload.get('num_gpus') or 1}"] + python_args

    local_size = str(payload.get("num_gpus") or 1) if is_linux else "1"

    current_log_file_path = None
    if validated_resume_checkpoint:
        current_log_file_path = str(config_path.parent / f"{Path(validated_resume_checkpoint).name}.log")
    training_log_queue = []
    log_buffer: list[str] = []
    command_line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [Command]: {spawn_exe} {' '.join(spawn_args)}"
    await training_reader(command_line, log_buffer)

    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    spawned_process = await asyncio.create_subprocess_exec(
        spawn_exe,
        *spawn_args,
        cwd=str(script_path.parent),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={
            **os.environ,
            "LOCAL_SIZE": local_size,
            "LOCAL_WORLD_SIZE": local_size,
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUNBUFFERED": "1",
        },
        creationflags=creationflags,
        start_new_session=os.name != "nt",
    )
    training_process = spawned_process
    await broadcast("training-status", {"type": "started", "running": True, "pid": spawned_process.pid})

    async def watch() -> None:
        global training_process
        await asyncio.gather(
            read_stream_lines(spawned_process.stdout, lambda line: training_reader(line, log_buffer)),
            read_stream_lines(spawned_process.stderr, lambda line: training_reader(line, log_buffer)),
        )
        code = await spawned_process.wait()
        if training_process is spawned_process:
            training_process = None
            status_type = "finished" if code == 0 else "error"
            await broadcast("training-status", {"type": status_type, "code": code, "running": False})

    asyncio.create_task(watch())
    if base_output_dir and not validated_resume_checkpoint:
        asyncio.create_task(detect_training_log(config_path, base_output_dir, time.time(), log_buffer))
    return {"success": True, "pid": spawned_process.pid}


@channel("start-training")
async def start_training(payload: dict[str, Any]):
    async with training_start_lock:
        return await _start_training(payload)


@channel("stop-training")
async def stop_training():
    global training_process, current_log_file_path
    async with training_start_lock:
        if training_process is not None:
            process_to_stop = training_process
            kill_process_tree(process_to_stop)
            try:
                await asyncio.wait_for(asyncio.shield(process_to_stop.wait()), timeout=15)
            except asyncio.TimeoutError:
                return {"success": False, "message": "训练进程仍在停止中，请稍后再试。"}
            if training_process is process_to_stop:
                training_process = None
            current_log_file_path = None
            return {"success": True}
        return {"success": False, "message": "No training running"}


@channel("run-python-script-capture")
async def run_python_script_capture(payload: dict[str, Any]):
    script_path = payload.get("scriptPath", "")
    args = payload.get("args", [])
    full_script = Path(script_path) if Path(script_path).is_absolute() else PROJECT_ROOT / script_path
    if not full_script.exists() and not ("/" in script_path or "\\" in script_path):
        full_script = PROJECT_ROOT / "tools" / script_path
    if not full_script.exists():
        return {"success": False, "error": f"Script not found: {full_script}"}
    proc = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), str(full_script), *args, cwd=str(full_script.parent), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    stdout, stderr = await proc.communicate()
    return {"success": proc.returncode == 0, "stdout": stdout.decode("utf-8", errors="replace"), "stderr": stderr.decode("utf-8", errors="replace"), "code": proc.returncode}


@channel("run-tool")
async def run_tool(payload: dict[str, Any]):
    global active_tool_process, active_tool_script_name, is_tool_manually_stopped, tool_log_buffer
    if active_tool_process is not None:
        return {"success": False, "error": "已有工具正在运行中"}
    script_name = payload.get("scriptName", "")
    args = payload.get("args", [])
    online = bool(payload.get("online", False))
    script_path = Path(script_name) if Path(script_name).is_absolute() else PROJECT_ROOT / script_name
    if not script_path.exists() and not ("/" in script_name or "\\" in script_name):
        script_path = PROJECT_ROOT / "tools" / script_name
    if not script_path.exists():
        return {"success": False, "error": f"找不到工具脚本: {script_path}"}

    tool_log_buffer = []
    active_tool_script_name = script_name
    is_tool_manually_stopped = False
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    if not online:
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
    active_tool_process = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), str(script_path), *args, cwd=str(script_path.parent), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    proc = active_tool_process

    async def on_tool_line(line: str) -> None:
        clean = line.replace("\x1b", "")
        if not clean.strip():
            return
        tool_log_buffer.append(clean)
        if len(tool_log_buffer) > 1000:
            del tool_log_buffer[: len(tool_log_buffer) - 1000]
        await broadcast("tool-output", clean)

    await asyncio.gather(read_stream_lines(proc.stdout, on_tool_line), read_stream_lines(proc.stderr, on_tool_line))
    code = await proc.wait()
    is_success = code == 0 and not is_tool_manually_stopped
    msg = f"\n--- [{datetime.now().strftime('%H:%M:%S')}] Task {'Finished' if is_success else ('Stopped' if is_tool_manually_stopped else 'Failed')} (Code {code}) ---\n"
    tool_log_buffer.append(msg)
    await broadcast("tool-status", {"type": "finished", "code": code, "isSuccess": is_success, "scriptName": script_name})
    active_tool_process = None
    active_tool_script_name = None
    return {"success": is_success}


@channel("stop-tool")
def stop_tool():
    global active_tool_process, is_tool_manually_stopped
    if active_tool_process is not None:
        is_tool_manually_stopped = True
        kill_process_tree(active_tool_process)
        active_tool_process = None
    return {"success": True}


@channel("get-tool-status")
def get_tool_status():
    return {"isRunning": active_tool_process is not None, "pid": getattr(active_tool_process, "pid", None), "scriptName": active_tool_script_name}


@channel("get-tool-logs")
def get_tool_logs():
    return tool_log_buffer


@channel("start-tensorboard")
async def start_tensorboard(payload: dict[str, Any]):
    global active_tensorboard_process, tensorboard_url
    if active_tensorboard_process is not None:
        kill_process_tree(active_tensorboard_process)
    log_dir = payload.get("logDir") or str(PROJECT_ROOT / "output")
    host = payload.get("host") or "localhost"
    port = int(payload.get("port") or 6006)
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    active_tensorboard_process = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), "-m", "tensorboard.main", "--logdir", log_dir, "--host", host, "--port", str(port), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, env={**os.environ, "PYTHONUTF8": "1"})
    tensorboard_url = f"http://{host}:{port}"
    settings = load_settings()
    settings.update({"isTensorboardEnabled": True, "tbLogDir": log_dir, "tbHost": host, "tbPort": port})
    save_settings(settings)
    return {"success": True, "url": tensorboard_url}


@channel("stop-tensorboard")
def stop_tensorboard():
    global active_tensorboard_process, tensorboard_url
    if active_tensorboard_process is not None:
        kill_process_tree(active_tensorboard_process)
        active_tensorboard_process = None
    tensorboard_url = ""
    settings = load_settings()
    settings["isTensorboardEnabled"] = False
    save_settings(settings)
    return {"success": True}


@channel("get-tensorboard-status")
def get_tensorboard_status():
    settings = load_settings()
    is_running = active_tensorboard_process is not None
    return {"isRunning": is_running, "url": tensorboard_url if is_running else "", "settings": {"host": settings.get("tbHost", "localhost"), "port": settings.get("tbPort", 6006), "logDir": settings.get("tbLogDir", ""), "autoStart": settings.get("isTensorboardEnabled", False)}}


@channel("get-fingerprint-cache")
def get_fingerprint_cache():
    return load_settings().get("cachedFingerprint")


@channel("save-fingerprint-cache")
def save_fingerprint_cache(fingerprint: dict[str, Any]):
    settings = load_settings()
    settings["cachedFingerprint"] = {**fingerprint, "calculatedAt": datetime.now().isoformat()}
    save_settings(settings)
    return {"success": True}


@channel("get-official-fingerprint")
def get_official_fingerprint():
    official = PROJECT_ROOT / "fingerprints" / "official.json"
    if not official.exists():
        return None
    data = json.loads(official.read_text(encoding="utf-8"))
    return {"sha256": data.get("combined_sha256") or data.get("sha256"), "totalFiles": data.get("total_files"), "version": data.get("version", "1.0.0"), "generatedAt": data.get("generated_at")}


@channel("calculate-python-fingerprint")
def calculate_python_fingerprint():
    python_exe = get_python_exe(PROJECT_ROOT)
    if python_exe in ("python", "python3"):
        return {"error": "Cannot calculate fingerprint for System Python. Please use a portable or virtual environment."}
    root = Path(python_exe).parent
    if root.name.lower() in ("scripts", "bin"):
        root = root.parent
    if not root.exists():
        return {"error": f"Python environment root not found at: {root}"}
    files = []
    total_size = 0
    combined = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pyc" not in str(p)):
        rel = path.relative_to(root).as_posix()
        h = hashlib.sha256(path.read_bytes()).hexdigest()
        size = path.stat().st_size
        total_size += size
        files.append({"path": rel, "size": size, "sha256": h})
        combined.update(f"{rel}:{h}".encode("utf-8"))
    def fmt(n: int) -> str:
        return f"{n / 1024 / 1024 / 1024:.2f} GB" if n >= 1024**3 else f"{n / 1024 / 1024:.2f} MB" if n >= 1024**2 else f"{n / 1024:.2f} KB" if n >= 1024 else f"{n} B"
    return {"totalFiles": len(files), "totalSize": total_size, "totalSizeFormatted": fmt(total_size), "sha256": combined.hexdigest(), "files": files[:100]}


@channel("fix-python-env")
async def fix_python_env():
    req = PROJECT_ROOT / "requirements.txt"
    if not req.exists():
        req = APP_DIR / "requirements.txt"
    proc = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), "-m", "pip", "install", "-r", str(req), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, "PYTHONUTF8": "1"})
    stdout, stderr = await proc.communicate()
    return {"success": proc.returncode == 0, "output": stdout.decode("utf-8", errors="replace"), "error": stderr.decode("utf-8", errors="replace")}


@channel("check-python-env")
async def check_python_env():
    req = PROJECT_ROOT / "requirements.txt"
    script = APP_DIR / "backend" / "check_requirements.py"
    if not req.exists() or not script.exists():
        return {"success": False, "error": "requirements.txt or check_requirements.py not found"}
    proc = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), str(script), str(req), "--json", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, "PYTHONUTF8": "1"})
    stdout, _ = await proc.communicate()
    text = stdout.decode("utf-8", errors="replace")
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        result = json.loads(text[start : end + 1])
        return {"success": True, "missing": result.get("missing", [])}
    return {"success": proc.returncode == 0, "missing": []}


@channel("run-backend")
async def run_backend(args: list[str]):
    script = APP_DIR / "backend" / "main.py"
    proc = await asyncio.create_subprocess_exec(get_python_exe(PROJECT_ROOT), str(script), "--json", *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    stdout, stderr = await proc.communicate()
    text = stdout.decode("utf-8", errors="replace")
    start = text.find("__JSON_START__")
    end = text.rfind("__JSON_END__")
    if start != -1 and end != -1:
        return json.loads(text[start + len("__JSON_START__") : end].strip())
    return {"rawOutput": text, "rawError": stderr.decode("utf-8", errors="replace")}


@channel("kill-backend")
def kill_backend():
    global active_backend_process
    kill_process_tree(active_backend_process)
    active_backend_process = None
    return True


@channel("start-resource-monitor")
def start_resource_monitor():
    return {"success": True, "message": "WebUI resource monitor polling is not implemented yet"}


@channel("stop-resource-monitor")
def stop_resource_monitor():
    return {"success": True}


@channel("get-resource-monitor-stats")
def get_resource_monitor_stats():
    return latest_monitor_stats


@channel("open-backend-log")
def open_backend_log():
    log_path = LOG_DIR / "backend_debug.log"
    if not log_path.exists():
        return {"success": False, "error": "Log file not found"}
    return open_path(str(log_path))


@channel("check-model-status")
def check_model_status():
    models_root = PROJECT_ROOT / "models"
    def check(*paths: str) -> bool:
        return any((models_root / p).exists() for p in paths)
    return {"success": True, "root": str(models_root), "status": {"whisperx": check("faster-whisper-large-v3-turbo-ct2", "whisperx/faster-whisper-large-v3-turbo-ct2"), "alignment": check("alignment"), "index_tts": check("index-tts", "index-tts/hub"), "qwen": check("Qwen2.5-7B-Instruct", "qwen/Qwen2.5-7B-Instruct"), "rife": check("rife", "rife-ncnn-vulkan")}}


@app.get("/api/file")
def serve_file(path: str):
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))


if UI_DIST.exists():
    app.mount("/", StaticFiles(directory=str(UI_DIST), html=True), name="ui")
else:
    @app.get("/")
    def missing_dist():
        return {"message": "UI dist not found. Run `npm run build:web` in app/ui first."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
