import http.server
import json
import os
import sys
import subprocess
import threading
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

def run_server():
    server_address = ('', PORT)
    httpd = http.server.HTTPServer(server_address, IPCHandler)
    print(f"Starting Web Bridge on port {PORT}...")
    httpd.serve_forever()

if __name__ == "__main__":
    if not os.path.exists(os.path.join(APP_ROOT_DIR, 'logs')):
        os.makedirs(os.path.join(APP_ROOT_DIR, 'logs'))
    run_server()
