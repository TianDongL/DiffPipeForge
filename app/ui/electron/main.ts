import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn, exec, ChildProcess } from 'child_process'
import fs from 'fs'
import { parse } from 'smol-toml'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- Application Logging Setup ---
const APP_ROOT_DIR = app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '../../..');
const LOG_DIR = path.join(APP_ROOT_DIR, 'logs');
const APP_LOG_PATH = path.join(LOG_DIR, 'app.log');

const resolveBackendPath = (subPath: string): string => {
  return path.join(APP_ROOT_DIR, 'app', subPath);
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


function createWindow() {
  console.log("createWindow called");
  win = new BrowserWindow({
    width: 1200,
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
      // In Dev: APP_ROOT is app/ui, so ../.. gives the true workspace root
      projectRoot = path.resolve(process.env.APP_ROOT, '../..');
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

    // 2. Check for Conda environment (Matches start.py method 1)
    if (process.env.CONDA_PREFIX) {
      const condaPython = path.join(process.env.CONDA_PREFIX, 'python.exe');
      if (fs.existsSync(condaPython)) {
        console.log(`[PythonLookup] Detected Conda environment: ${process.env.CONDA_DEFAULT_ENV}`);
        return condaPython;
      }
    }

    // 3. Check for Virtual Environment (Matches start.py method 2)
    if (process.env.VIRTUAL_ENV) {
      const venvPython = path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe');
      if (fs.existsSync(venvPython)) {
        console.log(`[PythonLookup] Detected Virtual Env: ${process.env.VIRTUAL_ENV}`);
        return venvPython;
      }
    }

    // 4. Try embedded_DP in project root or parent (Matches start.py priority)
    const searchDirs = [projectRoot, path.dirname(projectRoot)];
    for (const dir of searchDirs) {
      const embeddedDP = path.join(dir, 'python_embeded_DP', 'python.exe');
      if (fs.existsSync(embeddedDP)) {
        console.log(`[PythonLookup] Found embedded_DP in ${dir}: ${embeddedDP}`);
        return embeddedDP;
      }
    }

    // 5. Try standard local python folder
    const localPython = path.join(projectRoot, 'python', 'python.exe');
    if (fs.existsSync(localPython)) {
      console.log(`[PythonLookup] Found local python: ${localPython}`);
      return localPython;
    }

    // 6. Packaged specific locations
    if (app.isPackaged) {
      const resourcesPython = path.join(process.resourcesPath, 'python', 'python.exe');
      if (fs.existsSync(resourcesPython)) return resourcesPython;
    }

    return 'python';
  };

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

    return {
      success: true,
      path: pythonExe || '',
      displayName,
      status: isReady ? 'ready' : 'missing',
      isInternal: pythonExe === embeddedDP,
      availableEnvs
    };
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

      return {
        success: true,
        path: pythonExe || '',
        displayName,
        status: isReady ? 'ready' : 'missing',
        isInternal: pythonExe === embeddedDP
      };
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
          reset_optimizer_params: resetOptimizerParams
        } = args;

        if (!configPath) {
          reject(new Error("Missing configPath"));
          return;
        }

        // Parse config to find base output dir
        let baseOutputDir = '';
        try {
          const configContent = fs.readFileSync(configPath, 'utf8');
          const config: any = parse(configContent);
          baseOutputDir = config.output_dir;
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
            const sessions = dirs.filter(d => /^\d{8}_\d{2}-\d{2}-\d{2}$/.test(d));
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
        scriptPath = resolveBackendPath('backend/core/train.py');

        if (!fs.existsSync(scriptPath)) {
          console.error(`[Training] Script not found at ${scriptPath}`);
          reject(new Error(`Train script not found at ${scriptPath}`));
          return;
        }

        console.log(`[Training] Starting with Python: ${pythonExe}`);
        console.log(`[Training] Script: ${scriptPath}`);

        const pythonArgs = [scriptPath, '--config', configPath];

        if (resumeFromCheckpoint && typeof resumeFromCheckpoint === 'string' && resumeFromCheckpoint.trim() !== '') {
          pythonArgs.push('--resume_from_checkpoint', resumeFromCheckpoint.trim());
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

        const timestamp = new Date().toLocaleString();
        const quoteIfSpace = (s: string) => s.includes(' ') ? `"${s}"` : s;
        const normalizedExe = pythonExe.replace(/\\/g, '/');
        const normalizedArgs = pythonArgs.map(arg => {
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
        logBuffer.push(fullCommandStr);

        if (currentLogFilePath) {
          try {
            fs.appendFileSync(currentLogFilePath, fullCommandStr + '\n', 'utf-8');
          } catch (err) {
            console.error("Failed to write command to session log:", err);
          }
        }

        // Notify UI
        _event.sender.send('training-output', fullCommandStr);

        const cwd = path.dirname(scriptPath);

        trainingProcess = spawn(pythonExe, pythonArgs, {
          cwd: cwd,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1'
          }
        });

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

        trainingProcess.stdout?.on('data', (data: Buffer) => {
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

        trainingProcess.stderr?.on('data', (data: Buffer) => {
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

        trainingProcess.on('close', (code) => {
          console.log(`[Training] Exited with code ${code}`);
          trainingProcess = null;
          _event.sender.send('training-status', { type: 'finished', code });
        });

        trainingProcess.on('error', (err) => {
          console.error(`[Training] Spawn error: ${err}`);
          trainingProcess = null;
          _event.sender.send('training-status', { type: 'error', message: err.message });
        });

        resolve({ success: true, pid: trainingProcess.pid });

      } catch (e: any) {
        console.error("[Training] Start exception:", e);
        reject(e);
      }
    });
  });

  ipcMain.handle('stop-training', async () => {
    if (trainingProcess) {
      console.log("[Training] Stopping...");
      try {
        if (process.platform === 'win32' && trainingProcess.pid) {
          exec(`taskkill /pid ${trainingProcess.pid} /T /F`);
        } else {
          trainingProcess.kill();
        }
        trainingProcess = null;
        currentLogFilePath = null;
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
          return f.endsWith('.log') && /^\d{8}_\d{2}-\d{2}-\d{2}\.log$/.test(f);
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

