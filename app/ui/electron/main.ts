import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn, exec, ChildProcess } from 'child_process'
import fs from 'fs'
import { parse } from 'smol-toml'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// @ts-ignore
import log from "electron-log"

// --- Application Logging Setup ---
const APP_ROOT_DIR = app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '../../..');
const LOG_DIR = path.join(APP_ROOT_DIR, 'logs');
const APP_LOG_PATH = path.join(LOG_DIR, 'app.log');

// Configure electron-log
log.transports.file.level = "info"
log.transports.file.resolvePath = () => APP_LOG_PATH

const resolveBackendPath = (subPath: string): string => {
  return path.join(APP_ROOT_DIR, 'app', subPath);
};

interface TrainingCheckpointInfo {
  name: string;
  path: string;
  latestTag: string;
  step: number | null;
  modifiedAt: number;
}

interface TrainingCheckpointInspection {
  valid: boolean;
  path: string;
  latestTag?: string;
  step?: number | null;
  modifiedAt?: number;
  errorCode?: string;
  message?: string;
}

const TRAINING_SESSION_NAME_PATTERN = /^\d{8}_\d{2}-\d{2}-\d{2}$/;

const getTrainingOutputDirectory = (configPath: string): string => {
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config: any = parse(configContent);
  const configuredOutputDir = typeof config.output_dir === 'string' ? config.output_dir.trim() : '';
  if (!configuredOutputDir) {
    throw new Error('trainconfig.toml 中缺少 output_dir');
  }

  if (path.isAbsolute(configuredOutputDir)) {
    return path.normalize(configuredOutputDir);
  }

  // Match the training process cwd so relative output_dir values resolve exactly
  // as they do in the Windows/Linux kernels.
  const isLinux = process.platform === 'linux';
  const trainingScript = resolveBackendPath(isLinux ? 'backend/core_linux/train.py' : 'backend/core/train.py');
  return path.resolve(path.dirname(trainingScript), configuredOutputDir);
};

const inspectTrainingCheckpointDirectory = (runDirectory: string): TrainingCheckpointInspection => {
  const normalizedPath = path.resolve(runDirectory);

  let runStats: fs.Stats;
  try {
    runStats = fs.statSync(normalizedPath);
  } catch {
    return {
      valid: false,
      path: normalizedPath,
      errorCode: 'checkpoint_not_directory',
      message: '检查点目录不存在。请选择包含 latest 文件的训练运行目录。'
    };
  }

  if (!runStats.isDirectory()) {
    return {
      valid: false,
      path: normalizedPath,
      errorCode: 'checkpoint_not_directory',
      message: '检查点必须是文件夹，不能选择文件。'
    };
  }

  const latestPath = path.join(normalizedPath, 'latest');
  if (!fs.existsSync(latestPath) || !fs.statSync(latestPath).isFile()) {
    const folderName = path.basename(normalizedPath);
    const parentLatest = path.join(path.dirname(normalizedPath), 'latest');
    const selectedTagFolder = /^global_step\d+$/.test(folderName) && fs.existsSync(parentLatest);
    return {
      valid: false,
      path: normalizedPath,
      errorCode: selectedTagFolder ? 'checkpoint_select_run_root' : 'checkpoint_missing_latest',
      message: selectedTagFolder
        ? `请选择上一级训练运行目录 ${path.dirname(normalizedPath)}，不要直接选择 ${folderName}。`
        : '该文件夹不是可恢复的训练运行目录：缺少 latest 文件。'
    };
  }

  if (fs.statSync(latestPath).size > 4096) {
    return {
      valid: false,
      path: normalizedPath,
      errorCode: 'checkpoint_invalid_latest',
      message: 'latest 文件内容异常，无法作为检查点标签读取。'
    };
  }

  const latestTag = fs.readFileSync(latestPath, 'utf8').trim();
  if (!latestTag || !/^[A-Za-z0-9._-]+$/.test(latestTag) || latestTag === '.' || latestTag === '..') {
    return {
      valid: false,
      path: normalizedPath,
      errorCode: 'checkpoint_invalid_latest',
      message: 'latest 文件中的检查点标签无效。'
    };
  }

  const tagDirectory = path.join(normalizedPath, latestTag);
  if (!fs.existsSync(tagDirectory) || !fs.statSync(tagDirectory).isDirectory()) {
    return {
      valid: false,
      path: normalizedPath,
      latestTag,
      errorCode: 'checkpoint_missing_tag_directory',
      message: `latest 指向的检查点文件夹 ${latestTag} 不存在。`
    };
  }

  const hasModelState = fs.readdirSync(tagDirectory, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('_model_states.pt')) return false;
    return fs.statSync(path.join(tagDirectory, entry.name)).size > 0;
  });
  if (!hasModelState) {
    return {
      valid: false,
      path: normalizedPath,
      latestTag,
      errorCode: 'checkpoint_missing_model_state',
      message: `检查点文件夹 ${latestTag} 中没有 DeepSpeed model state。`
    };
  }

  const stepMatch = /^global_step(\d+)$/.exec(latestTag);
  const modifiedAt = Math.max(
    runStats.mtimeMs,
    fs.statSync(latestPath).mtimeMs,
    fs.statSync(tagDirectory).mtimeMs
  );

  return {
    valid: true,
    path: normalizedPath,
    latestTag,
    step: stepMatch ? Number(stepMatch[1]) : null,
    modifiedAt
  };
};

const resolveResumeCheckpoint = (configPath: string, requestedPath: string): TrainingCheckpointInspection => {
  const outputDirectory = getTrainingOutputDirectory(configPath);
  const trimmedPath = requestedPath.trim();
  if (!path.isAbsolute(trimmedPath) && (
    !/^[A-Za-z0-9._-]+$/.test(trimmedPath)
    || trimmedPath === '.'
    || trimmedPath === '..'
  )) {
    return {
      valid: false,
      path: trimmedPath,
      errorCode: 'checkpoint_relative_name_only',
      message: '相对路径只能填写输出目录下的运行文件夹名称；其他位置请填写绝对路径。'
    };
  }
  const candidate = path.isAbsolute(trimmedPath)
    ? path.normalize(trimmedPath)
    : path.resolve(outputDirectory, trimmedPath);
  try {
    return inspectTrainingCheckpointDirectory(candidate);
  } catch {
    return {
      valid: false,
      path: candidate,
      errorCode: 'checkpoint_unreadable',
      message: '检查点目录无法读取或内容不完整。'
    };
  }
};

const listTrainingCheckpoints = (configPath: string): { outputDir: string; checkpoints: TrainingCheckpointInfo[] } => {
  const outputDir = getTrainingOutputDirectory(configPath);
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    return { outputDir, checkpoints: [] };
  }

  const checkpoints = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return inspectTrainingCheckpointDirectory(path.join(outputDir, entry.name));
      } catch {
        return { valid: false, path: path.join(outputDir, entry.name) } as TrainingCheckpointInspection;
      }
    })
    .filter((inspection): inspection is TrainingCheckpointInspection & Required<Pick<TrainingCheckpointInspection, 'latestTag' | 'modifiedAt'>> => inspection.valid)
    .map((inspection) => ({
      name: path.basename(inspection.path),
      path: inspection.path,
      latestTag: inspection.latestTag,
      step: inspection.step ?? null,
      modifiedAt: inspection.modifiedAt
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  return { outputDir, checkpoints };
};

function setupLogging() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const logStream = fs.createWriteStream(APP_LOG_PATH, { flags: 'a' });
    const originalLog = console.log;
    const originalError = console.error;

    const formatMessage = (args: any[]) => {
      const timestamp = new Date().toISOString();
      return `[${timestamp}] ` + args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ') + '\n';
    };

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      logStream.write(formatMessage(args));
    };

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      logStream.write(`[ERROR] ` + formatMessage(args));
    };

    console.log("=========================================");
    console.log(`App started at ${new Date().toLocaleString()}`);
    console.log(`Version: ${app.getVersion()}`);
    console.log(`Platform: ${process.platform} (${process.arch})`);
    console.log(`Packaged: ${app.isPackaged}`);
    console.log("=========================================");
  } catch (e) {
    process.stderr.write(`Failed to setup logging: ${e}\n`);
  }
}

setupLogging();

process.on('uncaughtException', (error) => {
  console.error("Uncaught exception in main process:", error);
});

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let activeBackendProcess: any = null
let activeTensorboardProcess: any = null
let activeToolProcess: ChildProcess | null = null;
let toolLogBuffer: string[] = [];

const SETTINGS_FILE = path.join(APP_ROOT_DIR, 'settings.json');

interface AppSettings {
  userPythonPath?: string;
  isTensorboardEnabled?: boolean;
  tbLogDir?: string;
  tbHost?: string;
  tbPort?: number;
  language?: string;
  theme?: 'light' | 'dark';
  projectLaunchParams?: Record<string, any>;
  cachedFingerprint?: {
    sha256: string;
    totalFiles: number;
    totalSize: number;
    totalSizeFormatted: string;
    calculatedAt: string;
  };
  toolSettings?: Record<string, any>;
}

const loadSettings = (): AppSettings => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return {};
};

const saveSettings = (settings: AppSettings) => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
};

// --- Persist install location for the patch installer ---
// Users install by extracting a ZIP, so there is no installer-written registry
// record of where the app lives. We write our own current directory to a single
// fixed HKCU value on every launch (overwrite-in-place, so moving the folder
// just refreshes it — it never accumulates). The lightweight Inno patch
// installer reads this value to auto-detect the correct target directory.
// See patch_installer.iss -> GetInstallDir().
function recordInstallLocation() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    // APP_ROOT_DIR is the folder containing "DiffPipe Forge.exe".
    const installDir = APP_ROOT_DIR;
    const child = spawn('reg', [
      'add', 'HKCU\\Software\\DiffPipe Forge',
      '/v', 'InstallDir',
      '/t', 'REG_SZ',
      '/d', installDir,
      '/f'
    ], { windowsHide: true });
    child.on('error', (err) => console.error('[InstallDir] reg add failed:', err));
    child.on('close', (code) => {
      if (code === 0) console.log(`[InstallDir] Recorded install dir: ${installDir}`);
      else console.error(`[InstallDir] reg add exited with code ${code}`);
    });
  } catch (e) {
    console.error('[InstallDir] Failed to record install location:', e);
  }
}


