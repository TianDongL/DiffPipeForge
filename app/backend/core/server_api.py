import os
import sys
import json
import time
import shutil
import hashlib
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# Initialize Flask App
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# --- Configuration & Paths ---
# In cloud/workspace env, we assume the script is running from app/backend/core/
# We need to resolve project root.
# file: app/backend/core/server_api.py
# root: app/../../
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, '..', '..', '..'))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')
SETTINGS_FILE = os.path.join(PROJECT_ROOT, 'settings.json')

print(f"Server starting...")
print(f"Project Root: {PROJECT_ROOT}")
print(f"Output Dir: {OUTPUT_DIR}")
print(f"Settings File: {SETTINGS_FILE}")

# Ensure output directory exists from start
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Helper Functions ---

def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading settings: {e}")
    return {}

def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"Error saving settings: {e}")

def get_today_output_folder():
    """Generates a timestamped session folder in output/"""
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d_%H-%M-%S")
    folder = os.path.join(OUTPUT_DIR, timestamp)
    os.makedirs(folder, exist_ok=True)
    return folder

# --- Config Templates ---
DEFAULT_TRAIN_CONFIG = """[model]
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

DEFAULT_DATASET_CONFIG = """[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
min_ar = 0.5
max_ar = 2.0
num_repeats = 1
"""

DEFAULT_EVAL_CONFIG = """[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
"""

# --- Routes ---

@app.route('/ipc/get-recent-projects', methods=['POST'])
def get_recent_projects():
    """Returns list of recent projects from settings.json"""
    try:
        settings = load_settings()
        recents = settings.get('recentProjects', [])
        # Ensure they exist (optional cleanup)
        valid_recents = [p for p in recents if os.path.exists(p.get('path', ''))]
        
        # If we cleaned up, save back (optional, maybe skip to avoid aggressive deletion)
        if len(valid_recents) != len(recents):
            settings['recentProjects'] = valid_recents
            save_settings(settings)
            
        return jsonify(valid_recents)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/ipc/add-recent-project', methods=['POST'])
def add_recent_project():
    """Adds a project to history"""
    try:
        project_data = request.json
        if not project_data:
            return jsonify([])
        
        settings = load_settings()
        recents = settings.get('recentProjects', [])
        
        # Remove existing if same path
        recents = [p for p in recents if p['path'] != project_data['path']]
        
        # Add to top
        recents.insert(0, project_data)
        
        # Limit to 20
        recents = recents[:20]
        
        settings['recentProjects'] = recents
        save_settings(settings)
        return jsonify(recents)
    except Exception as e:
        print(f"Error adding recent: {e}")
        return jsonify(load_settings().get('recentProjects', []))

@app.route('/ipc/create-new-project', methods=['POST'])
def create_new_project():
    try:
        folder = get_today_output_folder()
        
        # Write default configs
        with open(os.path.join(folder, 'trainconfig.toml'), 'w', encoding='utf-8') as f:
            f.write(DEFAULT_TRAIN_CONFIG)
        with open(os.path.join(folder, 'dataset.toml'), 'w', encoding='utf-8') as f:
            f.write(DEFAULT_DATASET_CONFIG)
        with open(os.path.join(folder, 'evaldataset.toml'), 'w', encoding='utf-8') as f:
            f.write(DEFAULT_EVAL_CONFIG)
            
        return jsonify({"success": True, "path": folder})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/ipc/delete-project-folder', methods=['POST'])
def delete_project_folder():
    try:
        data = request.json
        # In the electron implementation, the argument comes directly, not in a wrapper object usually.
        # But requests.json in Flask gives the body.
        # The frontend calls invoke('delete-project-folder', projectToDelete)
        # Our web-ipc shim should wrap this in { args: [...] } or sending strictly JSON
        
        # Depending on how we implement web-ipc.ts, we might send { "0": path } or just the path if it's the body
        # Let's assume web-ipc sends the FIRST argument as the JSON body if it's an object, or we follow a standard convention.
        # Convention: Client sends { "args": [arg1, arg2] } to be generic.
        
        folder_path = None
        if isinstance(data, dict) and 'args' in data:
            folder_path = data['args'][0]
        else:
            # Fallback/Direct
            folder_path = data
            
        if not folder_path or not os.path.exists(folder_path):
            return jsonify({"success": False, "error": "Folder not found"})
            
        # Safety check: only delete inside output/
        # normalized_target = os.path.abspath(folder_path)
        # normalized_output = os.path.abspath(OUTPUT_DIR)
        # if not normalized_target.startswith(normalized_output):
        #    return jsonify({"success": False, "error": "Cannot delete outside output directory"})
        
        shutil.rmtree(folder_path)
        
        # Update settings
        settings = load_settings()
        recents = settings.get('recentProjects', [])
        new_recents = [p for p in recents if p['path'] != folder_path]
        settings['recentProjects'] = new_recents
        save_settings(settings)
        
        return jsonify({"success": True, "projects": new_recents})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/ipc/dialog:openFile', methods=['POST'])
def dialog_open_file():
    # Cloud version cannot open system dialog.
    # We can either return "Canceled" or simulate a web upload interaction.
    # Since "Open Project" usually means "Select Folder" in Electron, but web can't do that easily without <input type="file" webkitdirectory>.
    # For now, we return canceled to avoid error, OR we suggest the user use the Drag & Drop zone which is already implemented in the UI.
    return jsonify({"canceled": True, "filePaths": []})

@app.route('/ipc/read-file', methods=['POST'])
def read_file():
    try:
        data = request.json
        file_path = data.get('args', [None])[0]
        
        if not file_path or not os.path.exists(file_path):
            return "" # Electron returns null/empty string usually
            
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ""

@app.route('/ipc/copy-to-date-folder', methods=['POST'])
def copy_to_date_folder():
    try:
        data = request.json
        arg = data.get('args', [{}])[0]
        source_path = arg.get('sourcePath')
        filename = arg.get('filename')
        
        if not source_path or not os.path.exists(source_path):
             return jsonify({"success": False, "error": "Source not found"})
             
        folder = get_today_output_folder()
        target_name = filename if filename else os.path.basename(source_path)
        dest_path = os.path.join(folder, target_name)
        
        shutil.copy2(source_path, dest_path)
        
        # Return path with forward slashes
        return jsonify({
            "success": True, 
            "path": dest_path.replace(os.sep, '/')
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/ipc/copy-folder-configs-to-date', methods=['POST'])
def copy_folder_configs_to_date():
    try:
        data = request.json
        arg = data.get('args', [{}])[0]
        source_folder = arg.get('sourceFolderPath')
        
        if not source_folder or not os.path.exists(source_folder):
             return jsonify({"success": False, "error": "Source folder not found"})
             
        folder = get_today_output_folder()
        copied_files = []
        
        config_files = ['trainconfig.toml', 'dataset.toml', 'evaldataset.toml']
        
        # 1. Exact matches
        for cfg in config_files:
            src = os.path.join(source_folder, cfg)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(folder, cfg))
                copied_files.append(cfg)
                
        # 2. Sniffing (simplified version of Logic in main.ts)
        # In cloud mode, drag and drop often gives full paths that server can access if it's local.
        # If the user is dragging files from THEIR computer to the browser, the 'path' property is usually FAKE (C:\fakepath\...) 
        # unless we are in an environment like VSCode Web where filesystem usually allows access.
        # Assuming this "Cloud" is actually a remote desktop or local server accessed via browser where paths are valid on the server.
        
        for root, dirs, files in os.walk(source_folder):
            for file in files:
                if file.endswith('.toml') and file not in config_files:
                    # Simple heuristic: just copy it
                    # Logic in main.ts is complex sniffing, here we do a basic copy for robustness
                    # or skip to avoid clutter.
                    pass
                    
        return jsonify({
            "success": True, 
            "copiedFiles": copied_files, 
            "outputFolder": folder.replace(os.sep, '/')
        })
    except Exception as e:
         return jsonify({"success": False, "error": str(e)})

@app.route('/ipc/get-project-launch-params', methods=['POST'])
def get_project_launch_params():
    try:
        data = request.json
        project_path = data.get('args', [''])[0]
        settings = load_settings()
        params = settings.get('projectLaunchParams', {})
        # Normalize
        norm_path = project_path.replace('\\', '/').lower()
        return jsonify(params.get(norm_path, {}))
    except Exception:
        return jsonify({})

# Catch-all for other IPC calls to prevent unresponsiveness (log them)
@app.route('/ipc/<path:subpath>', methods=['POST'])
def catch_all(subpath):
    print(f"Warning: Unhandled IPC call: {subpath}")
    return jsonify({"error": f"Unhandled IPC channel: {subpath}"}), 404

if __name__ == '__main__':
    # Run on 5001 to match vite proxy
    app.run(host='0.0.0.0', port=5001, debug=True)
