import http.server
import json
import os
import sys
import subprocess
import threading
import socketserver
import datetime
import shutil
from urllib.parse import urlparse, parse_qs

PORT = 5001
APP_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_FILE = os.path.join(APP_ROOT_DIR, 'settings.json')
OUTPUT_DIR = os.path.join(APP_ROOT_DIR, 'output')

# Global Session Cache
CACHED_OUTPUT_FOLDER = None
ACTIVE_TOOL_PROCESS = None
TOOL_LOGS = []

class IPCHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/ipc':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            channel = data.get('channel')
            args = data.get('args', [])
            
            print(f"[Bridge] Received IPC invoke: {channel}")
            
            result = self.handle_ipc(channel, args)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
        else:
            self.send_error(404)

    def handle_ipc(self, channel, args):
        global CACHED_OUTPUT_FOLDER, ACTIVE_TOOL_PROCESS, TOOL_LOGS
        
        # Implementation of core Electron IPC handlers
        if channel == 'get-language':
            settings = self.load_settings()
            return settings.get('language', 'zh')
        
        elif channel == 'get-theme':
            settings = self.load_settings()
            return settings.get('theme', 'dark')
        
        elif channel == 'get-recent-projects':
            # Scan output dir and merge with settings
            return self.get_verified_projects()

        elif channel == 'add-recent-project':
            project = args[0]
            settings = self.load_settings()
            recent = settings.get('recentProjects', [])
            # Filter out existing path
            recent = [p for p in recent if p['path'].replace('\\', '/').lower() != project['path'].replace('\\', '/').lower()]
            recent.insert(0, project)
            settings['recentProjects'] = recent[:20]
            self.save_settings(settings)
            
            return self.get_verified_projects() # Return full list including scanned
        
        elif channel == 'get-paths':
            return {
                "projectRoot": APP_ROOT_DIR,
                "outputDir": OUTPUT_DIR
            }
            
        elif channel == 'get-platform':
            return sys.platform

        elif channel == 'read-file':
            path_str = args[0]
            try:
                if os.path.exists(path_str):
                    with open(path_str, 'r', encoding='utf-8') as f:
                        return f.read()
            except Exception as e:
                pass
            return None

        elif channel == 'write-file' or channel == 'save-file':
            path_str, content = args[0], args[1]
            try:
                os.makedirs(os.path.dirname(path_str), exist_ok=True)
                with open(path_str, 'w', encoding='utf-8') as f:
                    f.write(content)
                return True
            except:
                return False

        elif channel == 'ensure-dir':
            path_str = args[0]
            try:
                os.makedirs(path_str, exist_ok=True)
                return True
            except:
                return False

        elif channel == 'read-project-folder':
            folder_path = args[0]
            # Mimic Electron's read-project-folder logic
            result = {}
            mapping = {
                'dataset.toml': 'datasetConfig',
                'evaldataset.toml': 'evalDatasetConfig',
                'trainconfig.toml': 'trainConfig'
            }
            # Special check for subfolders like Desktop app
            for filename, key in mapping.items():
                p = os.path.join(folder_path, filename)
                # Try subfolders too
                if not os.path.exists(p):
                    if filename == 'trainconfig.toml':
                         p = os.path.join(folder_path, 'train_config', filename)
                    elif filename == 'dataset.toml' or filename == 'evaldataset.toml':
                         p = os.path.join(folder_path, 'dataset', filename)

                if os.path.exists(p):
                    try:
                        with open(p, 'r', encoding='utf-8') as f:
                            result[key] = f.read()
                    except: pass
            return result

        elif channel == 'set-session-folder':
            folder_path = args[0]
            if folder_path:
                if os.path.exists(folder_path):
                    CACHED_OUTPUT_FOLDER = folder_path
                    print(f"[Session] Locked to: {folder_path}")
                    return {"success": True}
                else:
                    return {"success": False, "error": "Invalid path"}
            else:
                CACHED_OUTPUT_FOLDER = None
                print(f"[Session] Cache cleared")
                return {"success": True}

        elif channel == 'get-python-status':
            return {
                "path": sys.executable,
                "displayName": "Python (Web Bridge)",
                "status": "ready",
                "isInternal": False,
                "availableEnvs": []
            }

        elif channel == 'run-backend':
            return {"status": "NOT_IMPLEMENTED", "message": "Backend streaming not supported in simple bridge"}

        elif channel == 'create-new-project':
            try:
                # Logic from main.ts create-new-project
                # Reset cache
                CACHED_OUTPUT_FOLDER = None
                
                output_dir = self.get_today_output_folder()
                CACHED_OUTPUT_FOLDER = output_dir # Set cache to new folder
                
                # Default templates (Simplified)
                default_train = "[model]\ntype = 'sdxl'\ncheckpoint_path = ''\ndtype = 'bfloat16'\n[optimizer]\ntype = 'adamw_optimi'\nlr = 2e-5\n[adapter]\ntype = 'lora'\nrank = 32\ndtype = 'bfloat16'\nepochs = 10\n"
                default_dataset = "[[datasets]]\ninput_path = ''\nresolutions = [1024]\nenable_ar_bucket = true\n"
                default_eval = "[[datasets]]\ninput_path = ''\nresolutions = [1024]\nenable_ar_bucket = true\n"
                
                with open(os.path.join(output_dir, 'trainconfig.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_train)
                with open(os.path.join(output_dir, 'dataset.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_dataset)
                with open(os.path.join(output_dir, 'evaldataset.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_eval)
                    
                print(f"[Bridge] Created new project at {output_dir}")
                normalized_path = output_dir.replace('\\', '/')
                return {"success": True, "path": normalized_path}
            except Exception as e:
                print(f"[Bridge] New Project Error: {e}")
                return {"success": False, "error": str(e)}

        elif channel == 'delete-project-folder':
            folder_path = args[0]
            try:
                if os.path.exists(folder_path):
                    shutil.rmtree(folder_path)
                    
                    # Update recent history
                    settings = self.load_settings()
                    recent = settings.get('recentProjects', [])
                    new_recent = [p for p in recent if p['path'].replace('\\', '/').lower() != folder_path.replace('\\', '/').lower()]
                    settings['recentProjects'] = new_recent
                    self.save_settings(settings)
                    
                    return {"success": True, "projects": self.get_verified_projects()}
                return {"success": False, "error": "Path not found", "projects": self.get_verified_projects()}
            except Exception as e:
                return {"success": False, "error": str(e)}

        elif channel == 'copy-folder-configs-to-date':
            source_folder = args[0].get('sourceFolderPath')
            try:
                if not os.path.exists(source_folder):
                    return {"success": False, "error": "Source not found"}
                
                # Use cached folder or create new one
                output_dir = self.get_today_output_folder()
                # If we were sent a set-session-folder before, we use that.
                # But typically main.ts checks getTodayOutputFolder independently of set calls?
                # Actually main.ts cache logic IS getTodayOutputFolder logic.
                
                copied_files = []
                for f in os.listdir(source_folder):
                    if f.endswith('.toml'):
                        s = os.path.join(source_folder, f)
                        d = os.path.join(output_dir, f)
                        if os.path.isfile(s):
                            shutil.copy2(s, d)
                            copied_files.append(f)
                            
                return {"success": True, "outputFolder": output_dir.replace('\\', '/'), "copiedFiles": copied_files}
            except Exception as e:
                return {"success": False, "error": str(e)}

        elif channel == 'copy-to-date-folder':
            source_path = args[0].get('sourcePath')
            filename = args[0].get('filename')
            try:
                if not os.path.exists(source_path):
                     return {"success": False, "error": "Source file not found"}

                output_dir = self.get_today_output_folder()
                target_name = filename if filename else os.path.basename(source_path)
                dest_path = os.path.join(output_dir, target_name)
                shutil.copy2(source_path, dest_path)
                
                return {"success": True, "path": dest_path.replace('\\', '/')}
            except Exception as e:
                return {"success": False, "error": str(e)}
        
        elif channel == 'save-to-date-folder':
            filename = args[0].get('filename')
            content = args[0].get('content')
            try:
                output_dir = self.get_today_output_folder()
                file_path = os.path.join(output_dir, filename)
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                return {"success": True, "path": file_path.replace('\\', '/'), "folder": output_dir.replace('\\', '/')}
            except Exception as e:
                return {"success": False, "error": str(e)}

        # --- Toolbox & Settings Handlers ---
        elif channel == 'get-tool-settings':
            tool_id = args[0]
            settings = self.load_settings()
            return settings.get('toolSettings', {}).get(tool_id, {})

        elif channel == 'save-tool-settings':
            tool_id = args[0].get('toolId')
            new_settings = args[0].get('settings')
            settings = self.load_settings()
            if 'toolSettings' not in settings:
                settings['toolSettings'] = {}
            settings['toolSettings'][tool_id] = new_settings
            self.save_settings(settings)
            return {"success": True}

        elif channel == 'dialog:openFile':
            # Web mode cannot open system dialogs. Return canceled or a "web upload" stub?
            # For select directory, we might want to return a "manual entry required" hint or just fail gracefully.
            return {"canceled": True, "filePaths": []}

        elif channel == 'run-tool':
            script_name = args[0].get('scriptName')
            script_args = args[0].get('args', [])
            
            # Simple single-process runner for web mode
            try:
                # Resolve script path (assuming backend/tools or similar)
                # In main.ts logic: path.join(projectRoot, 'tools', script_name) matches? 
                # Let's assume scripts are in app/backend/tools or similar.
                # Actually main.ts assumes they are in the 'tools' folder relative to project root.
                
                # Check for script in potential locations
                candidates = [
                    os.path.join(APP_ROOT_DIR, 'tools', script_name),
                    os.path.join(APP_ROOT_DIR, 'app', 'backend', 'tools', script_name),
                ]
                script_path = next((p for p in candidates if os.path.exists(p)), None)
                
                if not script_path:
                    return {"success": False, "error": f"Script not found: {script_name}"}

                cmd = [sys.executable, script_path] + [str(a) for a in script_args]
                
                # Global lock for one active tool?
                # We can store process in a global variable
                # global ACTIVE_TOOL_PROCESS <- Removed
                if ACTIVE_TOOL_PROCESS and ACTIVE_TOOL_PROCESS.poll() is None:
                    return {"success": False, "error": "A tool is already running"}

                ACTIVE_TOOL_PROCESS = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.PIPE, 
                    stderr=subprocess.STDOUT, 
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                    encoding='utf-8' # Force utf-8
                )
                
                # Start a thread to read logs
                # global TOOL_LOGS <- Removed
                TOOL_LOGS = []
                def read_logs():
                    if ACTIVE_TOOL_PROCESS:
                         for line in iter(ACTIVE_TOOL_PROCESS.stdout.readline, ''):
                             TOOL_LOGS.append(line)
                             print(f"[ToolLog] {line.strip()}")
                         ACTIVE_TOOL_PROCESS.stdout.close()
                
                t = threading.Thread(target=read_logs)
                t.daemon = True
                t.start()

                return {"success": True}
            except Exception as e:
                return {"success": False, "error": str(e)}

        elif channel == 'stop-tool':
            # global ACTIVE_TOOL_PROCESS <- Removed
            if ACTIVE_TOOL_PROCESS:
                ACTIVE_TOOL_PROCESS.terminate()
                ACTIVE_TOOL_PROCESS = None
            return {"success": True}

        elif channel == 'get-tool-status':
            # global ACTIVE_TOOL_PROCESS <- Removed
            is_running = ACTIVE_TOOL_PROCESS is not None and ACTIVE_TOOL_PROCESS.poll() is None
            # We don't track script name deeply in this simple bridge yet, but UI expects it
            return {"isRunning": is_running, "scriptName": "gemini_concurrent_tagging.py" if is_running else ""}

        elif channel == 'get-tool-logs':
            return TOOL_LOGS

        # --- Resource Monitor Handlers ---
        elif channel == 'start-resource-monitor':
            # In a real implementation, start a background thread collecting stats
            return {"success": True}

        elif channel == 'get-resource-monitor-stats':
            # Mock stats for web mode
            # In real cloud mode, this should read actual system stats if permitted
            return {
                "cpu_model": "Cloud CPU",
                "cpu_percent": 15.5,
                "memory": {
                    "total": 16 * 1024 * 1024 * 1024,
                    "available": 8 * 1024 * 1024 * 1024,
                    "percent": 50.0,
                    "used": 8 * 1024 * 1024 * 1024
                },
                "disks": [],
                "gpus": [], # GPU stats might need nvml, skip for now
                "timestamp": datetime.datetime.now().timestamp()
            }

        # --- System Diagnostics Handlers ---
        elif channel == 'calculate-python-fingerprint':
            # Mock fingerprint calc
            return {
                "totalFiles": 1000,
                "totalSize": 102400,
                "totalSizeFormatted": "100 MB",
                "sha256": "mock_sha256_hash_for_cloud_mode"
            }

        elif channel == 'get-fingerprint-cache':
            return {
                "totalFiles": 1000,
                "totalSize": 102400,
                "totalSizeFormatted": "100 MB",
                "sha256": "mock_sha256_hash_for_cloud_mode",
                "calculatedAt": datetime.datetime.now().isoformat()
            }

        elif channel == 'get-official-fingerprint':
             return {
                "sha256": "mock_sha256_hash_for_cloud_mode",
                "totalFiles": 1000,
                "version": "1.0.0",
                "generatedAt": datetime.datetime.now().isoformat()
             }
        
        elif channel == 'save-fingerprint-cache':
            # efficient no-op or save to settings
            return {"success": True}

        # --- Training Launcher Handlers ---
        elif channel == 'get-training-status':
             return {"running": False, "message": "Ready"}
        
        elif channel == 'start-training':
             return {"success": True, "message": "Training started (Mock)"}
        
        elif channel == 'stop-training':
             return {"success": True}
        
        elif channel == 'get-project-launch-params':
            # Return empty or saved params
             return {}
        
        elif channel == 'save-project-launch-params':
             return {"success": True}

        return {"error": f"Unknown channel: {channel}"}

    def get_today_output_folder(self):
        global CACHED_OUTPUT_FOLDER
        if CACHED_OUTPUT_FOLDER and os.path.exists(CACHED_OUTPUT_FOLDER):
            return CACHED_OUTPUT_FOLDER
        
        now = datetime.datetime.now()
        timestamp = now.strftime("%Y%m%d_%H-%M-%S")
        output_dir = os.path.join(OUTPUT_DIR, timestamp)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
            
        CACHED_OUTPUT_FOLDER = output_dir
        print(f"[Output] Created new session folder: {output_dir}")
        return output_dir

    def get_verified_projects(self):
        settings = self.load_settings()
        projects = settings.get('recentProjects', [])
        
        # Scan output dir
        if os.path.exists(OUTPUT_DIR):
            try:
                entries = os.listdir(OUTPUT_DIR)
                for name in entries:
                    full_path = os.path.join(OUTPUT_DIR, name)
                    if os.path.isdir(full_path):
                        # Check if already in projects
                        exists = any([os.path.normpath(p['path']) == os.path.normpath(full_path) for p in projects])
                        if not exists:
                             projects.append({
                                 "name": name,
                                 "path": full_path,
                                 "lastModified": datetime.datetime.fromtimestamp(os.path.getmtime(full_path)).isoformat()
                             })
            except Exception as e:
                print(f"Scan error: {e}")

        # Verify existence and sort
        verified = []
        for p in projects:
            if os.path.exists(p['path']):
                try:
                    stats = os.stat(p['path'])
                    p['timestamp'] = stats.st_mtime
                    # p['lastModified'] = ...
                    verified.append(p)
                except:
                    pass
        
        # Sort desc
        verified.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        return verified

    def save_settings(self, settings):
        try:
            with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2)
        except:
            pass

    def load_settings(self):
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {}

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def run_server():
    server_address = ('', PORT)
    httpd = ThreadedHTTPServer(server_address, IPCHandler)
    print(f"Starting Multi-threaded Web Bridge on port {PORT}...")
    httpd.serve_forever()

if __name__ == "__main__":
    if not os.path.exists(os.path.join(APP_ROOT_DIR, 'logs')):
        os.makedirs(os.path.join(APP_ROOT_DIR, 'logs'))
    run_server()