function createWindow() {
  console.log("createWindow called");
  win = new BrowserWindow({
    width: 1290,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false // Allow loading local resources (file://)
    },
    autoHideMenuBar: true, // Hide the default menu bar (File, Edit, etc.)
    frame: false, // Frameless window for custom title bar
  })
  console.log("BrowserWindow created, id:", win.id);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Open urls in the user's browser
  win.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: "deny" };
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.whenReady().then(() => {
  console.log("App is ready, creating window...");
  createWindow()

  // Record where we are running from so the patch installer can find us.
  recordInstallLocation()


  // Window controls
  ipcMain.on('window-minimize', () => {
    win?.minimize();
  });

  ipcMain.on('window-toggle-maximize', () => {
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    win?.close();
  });

  // IPC Handler for converting path to file URL (robust encoding)
  ipcMain.handle('get-file-url', async (_event, filePath: string) => {
    return pathToFileURL(filePath).href
  })

  // IPC Handler for saving files (used for temp json)
  ipcMain.handle('save-file', async (_event: any, filePath: string, content: string) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, 'utf-8', (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  // IPC Handler for file dialog
  ipcMain.handle('dialog:openFile', async (_event, options) => {
    if (!win) return { canceled: true, filePaths: [] }
    return await dialog.showOpenDialog(win, options)
  })

  // IPC Handler for message box
  ipcMain.handle('dialog:showMessageBox', async (_event, options) => {
    if (!win) return { response: 0 }
    return await dialog.showMessageBox(win, options)
  })

  // IPC Handler for directory creation
  ipcMain.handle('ensure-dir', async (_event: any, dirPath: string) => {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  ipcMain.handle('get-paths', async () => {
    let projectRoot;
    if (app.isPackaged) {
      // In Prod: resources/backend... -> Root is parent of resources
      projectRoot = path.dirname(process.resourcesPath);
    } else {
      projectRoot = path.resolve(process.env.APP_ROOT, '../..');
    }
    const outputDir = path.join(projectRoot, 'output');
    return { projectRoot, outputDir };
  })

  ipcMain.handle('get-language', async () => {
    const settings = loadSettings();
    return settings.language || 'zh';
  });

  ipcMain.handle('get-platform', () => process.platform);

  ipcMain.handle('set-language', async (_event, lang: string) => {
    const settings = loadSettings();
    settings.language = lang;
    saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle('get-theme', async () => {
    const settings = loadSettings();
    return settings.theme || 'dark';
  });

  ipcMain.handle('set-theme', async (_event, theme: 'light' | 'dark') => {
    const settings = loadSettings();
    settings.theme = theme;
    saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle('get-project-launch-params', async (_event, projectPath: string) => {
    const settings = loadSettings();
    if (!settings.projectLaunchParams) return {};
    const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
    return settings.projectLaunchParams[normalized] || {};
  });

  ipcMain.handle('save-project-launch-params', async (_event, { projectPath, params }) => {
    const settings = loadSettings();
    if (!settings.projectLaunchParams) settings.projectLaunchParams = {};
    const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
    settings.projectLaunchParams[normalized] = params;
    saveSettings(settings);
    return { success: true };
  });

  ipcMain.handle('get-tool-settings', async (_event, toolId: string) => {
    const settings = loadSettings();
    return settings.toolSettings?.[toolId] || {};
  });

  ipcMain.handle('save-tool-settings', async (_event, { toolId, settings: newSettings }) => {
    const settings = loadSettings();
    if (!settings.toolSettings) settings.toolSettings = {};
    settings.toolSettings[toolId] = newSettings;
    saveSettings(settings);
    return { success: true };
  });

  let tbUrl = ''; // Cached URL for the currently active TB session

  // IPC Handler for TensorBoard
  ipcMain.handle('start-tensorboard', async (_event: any, { logDir, host, port }: any) => {
    // Persistent state update
    const settings = loadSettings();
    settings.isTensorboardEnabled = true;
    settings.tbLogDir = logDir;
    settings.tbHost = host;
    settings.tbPort = port;
    saveSettings(settings);

    return new Promise((resolve, reject) => {
      // Clean up existing process
      if (activeTensorboardProcess) {
        try {
          // On Windows, tree kill might be needed, but for now simple kill
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', activeTensorboardProcess.pid, '/f', '/t']);
          }
          activeTensorboardProcess.kill();
        } catch (e) { console.error("Error killing tensorboard:", e); }
        activeTensorboardProcess = null;
      }

      console.log(`Starting TensorBoard on ${host}:${port} for dir ${logDir}`);

      console.log(`Starting TensorBoard on ${host}:${port} for dir ${logDir}`);

      // Resolve Python using unified logic
      const { projectRoot } = resolveModelsRoot();
      const pythonExe = getPythonExe(projectRoot);
      let tensorboardArgs = ['-m', 'tensorboard.main', '--logdir', logDir, '--host', host, '--port', String(port)];

      // Check if logDir exists, if not, tensorboard might complain or just show empty
      if (!fs.existsSync(logDir)) {
        console.warn(`Log dir ${logDir} does not exist, creating it.`);
        try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) { console.error(e); }
      }

      const tbProcess = spawn(pythonExe, tensorboardArgs, {
        env: { ...process.env, PYTHONUTF8: '1' }
      });

      activeTensorboardProcess = tbProcess;

      tbProcess.stdout.on('data', (data) => console.log('[TB Out]:', data.toString()));
      tbProcess.stderr.on('data', (data) => console.log('[TB Err]:', data.toString()));

      tbProcess.on('error', (err) => {
        console.error('Failed to start TensorBoard:', err);
        reject(err.message);
      });

      // Polling function to check if TB is really ready
      const checkPort = (host: string, port: number, timeout: number) => {
        return new Promise((res) => {
          const startTime = Date.now();
          const timer = setInterval(() => {
            const client = new (require('net').Socket)();
            client.once('error', () => { });
            client.connect(port, host, () => {
              client.end();
              clearInterval(timer);
              res(true);
            });

            if (Date.now() - startTime > timeout) {
              clearInterval(timer);
              res(false);
            }
          }, 500);
        });
      };

      checkPort(host, port, 10000).then((isReady) => {
        if (isReady && activeTensorboardProcess && !activeTensorboardProcess.killed) {
          console.log(`[TB] Port ${port} is ready.`);
          tbUrl = `http://${host}:${port}`;
          resolve({ success: true, url: tbUrl });
        } else {
          // If start failed, clear the enabled flag
          const s = loadSettings();
          s.isTensorboardEnabled = false;
          saveSettings(s);
          reject("TensorBoard process failed to start or port timed out");
        }
      });
    });
  });

  ipcMain.handle('stop-tensorboard', async () => {
    // Persistent state update
    const settings = loadSettings();
    settings.isTensorboardEnabled = false;
    saveSettings(settings);

    if (activeTensorboardProcess) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', activeTensorboardProcess.pid, '/f', '/t']);
        }
        activeTensorboardProcess.kill();
        activeTensorboardProcess = null;
        tbUrl = '';
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
    tbUrl = '';
    return { success: true };
  });

  ipcMain.handle('get-tensorboard-status', async () => {
    const isRunning = !!(activeTensorboardProcess && !activeTensorboardProcess.killed);
    const settings = loadSettings();

    return {
      isRunning,
      url: tbUrl || (isRunning ? `http://${settings.tbHost || 'localhost'}:${settings.tbPort || 6006}` : ''),
      settings: {
        host: settings.tbHost || 'localhost',
        port: settings.tbPort || 6006,
        logDir: settings.tbLogDir || '',
        autoStart: settings.isTensorboardEnabled || false
      }
    };
  });







  // IPC Handler for Python Backend
  ipcMain.handle('run-backend', async (_event: any, args: any[]) => {
    return new Promise((resolve, reject) => {
      console.log('Running backend with args:', args)

      let backendProcess;

      if (app.isPackaged) {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        const scriptPath = resolveBackendPath('backend/main.py');
        const modelsDir = path.join(APP_ROOT_DIR, 'models', 'index-tts', 'hub');

        console.log('Spawning Packaged Backend with Python:', pythonExe);
        console.log('Target Script:', scriptPath);

        // Spawn python process
        backendProcess = spawn(pythonExe, [scriptPath, '--json', '--model_dir', modelsDir, ...args], {
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        });
      } else {
        // In Dev: python backend/main.py
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        const pythonScript = path.join(process.env.APP_ROOT, '../backend/main.py')
        const modelsDir = path.join(projectRoot, 'models', 'index-tts', 'hub');

        const pythonArgs = [pythonScript, '--json', '--model_dir', modelsDir, ...args]

        console.log('Spawning Python Script:', pythonScript, 'with', pythonExe);
        // Force Python to use UTF-8 for IO and arguments
        backendProcess = spawn(pythonExe, pythonArgs, {
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        })
      }

      activeBackendProcess = backendProcess


      let outputData = ''
      let errorData = ''

      if (backendProcess) {
        backendProcess.stdout.on('data', (data: any) => {
          const str = data.toString()

          const lines = str.split('\n');
          lines.forEach((line: string) => {
            // Parse progress markers: [PROGRESS] 50
            const progressMatch = line.match(/\[PROGRESS\]\s*(\d+)/);
            if (progressMatch) {
              const p = parseInt(progressMatch[1], 10);
              _event.sender.send('backend-progress', p);
            }

            // Parse partial results: [PARTIAL] json
            const partialMatch = line.match(/\[PARTIAL\]\s*(.*)/);
            if (partialMatch) {
              try {
                const pData = JSON.parse(partialMatch[1].trim());
                _event.sender.send('backend-partial-result', pData);
              } catch (e) {
                console.error("Failed to parse partial:", e);
              }
            }

            // Parse dependency installation markers: [DEPS_INSTALLING] package
            const depsMatch = line.match(/\[DEPS_INSTALLING\]\s*(.*)/);
            if (depsMatch) {
              const packageDesc = depsMatch[1].trim();
              _event.sender.send('backend-deps-installing', packageDesc);
            }

            // Parse dependency completion markers: [DEPS_DONE] package
            const depsDoneMatch = line.match(/\[DEPS_DONE\]\s*(.*)/);
            if (depsDoneMatch) {
              _event.sender.send('backend-deps-done');
            }
          });

          console.log('[Py Stdout]:', str)
          outputData += str
        })

        backendProcess.stderr.on('data', (data: any) => {
          const str = data.toString()
          console.error('[Py Stderr]:', str)
          errorData += str
        })

        backendProcess.on('close', (code: number) => {
          if (activeBackendProcess === backendProcess) activeBackendProcess = null;
          if (code !== 0) {
            reject(new Error(`Python process exited with code ${code}. Error: ${errorData}`))
            return
          }

          // Parse JSON output
          try {
            const startMarker = '__JSON_START__'
            const endMarker = '__JSON_END__'
            const startIndex = outputData.indexOf(startMarker)
            const endIndex = outputData.lastIndexOf(endMarker) // Use lastIndexOf for safety

            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
              let jsonFullStr = outputData.substring(startIndex + startMarker.length, endIndex).trim()

              // [ROBUST] Find the actual JSON object boundaries within the markers
              const firstBrace = jsonFullStr.indexOf('{')
              const lastBrace = jsonFullStr.lastIndexOf('}')
              const firstBracket = jsonFullStr.indexOf('[')
              const lastBracket = jsonFullStr.lastIndexOf(']')

              // Determine if it's an object or array based on what comes first
              let startIdx = -1;
              let endIdx = -1;

              // If both exist, take the earlier one. If only one exists, take it.
              if (firstBrace !== -1 && firstBracket !== -1) {
                if (firstBrace < firstBracket) {
                  startIdx = firstBrace;
                  endIdx = lastBrace;
                } else {
                  startIdx = firstBracket;
                  endIdx = lastBracket;
                }
              } else if (firstBrace !== -1) {
                startIdx = firstBrace;
                endIdx = lastBrace;
              } else if (firstBracket !== -1) {
                startIdx = firstBracket;
                endIdx = lastBracket;
              }

              if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const cleanJsonStr = jsonFullStr.substring(startIdx, endIdx + 1)
                const result = JSON.parse(cleanJsonStr)
                resolve(result)
              } else {
                // Fallback (e.g. simple primitives or clean string)
                const result = JSON.parse(jsonFullStr)
                resolve(result)
              }
            } else {
              console.warn('JSON markers not found or invalid in output')
              resolve({ rawOutput: outputData, rawError: errorData })
            }
          } catch (e) {
            console.error('Failed to parse backend output. Raw:', outputData);
            reject(new Error(`Failed to parse backend output: ${e}`))
          }
        })
      } else {
        reject(new Error("Failed to spawn backend process"));
      }
    })
  })

  ipcMain.handle('cache-video', async (_event, filePath: string) => {
    try {
      // Determine .cache folder path
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, '..');
      }
      const cacheDir = path.join(projectRoot, '.cache');

      // Ensure .cache exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // 1. If input file is already in .cache, assume it's cached and return as is.
      // Normalize paths for comparison
      const normalizedInput = path.normalize(filePath);
      const normalizedCache = path.normalize(cacheDir);

      if (normalizedInput.startsWith(normalizedCache)) {
        return normalizedInput;
      }

      // 2. Compute stable filename based on input path hash
      // This ensures same file path maps to same cached file
      const crypto = require('node:crypto');
      const hash = crypto.createHash('md5').update(normalizedInput).digest('hex');
      const basename = path.basename(filePath);
      // Limit filename length just in case
      const safeBasename = `${hash.substring(0, 12)}_${basename}`;
      const destPath = path.join(cacheDir, safeBasename);

      // 3. Check if we already have it
      if (fs.existsSync(destPath)) {
        console.log(`Using existing cached file for: ${filePath}`);
        return destPath;
      }

      // 4. Copy if new
      console.log(`Caching new file: ${filePath} -> ${destPath}`);
      await fs.promises.copyFile(filePath, destPath);

      return destPath;
    } catch (error) {
      console.error('Failed to cache video:', error);
      throw error;
    }
  })

  // IPC Handler to open folder
  ipcMain.handle('open-folder', async (_event, filePath: string) => {
    try {
      console.log(`[Main] open-folder requested for: ${filePath}`);
      if (!filePath) return false;

      let currentPath = path.normalize(filePath);
      console.log(`[Main] Normalized starting path: ${currentPath}`);

      // Try to find the nearest existing parent directory
      while (currentPath && currentPath !== path.parse(currentPath).root) {
        if (fs.existsSync(currentPath)) {
          const stat = fs.statSync(currentPath);
          if (stat.isDirectory()) {
            console.log(`[Main] Opening existing directory: ${currentPath}`);
            await shell.openPath(currentPath);
          } else {
            console.log(`[Main] Showing existing file in folder: ${currentPath}`);
            shell.showItemInFolder(currentPath);
          }
          return true;
        }
        console.log(`[Main] Path does not exist, trying parent: ${currentPath}`);
        currentPath = path.dirname(currentPath);
      }

      // Final check for root if we got there
      if (currentPath && fs.existsSync(currentPath)) {
        await shell.openPath(currentPath);
        return true;
      }

      console.error(`[Main] Could not find any existing parent directory for: ${filePath}`);
      return false;
    } catch (e) {
      console.error("[Main] Failed to open folder:", e);
      return false;
    }
  })

  // IPC Handler to open file externally (system default player)
  ipcMain.handle('open-external', async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (e) {
      console.error("Failed to open external:", e);
      return false;
    }
  })

  // IPC Handler to list images in a directory
  ipcMain.handle('list-images', async (_event, { dirPath, limit = 20 }) => {
    try {
      if (!dirPath) return { success: false, error: "No directory path provided", images: [], total: 0 };
      if (!fs.existsSync(dirPath)) return { success: true, images: [], total: 0 };

      const files = await fs.promises.readdir(dirPath);
      const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']);

      const allImages = files
        .filter(file => imageExtensions.has(path.extname(file).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })) // Natural sort
        .map(file => path.join(dirPath, file));

      const images = allImages.slice(0, limit);

      return { success: true, images, total: allImages.length };
    } catch (e: any) {
      console.error("Failed to list images:", e);
      return { success: false, error: e.message, images: [], total: 0 };
    }
  })

  // IPC Handler to list trainable media in a directory (images + videos)
  ipcMain.handle('list-media', async (_event, { dirPath, limit = 20 }) => {
    try {
      if (!dirPath) return { success: false, error: "No directory path provided", files: [], total: 0, imageTotal: 0, videoTotal: 0 };
      if (!fs.existsSync(dirPath)) return { success: true, files: [], total: 0, imageTotal: 0, videoTotal: 0 };

      const files = await fs.promises.readdir(dirPath);
      const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']);
      const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv']);

      const allFiles = files
        .filter(file => imageExtensions.has(path.extname(file).toLowerCase()) || videoExtensions.has(path.extname(file).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      const imageTotal = allFiles.filter(file => imageExtensions.has(path.extname(file).toLowerCase())).length;
      const videoTotal = allFiles.filter(file => videoExtensions.has(path.extname(file).toLowerCase())).length;

      return {
        success: true,
        files: allFiles.slice(0, limit).map(file => path.join(dirPath, file)),
        total: allFiles.length,
        imageTotal,
        videoTotal
      };
    } catch (e: any) {
      console.error("Failed to list media:", e);
      return { success: false, error: e.message, files: [], total: 0, imageTotal: 0, videoTotal: 0 };
    }
  })

  // IPC Handler to get image thumbnail (compressed preview)
  ipcMain.handle('get-thumbnail', async (_event, filePath: string) => {
    try {
      // nativeImage.createThumbnailFromPath is only available on macOS and Windows
      if (process.platform === 'linux') {
        return pathToFileURL(filePath).href;
      }
      const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 200, height: 200 });
      return thumb.toDataURL();
    } catch (e) {
      // console.error("Failed to generate thumbnail for:", filePath, e);
      // Fallback to file URL if thumbnail fails
      return pathToFileURL(filePath).href;
    }
  })

  // IPC Handler to get mask thumbnail for an image
  ipcMain.handle('get-mask-thumbnail', async (_event, { originalPath, maskDirName, overrideMaskPath }: { originalPath: string, maskDirName?: string, overrideMaskPath?: string }) => {
    try {
      const filename = path.basename(originalPath);
      const ext = path.extname(filename);
      const nameWithoutExt = path.basename(filename, ext);
      const maskFilename = nameWithoutExt + '.png'; // masks are always .png

      let maskPath = '';
      if (overrideMaskPath) {
        // Use the override mask directory directly
        maskPath = path.join(overrideMaskPath, maskFilename);
      } else if (maskDirName) {
        // Look in a subdirectory of the image's parent
        const imageDir = path.dirname(originalPath);
        maskPath = path.join(imageDir, maskDirName, maskFilename);
      } else {
        // Default: sibling directory with _masks suffix
        const imageDir = path.dirname(originalPath);
        maskPath = path.join(imageDir + '_masks', maskFilename);
      }

      if (!fs.existsSync(maskPath)) {
        return { success: false };
      }

      if (process.platform === 'linux') {
        return { success: true, thumbnail: pathToFileURL(maskPath).href, maskPath };
      }

      const thumb = await nativeImage.createThumbnailFromPath(maskPath, { width: 200, height: 200 });
      return { success: true, thumbnail: thumb.toDataURL(), maskPath };
    } catch (e) {
      return { success: false };
    }
  })

  // IPC Handler to read caption file matching an image
  ipcMain.handle('read-caption', async (_event, imagePath: string) => {
    try {
      const ext = path.extname(imagePath);
      const captionPath = imagePath.replace(ext, '.txt');

      if (fs.existsSync(captionPath)) {
        const content = await fs.promises.readFile(captionPath, 'utf-8');
        return { exists: true, content: content.trim() };
      }
      return { exists: false, content: '' };
    } catch (e) {
      console.error("Failed to read caption for:", imagePath, e);
      return { exists: false, content: '' };
    }
  })

  // IPC Handler to write/update caption file
  ipcMain.handle('write-caption', async (_event, { imagePath, content }: { imagePath: string, content: string }) => {
    try {
      const ext = path.extname(imagePath);
      const captionPath = imagePath.replace(ext, '.txt');

      await fs.promises.writeFile(captionPath, content, 'utf-8');
      return { success: true };
    } catch (e) {
      console.error("Failed to write caption for:", imagePath, e);
      return { success: false, error: String(e) };
    }
  })

  // IPC Handler to restore files to parent directory
  ipcMain.handle('restore-files', async (_event, filePaths: string[]) => {
    try {
      let restoredCount = 0;
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) continue;

        // Parent of current folder (likely 'low_quality', 'duplicates' etc.)
        const currentDir = path.dirname(filePath);
        const parentDir = path.dirname(currentDir);
        const fileName = path.basename(filePath);
        let destPath = path.join(parentDir, fileName);

        // Conflict Resolution: Rename if exists
        if (fs.existsSync(destPath)) {
          const name = path.parse(fileName).name;
          const ext = path.parse(fileName).ext;
          let counter = 1;
          while (fs.existsSync(path.join(parentDir, `${name}_restored_${counter}${ext}`))) {
            counter++;
          }
          destPath = path.join(parentDir, `${name}_restored_${counter}${ext}`);
        }

        await fs.promises.rename(filePath, destPath);
        restoredCount++;
      }
      return { success: true, count: restoredCount };
    } catch (e: any) {
      console.error("Failed to restore files:", e);
      return { success: false, error: e.message };
    }
  })

  // IPC Handler to kill backend
  ipcMain.handle('kill-backend', async () => {
    if (activeBackendProcess) {
      try {
        const pid = activeBackendProcess.pid;
        console.log(`Killing python process ${pid}...`);

        if (process.platform === 'win32') {
          // Force kill tree
          const { exec } = await import('child_process');
          exec(`taskkill /pid ${pid} /T /F`);
        } else {
          activeBackendProcess.kill('SIGKILL');
        }
        activeBackendProcess = null;
        return true;
      } catch (e) {
        console.error("Failed to kill backend:", e);
        return false;
      }
    }
    return true; // No process running, technically success
  })

  // --- Resource Monitor IPC ---
  let activeMonitorProcess: ChildProcess | null = null;
  let latestMonitorStats: any = null;

  ipcMain.handle('start-resource-monitor', async (_event) => {
    if (activeMonitorProcess) return { success: true, message: "Already running" };

    return new Promise((resolve, reject) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let scriptPath = '';

        scriptPath = resolveBackendPath('backend/monitor.py');

        if (!fs.existsSync(scriptPath)) {
          // Try looking in root if not in backend/ (fallback)
          const fallbackPath = path.join(projectRoot, 'monitor.py');
          if (fs.existsSync(fallbackPath)) {
            scriptPath = fallbackPath;
          } else {
            reject(new Error(`Monitor script not found at ${scriptPath}`));
            return;
          }
        }

        console.log(`[Monitor] Spawning: ${pythonExe} ${scriptPath}`);

        activeMonitorProcess = spawn(pythonExe, [scriptPath], {
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        });

        activeMonitorProcess.stdout?.on('data', (data) => {
          const str = data.toString();
          // Parse custom JSON markers
          const startMarker = '__JSON_START__';
          const endMarker = '__JSON_END__';

          // Handle potential multiple chunks or merged lines
          const lines = str.split('\n');
          for (const line of lines) {
            const startIndex = line.indexOf(startMarker);
            const endIndex = line.lastIndexOf(endMarker);

            if (startIndex !== -1 && endIndex !== -1) {
              try {
                const jsonStr = line.substring(startIndex + startMarker.length, endIndex);
                latestMonitorStats = JSON.parse(jsonStr);
                _event.sender.send('resource-stats', latestMonitorStats);
              } catch (e) {
                console.error("[Monitor] Parse error:", e);
              }
            }
          }
        });

        activeMonitorProcess.stderr?.on('data', (data) => {
          console.error(`[Monitor Err]: ${data}`);
        });

        activeMonitorProcess.on('close', (code) => {
          console.log(`[Monitor] Exited with code ${code}`);
          activeMonitorProcess = null;
        });

        resolve({ success: true });

      } catch (e: any) {
        console.error("[Monitor] Start failed:", e);
        reject(e);
      }
    });
  });

  ipcMain.handle('stop-resource-monitor', async () => {
    if (activeMonitorProcess) {
      try {
        activeMonitorProcess.kill();
        activeMonitorProcess = null;
        latestMonitorStats = null;
      } catch (e) {
        console.error("[Monitor] Stop failed:", e);
      }
    }
    return { success: true };
  });

  ipcMain.handle('get-resource-monitor-stats', async () => {
    return latestMonitorStats;
  });

  // IPC Handler to open backend log
  ipcMain.handle('open-backend-log', async () => {
    try {
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, '..');
      }

      const logPath = path.join(projectRoot, 'logs', 'backend_debug.log');

      if (!fs.existsSync(logPath)) {
        console.error(`Log file not found at: ${logPath}`);
        return { success: false, error: 'Log file not found' };
      }

      const error = await shell.openPath(logPath);
      if (error) {
        console.error(`Failed to open log: ${error}`);
        return { success: false, error };
      }
      return { success: true };
    } catch (e) {
      console.error("Failed to open backend log:", e);
      return { success: false, error: String(e) };
    }
  })

  // --- Fingerprint / System Diagnostics IPC ---
  ipcMain.handle('calculate-python-fingerprint', async (_event) => {
    try {
      const { projectRoot } = resolveModelsRoot();
      const pythonExe = getPythonExe(projectRoot);

      if (!pythonExe || pythonExe === 'python' || pythonExe === 'python3') {
        return { error: "Cannot calculate fingerprint for System Python. Please use a portable or virtual environment." };
      }

      if (!fs.existsSync(pythonExe)) {
        return { error: `Active Python executable not found: ${pythonExe}` };
      }

      // Determine environment root
      // If inside Scripts (Windows) or bin (Linux/Mac), go up one level
      let pythonEnvPath = path.dirname(pythonExe);
      if (path.basename(pythonEnvPath).toLowerCase() === 'scripts' || path.basename(pythonEnvPath).toLowerCase() === 'bin') {
        pythonEnvPath = path.dirname(pythonEnvPath);
      }

      console.log(`[Fingerprint] Calculating for user selected env: ${pythonEnvPath}`);

      if (!fs.existsSync(pythonEnvPath)) {
        return { error: `Python environment root not found at: ${pythonEnvPath}` };
      }

      const crypto = require('crypto');
      const allFiles: { path: string; size: number; sha256: string }[] = [];
      let totalSize = 0;
      let processedCount = 0;

      // Async hash calculation using streams (prevents memory issues with large files)
      const calcFileHashAsync = (filePath: string): Promise<string> => {
        return new Promise((resolve, reject) => {
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
          stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
          stream.on('end', () => resolve(hash.digest('hex')));
          stream.on('error', reject);
        });
      };

      // Collect all file paths first (lightweight operation)
      const filePaths: { fullPath: string; relativePath: string }[] = [];
      const excludePatterns = ['__pycache__', '.pyc', '.git', '.log'];

      const collectFiles = (dir: string, basePath: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

            // Match Python's exclusion logic: check if pattern appears anywhere in path
            // Python: "if pattern in rel_path.parts or pattern in rel_path_str"
            let shouldExclude = false;
            for (const pattern of excludePatterns) {
              if (relativePath.includes(pattern)) {
                shouldExclude = true;
                break;
              }
            }
            if (shouldExclude) continue;

            if (entry.isDirectory()) {
              collectFiles(fullPath, basePath);
            } else if (entry.isFile()) {
              filePaths.push({ fullPath, relativePath });
            }
          }
        } catch (e) {
          console.error(`[Fingerprint] Error scanning dir: ${dir}`, e);
        }
      };

      collectFiles(pythonEnvPath, pythonEnvPath);
      const totalFiles = filePaths.length;

      console.log(`[Fingerprint] Found ${totalFiles} files to process`);

      // Process files in batches to avoid overwhelming the system
      const BATCH_SIZE = 50;
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async ({ fullPath, relativePath }) => {
          try {
            const stats = await fs.promises.stat(fullPath);
            const hash = await calcFileHashAsync(fullPath);
            allFiles.push({ path: relativePath, size: stats.size, sha256: hash });
            totalSize += stats.size;
          } catch (e) {
            console.error(`[Fingerprint] Error processing: ${fullPath}`, e);
          }
        }));

        processedCount += batch.length;

        // Send progress to renderer (optional)
        if (processedCount % 200 === 0 || processedCount === totalFiles) {
          console.log(`[Fingerprint] Progress: ${processedCount}/${totalFiles}`);
        }
      }

      // Sort files for consistent ordering (must match Python's sorted() behavior)
      // Use simple string comparison instead of localeCompare for exact match
      allFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

      // Compute combined SHA256 using same algorithm as package_app.py
      // Format: "relative_path:sha256_hash" for each file
      const combinedHash = crypto.createHash('sha256');
      for (const file of allFiles) {
        const combinedStr = `${file.path}:${file.sha256}`;
        combinedHash.update(combinedStr);
      }
      const sha256 = combinedHash.digest('hex');

      // Format size
      const formatSize = (bytes: number): string => {
        if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return bytes + ' B';
      };

      console.log(`[Fingerprint] Completed. Files: ${allFiles.length}, Size: ${formatSize(totalSize)}`);

      return {
        totalFiles: allFiles.length,
        totalSize,
        totalSizeFormatted: formatSize(totalSize),
        sha256,
        files: allFiles.slice(0, 100) // Return first 100 files for debugging
      };
    } catch (e: any) {
      console.error('[Fingerprint] Error:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('get-official-fingerprint', async () => {
    try {
      const { projectRoot } = resolveModelsRoot();
      const officialPath = path.join(projectRoot, 'fingerprints', 'official.json');

      if (!fs.existsSync(officialPath)) {
        console.log(`[Fingerprint] Official fingerprint not found at: ${officialPath}`);
        return null;
      }

      const content = fs.readFileSync(officialPath, 'utf-8');
      const official = JSON.parse(content);
      return {
        sha256: official.combined_sha256 || official.sha256,
        totalFiles: official.total_files,
        version: official.version || '1.0.0',
        generatedAt: official.generated_at
      };
    } catch (e: any) {
      console.error('[Fingerprint] Error reading official:', e);
      return null;
    }
  });

  // Save fingerprint result to settings (so it persists between sessions)
  ipcMain.handle('save-fingerprint-cache', async (_event, fingerprint: {
    sha256: string;
    totalFiles: number;
    totalSize: number;
    totalSizeFormatted: string;
  }) => {
    try {
      const settings = loadSettings();
      settings.cachedFingerprint = {
        ...fingerprint,
        calculatedAt: new Date().toISOString()
      };
      saveSettings(settings);
      return { success: true };
    } catch (e: any) {
      console.error('[Fingerprint] Error saving cache:', e);
      return { success: false, error: e.message };
    }
  });

  // Get cached fingerprint from settings
  ipcMain.handle('get-fingerprint-cache', async () => {
    try {
      const settings = loadSettings();
      return settings.cachedFingerprint || null;
    } catch (e: any) {
      console.error('[Fingerprint] Error loading cache:', e);
      return null;
    }
  });

  // IPC Handler to repair python environment
  ipcMain.handle('fix-python-env', async (_event) => {
    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let requirementsPath = '';

        if (app.isPackaged) {
          // Requirements: Try looking in project root
          requirementsPath = path.join(projectRoot, 'requirements.txt');
          if (!fs.existsSync(requirementsPath)) {
            const internalReq = resolveBackendPath('backend/requirements.txt');
            if (fs.existsSync(internalReq)) requirementsPath = internalReq;
          }
        } else {
          requirementsPath = path.join(projectRoot, 'requirements.txt');
        }

        if (!fs.existsSync(pythonExe) && pythonExe !== 'python') {
          resolve({ success: false, error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }

        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: `找不到 requirements.txt。请确认文件存在于 ${projectRoot}` });
          return;
        }

        console.log(`[FixEnv] Starting repair... Python: ${pythonExe}, Req: ${requirementsPath}`);

        const installProcess = spawn(pythonExe, ['-m', 'pip', 'install', '-r', requirementsPath], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        let output = '';
        let errorOut = '';

        installProcess.stdout.on('data', (data) => {
          console.log(`[Pip]: ${data}`);
          output += data.toString();
        });

        installProcess.stderr.on('data', (data) => {
          console.error(`[Pip Err]: ${data}`);
          errorOut += data.toString();
        });

        installProcess.on('close', (code) => {
          if (code === 0) {
            console.log('[FixEnv] Success!');
            resolve({ success: true, output });
          } else {
            console.error('[FixEnv] Failed code:', code);
            resolve({ success: false, error: `Pip install failed (Code ${code}). \nError: ${errorOut}` });
          }
        });

        installProcess.on('error', (err) => {
          resolve({ success: false, error: `Spawn error: ${err.message}` });
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  })

  // IPC Handler to check python environment (list missing deps)
  ipcMain.handle('check-python-env', async (_event) => {
    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let requirementsPath = '';
        let checkScriptPath = '';

        if (app.isPackaged) {
          requirementsPath = path.join(projectRoot, 'requirements.txt');
          if (!fs.existsSync(requirementsPath)) {
            const internalReq = resolveBackendPath('backend/requirements.txt');
            if (fs.existsSync(internalReq)) {
              requirementsPath = internalReq; // Assuming reqToUse should update requirementsPath
            }
          }
          checkScriptPath = resolveBackendPath('backend/check_requirements.py');
        } else {
          requirementsPath = path.join(projectRoot, 'requirements.txt');
          checkScriptPath = path.join(projectRoot, 'backend', 'check_requirements.py');
        }

        if (!fs.existsSync(pythonExe)) {
          resolve({ success: false, status: 'missing_python', error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }
        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: "requirements.txt not found" });
          return;
        }
        if (!fs.existsSync(checkScriptPath)) {
          resolve({ success: false, error: "check_requirements.py not found" });
          return;
        }

        const checkProcess = spawn(pythonExe, [checkScriptPath, requirementsPath, '--json'], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        let output = '';
        checkProcess.stdout.on('data', (data) => output += data.toString());
        checkProcess.stderr.on('data', (data) => console.error('[CheckEnv Err]:', data.toString()));

        checkProcess.on('close', (code) => {
          try {
            // Attempt to find JSON in output
            const jsonStart = output.indexOf('{');
            const jsonEnd = output.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
              const jsonStr = output.substring(jsonStart, jsonEnd + 1);
              const result = JSON.parse(jsonStr);
              resolve({ success: true, missing: result.missing || [] });
            } else {
              // No JSON found
              if (code === 0 && !output.trim()) resolve({ success: true, missing: [] }); // Empty output usually OK if logic implies success, but our script prints success msg.
              // Actually our script prints "All good" if no JSON.
              // Ideally we look for success status or non-zero code.
              if (code !== 0) resolve({ success: false, error: "Dependency check failed (non-zero exit)" });
              else resolve({ success: true, missing: [] });
            }
          } catch (e: any) {
            resolve({ success: false, error: `Parse error: ${e.message}` });
          }
        });

        checkProcess.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  })

  // Helper function to resolve Models Root
  const resolveModelsRoot = () => {
    let modelsRoot = '';
    let projectRoot = '';

    if (app.isPackaged) {
      projectRoot = path.dirname(process.resourcesPath);
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        modelsRoot = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'models');
      } else {
        modelsRoot = path.join(projectRoot, 'models');
      }
    } else {
      // In Dev: APP_ROOT_DIR is the workspace root
      projectRoot = APP_ROOT_DIR;
      modelsRoot = path.join(projectRoot, 'models');
    }
    return { modelsRoot, projectRoot };
  };

  /**
   * Scans project root for folders containing python.exe
   * Matches folders named 'python' or starting with 'python_'
   */
  const scanPythonEnvironments = (projectRoot: string) => {
    const envs: { name: string, path: string }[] = [];
    try {
      if (!fs.existsSync(projectRoot)) return envs;

      const files = fs.readdirSync(projectRoot);
      for (const f of files) {
        const fullPath = path.join(projectRoot, f);
        if (fs.statSync(fullPath).isDirectory()) {
          // Check if folder name matches pattern
          if (f === 'python' || f.startsWith('python_')) {
            const exePath = path.join(fullPath, 'python.exe');
            if (fs.existsSync(exePath)) {
              envs.push({ name: f, path: exePath });
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to scan environments:", e);
    }
    return envs;
  };

  /**
   * Asks conda for a list of environments in JSON format
   */
  const scanCondaEnvironments = async (): Promise<{ name: string, path: string }[]> => {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      // Set a short timeout to prevent hanging if conda is broken
      exec('conda env list --json', { timeout: 3000 }, (err: any, stdout: string) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          if (data && data.envs && Array.isArray(data.envs)) {
            const results = data.envs.map((envPath: string) => {
              const name = path.basename(envPath);
              const pythonPath = path.join(envPath, 'python.exe');
              if (fs.existsSync(pythonPath)) {
                return { name: `${name} [Conda]`, path: pythonPath };
              }
              return null;
            }).filter(Boolean) as { name: string, path: string }[];
            resolve(results);
          } else {
            resolve([]);
          }
        } catch (e) {
          console.error("Failed to parse conda JSON:", e);
          resolve([]);
        }
      });
    });
  };

  function getPythonExe(projectRoot: string): string {
    // 1. User selected path from settings (Highest priority)
    const settings = loadSettings();
    if (settings.userPythonPath && fs.existsSync(settings.userPythonPath)) {
      console.log(`[PythonLookup] Using user-selected path: ${settings.userPythonPath}`);
      return settings.userPythonPath;
    }

    // Helper to check standard locations
    const isWin = process.platform === 'win32';
    const getSubPath = (base: string) => isWin ? path.join(base, 'Scripts', 'python.exe') : path.join(base, 'bin', 'python');

    // 2. Check for Conda environment
    if (process.env.CONDA_PREFIX) {
      const condaPython = getSubPath(process.env.CONDA_PREFIX);
      if (fs.existsSync(condaPython)) {
        console.log(`[PythonLookup] Detected Conda environment: ${process.env.CONDA_DEFAULT_ENV}`);
        return condaPython;
      }
    }

    // 3. Check for Virtual Environment
    if (process.env.VIRTUAL_ENV) {
      const venvPython = getSubPath(process.env.VIRTUAL_ENV);
      if (fs.existsSync(venvPython)) {
        console.log(`[PythonLookup] Detected Virtual Env: ${process.env.VIRTUAL_ENV}`);
        return venvPython;
      }
    }

    // 4. Try embedded_DP in project root or parent
    const searchDirs = [projectRoot, path.dirname(projectRoot)];
    for (const dir of searchDirs) {
      const embeddedDP = isWin ? path.join(dir, 'python_embeded_DP', 'python.exe') : path.join(dir, 'python_embeded_DP', 'bin', 'python');
      if (fs.existsSync(embeddedDP)) {
        console.log(`[PythonLookup] Found embedded_DP in ${dir}: ${embeddedDP}`);
        return embeddedDP;
      }
    }

    // 5. Try standard local python folder
    const localPython = isWin ? path.join(projectRoot, 'python', 'python.exe') : path.join(projectRoot, 'python', 'bin', 'python');
    if (fs.existsSync(localPython)) {
      console.log(`[PythonLookup] Found local python: ${localPython}`);
      return localPython;
    }

    // 6. Packaged specific locations
    if (app.isPackaged) {
      const resourcesPython = isWin ? path.join(process.resourcesPath, 'python', 'python.exe') : path.join(process.resourcesPath, 'python', 'bin', 'python');
      if (fs.existsSync(resourcesPython)) return resourcesPython;
    }

    return isWin ? 'python' : 'python3';
  }
  // IPC to get current python info and list of available ones
  ipcMain.handle('get-python-status', async () => {
    const { projectRoot } = resolveModelsRoot();
    const pythonExe = getPythonExe(projectRoot);
    const localEnvs = scanPythonEnvironments(projectRoot);
    const condaEnvs = await scanCondaEnvironments();
    const availableEnvs = [...localEnvs, ...condaEnvs];

    let isReady = false;
    if (pythonExe === 'python') {
      isReady = await new Promise(res => {
        exec('python --version', (err) => res(!err));
      });
    } else if (pythonExe && fs.existsSync(pythonExe)) {
      isReady = true;
    }

    const embeddedDP = path.join(projectRoot, 'python_embeded_DP', 'python.exe');
    const isInternal = pythonExe === embeddedDP;

    const isSamePath = (p1: string, p2: string) => {
      if (!p1 || !p2) return false;
      const r1 = path.resolve(p1);
      const r2 = path.resolve(p2);
      return process.platform === 'win32' ? r1.toLowerCase() === r2.toLowerCase() : r1 === r2;
    };

    // Determine safe name for display (folder name or path basename)
    let displayName = 'Unknown';
    if (pythonExe === 'python') {
      displayName = 'System Python';
    } else if (pythonExe) {
      // Check if it's a conda env first for better naming
      const matchingConda = condaEnvs.find(c => isSamePath(c.path, pythonExe));
      if (matchingConda) {
        displayName = matchingConda.name;
      } else {
        // If it's in project root, use folder name
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          displayName = relative.split(/[/\\]/)[0]; // Use the top level folder name
        } else {
          displayName = path.basename(path.dirname(pythonExe));
        }
      }
    }

    return {
      path: pythonExe || '',
      displayName,
      status: isReady ? 'ready' : 'missing',
      isInternal,
      availableEnvs
    };
  });

  // IPC to set python env from list
  ipcMain.handle('set-python-env', async (_event, filePath: string) => {
    const settings = loadSettings();
    settings.userPythonPath = filePath;
    saveSettings(settings);

    const { projectRoot } = resolveModelsRoot();
    const pythonExe = getPythonExe(projectRoot);
    const localEnvs = scanPythonEnvironments(projectRoot);
    const condaEnvs = await scanCondaEnvironments();
    const availableEnvs = [...localEnvs, ...condaEnvs];
    const isReady = pythonExe === 'python' ? true : (pythonExe ? fs.existsSync(pythonExe) : false);
    const embeddedDP = path.join(projectRoot, 'python_embeded_DP', 'python.exe');

    const isSamePath = (p1: string, p2: string) => {
      if (!p1 || !p2) return false;
      const r1 = path.resolve(p1);
      const r2 = path.resolve(p2);
      return process.platform === 'win32' ? r1.toLowerCase() === r2.toLowerCase() : r1 === r2;
    };

    // Display Name logic same as status
    let displayName = 'Unknown';
    if (pythonExe === 'python') {
      displayName = 'System Python';
    } else if (pythonExe) {
      const matchingConda = condaEnvs.find(c => isSamePath(c.path, pythonExe));
      if (matchingConda) {
        displayName = matchingConda.name;
      } else {
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          displayName = relative.split(/[/\\]/)[0];
        } else {
          displayName = path.basename(path.dirname(pythonExe));
        }
      }
    }

    const result = {
      success: true,
      path: pythonExe || '',
      displayName,
      status: isReady ? 'ready' : 'missing',
      isInternal: pythonExe === embeddedDP,
      availableEnvs
    };

    if (win) {
      win.webContents.send('python-status-changed', {
        path: result.path,
        displayName: result.displayName,
        status: result.status,
        isInternal: result.isInternal
      });
    }

    return result;
  });

  // IPC to manually pick python exe (Fallback/Other option)
  ipcMain.handle('pick-python-exe', async () => {
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Python Interpreter (python.exe)',
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      const settings = loadSettings();
      settings.userPythonPath = selectedPath;
      saveSettings(settings);

      const { projectRoot } = resolveModelsRoot();
      const pythonExe = getPythonExe(projectRoot);
      const isReady = pythonExe === 'python' ? true : (pythonExe ? fs.existsSync(pythonExe) : false);
      const embeddedDP = path.join(projectRoot, 'python_embeded_DP', 'python.exe');

      let displayName = 'Unknown';
      if (pythonExe === 'python') displayName = 'System Python';
      else if (pythonExe) {
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) displayName = relative.split(/[/\\]/)[0];
        else displayName = path.basename(path.dirname(pythonExe));
      }

      const response = {
        success: true,
        path: pythonExe || '',
        displayName,
        status: isReady ? 'ready' : 'missing',
        isInternal: pythonExe === embeddedDP
      };

      if (win) {
        win.webContents.send('python-status-changed', {
          path: response.path,
          displayName: response.displayName,
          status: response.status,
          isInternal: response.isInternal
        });
      }

      return response;
    }
    return { canceled: true };
  });

  // IPC Handler to check model status
  ipcMain.handle('check-model-status', async (_event) => {
    return new Promise((resolve) => {
      try {
        const { modelsRoot } = resolveModelsRoot();
        console.log('[CheckModel] Models Root:', modelsRoot);

        const checkDir = (subpath: string[]) => {
          // Check variations
          for (const p of subpath) {
            const fullPath = path.join(modelsRoot, p);
            if (fs.existsSync(fullPath)) return true;
          }
          return false;
        };

        // Specific checks
        const status = {
          whisperx: checkDir(['faster-whisper-large-v3-turbo-ct2', 'whisperx/faster-whisper-large-v3-turbo-ct2']),
          alignment: checkDir(['alignment']),
          index_tts: checkDir(['index-tts', 'index-tts/hub']),
          qwen: checkDir(['Qwen2.5-7B-Instruct', 'qwen/Qwen2.5-7B-Instruct']),
          qwen_tokenizer: checkDir(['Qwen3-TTS-Tokenizer-12Hz', 'Qwen/Qwen3-TTS-Tokenizer-12Hz']),
          qwen_17b_base: checkDir(['Qwen3-TTS-12Hz-1.7B-Base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base']),
          qwen_17b_design: checkDir(['Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign']),
          qwen_17b_custom: checkDir(['Qwen3-TTS-12Hz-1.7B-CustomVoice', 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice']),
          qwen_06b_base: checkDir(['Qwen3-TTS-12Hz-0.6B-Base', 'Qwen/Qwen3-TTS-12Hz-0.6B-Base']),
          qwen_06b_custom: checkDir(['Qwen3-TTS-12Hz-0.6B-CustomVoice', 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice']),
          rife: checkDir(['rife', 'rife-ncnn-vulkan'])
        };

        resolve({ success: true, status, root: modelsRoot });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  });


  // IPC Handler to check style filter model
  ipcMain.handle('check-style-model', async () => {
    const { projectRoot } = resolveModelsRoot();
    const modelPath = path.join(projectRoot, 'tools', 'filter_style', 'clip-vit-base-patch32');
    try {
      if (!fs.existsSync(modelPath)) return false;
      // Check for essential files: config.json and pytorch_model.bin or model.safetensors
      const configJson = path.join(modelPath, 'config.json');
      const modelBin = path.join(modelPath, 'pytorch_model.bin');
      const modelSafe = path.join(modelPath, 'model.safetensors');

      return fs.existsSync(configJson) && (fs.existsSync(modelBin) || fs.existsSync(modelSafe));
    } catch (error) {
      console.error("Error checking style model:", error);
      return false;
    }
  });

  // IPC Handler to check file existence (Robust check)
  ipcMain.handle('check-file-exists', async (_event, filePath: string) => {
    try {
      if (!filePath) return false;
      return fs.existsSync(filePath);
    } catch (e) {
      console.error("Check file exists error:", e);
      return false;
    }
  });

  ipcMain.handle('open-path', async (_event, pathStr: string) => {
    if (!pathStr || !fs.existsSync(pathStr)) {
      return { success: false, error: '路径不存在' };
    }
    shell.openPath(pathStr);
    return { success: true };
  });

  // IPC Handler to read a single file
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error("Read file error:", e);
      return null;
    }
  });

  // IPC Handler to read project config files (Sniff/Read only, no side effects)
  ipcMain.handle('read-project-folder', async (_event, folderPath: string) => {
    try {
      if (!fs.existsSync(folderPath)) return { error: "Folder not found" };

      const tryRead = (candidates: string[]) => {
        for (const relPath of candidates) {
          const p = path.join(folderPath, relPath);
          if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
        }
        return null;
      };

      return {
        datasetConfig: tryRead(['dataset.toml', path.join('dataset', 'dataset.toml')]),
        evalDatasetConfig: tryRead(['evaldataset.toml', path.join('dataset', 'evaldataset.toml')]),
        trainConfig: tryRead(['trainconfig.toml', path.join('train_config', 'trainconfig.toml')])
      };
    } catch (e: any) {
      console.error("Read project folder error:", e);
      return { error: e.message };
    }
  });

  // IPC: Explicitly lock the session output folder
  ipcMain.handle('set-session-folder', async (_event, folderPath: string | null) => {
    if (!folderPath) {
      cachedOutputFolder = null;
      console.log(`[Session] Cache cleared`);
      return { success: true };
    }
    if (fs.existsSync(folderPath)) {
      cachedOutputFolder = folderPath;
      console.log(`[Session] Explicitly locked to: ${folderPath}`);
      return { success: true };
    }
    return { success: false, error: "Invalid path" };
  });



  // IPC Handler to Cancel Download
  // Helper for date folder - CACHED per session
  let cachedOutputFolder: string | null = null;

  const getTodayOutputFolder = (projectRoot: string) => {
    // 如果已经有缓存的文件夹，直接返回
    if (cachedOutputFolder && fs.existsSync(cachedOutputFolder)) {
      return cachedOutputFolder;
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    // Format: YYYYMMDD_HH-MM-SS
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const outputDir = path.join(projectRoot, 'output', timestamp);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    cachedOutputFolder = outputDir;
    console.log(`[OutputFolder] Created session folder: ${outputDir}`);
    return outputDir;
  };

  // IPC: Create a brand new project with default configs
  ipcMain.handle('create-new-project', async () => {
    try {
      const { projectRoot } = resolveModelsRoot();

      // Reset cache to force a fresh folder
      cachedOutputFolder = null;
      const folder = getTodayOutputFolder(projectRoot);

      // Default contents
      const defaultTrain = `[model]
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
`;

      const defaultDataset = `[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
min_ar = 0.5
max_ar = 2.0
num_repeats = 1
`;

      const defaultEval = `[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
`;

      fs.writeFileSync(path.join(folder, 'trainconfig.toml'), defaultTrain, 'utf-8');
      fs.writeFileSync(path.join(folder, 'dataset.toml'), defaultDataset, 'utf-8');
      fs.writeFileSync(path.join(folder, 'evaldataset.toml'), defaultEval, 'utf-8');

      console.log(`[NewProject] Created at: ${folder}`);
      return { success: true, path: folder };
    } catch (e: any) {
      console.error("Create new project error:", e);
      return { success: false, error: e.message };
    }
  });

  // IPC: Save content to output/date/filename
  ipcMain.handle('save-to-date-folder', async (_event, args) => {
    try {
      const { filename, content } = args;
      const { projectRoot } = resolveModelsRoot(); // Re-use this helper to get workspace root
      const folder = getTodayOutputFolder(projectRoot);
      const filePath = path.join(folder, filename);

      fs.writeFileSync(filePath, content, 'utf-8');

      // Return path with forward slashes for consistency across platforms
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedFolder = folder.replace(/\\/g, '/');

      return { success: true, path: normalizedPath, folder: normalizedFolder };
    } catch (e: any) {
      console.error("Save to date folder error:", e);
      return { success: false, error: e.message };
    }
  });

  // IPC: Delete file from output/date/filename
  ipcMain.handle('delete-from-date-folder', async (_event, args) => {
    try {
      const { filename } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const filePath = path.join(folder, filename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (e: any) {
      console.error("Delete from date folder error:", e);
      return { success: false, error: e.message };
    }
  });

  // IPC: Copy file to output/date/filename
  ipcMain.handle('copy-to-date-folder', async (_event, args) => {
    try {
      const { sourcePath, filename } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const destPath = path.join(folder, filename || path.basename(sourcePath));

      fs.copyFileSync(sourcePath, destPath);
      return { success: true, path: destPath };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // IPC: Copy all .toml configs from a folder to output/date folder
  ipcMain.handle('copy-folder-configs-to-date', async (_event, args) => {
    try {
      const { sourceFolderPath } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const copiedFiles: string[] = [];

      // Check if source is a directory
      const stat = fs.statSync(sourceFolderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Source is not a directory' };
      }

      // Scan for common config files
      const configFiles = ['trainconfig.toml', 'dataset.toml', 'evaldataset.toml'];

      // 1. First pass: try exact matches
      for (const configFile of configFiles) {
        const srcPath = path.join(sourceFolderPath, configFile);
        if (fs.existsSync(srcPath)) {
          const destPath = path.join(folder, configFile);
          fs.copyFileSync(srcPath, destPath);
          copiedFiles.push(configFile);
          console.log(`[CopyConfigs] Copied exact match ${configFile}`);
        }
      }

      // 2. Second pass: scan for other .toml files if standard ones are missing
      const files = fs.readdirSync(sourceFolderPath);
      for (const file of files) {
        if (file.endsWith('.toml') && !configFiles.includes(file)) {
          const srcPath = path.join(sourceFolderPath, file);
          const content = fs.readFileSync(srcPath, 'utf-8');

          let targetName = '';

          // Simple sniffing
          if ((content.includes('[model]') && content.includes('type =')) || content.includes('training_arguments')) {
            targetName = 'trainconfig.toml';
          } else if (content.includes('[[datasets]]') || content.includes('[dataset]') || content.includes('[[directory]]')) {
            if (content.includes('enable_ar_bucket') && !copiedFiles.includes('dataset.toml')) {
              // If it contains bucket config and we don't have a dataset yet, treat as main dataset
              targetName = 'dataset.toml';
            } else if (!copiedFiles.includes('evaldataset.toml')) {
              // If we already have dataset.toml, or this doesn't have buckets, treat as eval
              // This covers the case where user uploads two similar files; first one becomes dataset, second becomes eval
              targetName = 'evaldataset.toml';
            } else if (!copiedFiles.includes('dataset.toml')) {
              // Fallback: if we found eval first (unlikely but possible), this one becomes dataset
              targetName = 'dataset.toml';
            }
          }

          if (targetName) {
            // Only overwrite if we didn't find the exact match already
            if (!copiedFiles.includes(targetName)) {
              const destPath = path.join(folder, targetName);
              fs.copyFileSync(srcPath, destPath);
              copiedFiles.push(targetName);
              console.log(`[CopyConfigs] Sniffed ${file} as ${targetName}`);
            }
          }
        }
      }

      // Also check subdirectories (dataset/, train_config/)
      const subDirs = ['dataset', 'train_config'];
      for (const subDir of subDirs) {
        const subDirPath = path.join(sourceFolderPath, subDir);
        if (fs.existsSync(subDirPath) && fs.statSync(subDirPath).isDirectory()) {
          const subFiles = fs.readdirSync(subDirPath);
          for (const file of subFiles) {
            if (file.endsWith('.toml')) {
              const srcPath = path.join(subDirPath, file);
              // If it's in train_config, assume trainconfig.toml if we don't have one
              let targetName = '';
              if (subDir === 'train_config') targetName = 'trainconfig.toml';
              if (subDir === 'dataset') targetName = 'dataset.toml'; // Simplification

              if (targetName && !copiedFiles.includes(targetName)) {
                const destPath = path.join(folder, targetName);
                fs.copyFileSync(srcPath, destPath);
                copiedFiles.push(targetName);
                console.log(`[CopyConfigs] Copied from subDir ${subDir}/${file} as ${targetName}`);
              } else {
                // Fallback: copy as is if we can't map it, but the UI might not read it
                const destPath = path.join(folder, file);
                fs.copyFileSync(srcPath, destPath);
                copiedFiles.push(file);
              }
            }
          }
        }
      }

      return { success: true, copiedFiles, outputFolder: folder };
    } catch (e: any) {
      console.error("Copy folder configs error:", e);
      return { success: false, error: e.message };
    }
  });



  // --- Training IPC ---
  let trainingProcess: ChildProcess | null = null;
  let trainingLogQueue: string[] = [];
  let currentLogFilePath: string | null = null;

  ipcMain.handle('list-resume-checkpoints', async (_event, configPath: string) => {
    if (!configPath || !fs.existsSync(configPath)) {
      throw new Error('Missing or invalid configPath');
    }
    return listTrainingCheckpoints(configPath);
  });

  ipcMain.handle('validate-resume-checkpoint', async (_event, { configPath, checkpointPath }: { configPath: string; checkpointPath: string }) => {
    if (!configPath || !fs.existsSync(configPath)) {
      return { valid: false, errorCode: 'checkpoint_invalid_config', message: '训练配置文件不存在。' };
    }
    if (typeof checkpointPath !== 'string' || !checkpointPath.trim()) {
      return { valid: true, path: '' };
    }
    return resolveResumeCheckpoint(configPath, checkpointPath);
  });

  ipcMain.handle('start-training', async (_event, args) => {
    if (trainingProcess) return { success: false, message: "训练已经在进行中" };

    return new Promise((resolve, reject) => {
      try {
        const {
          configPath,
          // Optional parameters from launcher (mapped from snake_case to camelCase)
          resume_from_checkpoint: resumeFromCheckpoint,
          reset_dataloader: resetDataloader,
          regenerate_cache: regenerateCache,
          trust_cache: trustCache,
          cache_only: cacheOnly,
          i_know_what_i_am_doing: forceIKnow,
          dump_dataset: dumpDataset,
          reset_optimizer_params: resetOptimizerParams,
          num_gpus: numGpus
        } = args;

        if (!configPath) {
          reject(new Error("Missing configPath"));
          return;
        }

        // Parse config to find base output dir
        let baseOutputDir = '';
        try {
          baseOutputDir = getTrainingOutputDirectory(configPath);
        } catch (e) {
          console.warn("[Training] Failed to parse config for output_dir:", e);
        }

        const configDir = path.dirname(configPath);
        const startTime = Date.now();
        currentLogFilePath = null; // Reset
        const logBuffer: string[] = [];
        let detectionAttempts = 0;
        const maxDetectionAttempts = 60; // 5 minutes (5s interval)

        const detectAndInitLog = () => {
          if (currentLogFilePath || !baseOutputDir || !fs.existsSync(baseOutputDir)) return;

          try {
            const dirs = fs.readdirSync(baseOutputDir).filter(f => {
              try {
                return fs.statSync(path.join(baseOutputDir, f)).isDirectory();
              } catch { return false; }
            });

            // Timestamp format YYYYMMDD_HH-MM-SS
            const sessions = dirs.filter(d => TRAINING_SESSION_NAME_PATTERN.test(d));
            if (sessions.length > 0) {
              const newest = sessions.sort().reverse()[0];
              const newestPath = path.join(baseOutputDir, newest);
              const stats = fs.statSync(newestPath);

              // If created after we started (with some buffer for clock skew)
              if (stats.birthtimeMs > startTime - 30000) {
                // SAVE IN PROJECT ROOT instead of inside newestPath
                currentLogFilePath = path.join(configDir, `${newest}.log`);
                console.log(`[Training] Detected session: ${newest}. Writing log to PROJECT ROOT: ${currentLogFilePath}`);
                // Flush buffer
                if (logBuffer.length > 0) {
                  fs.writeFileSync(currentLogFilePath, logBuffer.join('\n') + '\n', 'utf-8');
                  logBuffer.length = 0;
                }
              }
            }
          } catch (e) {
            console.error("[Training] Error detecting session folder:", e);
          }
        };

        const detectionInterval = setInterval(() => {
          detectionAttempts++;
          detectAndInitLog();
          if (currentLogFilePath || detectionAttempts >= maxDetectionAttempts || !trainingProcess) {
            clearInterval(detectionInterval);
          }
        }, 5000);

        const { projectRoot } = resolveModelsRoot();

        // Resolve Python
        const pythonExe = getPythonExe(projectRoot);
        if (!fs.existsSync(pythonExe) && pythonExe !== 'python') {
          reject(new Error(`Python interpreter not found at ${pythonExe}`));
          return;
        }

        // Resolve Train Script
        let scriptPath = '';
        const isLinux = process.platform === 'linux';
        scriptPath = resolveBackendPath(isLinux ? 'backend/core_linux/train.py' : 'backend/core/train.py');

        if (!fs.existsSync(scriptPath)) {
          console.error(`[Training] Script not found at ${scriptPath}`);
          reject(new Error(`Train script not found at ${scriptPath}`));
          return;
        }

        let validatedResumeCheckpoint = '';
        if (resumeFromCheckpoint && typeof resumeFromCheckpoint === 'string' && resumeFromCheckpoint.trim() !== '') {
          const inspection = resolveResumeCheckpoint(configPath, resumeFromCheckpoint);
          if (!inspection.valid) {
            resolve({
              success: false,
              code: inspection.errorCode,
              message: inspection.message || '检查点目录无效。'
            });
            return;
          }
          validatedResumeCheckpoint = inspection.path;
          currentLogFilePath = path.join(configDir, `${path.basename(validatedResumeCheckpoint)}.log`);
          clearInterval(detectionInterval);
          console.log(`[Training] Resume session detected. Appending log to: ${currentLogFilePath}`);
        }

        console.log(`[Training] Starting with Python: ${pythonExe}`);
        console.log(`[Training] Script: ${scriptPath}`);

        const pythonArgs = [scriptPath, '--config', configPath];

        if (validatedResumeCheckpoint) {
          pythonArgs.push('--resume_from_checkpoint', validatedResumeCheckpoint);
        }
        if (resetDataloader) pythonArgs.push('--reset_dataloader');
        if (resetOptimizerParams) pythonArgs.push('--reset_optimizer_params');
        if (cacheOnly) pythonArgs.push('--cache_only');
        if (forceIKnow) pythonArgs.push('--i_know_what_i_am_doing');

        if (regenerateCache) pythonArgs.push('--regenerate_cache');
        if (trustCache) pythonArgs.push('--trust_cache');

        pythonArgs.push('--deepspeed');

        if (dumpDataset && typeof dumpDataset === 'string' && dumpDataset.trim() !== '') {
          pythonArgs.push('--dump_dataset', dumpDataset.trim());
        }

        // Platform specific executable and final arguments
        let spawnExe = pythonExe;
        let spawnArgs = pythonArgs;

        if (isLinux) {
          // Linux uses standard deepspeed launcher if not on Windows
          const binDir = path.dirname(pythonExe);
          const deepspeedPath = path.join(binDir, 'deepspeed');
          spawnExe = fs.existsSync(deepspeedPath) ? deepspeedPath : 'deepspeed';
          spawnArgs = [`--num_gpus=${numGpus || 1}`, ...pythonArgs];
          console.log(`[Training] [Linux] Using deepspeed launcher: ${spawnExe}`);
        }

        const localSize = isLinux ? String(numGpus || 1) : '1';

        const timestamp = new Date().toLocaleString();
        const quoteIfSpace = (s: string) => s.includes(' ') ? `"${s}"` : s;
        const normalizedExe = spawnExe.replace(/\\/g, '/');
        const normalizedArgs = spawnArgs.map(arg => {
          // Force forward slashes for paths in the log display
          if (arg.includes('/') || arg.includes('\\')) {
            return quoteIfSpace(arg.replace(/\\/g, '/'));
          }
          return quoteIfSpace(arg);
        });
        const fullCommandStr = `[${timestamp}] [Command]: ${quoteIfSpace(normalizedExe)} ${normalizedArgs.join(' ')}`;

        console.log(`[Training] Launching: ${fullCommandStr}`);

        // Initialize log persistence BEFORE spawning
        trainingLogQueue = [fullCommandStr];

        if (currentLogFilePath) {
          try {
            fs.appendFileSync(currentLogFilePath, fullCommandStr + '\n', 'utf-8');
          } catch (err) {
            console.error("Failed to write command to session log:", err);
          }
        } else {
          logBuffer.push(fullCommandStr);
        }

        // Notify UI
        _event.sender.send('training-output', fullCommandStr);

        const cwd = path.dirname(scriptPath);

        const spawnedTrainingProcess = spawn(spawnExe, spawnArgs, {
          cwd: cwd,
          detached: process.platform !== 'win32', // Needed for process group killing on Linux
          env: {
            ...process.env,
            LOCAL_SIZE: localSize,
            LOCAL_WORLD_SIZE: localSize,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1'
          }
        });
        trainingProcess = spawnedTrainingProcess;

        _event.sender.send('training-status', { type: 'started', running: true, pid: spawnedTrainingProcess.pid });

        // Robust log reader with encoding support (GBK fallback for Windows)
        let stdoutLineBuffer = '';
        let stderrLineBuffer = '';

        // Use stateful decoders to handle split multi-byte characters
        const stdoutUtf8 = new TextDecoder('utf-8', { fatal: true });
        const stdoutGbk = new TextDecoder('gbk');
        const stderrUtf8 = new TextDecoder('utf-8', { fatal: true });
        const stderrGbk = new TextDecoder('gbk');

        const decodeChunk = (data: Buffer, utf8: TextDecoder, gbk: TextDecoder) => {
          try {
            // Try UTF-8 first (strict fatal check)
            return utf8.decode(data, { stream: true });
          } catch (e) {
            // Fallback to GBK on error (common on Windows CMD/Linker)
            try {
              return gbk.decode(data, { stream: true });
            } catch (e2) {
              // Final fallback to non-fatal UTF-8 (best effort)
              return new TextDecoder('utf-8').decode(data, { stream: true });
            }
          }
        };

        spawnedTrainingProcess.stdout?.on('data', (data: Buffer) => {
          const content = decodeChunk(data, stdoutUtf8, stdoutGbk);
          stdoutLineBuffer += content;

          // Handle lines and progress bars (carriage returns)
          if (stdoutLineBuffer.includes('\n') || stdoutLineBuffer.includes('\r')) {
            const parts = stdoutLineBuffer.split(/[\r\n]/);
            // Keep the last partial line in buffer
            stdoutLineBuffer = parts.pop() || '';

            parts.forEach(line => {
              if (line.trim()) {
                trainingLogQueue.push(line);
                _event.sender.send('training-output', line);
                console.log(`[Train]: ${line}`);

                // Extract speed: steps: 6 loss: 0.1961 iter time (s): 7.387 samples/sec: 0.541
                const speedMatch = line.match(/iter time \(s\):\s*([\d.]+)\s*samples\/sec:\s*([\d.]+)/);
                if (speedMatch) {
                  _event.sender.send('training-speed', {
                    iterTime: parseFloat(speedMatch[1]),
                    samplesPerSec: parseFloat(speedMatch[2])
                  });
                }

                if (currentLogFilePath) {
                  try {
                    fs.appendFileSync(currentLogFilePath, line + '\n', 'utf-8');
                  } catch (err) {
                    console.error("Failed to write to session log:", err);
                  }
                } else {
                  logBuffer.push(line);
                }
              }
            });
          }
        });

        spawnedTrainingProcess.stderr?.on('data', (data: Buffer) => {
          const content = decodeChunk(data, stderrUtf8, stderrGbk);
          stderrLineBuffer += content;

          if (stderrLineBuffer.includes('\n') || stderrLineBuffer.includes('\r')) {
            const parts = stderrLineBuffer.split(/[\r\n]/);
            stderrLineBuffer = parts.pop() || '';

            parts.forEach(line => {
              if (line.trim()) {
                trainingLogQueue.push(line);
                _event.sender.send('training-output', line);
                console.error(`[Train Err]: ${line}`);

                if (currentLogFilePath) {
                  try {
                    fs.appendFileSync(currentLogFilePath, `${line}\n`, 'utf-8');
                  } catch (err) {
                    console.error("Failed to write to session log:", err);
                  }
                } else {
                  logBuffer.push(`${line}`);
                }
              }
            });
          }
        });

        spawnedTrainingProcess.on('close', (code) => {
          console.log(`[Training] Exited with code ${code}`);
          if (trainingProcess === spawnedTrainingProcess) {
            trainingProcess = null;
            currentLogFilePath = null;
            const statusType = code === 0 ? 'finished' : 'error';
            _event.sender.send('training-status', { type: statusType, code, running: false });
          }
        });

        spawnedTrainingProcess.on('error', (err) => {
          console.error(`[Training] Spawn error: ${err}`);
          if (trainingProcess === spawnedTrainingProcess) {
            trainingProcess = null;
            currentLogFilePath = null;
            _event.sender.send('training-status', { type: 'error', message: err.message, running: false });
          }
        });

        resolve({ success: true, pid: spawnedTrainingProcess.pid });

      } catch (e: any) {
        console.error("[Training] Start exception:", e);
        reject(e);
      }
    });
  });

  ipcMain.handle('stop-training', async () => {
    if (trainingProcess) {
      console.log("[Training] Stopping...");
      const processToStop = trainingProcess;
      try {
        if (process.platform === 'win32' && processToStop.pid) {
          exec(`taskkill /pid ${processToStop.pid} /T /F`);
        } else if (process.platform === 'linux' && processToStop.pid) {
          // Kill the entire process group on Linux to clean up orphaned deepspeed children
          try {
            process.kill(-processToStop.pid, 'SIGKILL');
          } catch (e) {
            console.error("[Training] Process group kill failed, trying normal kill:", e);
            processToStop.kill('SIGKILL');
          }
        } else {
          processToStop.kill();
        }
        // Keep the process registered until its close/error event fires. This
        // prevents a new session from starting while the old process still owns
        // its checkpoint directory and GPU resources.
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, message: "No training running" };
  });

  ipcMain.handle('get-training-status', async () => {
    return {
      running: !!trainingProcess,
      pid: trainingProcess?.pid,
      currentLogFilePath: currentLogFilePath,
      logs: trainingLogQueue
    };
  });

  ipcMain.handle('get-training-logs', async (_event, logPath) => {
    if (!logPath) return [];
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8');
        return content.split('\n').filter(l => l.trim() !== '');
      }
      return [];
    } catch (e) {
      console.error("Failed to read session log:", e);
      return [];
    }
  });

  ipcMain.handle('get-training-sessions', async (_event, configPath) => {
    if (!configPath) return [];
    try {
      const configDir = path.dirname(configPath);

      if (!fs.existsSync(configDir)) return [];

      const files = fs.readdirSync(configDir).filter(f => {
        try {
          return f.endsWith('.log') && TRAINING_SESSION_NAME_PATTERN.test(f.slice(0, -4));
        } catch { return false; }
      });

      const sessions = files.sort().reverse();
      return sessions.map(file => {
        const logPath = path.join(configDir, file);
        const stats = fs.statSync(logPath);
        const id = file.replace('.log', '');
        return {
          id: id,
          path: logPath,
          timestamp: stats.birthtimeMs,
          hasLog: true
        };
      });
    } catch (e) {
      console.error("Failed to list training sessions:", e);
      return [];
    }
  });

  // IPC Handler to run python script and capture output (oneshot)
  ipcMain.handle('run-python-script-capture', async (_event, { scriptPath, args = [] }: { scriptPath: string, args: string[] }) => {
    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);

        // Handle path resolution
        let fullScriptPath = '';
        if (scriptPath.includes('/') || scriptPath.includes('\\')) {
          if (path.isAbsolute(scriptPath)) {
            fullScriptPath = scriptPath;
          } else {
            fullScriptPath = path.join(projectRoot, scriptPath);
          }
        } else {
          fullScriptPath = path.join(projectRoot, 'tools', scriptPath);
        }

        // Fallback check
        if (!fs.existsSync(fullScriptPath)) {
          resolve({ success: false, error: `Script not found: ${fullScriptPath}` });
          return;
        }

        const toolsDir = path.dirname(fullScriptPath);
        console.log(`[ScriptCapture] Running: ${pythonExe} ${fullScriptPath} ${args.join(' ')}`);

        const proc = spawn(pythonExe, [fullScriptPath, ...args], {
          cwd: toolsDir,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8'
          }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data.toString());
        proc.stderr.on('data', (data) => stderr += data.toString());

        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            stdout,
            stderr,
            code
          });
        });

        proc.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  });

  // --- Toolbox IPC ---
  let activeToolScriptName: string | null = null;
  let isManuallyStopped = false;
  ipcMain.handle('run-tool', async (_event, { scriptName, args = [], online = false }: { scriptName: string, args: string[], online?: boolean }) => {
    if (activeToolProcess) {
      return { success: false, error: "已有工具正在运行中" };
    }

    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);

        let scriptPath = '';
        let toolsDir = '';

        // Check if scriptName is already a path (relative or absolute)
        if (scriptName.includes('/') || scriptName.includes('\\')) {
          if (path.isAbsolute(scriptName)) {
            scriptPath = scriptName;
          } else {
            scriptPath = path.join(projectRoot, scriptName);
          }
          toolsDir = path.dirname(scriptPath);
        } else {
          // Default behavior: look in root/tools
          const rootToolsDir = path.join(projectRoot, 'tools');
          toolsDir = rootToolsDir;
          scriptPath = path.join(rootToolsDir, scriptName);
        }

        if (!fs.existsSync(scriptPath)) {
          resolve({ success: false, error: `找不到工具脚本: ${scriptPath}` });
          return;
        }

        toolLogBuffer = [];
        activeToolScriptName = scriptName;
        isManuallyStopped = false;
        console.log(`[Toolbox] Running: ${pythonExe} ${scriptPath} ${args.join(' ')}`);

        const env: any = {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        };

        if (!online) {
          env.HF_HUB_OFFLINE = '1';
          env.TRANSFORMERS_OFFLINE = '1';
        }

        activeToolProcess = spawn(pythonExe, [scriptPath, ...args], {
          cwd: toolsDir,
          env
        });

        // Helper to clean logs
        const cleanLog = (data: any) => {
          let str = data.toString();
          str = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

          // Normalize Windows newlines
          str = str.replace(/\r\n/g, '\n');

          // Handle progress bars (carriage return)
          if (str.includes('\r')) {
            // Split by \r and take the last non-empty part
            const parts = str.split('\r').filter((p: string) => p.trim().length > 0);
            if (parts.length > 0) {
              str = parts[parts.length - 1];
            } else {
              // If everything was filtered out (e.g. only \r), result is empty
              // But we might want to keep newlines if they existed before?
              // Simplest fix for now: if we have parts, take the last one.
              // If str resulted in empty after filter, it will be caught by the !str.trim() check below.
            }
          }
          return str;
        };

        activeToolProcess.stdout?.on('data', (data) => {
          const str = cleanLog(data);
          if (!str.trim()) return;
          console.log(`[Tool Out]: ${str}`);
          _event.sender.send('tool-output', str);
          toolLogBuffer.push(str);
          if (toolLogBuffer.length > 1000) toolLogBuffer.shift();
        });

        activeToolProcess.stderr?.on('data', (data) => {
          const str = cleanLog(data);
          if (!str.trim()) return;
          console.error(`[Tool Err]: ${str}`);
          _event.sender.send('tool-output', str);
          toolLogBuffer.push(str);
          if (toolLogBuffer.length > 1000) toolLogBuffer.shift();
        });

        activeToolProcess.on('close', (code) => {
          const timestamp = new Date().toLocaleTimeString();
          const isSuccess = code === 0 && !isManuallyStopped;
          const msg = `\n--- [${timestamp}] Task ${isSuccess ? 'Finished' : (isManuallyStopped ? 'Stopped' : 'Failed')} (Code ${code}) ---\n`;
          console.log(`[Toolbox] Process exited with code ${code}`);

          if (win) {
            win.webContents.send('tool-status', { type: 'finished', code, isSuccess, scriptName });
          }
          toolLogBuffer.push(msg); // Keep this line for logging the message
          activeToolProcess = null;
          activeToolScriptName = null;
          resolve({ success: isSuccess });
        });

        // Removed early resolve to wait for process completion

      } catch (e: any) {
        console.error("[Toolbox] Start failed:", e);
        resolve({ success: false, error: e.message });
      }
    });
  });

  ipcMain.handle('stop-tool', async () => {
    if (activeToolProcess) {
      try {
        if (process.platform === 'win32') {
          exec(`taskkill /pid ${activeToolProcess.pid} /T /F`);
        } else {
          activeToolProcess.kill('SIGKILL');
        }
        isManuallyStopped = true;
        activeToolProcess = null;
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
    return { success: true };
  });

  ipcMain.handle('get-tool-status', async () => {
    return { isRunning: !!activeToolProcess, pid: activeToolProcess?.pid, scriptName: activeToolScriptName };
  });

  ipcMain.handle('get-tool-logs', async () => {
    return toolLogBuffer;
  });



  const RECENT_PROJECTS_FILE = path.join(app.getPath('userData'), 'recent_projects.json');

  const loadRecentProjects = () => {
    try {
      if (fs.existsSync(RECENT_PROJECTS_FILE)) {
        const data = fs.readFileSync(RECENT_PROJECTS_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error("Failed to load recent projects:", e);
    }
    return [];
  };

  const saveRecentProjects = (projects: any[]) => {
    try {
      fs.writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
    } catch (e) {
      console.error("Failed to save recent projects:", e);
    }
  };

  const getVerifiedProjects = () => {
    let projects = loadRecentProjects();
    try {
      const { projectRoot } = resolveModelsRoot();
      const outputDir = path.join(projectRoot, 'output');

      if (fs.existsSync(outputDir)) {
        const entries = fs.readdirSync(outputDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = path.join(outputDir, entry.name);
            // Any subdirectory in output is considered a project
            const exists = projects.some((p: any) => path.relative(p.path, fullPath) === '');
            if (!exists) {
              projects.push({
                name: entry.name,
                path: fullPath,
                lastModified: fs.statSync(fullPath).mtime.toLocaleString()
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Error scanning output dir:", e);
    }

    // Prepare for sort and verification
    const verifiedProjects = [];
    for (const p of projects) {
      if (fs.existsSync(p.path)) {
        try {
          const stat = fs.statSync(p.path);
          p.timestamp = stat.mtime.getTime();
          p.lastModified = stat.mtime.toLocaleString();
          verifiedProjects.push(p);
        } catch (e) {
          verifiedProjects.push(p);
        }
      }
    }

    // Sort by timestamp descending
    verifiedProjects.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    return verifiedProjects;
  };

  ipcMain.handle('get-recent-projects', async () => {
    return getVerifiedProjects();
  });

  ipcMain.handle('add-recent-project', async (_event, project) => {
    const projects = loadRecentProjects();
    // Deduplicate by path
    const filtered = projects.filter((p: any) => p.path.toLowerCase() !== project.path.toLowerCase());
    // Add new at top
    filtered.unshift(project);
    // Limit history size to 20
    const limited = filtered.slice(0, 20);
    saveRecentProjects(limited);
    return getVerifiedProjects(); // Return full list including scanned
  });

  ipcMain.handle('remove-recent-project', async (_event, projectPath) => {
    const projects = loadRecentProjects();
    const filtered = projects.filter((p: any) => p.path.toLowerCase() !== projectPath.toLowerCase());
    saveRecentProjects(filtered);
    return getVerifiedProjects();
  });

  ipcMain.handle('delete-project-folder', async (_event, projectPath) => {
    try {
      // 1. Remove from history and settings
      const projects = loadRecentProjects();
      const filtered = projects.filter((p: any) => p.path.toLowerCase() !== projectPath.toLowerCase());
      saveRecentProjects(filtered);

      const settings = loadSettings();
      if (settings.projectLaunchParams) {
        const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
        if (settings.projectLaunchParams[normalized]) {
          delete settings.projectLaunchParams[normalized];
          saveSettings(settings);
        }
      }

      // 2. Delete folder from disk
      if (fs.existsSync(projectPath)) {
        await fs.promises.rm(projectPath, { recursive: true, force: true });
        return { success: true, projects: getVerifiedProjects() }; // Return fresh scan
      } else {
        return { success: false, error: "Path does not exist", projects: getVerifiedProjects() };
      }
    } catch (error: any) {
      console.error(`Failed to delete project folder: ${projectPath}`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rename-project-folder', async (_event, { oldPath, newName }) => {
    try {
      if (!fs.existsSync(oldPath)) {
        return { success: false, error: "Path does not exist" };
      }

      const parentDir = path.dirname(oldPath);
      const newPath = path.join(parentDir, newName);

      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        return { success: false, error: "Target name already exists" };
      }

      // Rename physical folder
      fs.renameSync(oldPath, newPath);

      // Update settings
      const settings = loadSettings();
      if (settings.projectLaunchParams) {
        const normalizedOld = oldPath.replace(/\\/g, '/').toLowerCase();
        const normalizedNew = newPath.replace(/\\/g, '/').toLowerCase();
        if (settings.projectLaunchParams[normalizedOld]) {
          settings.projectLaunchParams[normalizedNew] = settings.projectLaunchParams[normalizedOld];
          delete settings.projectLaunchParams[normalizedOld];
          saveSettings(settings);
          console.log(`[Rename] Migrated launch params from ${normalizedOld} to ${normalizedNew}`);
        }
      }

      // Update history
      let projects = loadRecentProjects();
      let updated = false;
      projects = projects.map((p: any) => {
        if (p.path.toLowerCase() === oldPath.toLowerCase()) {
          updated = true;
          return {
            ...p,
            name: newName,
            path: newPath,
            lastModified: new Date().toLocaleString()
          };
        }
        return p;
      });

      if (updated) {
        saveRecentProjects(projects);
      }

      return { success: true, newPath, projects: getVerifiedProjects() };

    } catch (error: any) {
      console.error(`Failed to rename project folder: ${oldPath}`, error);
      return { success: false, error: error.message };
    }
  });

})

