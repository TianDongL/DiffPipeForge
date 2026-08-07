import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

try:
    import tomllib
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

app = FastAPI(title="DiffPipe Forge WebUI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


def channel(name: str):
    def decorator(fn: Callable[..., Any]):
        handlers[name] = fn
        return fn

    return decorator


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


@app.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
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


@channel("save-file")
def save_file(file_path: str, content: str):
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
    file_path.write_text(payload.get("content", ""), encoding="utf-8")
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
    return list_training_checkpoints(config_path)


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
