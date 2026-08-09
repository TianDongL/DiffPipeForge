import asyncio
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import web_server


class WebAuthTests(unittest.TestCase):
    origin = "https://cloud.example"

    def setUp(self):
        self.mode_patch = mock.patch.object(web_server, "WEB_AUTH_MODE", "system")
        self.password_patch = mock.patch.object(
            web_server,
            "_verify_web_auth_credentials",
            side_effect=lambda payload: payload.get("credential") == "correct-instance-password",
        )
        self.mode_patch.start()
        self.password_patch.start()
        with web_server._web_auth_state_lock:
            web_server._web_auth_sessions.clear()
            web_server._web_auth_attempts_by_client.clear()
            web_server._web_auth_global_attempts.clear()
        web_server.clients.clear()
        self.client = TestClient(web_server.app, base_url=self.origin)

    def tearDown(self):
        self.client.close()
        self.password_patch.stop()
        self.mode_patch.stop()

    def login(self, password: str = "correct-instance-password"):
        return self.client.post(
            "/auth/login",
            headers={"Origin": self.origin},
            json={"credential": password},
        )

    def test_auth_off_preserves_existing_api_behavior(self):
        with mock.patch.object(web_server, "WEB_AUTH_MODE", "off"):
            response = self.client.post("/api/ipc/get-platform", json=[])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("data", response.json())

    def test_unauthenticated_root_is_login_page_and_sensitive_routes_are_denied(self):
        root = self.client.get("/")
        self.assertEqual(root.status_code, 200, root.text)
        self.assertIn("实例密码", root.text)
        self.assertIn("Instance password", root.text)
        self.assertEqual(root.headers.get("cache-control"), "no-store")
        self.assertIn("frame-ancestors 'none'", root.headers.get("content-security-policy", ""))

        api = self.client.post("/api/ipc/get-platform", json=[])
        self.assertEqual(api.status_code, 401, api.text)
        file_api = self.client.get("/api/file", params={"path": "missing"})
        self.assertEqual(file_api.status_code, 401, file_api.text)

        health = self.client.get("/healthz")
        self.assertEqual(health.status_code, 200, health.text)
        self.assertEqual(health.json(), {"status": "ok"})

    def test_wrong_and_correct_password_cookie_and_logout(self):
        wrong = self.login("wrong")
        self.assertEqual(wrong.status_code, 401, wrong.text)
        self.assertNotIn(web_server.WEB_AUTH_COOKIE_NAME, wrong.cookies)

        correct = self.login()
        self.assertEqual(correct.status_code, 200, correct.text)
        cookie = correct.headers.get("set-cookie", "")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("SameSite=strict", cookie)

        authenticated = self.client.post(
            "/api/ipc/get-platform",
            headers={"Origin": self.origin},
            json=[],
        )
        self.assertEqual(authenticated.status_code, 200, authenticated.text)

        logout = self.client.post("/auth/logout", headers={"Origin": self.origin})
        self.assertEqual(logout.status_code, 200, logout.text)
        denied_again = self.client.get("/api/web-resources/roots")
        self.assertEqual(denied_again.status_code, 401, denied_again.text)

    def test_login_and_authenticated_mutations_require_same_host_origin(self):
        missing_origin = self.client.post(
            "/auth/login",
            json={"credential": "correct-instance-password"},
        )
        self.assertEqual(missing_origin.status_code, 403, missing_origin.text)
        foreign_origin = self.client.post(
            "/auth/login",
            headers={"Origin": "https://attacker.example"},
            json={"credential": "correct-instance-password"},
        )
        self.assertEqual(foreign_origin.status_code, 403, foreign_origin.text)

        self.assertEqual(self.login().status_code, 200)
        blocked = self.client.post(
            "/api/ipc/get-platform",
            headers={"Origin": "https://attacker.example"},
            json=[],
        )
        self.assertEqual(blocked.status_code, 403, blocked.text)
        allowed = self.client.post(
            "/api/ipc/get-platform",
            headers={"Origin": self.origin},
            json=[],
        )
        self.assertEqual(allowed.status_code, 200, allowed.text)

    def test_login_attempts_are_rate_limited(self):
        with mock.patch.object(web_server, "WEB_AUTH_LOGIN_MAX_ATTEMPTS", 2), mock.patch.object(
            web_server,
            "WEB_AUTH_LOGIN_GLOBAL_MAX_ATTEMPTS",
            20,
        ):
            self.assertEqual(self.login("wrong-1").status_code, 401)
            self.assertEqual(self.login("wrong-2").status_code, 401)
            limited = self.login()
        self.assertEqual(limited.status_code, 429, limited.text)
        self.assertGreaterEqual(int(limited.headers["retry-after"]), 1)

    def test_login_rejects_declared_and_streamed_bodies_over_8192_bytes(self):
        declared = self.client.post(
            "/auth/login",
            headers={
                "Origin": self.origin,
                "Content-Type": "application/json",
                "Content-Length": str(web_server.WEB_AUTH_LOGIN_MAX_BODY_BYTES + 1),
            },
            content=b"{}",
        )
        self.assertEqual(declared.status_code, 413, declared.text)

        def oversized_chunks():
            yield b'{"credential":"'
            yield b"x" * web_server.WEB_AUTH_LOGIN_MAX_BODY_BYTES
            yield b'"}'

        streamed = self.client.post(
            "/auth/login",
            headers={"Origin": self.origin, "Content-Type": "application/json"},
            content=oversized_chunks(),
        )
        self.assertEqual(streamed.status_code, 413, streamed.text)

    def test_login_rejects_wrong_content_type_encoding_and_invalid_json(self):
        wrong_type = self.client.post(
            "/auth/login",
            headers={"Origin": self.origin, "Content-Type": "text/plain"},
            content=b"{}",
        )
        self.assertEqual(wrong_type.status_code, 415, wrong_type.text)

        encoded = self.client.post(
            "/auth/login",
            headers={
                "Origin": self.origin,
                "Content-Type": "application/json",
                "Content-Encoding": "identity",
            },
            content=b"{}",
        )
        self.assertEqual(encoded.status_code, 415, encoded.text)

        malformed = self.client.post(
            "/auth/login",
            headers={"Origin": self.origin, "Content-Type": "application/json"},
            content=b"not-json",
        )
        self.assertEqual(malformed.status_code, 400, malformed.text)
        self.assertNotIn("not-json", malformed.text)

    def test_login_stream_read_has_a_total_timeout(self):
        class SlowRequest:
            headers = {"content-type": "application/json"}

            async def stream(self):
                await asyncio.sleep(0.05)
                yield b"{}"

        async def read():
            with mock.patch.object(web_server, "WEB_AUTH_LOGIN_BODY_TIMEOUT_SECONDS", 0.001):
                return await web_server._read_login_payload(SlowRequest())

        payload, error = asyncio.run(read())
        self.assertIsNone(payload)
        self.assertIsNotNone(error)
        self.assertEqual(error.status_code, 408)

    def test_websocket_rejects_before_accept_then_allows_authenticated_same_origin(self):
        with self.assertRaises(WebSocketDisconnect) as unauthenticated:
            with self.client.websocket_connect(
                "/ws/events",
                headers={"Origin": self.origin, "Host": "cloud.example"},
            ):
                pass
        self.assertEqual(unauthenticated.exception.code, 4401)

        login = self.login()
        self.assertEqual(login.status_code, 200)
        session_cookie = self.client.cookies.get(web_server.WEB_AUTH_COOKIE_NAME)
        cookie_header = f"{web_server.WEB_AUTH_COOKIE_NAME}={session_cookie}"
        with self.assertRaises(WebSocketDisconnect) as foreign_origin:
            with self.client.websocket_connect(
                "/ws/events",
                headers={
                    "Origin": "https://attacker.example",
                    "Host": "cloud.example",
                    "Cookie": cookie_header,
                },
            ):
                pass
        self.assertEqual(foreign_origin.exception.code, 4403)

        with self.client.websocket_connect(
            "/ws/events",
            headers={"Origin": self.origin, "Host": "cloud.example", "Cookie": cookie_header},
        ) as websocket:
            websocket.send_text("ping")

    def test_broadcast_closes_revoked_session_without_sending_but_auth_off_still_sends(self):
        class RecordingWebSocket:
            def __init__(self):
                self.sent: list[str] = []
                self.closed: list[int] = []

            async def send_text(self, payload):
                self.sent.append(payload)

            async def close(self, code):
                self.closed.append(code)

        revoked_socket = RecordingWebSocket()
        token = web_server._issue_web_auth_session()
        web_server.clients[revoked_socket] = token
        web_server._revoke_web_auth_session(token)
        asyncio.run(web_server.broadcast("training-log", "must-not-leak"))
        self.assertEqual(revoked_socket.sent, [])
        self.assertEqual(revoked_socket.closed, [4401])
        self.assertNotIn(revoked_socket, web_server.clients)

        open_socket = RecordingWebSocket()
        web_server.clients[open_socket] = None
        with mock.patch.object(web_server, "WEB_AUTH_MODE", "off"):
            asyncio.run(web_server.broadcast("training-log", "allowed"))
        self.assertEqual(len(open_socket.sent), 1)
        self.assertIn("allowed", open_socket.sent[0])
        self.assertEqual(open_socket.closed, [])

    def test_logout_actively_closes_websocket_for_that_session(self):
        self.assertEqual(self.login().status_code, 200)
        session_cookie = self.client.cookies.get(web_server.WEB_AUTH_COOKIE_NAME)
        cookie_header = f"{web_server.WEB_AUTH_COOKIE_NAME}={session_cookie}"
        with self.client.websocket_connect(
            "/ws/events",
            headers={"Origin": self.origin, "Host": "cloud.example", "Cookie": cookie_header},
        ) as websocket:
            logout = self.client.post("/auth/logout", headers={"Origin": self.origin})
            self.assertEqual(logout.status_code, 200, logout.text)
            with self.assertRaises(WebSocketDisconnect) as closed:
                websocket.receive_text()
            self.assertEqual(closed.exception.code, 4401)

    def test_websocket_closes_when_signed_session_expires(self):
        with mock.patch.object(web_server, "WEB_AUTH_SESSION_SECONDS", 1):
            token = web_server._issue_web_auth_session()
            cookie_header = f"{web_server.WEB_AUTH_COOKIE_NAME}={token}"
            with self.client.websocket_connect(
                "/ws/events",
                headers={"Origin": self.origin, "Host": "cloud.example", "Cookie": cookie_header},
            ) as websocket:
                with self.assertRaises(WebSocketDisconnect) as closed:
                    websocket.receive_text()
                self.assertEqual(closed.exception.code, 4401)

    def test_tampered_and_expired_sessions_are_rejected(self):
        token = web_server._issue_web_auth_session(now=1_000)
        self.assertIsNotNone(web_server._web_auth_session_details(token, now=1_001))
        self.assertIsNone(web_server._web_auth_session_details(token + "x", now=1_001))
        self.assertIsNone(
            web_server._web_auth_session_details(
                token,
                now=1_000 + web_server.WEB_AUTH_SESSION_SECONDS,
            )
        )

    def test_youyun_login_uses_instance_card_fields(self):
        captured: dict[str, str] = {}

        def capture(payload):
            captured.update(payload)
            return True

        with mock.patch.object(web_server, "WEB_AUTH_MODE", "youyun"):
            root = self.client.get("/")
            self.assertEqual(root.status_code, 200, root.text)
            self.assertIn("SSH 端口", root.text)
            self.assertIn("实例密码", root.text)
            self.assertIn("不需要打开终端", root.text)

            with mock.patch.object(web_server, "_verify_web_auth_credentials", side_effect=capture):
                login = self.client.post(
                    "/auth/login",
                    headers={"Origin": self.origin},
                    json={"ssh_port": "23456", "password": "card-password"},
                )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(captured, {"ssh_port": "23456", "password": "card-password"})

    def test_youyun_ssh_auth_pins_host_key_and_keeps_password_out_of_files_and_arguments(self):
        hostname = "cpod-abc123"
        host_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestHostKey"
        password = "sensitive-card-password"
        inspected_paths: list[Path] = []

        def fake_run(command, **kwargs):
            joined = " ".join(command)
            self.assertNotIn(password, joined)
            self.assertEqual(command[:3], ["/usr/bin/setsid", "--wait", "/usr/bin/ssh"])
            self.assertIn(f"root@{hostname}.podtcp.compshare.cn", command)
            self.assertIn("StrictHostKeyChecking=yes", command)
            self.assertIn("PreferredAuthentications=password", command)
            self.assertEqual(kwargs["stdin"], web_server.subprocess.DEVNULL)
            self.assertEqual(kwargs["stdout"], web_server.subprocess.DEVNULL)
            self.assertEqual(kwargs["stderr"], web_server.subprocess.DEVNULL)
            self.assertEqual(kwargs["timeout"], web_server.WEB_AUTH_YOUYUN_TIMEOUT_SECONDS)
            self.assertFalse(kwargs["check"])

            env = kwargs["env"]
            self.assertEqual(env["DIFFPIPE_SSH_PASSWORD"], password)
            askpass = Path(env["SSH_ASKPASS"])
            known_option = next(item for item in command if item.startswith("UserKnownHostsFile="))
            known_hosts = Path(known_option.split("=", 1)[1])
            inspected_paths.extend([askpass, known_hosts])
            self.assertEqual(
                askpass.read_text(encoding="ascii"),
                '#!/bin/sh\nprintf %s "$DIFFPIPE_SSH_PASSWORD"\n',
            )
            self.assertNotIn(password, askpass.read_text(encoding="ascii"))
            self.assertEqual(
                known_hosts.read_text(encoding="ascii"),
                f"[{hostname}.podtcp.compshare.cn]:23456 {host_key}\n",
            )
            self.assertNotIn(password, known_hosts.read_text(encoding="ascii"))
            return mock.Mock(returncode=0)

        with mock.patch.object(web_server, "_youyun_hostname", hostname), mock.patch.object(
            web_server,
            "_youyun_ssh_host_public_key",
            host_key,
        ), mock.patch.object(web_server.subprocess, "run", side_effect=fake_run):
            self.assertTrue(web_server._verify_youyun_ssh_credentials("23456", password))

        for path in inspected_paths:
            self.assertFalse(path.exists())

    def test_youyun_ssh_auth_rejects_invalid_target_fields_and_ssh_failure(self):
        with mock.patch.object(web_server, "_youyun_hostname", "unexpected-host"), mock.patch.object(
            web_server,
            "_youyun_ssh_host_public_key",
            "ssh-ed25519 AAAAkey",
        ), mock.patch.object(web_server.subprocess, "run") as run:
            self.assertFalse(web_server._verify_youyun_ssh_credentials("23456", "password"))
            run.assert_not_called()

        with mock.patch.object(web_server, "_youyun_hostname", "cpod-safe123"), mock.patch.object(
            web_server,
            "_youyun_ssh_host_public_key",
            "ssh-ed25519 AAAAkey",
        ), mock.patch.object(web_server.subprocess, "run", return_value=mock.Mock(returncode=255)) as run:
            for port in ("0", "65536", "not-a-port", True):
                self.assertFalse(web_server._verify_youyun_ssh_credentials(port, "password"))
            self.assertFalse(web_server._verify_youyun_ssh_credentials("23456", "wrong-password"))
            self.assertEqual(run.call_count, 1)

        unavailable_slot = mock.Mock()
        unavailable_slot.acquire.return_value = False
        with mock.patch.object(web_server, "_youyun_hostname", "cpod-safe123"), mock.patch.object(
            web_server,
            "_youyun_ssh_host_public_key",
            "ssh-ed25519 AAAAkey",
        ), mock.patch.object(web_server, "_youyun_auth_slots", unavailable_slot), mock.patch.object(
            web_server.subprocess,
            "run",
        ) as run:
            self.assertFalse(web_server._verify_youyun_ssh_credentials("23456", "password"))
            run.assert_not_called()
            unavailable_slot.release.assert_not_called()

        acquired_slot = mock.Mock()
        acquired_slot.acquire.return_value = True
        with mock.patch.object(web_server, "_youyun_hostname", "cpod-safe123"), mock.patch.object(
            web_server,
            "_youyun_ssh_host_public_key",
            "ssh-ed25519 AAAAkey",
        ), mock.patch.object(web_server, "_youyun_auth_slots", acquired_slot), mock.patch.object(
            web_server.subprocess,
            "run",
            side_effect=web_server.subprocess.TimeoutExpired("ssh", 15),
        ):
            self.assertFalse(web_server._verify_youyun_ssh_credentials("23456", "password"))
            acquired_slot.release.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
