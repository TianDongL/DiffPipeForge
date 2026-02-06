import http.server
import json
import os
import sys
import subprocess
import threading
import socketserver
from urllib.parse import urlparse, parse_qs

PORT = 5001
APP_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_FILE = os.path.join(APP_ROOT_DIR, 'settings.json')

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
        # Implementation of core Electron IPC handlers
        if channel == 'get-language':
            settings = self.load_settings()
            return settings.get('language', 'zh')
        
        elif channel == 'get-theme':
            settings = self.load_settings()
            return settings.get('theme', 'dark')
        
        elif channel == 'get-recent-projects':
            settings = self.load_settings()
            return settings.get('recentProjects', [])

        elif channel == 'add-recent-project':
            project = args[0]
            settings = self.load_settings()
            recent = settings.get('recentProjects', [])
            # Filter out existing path
            recent = [p for p in recent if p['path'] != project['path']]
            recent.insert(0, project)
            settings['recentProjects'] = recent[:10]
            self.save_settings(settings)
            return settings['recentProjects']
        
        elif channel == 'get-paths':
            return {
                "projectRoot": APP_ROOT_DIR,
                "outputDir": os.path.join(APP_ROOT_DIR, 'output')
            }
            
        elif channel == 'get-platform':
            return sys.platform

        elif channel == 'read-file':
            path = args[0]
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return f.read()
            except Exception as e:
                return None

        elif channel == 'write-file' or channel == 'save-file':
            path, content = args[0], args[1]
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(content)
                return True
            except:
                return False

        elif channel == 'ensure-dir':
            path = args[0]
            try:
                os.makedirs(path, exist_ok=True)
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
            for filename, key in mapping.items():
                p = os.path.join(folder_path, filename)
                if os.path.exists(p):
                    try:
                        with open(p, 'r', encoding='utf-8') as f:
                            result[key] = f.read()
                    except: pass
            return result

        elif channel == 'set-session-folder':
            # In browser mode, we don't have a global session state in Python yet
            # but we can return success
            return True

        elif channel == 'get-python-status':
            # Basic info
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
                import datetime
                now = datetime.datetime.now()
                timestamp = now.strftime("%Y%m%d_%H-%M-%S")
                output_dir = os.path.join(APP_ROOT_DIR, 'output', timestamp)
                os.makedirs(output_dir, exist_ok=True)
                
                # Default templates
                default_train = """[model]
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

# Training settings
epochs = 10
micro_batch_size_per_gpu = 1
gradient_accumulation_steps = 1
"""
                default_dataset = """[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
min_ar = 0.5
max_ar = 2.0
num_repeats = 1
"""
                default_eval = """[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
"""
                with open(os.path.join(output_dir, 'trainconfig.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_train)
                with open(os.path.join(output_dir, 'dataset.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_dataset)
                with open(os.path.join(output_dir, 'evaldataset.toml'), 'w', encoding='utf-8') as f:
                    f.write(default_eval)
                    
                print(f"[Bridge] Created new project at {output_dir}")
                # Return normalized path
                normalized_path = output_dir.replace('\\', '/')
                return {"success": True, "path": normalized_path}
            except Exception as e:
                print(f"[Bridge] New Project Error: {e}")
                return {"success": False, "error": str(e)}

        elif channel == 'delete-project-folder':
            folder_path = args[0]
            try:
                import shutil
                if os.path.exists(folder_path):
                    shutil.rmtree(folder_path)
                    
                    # Update recent history
                    settings = self.load_settings()
                    recent = settings.get('recentProjects', [])
                    new_recent = [p for p in recent if p['path'].replace('\\', '/') != folder_path.replace('\\', '/')]
                    settings['recentProjects'] = new_recent
                    self.save_settings(settings)
                    
                    return {"success": True, "projects": new_recent}
                return {"success": False, "error": "Path not found"}
            except Exception as e:
                return {"success": False, "error": str(e)}

        elif channel == 'copy-folder-configs-to-date':
            source_folder = args[0].get('sourceFolderPath')
            try:
                if not os.path.exists(source_folder):
                    return {"success": False, "error": "Source not found"}
                
                import datetime
                import shutil
                now = datetime.datetime.now()
                timestamp = now.strftime("%Y%m%d_%H-%M-%S")
                output_dir = os.path.join(APP_ROOT_DIR, 'output', timestamp)
                os.makedirs(output_dir, exist_ok=True)
                
                copied_files = []
                # Simple copy logic
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

                import datetime
                import shutil
                now = datetime.datetime.now()
                timestamp = now.strftime("%Y%m%d_%H-%M-%S")
                output_dir = os.path.join(APP_ROOT_DIR, 'output', timestamp)
                os.makedirs(output_dir, exist_ok=True)
                
                target_name = filename if filename else os.path.basename(source_path)
                dest_path = os.path.join(output_dir, target_name)
                shutil.copy2(source_path, dest_path)
                
                return {"success": True, "path": dest_path.replace('\\', '/')}
            except Exception as e:
                return {"success": False, "error": str(e)}

        return {"error": f"Unknown channel: {channel}"}

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
    """Handle requests in a separate thread."""
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
