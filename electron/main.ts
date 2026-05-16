import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, shell, session, Tray } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.DIST_ELECTRON = __dirname;
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist');
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST;

const API_PORT = Number(process.env.ODESSA_API_PORT || (app.isPackaged ? 8765 : 8000));
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
process.env.ODESSA_API_PORT = String(API_PORT);
const IS_BACKGROUND_RUNTIME = app.isPackaged && process.argv.includes('--background-runtime');

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendLogFile = '';
let desktopBootLogFile = '';
let backendReady = false;
let lastBackendFailure: string | null = null;
let tray: Tray | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function rootDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function userLogDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function desktopLogFile() {
  if (!desktopBootLogFile) {
    desktopBootLogFile = path.join(userLogDir(), `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  }
  return desktopBootLogFile;
}

function logDesktopBoot(message: string, metadata: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    uptimeMs: Math.round(process.uptime() * 1000),
    message,
    ...metadata,
  });
  fs.appendFile(desktopLogFile(), `${line}\n`, () => undefined);
}

function runtimePaths() {
  const root = rootDir();
  const pythonBase = app.isPackaged ? path.join(root, 'python') : path.join(root, 'venv');
  const pythonExe = process.platform === 'win32'
    ? path.join(pythonBase, 'Scripts', 'python.exe')
    : path.join(pythonBase, 'bin', 'python');
  return {
    root,
    serverDir: path.join(root, 'server'),
    pythonExe,
    logDir: userLogDir(),
  };
}

function appIconPath() {
  const iconPath = path.join(rootDir(), 'assets', 'branding', 'odessa-icon.ico');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function appendBackendLog(line: string) {
  if (!backendLogFile) return;
  fs.appendFile(backendLogFile, line, () => undefined);
}

function waitForHealth(timeoutMs = 20000): Promise<boolean> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(`${API_ORIGIN}/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 500);
    };

    tick();
  });
}

function getJson(pathname: string, timeoutMs = 1500): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = http.get(`${API_ORIGIN}${pathname}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function getCompatibleRuntimeStatus(timeoutMs = 1000) {
  const status = await getJson('/desktop/ready', timeoutMs);
  if (!status?.coreReady) return null;
  const runtimeRoot = status.runtimeRoot;
  if (typeof runtimeRoot === 'string' && path.resolve(runtimeRoot) === path.resolve(rootDir())) {
    return status;
  }
  if (!runtimeRoot && !app.isPackaged) {
    return status;
  }
  logDesktopBoot('ignoring-incompatible-runtime', { runtimeRoot, expectedRoot: rootDir(), pid: status.pid });
  return null;
}

function postJson(pathname: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      `${API_ORIGIN}${pathname}`,
      { method: 'POST' },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300));
      },
    );
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function ensureBackend() {
  const compatibleRuntime = await getCompatibleRuntimeStatus(800);
  if (compatibleRuntime) {
    backendReady = true;
    logDesktopBoot('backend-reused', { pid: compatibleRuntime.pid, uptimeMs: compatibleRuntime.uptimeMs });
    return true;
  }
  if (backendProcess) return waitForHealth(3000);

  const paths = runtimePaths();
  backendLogFile = path.join(paths.logDir, `backend-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  if (!fs.existsSync(paths.pythonExe)) {
    appendBackendLog(`[desktop] Python runtime not found: ${paths.pythonExe}\n`);
    backendReady = false;
    return false;
  }

  const env = {
    ...process.env,
    ODESSA_DESKTOP: '1',
    ODESSA_USER_DATA_DIR: app.getPath('userData'),
    ODESSA_RUNTIME_ROOT: paths.root,
    ODESSA_PYTHON_EXE: paths.pythonExe,
    PYTHONPATH: paths.root,
  };

  logDesktopBoot('backend-spawn', { pythonExe: paths.pythonExe, root: paths.root, port: API_PORT });
  backendProcess = spawn(
    paths.pythonExe,
    ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', String(API_PORT)],
    {
      cwd: paths.root,
      env,
      windowsHide: true,
    },
  );

  backendProcess.stdout.on('data', (data) => appendBackendLog(String(data)));
  backendProcess.stderr.on('data', (data) => {
    const text = String(data);
    appendBackendLog(text);
    if (text.includes('Controle de Aplicativo') || text.includes('App Control') || text.includes('DLL load failed')) {
      lastBackendFailure = text.slice(0, 1000);
    }
  });
  backendProcess.on('exit', (code, signal) => {
    appendBackendLog(`[desktop] Backend exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    if (code !== 0 && !lastBackendFailure) {
      lastBackendFailure = `Backend saiu antes de ficar pronto. code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    }
    logDesktopBoot('backend-exit', { code, signal });
    backendProcess = null;
  });

  const spawnedProcess = backendProcess;
  backendReady = await Promise.race([
    waitForHealth(),
    new Promise<boolean>((resolve) => {
      spawnedProcess.once('exit', () => resolve(false));
    }),
  ]);
  logDesktopBoot('backend-health-result', { ready: backendReady });
  return backendReady;
}

