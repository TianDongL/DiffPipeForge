import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import web_server


class WebResourceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(web_server.app)
        web_server.model_download_jobs.clear()
        web_server.model_download_tasks.clear()

    def test_browse_is_sandboxed_and_filters_model_files(self):
        with tempfile.TemporaryDirectory() as root_raw, tempfile.TemporaryDirectory() as outside_raw:
            root = Path(root_raw)
            (root / "folder").mkdir()
            (root / "model.safetensors").write_bytes(b"model")
            (root / "notes.txt").write_text("caption", encoding="utf-8")
            env = {
                "DIFFPIPE_WEB_BROWSE_ROOTS": str(root),
                "DIFFPIPE_WEB_UPLOAD_ROOT": str(root / "uploads"),
            }
            with mock.patch.dict(os.environ, env, clear=False):
                response = self.client.post(
                    "/api/web-resources/list",
                    json={"path": str(root), "modelOnly": True},
                )
                self.assertEqual(response.status_code, 200, response.text)
                names = {entry["name"] for entry in response.json()["entries"]}
                self.assertEqual(names, {"folder", "model.safetensors"})

                denied = self.client.post(
                    "/api/web-resources/list",
                    json={"path": outside_raw, "modelOnly": False},
                )
                self.assertEqual(denied.status_code, 403, denied.text)

                created = self.client.post(
                    "/api/web-resources/mkdir",
                    json={"parent": str(root), "name": "new-dataset"},
                )
                self.assertEqual(created.status_code, 200, created.text)
                self.assertTrue((root / "new-dataset").is_dir())

                traversal = self.client.post(
                    "/api/web-resources/mkdir",
                    json={"parent": str(root), "name": "../escape"},
                )
                self.assertEqual(traversal.status_code, 400, traversal.text)

    def test_browser_upload_requires_exact_video_caption_pairs(self):
        with tempfile.TemporaryDirectory() as root_raw:
            upload_root = Path(root_raw) / "uploads"
            env = {
                "DIFFPIPE_WEB_UPLOAD_ROOT": str(upload_root),
                "DIFFPIPE_WEB_BROWSE_ROOTS": root_raw,
            }
            with mock.patch.dict(os.environ, env, clear=False):
                session = self.client.post("/api/web-resources/upload-session")
                self.assertEqual(session.status_code, 200, session.text)
                session_id = session.json()["sessionId"]

                video = self.client.put(
                    f"/api/web-resources/upload/{session_id}",
                    params={"filename": "001.mp4"},
                    content=b"video-bytes",
                )
                caption = self.client.put(
                    f"/api/web-resources/upload/{session_id}",
                    params={"filename": "001.txt"},
                    content="caption".encode("utf-8"),
                )
                self.assertEqual(video.status_code, 200, video.text)
                self.assertEqual(caption.status_code, 200, caption.text)

                finalized = self.client.post(f"/api/web-resources/upload/{session_id}/finalize")
                self.assertEqual(finalized.status_code, 200, finalized.text)
                self.assertEqual(finalized.json()["videoCount"], 1)
                self.assertEqual(finalized.json()["captionCount"], 1)
                self.assertEqual(Path(finalized.json()["path"]).parent, upload_root.resolve())
                completed_delete = self.client.delete(f"/api/web-resources/upload/{session_id}")
                self.assertEqual(completed_delete.status_code, 409, completed_delete.text)
                completed_put = self.client.put(
                    f"/api/web-resources/upload/{session_id}",
                    params={"filename": "later.txt"},
                    content=b"must not mutate finalized data",
                )
                self.assertEqual(completed_put.status_code, 409, completed_put.text)

                second = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
                self.client.put(
                    f"/api/web-resources/upload/{second}",
                    params={"filename": "orphan.mp4"},
                    content=b"video",
                )
                rejected = self.client.post(f"/api/web-resources/upload/{second}/finalize")
                self.assertEqual(rejected.status_code, 400, rejected.text)

                traversal = self.client.put(
                    f"/api/web-resources/upload/{second}",
                    params={"filename": "../outside.mp4"},
                    content=b"bad",
                )
                self.assertEqual(traversal.status_code, 400, traversal.text)
                cancelled = self.client.delete(f"/api/web-resources/upload/{second}")
                self.assertEqual(cancelled.status_code, 200, cancelled.text)

                case_session = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
                self.client.put(
                    f"/api/web-resources/upload/{case_session}",
                    params={"filename": "CaseSensitive.mp4"},
                    content=b"video",
                )
                self.client.put(
                    f"/api/web-resources/upload/{case_session}",
                    params={"filename": "casesensitive.txt"},
                    content=b"caption",
                )
                case_rejected = self.client.post(f"/api/web-resources/upload/{case_session}/finalize")
                self.assertEqual(case_rejected.status_code, 400, case_rejected.text)

                upper_caption_session = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
                upper_caption = self.client.put(
                    f"/api/web-resources/upload/{upper_caption_session}",
                    params={"filename": "clip.TXT"},
                    content=b"caption",
                )
                self.assertEqual(upper_caption.status_code, 400, upper_caption.text)

    def test_output_directory_creation_requires_an_allowed_root(self):
        with tempfile.TemporaryDirectory() as output_raw, tempfile.TemporaryDirectory() as outside_raw:
            output_root = Path(output_raw)
            target = output_root / "DiffPipeForge" / "run-output"
            with mock.patch.dict(os.environ, {"DIFFPIPE_WEB_OUTPUT_ROOTS": str(output_root)}, clear=False):
                created = self.client.post(
                    "/api/web-resources/ensure-directory",
                    json={"path": str(target)},
                )
                self.assertEqual(created.status_code, 200, created.text)
                self.assertTrue(target.is_dir())

                denied = self.client.post(
                    "/api/web-resources/ensure-directory",
                    json={"path": str(Path(outside_raw) / "run-output")},
                )
                self.assertEqual(denied.status_code, 403, denied.text)

    def test_minimax_discovery_accepts_model_and_models_style_roots(self):
        tiny_manifest = {
            "diffusion_model": {"path": "diffusion_models/diffusion.safetensors", "size": 3, "sha256": hashlib.sha256(b"x" * 3).hexdigest()},
            "text_encoder_path": {"path": "text_encoders/text.safetensors", "size": 4, "sha256": hashlib.sha256(b"x" * 4).hexdigest()},
            "vae": {"path": "vae/video.safetensors", "size": 5, "sha256": hashlib.sha256(b"x" * 5).hexdigest()},
            "audio_vae": {"path": "vae/audio.safetensors", "size": 6, "sha256": hashlib.sha256(b"x" * 6).hexdigest()},
        }
        with tempfile.TemporaryDirectory() as root_raw:
            root = Path(root_raw) / "MiniMax-H3"
            for metadata in tiny_manifest.values():
                path = root / metadata["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"x" * metadata["size"])
            with mock.patch.dict(os.environ, {"DIFFPIPE_WEB_MODEL_ROOTS": root_raw}, clear=False), mock.patch.object(
                web_server,
                "MINIMAX_H3_FILES",
                tiny_manifest,
            ):
                result = web_server._discover_minimax_h3_files()
            self.assertTrue(result["complete"], result)
            self.assertEqual(set(result["pathMap"]), set(tiny_manifest))
            self.assertEqual(result["verifiedBy"], "sha256")

        self.assertEqual(web_server._storage_kind(Path("/model")), "public_models")
        self.assertEqual(web_server._storage_kind(Path("/models")), "public_models")
        if os.name == "nt":
            self.assertEqual(web_server._recommended_output_base(), web_server.PROJECT_ROOT.resolve())
            self.assertEqual(web_server._storage_kind(Path("/cloud")), "local")

    def test_download_worker_verifies_and_maps_files_without_exposing_secrets(self):
        with tempfile.TemporaryDirectory() as root_raw:
            target = Path(root_raw) / "model"
            content = b"verified-model"
            digest = hashlib.sha256(content).hexdigest()
            existing = target / "weights" / "model.safetensors"
            existing.parent.mkdir(parents=True, exist_ok=True)
            existing.write_bytes(b"invalid")
            job_id = "a" * 32
            web_server.model_download_jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "completedFiles": 0,
                "bytesDownloaded": 0,
                "pathMap": {},
                "error": None,
            }
            spec = {
                "source": "huggingface",
                "repoId": "owner/repo",
                "revision": "fixed",
                "targetDir": str(target),
                "files": [{
                    "path": "weights/model.safetensors",
                    "size": len(content),
                    "sha256": digest,
                    "field": "diffusion_model",
                }],
            }

            def fake_download(_source, _repo, _revision, relative_path, target_dir):
                path = target_dir / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
                return path.resolve()

            with mock.patch.object(web_server, "_download_model_file", side_effect=fake_download), mock.patch.dict(
                os.environ,
                {
                    "HF_TOKEN": "hf_secret_should_never_appear",
                    "DIFFPIPE_WEB_MODEL_ROOTS": root_raw,
                },
                clear=False,
            ):
                asyncio.run(web_server._run_model_download(job_id, spec))

            job = web_server.model_download_jobs[job_id]
            self.assertEqual(job["status"], "completed", job)
            self.assertEqual(job["pathMap"]["diffusion_model"], str((target / "weights/model.safetensors").resolve()))
            self.assertNotIn("hf_secret_should_never_appear", str(job))
            quarantined = list(existing.parent.glob("model.safetensors.invalid-*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(quarantined[0].read_bytes(), b"invalid")

    def test_size_only_existing_file_still_uses_official_download_client(self):
        with tempfile.TemporaryDirectory() as root_raw:
            target = Path(root_raw) / "model"
            expected = target / "weights" / "model.safetensors"
            expected.parent.mkdir(parents=True)
            expected.write_bytes(b"old-data")
            replacement = b"new-data"
            job_id = "c" * 32
            web_server.model_download_jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "completedFiles": 0,
                "bytesDownloaded": 0,
                "pathMap": {},
                "error": None,
            }
            spec = {
                "source": "huggingface",
                "repoId": "owner/repo",
                "revision": "fixed",
                "targetDir": str(target),
                "files": [{"path": "weights/model.safetensors", "size": len(replacement)}],
            }
            calls: list[str] = []

            def fake_download(_source, _repo, _revision, relative_path, target_dir):
                calls.append(relative_path)
                path = target_dir / relative_path
                path.write_bytes(replacement)
                return path.resolve()

            with mock.patch.object(web_server, "_download_model_file", side_effect=fake_download), mock.patch.dict(
                os.environ,
                {"DIFFPIPE_WEB_MODEL_ROOTS": root_raw},
                clear=False,
            ):
                asyncio.run(web_server._run_model_download(job_id, spec))

            self.assertEqual(calls, ["weights/model.safetensors"])
            self.assertEqual(expected.read_bytes(), replacement)
            self.assertEqual(web_server.model_download_jobs[job_id]["status"], "completed")

    def test_repository_file_paths_cannot_escape_download_target(self):
        for unsafe in ("../escape.bin", "/absolute/file.bin", "C:/escape/file.bin", "folder/C:/file.bin"):
            with self.assertRaises(web_server.HTTPException, msg=unsafe):
                web_server._safe_relative_repo_file(unsafe)

        with tempfile.TemporaryDirectory() as target_raw:
            target = Path(target_raw)
            relative = web_server._safe_relative_repo_file("weights/model.safetensors")
            resolved = web_server._download_file_path(target, relative)
            self.assertTrue(web_server._path_within(resolved, target.resolve()))

    def test_public_model_role_is_read_only_even_after_canonicalization(self):
        with tempfile.TemporaryDirectory() as root_raw:
            root = Path(root_raw).resolve()
            with mock.patch.object(web_server, "_web_root_candidates", return_value=[(root, "model")]):
                record = web_server._root_record(root, "model")
                self.assertEqual(record["storageKind"], "public_models")
                self.assertFalse(record["writable"])
                denied = self.client.post(
                    "/api/web-resources/mkdir",
                    json={"parent": str(root), "name": "must-not-write"},
                )
                self.assertEqual(denied.status_code, 403, denied.text)

    def test_singular_configured_output_root_is_also_allowed(self):
        with tempfile.TemporaryDirectory() as output_raw:
            target = Path(output_raw) / "session-output"
            with mock.patch.dict(os.environ, {"DIFFPIPE_WEB_OUTPUT_ROOT": output_raw}, clear=False):
                response = self.client.post(
                    "/api/web-resources/ensure-directory",
                    json={"path": str(target)},
                )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(target.is_dir())

    def test_download_requires_revision_metadata_and_non_overlapping_target(self):
        with tempfile.TemporaryDirectory() as root_raw:
            root = Path(root_raw)
            target = root / "models" / "job"
            env = {"DIFFPIPE_WEB_MODEL_ROOTS": str(root)}
            with mock.patch.dict(os.environ, env, clear=False):
                missing_revision = self.client.post(
                    "/api/web-resources/model-downloads",
                    json={
                        "source": "huggingface",
                        "repoId": "owner/repo",
                        "revision": "",
                        "targetDir": str(target),
                        "files": [{"path": "model.safetensors", "size": 1}],
                    },
                )
                self.assertEqual(missing_revision.status_code, 400, missing_revision.text)

                missing_metadata = self.client.post(
                    "/api/web-resources/model-downloads",
                    json={
                        "source": "huggingface",
                        "repoId": "owner/repo",
                        "revision": "fixed",
                        "targetDir": str(target),
                        "files": [{"path": "model.safetensors"}],
                    },
                )
                self.assertEqual(missing_metadata.status_code, 400, missing_metadata.text)

                with mock.patch.object(web_server.shutil, "disk_usage", return_value=mock.Mock(free=1099)), mock.patch.dict(
                    os.environ,
                    {
                        **env,
                        "DIFFPIPE_WEB_DOWNLOAD_FREE_RESERVE_BYTES": "0",
                        "DIFFPIPE_WEB_UNKNOWN_FILE_RESERVE_BYTES": "100",
                    },
                    clear=False,
                ):
                    partial_known_size = self.client.post(
                        "/api/web-resources/model-downloads",
                        json={
                            "source": "huggingface",
                            "repoId": "owner/repo",
                            "revision": "fixed",
                            "targetDir": str(target),
                            "files": [
                                {"path": "large.safetensors", "size": 1000},
                                {"path": "second.safetensors", "size": 100, "sha256": "0" * 64},
                            ],
                        },
                    )
                self.assertEqual(partial_known_size.status_code, 507, partial_known_size.text)

                web_server.model_download_jobs["b" * 32] = {
                    "status": "running",
                    "targetDir": str(target),
                }
                overlap = self.client.post(
                    "/api/web-resources/model-downloads",
                    json={
                        "source": "huggingface",
                        "repoId": "owner/repo",
                        "revision": "fixed",
                        "targetDir": str(target / "child"),
                        "files": [{"path": "model.safetensors", "size": 1}],
                    },
                )
                self.assertEqual(overlap.status_code, 409, overlap.text)

    def test_download_target_reservation_is_atomic_across_concurrent_requests(self):
        with tempfile.TemporaryDirectory() as root_raw:
            target = Path(root_raw) / "models" / "job"
            existing = target / "model.safetensors"
            existing.parent.mkdir(parents=True)
            content = b"already-here"
            existing.write_bytes(content)
            payload = {
                "source": "huggingface",
                "repoId": "owner/repo",
                "revision": "fixed",
                "targetDir": str(target),
                "files": [{
                    "path": "model.safetensors",
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }],
            }

            async def hold_worker(_job_id, _spec):
                await asyncio.Event().wait()

            async def run_concurrently():
                results = await asyncio.gather(
                    web_server.start_model_download(payload),
                    web_server.start_model_download(payload),
                    return_exceptions=True,
                )
                tasks = list(web_server.model_download_tasks.values())
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                return results

            with mock.patch.dict(os.environ, {"DIFFPIPE_WEB_MODEL_ROOTS": root_raw}, clear=False), mock.patch.object(
                web_server,
                "_run_model_download",
                side_effect=hold_worker,
            ):
                results = asyncio.run(run_concurrently())

            successes = [result for result in results if isinstance(result, dict)]
            conflicts = [result for result in results if isinstance(result, web_server.HTTPException)]
            self.assertEqual(len(successes), 1, results)
            self.assertEqual(len(conflicts), 1, results)
            self.assertEqual(conflicts[0].status_code, 409)

    def test_pending_upload_quota_is_recomputed_for_every_put(self):
        with tempfile.TemporaryDirectory() as root_raw, mock.patch.dict(
            os.environ,
            {"DIFFPIPE_WEB_UPLOAD_ROOT": str(Path(root_raw) / "uploads")},
            clear=False,
        ), mock.patch.object(web_server, "WEB_MAX_PENDING_UPLOAD_BYTES", 1024):
            first = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
            second = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
            first_upload = self.client.put(
                f"/api/web-resources/upload/{first}",
                params={"filename": "first.mp4"},
                content=b"a" * 600,
            )
            self.assertEqual(first_upload.status_code, 200, first_upload.text)
            second_upload = self.client.put(
                f"/api/web-resources/upload/{second}",
                params={"filename": "second.mp4"},
                content=b"b" * 600,
            )
            self.assertEqual(second_upload.status_code, 413, second_upload.text)

    def test_upload_rejects_declared_file_before_crossing_disk_reserve(self):
        with tempfile.TemporaryDirectory() as root_raw, mock.patch.dict(
            os.environ,
            {
                "DIFFPIPE_WEB_UPLOAD_ROOT": str(Path(root_raw) / "uploads"),
                "DIFFPIPE_WEB_UPLOAD_FREE_RESERVE_BYTES": "100",
            },
            clear=False,
        ):
            session_id = self.client.post("/api/web-resources/upload-session").json()["sessionId"]
            with mock.patch.object(web_server.shutil, "disk_usage", return_value=mock.Mock(free=109)):
                response = self.client.put(
                    f"/api/web-resources/upload/{session_id}",
                    params={"filename": "clip.mp4"},
                    content=b"0123456789",
                )
            self.assertEqual(response.status_code, 507, response.text)
            session = Path(root_raw) / "uploads" / session_id
            self.assertFalse((session / "clip.mp4").exists())
            self.assertEqual(list(session.glob("*.part")), [])

    def test_minimax_discovery_rejects_file_symlinks(self):
        with tempfile.TemporaryDirectory() as root_raw, tempfile.TemporaryDirectory() as outside_raw:
            root = Path(root_raw)
            outside = Path(outside_raw) / "model.safetensors"
            outside.write_bytes(b"safe-size")
            link = root / "diffusion_models" / outside.name
            link.parent.mkdir(parents=True)
            try:
                link.symlink_to(outside)
            except OSError as exc:
                self.skipTest(f"Symlinks are unavailable on this host: {exc}")
            manifest = {
                "diffusion_model": {
                    "path": f"diffusion_models/{outside.name}",
                    "size": outside.stat().st_size,
                    "sha256": hashlib.sha256(outside.read_bytes()).hexdigest(),
                }
            }
            with mock.patch.dict(os.environ, {"DIFFPIPE_WEB_MODEL_ROOTS": root_raw}, clear=False), mock.patch.object(
                web_server,
                "MINIMAX_H3_FILES",
                manifest,
            ):
                result = web_server._discover_minimax_h3_files()
            self.assertFalse(result["complete"], result)
            self.assertEqual(result["candidates"]["diffusion_model"], [])

    def test_upload_gc_only_removes_strict_unfinished_sessions(self):
        with tempfile.TemporaryDirectory() as root_raw:
            upload_root = Path(root_raw) / "uploads"
            upload_root.mkdir()
            unrelated = upload_root / "dataset-user-archive"
            unrelated.mkdir()
            (unrelated / web_server.WEB_UPLOAD_IN_PROGRESS_MARKER).write_text("{}", encoding="utf-8")

            stale = upload_root / "dataset-20200101-000000-abcdef1234"
            stale.mkdir()
            (stale / web_server.WEB_UPLOAD_IN_PROGRESS_MARKER).write_text("{}", encoding="utf-8")
            old = 1_600_000_000
            os.utime(stale, (old, old))

            with mock.patch.dict(
                os.environ,
                {"DIFFPIPE_WEB_UPLOAD_ROOT": str(upload_root)},
                clear=False,
            ), mock.patch.object(web_server, "WEB_UPLOAD_STALE_SECONDS", 60):
                created = self.client.post("/api/web-resources/upload-session")

            self.assertEqual(created.status_code, 200, created.text)
            self.assertTrue(unrelated.is_dir())
            self.assertFalse(stale.exists())

    def test_ui_only_output_base_never_enters_training_toml(self):
        valid = "output_dir = '/usrdata/DiffPipeForge/output/run-1'\n[model]\ntype = 'minimax_h3'\n"
        web_server._validate_toml_before_save("trainconfig.toml", valid)
        parsed = web_server.tomllib.loads(valid)
        self.assertNotIn("output_base_dir", parsed)

        invalid = "output_base_dir = '/usrdata/DiffPipeForge/output'\noutput_dir = '/usrdata/DiffPipeForge/output/run-1'\n"
        with self.assertRaises(ValueError):
            web_server._validate_toml_before_save("trainconfig.toml", invalid)


if __name__ == "__main__":
    unittest.main()