function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill();
  backendProcess = null;
}

function showMainWindow() {
  if (!mainWindow) {
    void createWindow({ show: true });
    return;
  }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray || !app.isPackaged) return;
  const icon = appIconPath();
  if (!icon) return;
  tray = new Tray(icon);
  tray.setToolTip('Odessa');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Odessa', click: showMainWindow },
      { label: 'Aquecer runtime', click: () => void ensureRuntimeWarm() },
      {
        label: 'Sair',
        click: () => {
          stopBackend();
          app.exit(0);
        },
      },
    ]),
  );
  tray.on('click', showMainWindow);
}

function registerDesktopIpc() {
  ipcMain.handle('odessa:runtime-status', async () => {
    const paths = runtimePaths();
    return {
      ok: await waitForHealth(1500),
      apiOrigin: API_ORIGIN,
      packaged: app.isPackaged,
      platform: process.platform,
      pythonExe: paths.pythonExe,
      serverDir: paths.serverDir,
      logDir: paths.logDir,
      backendLogFile,
      lastBackendFailure,
      pythonRuntimeFound: fs.existsSync(paths.pythonExe),
      serverFound: fs.existsSync(paths.serverDir),
      readiness: await getJson('/desktop/ready'),
    };
  });

  ipcMain.handle('odessa:list-capture-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 420, height: 240 },
      fetchWindowIcons: true,
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnail: source.thumbnail?.isEmpty() ? null : source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
  });

  ipcMain.handle('odessa:open-logs', async () => {
    await shell.openPath(userLogDir());
    return { ok: true, path: userLogDir() };
  });
}

async function createWindow(options: { show?: boolean } = {}) {
  const preloadPath = path.join(__dirname, 'preload.mjs');
  const shouldShow = options.show !== false;

  logDesktopBoot('window-create-start', { show: shouldShow, backgroundRuntime: IS_BACKGROUND_RUNTIME });
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Odessa',
    icon: appIconPath(),
    backgroundColor: '#060b12',
    show: shouldShow,
    skipTaskbar: !shouldShow,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: preloadPath,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logDesktopBoot('window-did-finish-load', { show: shouldShow });
    mainWindow?.webContents.send('odessa:backend-status', { ok: backendReady, apiOrigin: API_ORIGIN, logFile: backendLogFile });
    if (shouldShow) {
      mainWindow?.show();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    logDesktopBoot('window-load-url', { url: process.env.VITE_DEV_SERVER_URL });
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    logDesktopBoot('window-load-file', { file: path.join(process.env.DIST!, 'index.html') });
    void mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (app.isPackaged) {
      event.preventDefault();
      mainWindow?.hide();
      mainWindow?.setSkipTaskbar(true);
      return;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function ensureRuntimeWarm(level: 'core' | 'heavy' = 'core') {
  const ready = await ensureBackend();
  mainWindow?.webContents.send('odessa:backend-status', { ok: ready, apiOrigin: API_ORIGIN, logFile: backendLogFile });
  if (ready) {
    logDesktopBoot('warmup-request', { level });
    void postJson(`/desktop/warmup?level=${level}`, 2500);
  }
}

app.whenReady().then(() => {
  logDesktopBoot('app-ready', { packaged: app.isPackaged, backgroundRuntime: IS_BACKGROUND_RUNTIME });
  registerDesktopIpc();
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--background-runtime'],
      name: 'Odessa Runtime',
    });
  }
  createTray();
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      callback({ video: sources[0] });
    }).catch(() => callback({}));
  });
  void createWindow({ show: !IS_BACKGROUND_RUNTIME });
  void ensureRuntimeWarm(IS_BACKGROUND_RUNTIME ? 'heavy' : 'core');
});

app.on('second-instance', () => {
  logDesktopBoot('second-instance');
  showMainWindow();
  void ensureRuntimeWarm('core');
});

app.on('before-quit', () => {
  if (!app.isPackaged) {
    stopBackend();
  }
});

app.on('window-all-closed', () => {
  mainWindow = null;
  if (!app.isPackaged) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
