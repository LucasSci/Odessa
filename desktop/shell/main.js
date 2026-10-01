/**
 * Odessa — o programa.
 *
 * Substitui o antigo launcher (start-odessa.vbs + .ps1, que abria uma aba no
 * navegador e ficava escondido reerguendo o servidor para sempre):
 *   - sobe o servidor local (python embutido + uvicorn) e mostra uma tela de
 *     "Iniciando…" até ele responder;
 *   - abre a interface numa janela própria, sem barra de endereço;
 *   - fechar a janela NÃO desliga: o Odessa segue no ícone perto do relógio
 *     (o overlay do OBS e as respostas no chat continuam);
 *   - "Desligar" (bandeja ou botão no app) para servidor, bridge do Tango e IA
 *     local pelo caminho limpo (POST /api/v1/system/shutdown) e fecha tudo;
 *   - se o servidor cair no meio da live, sobe de novo (até 5 quedas em 2 min).
 *
 * Instalado em <instalação>\app\Odessa.exe. Em desenvolvimento:
 *   ODESSA_DEV_URL=http://localhost:3000/ electron .   (não gerencia servidor)
 */
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, session, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const PORT = 8000;
// "localhost" de propósito (mesmo motivo do launcher antigo: CORS do frontend).
const APP_URL = process.env.ODESSA_DEV_URL || `http://localhost:${PORT}/`;
const APP_ORIGIN = new URL(APP_URL).origin;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const DEV = Boolean(process.env.ODESSA_DEV_URL);
const INSTALL_ROOT = app.isPackaged
  ? path.resolve(path.dirname(process.execPath), '..')
  : process.env.ODESSA_INSTALL_ROOT || path.resolve(__dirname, '..', '..');
const PY_EXE = fs.existsSync(path.join(INSTALL_ROOT, 'python', 'python.exe'))
  ? path.join(INSTALL_ROOT, 'python', 'python.exe')
  : path.join(INSTALL_ROOT, 'venv', 'Scripts', 'python.exe');
const ICON = path.join(__dirname, 'icon.ico');
const LOCAL_DIR = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Odessa');
const LOG_DIR = path.join(LOCAL_DIR, 'logs');

let mainWindow = null;
let splash = null;
let tray = null;
let backend = null; // processo do servidor que ESTE programa iniciou
let quitting = false;
let shuttingDown = false;
const crashes = [];

app.setAppUserModelId('studio.odessa.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(boot);
}

// A janela fechada não encerra o programa: ele vive na bandeja.
app.on('window-all-closed', () => {});

// ── Logs ───────────────────────────────────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
function rotate(file, maxBytes = 5 * 1024 * 1024, keep = 5) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < maxBytes) return;
    for (let i = keep - 1; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch { /* log não pode derrubar o programa */ }
}
['odessa.log', 'backend.out.log', 'backend.err.log'].forEach((n) => rotate(path.join(LOG_DIR, n)));
function log(msg) {
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'odessa.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* idem */ }
}

// ── Servidor ───────────────────────────────────────────────────────────────
function getJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function postJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', timeout: timeoutMs, headers: { 'Content-Length': 0 } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** /health com {"service":"odessa-api"} é a assinatura do nosso servidor. */
async function isOdessaUp() {
  const body = await getJson(HEALTH_URL);
  return Boolean(body && body.service === 'odessa-api');
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

/** .env com segredos gerados no primeiro uso (mesmo conteúdo do launcher antigo). */
function ensureEnvFile() {
  const envFile = path.join(INSTALL_ROOT, '.env');
  if (fs.existsSync(envFile)) return;
  const secret = () => crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  fs.writeFileSync(
    envFile,
    [`ODESSA_SESSION_SECRET=${secret()}`, `ODESSA_ADMIN_PASSWORD=${secret()}`, 'ODESSA_AUTH_DISABLED=1', 'AI_PROVIDER=ollama', ''].join('\n'),
    'utf8',
  );
  log('.env inicial gerado.');
}

function startBackend() {
  const out = fs.openSync(path.join(LOG_DIR, 'backend.out.log'), 'a');
  const err = fs.openSync(path.join(LOG_DIR, 'backend.err.log'), 'a');
  backend = spawn(PY_EXE, ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: INSTALL_ROOT,
    windowsHide: true,
    stdio: ['ignore', out, err],
    // PLAYWRIGHT_BROWSERS_PATH=0: o Chromium da bridge vem embutido no python\.
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0', ODESSA_DESKTOP: '1' },
  });
  log(`Servidor iniciado (pid ${backend.pid}).`);
  const proc = backend;
  proc.on('exit', (code) => onBackendExit(proc, code));
}

async function onBackendExit(proc, code) {
  if (proc !== backend) return;
  backend = null;
  log(`Servidor encerrou (código ${code}).`);
  if (quitting || shuttingDown) return;

  const now = Date.now();
  crashes.push(now);
  while (crashes.length && now - crashes[0] > 120_000) crashes.shift();
  try {
    fs.copyFileSync(path.join(LOG_DIR, 'backend.err.log'), path.join(LOG_DIR, 'backend.err.last-crash.log'));
  } catch { /* sem log para guardar */ }
  if (crashes.length >= 5) {
    log('Servidor caiu 5 vezes em 2 minutos: não vou reiniciar.');
    dialog.showErrorBox(
      'Odessa parou de funcionar',
      `O servidor do Odessa caiu várias vezes seguidas e não vai reiniciar sozinho.\n\nUse "Reiniciar servidor" no ícone perto do relógio. Se repetir, envie o log:\n${path.join(LOG_DIR, 'backend.err.log')}`,
    );
    return;
  }
  await new Promise((r) => setTimeout(r, Math.min(30_000, 2 ** crashes.length * 1000)));
  if (quitting || shuttingDown || (await isOdessaUp())) return;
  log(`Reiniciando servidor (queda ${crashes.length}).`);
  startBackend();
}

async function waitUntilUp(seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await isOdessaUp()) return true;
    if (!DEV && !backend) return false; // saiu antes de ficar pronto
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ── Janelas ────────────────────────────────────────────────────────────────
function createSplash() {
  splash = new BrowserWindow({
    width: 360, height: 240, frame: false, resizable: false, show: false, center: true,
    backgroundColor: '#050608', icon: ICON, skipTaskbar: false, title: 'Odessa',
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });
}

function setSplash(text) {
  if (splash) splash.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
function readWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { width: 1440, height: 900 }; }
}
function saveWindowState() {
  if (!mainWindow || mainWindow.isMinimized()) return;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }));
  } catch { /* não é crítico */ }
}

function isAppUrl(url) {
  try { return new URL(url).origin === APP_ORIGIN; } catch { return false; }
}

function createMain() {
  const state = readWindowState();
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960, minHeight: 640, show: false, title: 'Odessa', icon: ICON,
    backgroundColor: '#050608', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // Crítico: a resposta automática e o motor da live rodam aqui; com a
      // janela escondida na bandeja eles não podem desacelerar.
      backgroundThrottling: false,
    },
  });
  mainWindow.removeMenu();
  if (state.maximized) mainWindow.maximize();

  // Links externos abrem no navegador; arquivos do próprio Odessa, numa janela.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, backgroundColor: '#050608' } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (splash) splash.close();
  });
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Fechar = esconder na bandeja. Desligar é só pelo botão "Desligar".
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    saveWindowState();
    mainWindow.hide();
    const flag = path.join(app.getPath('userData'), 'tray-hint-shown');
    if (!fs.existsSync(flag) && tray) {
      tray.displayBalloon({
        title: 'O Odessa continua rodando',
        content: 'Ele fica aqui perto do relógio (overlay e chat seguem funcionando). Para desligar, use "Desligar Odessa".',
        iconType: 'info',
      });
      try { fs.writeFileSync(flag, '1'); } catch { /* aviso aparece de novo, sem problema */ }
    }
  });

  mainWindow.loadURL(APP_URL);
}

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('Odessa');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Odessa', click: showMain },
      { label: 'Reiniciar servidor', enabled: !DEV, click: () => void restartBackend() },
      { type: 'separator' },
      { label: 'Desligar Odessa', click: () => void shutdown({ confirmed: false }) },
    ]),
  );
  tray.on('double-click', showMain);
  tray.on('click', showMain);
}

// ── Desligar ───────────────────────────────────────────────────────────────
async function liveOnAir() {
  const health = await getJson(`http://127.0.0.1:${PORT}/api/v1/obs/live-health`, 6000);
  const t = health && health.transmission;
  return Boolean(t && (t.streamActive || t.virtualCameraActive));
}

function killTree(pid) {
  return new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()));
}

async function stopBackend() {
  const proc = backend;
  await postJson(`http://127.0.0.1:${PORT}/api/v1/system/shutdown`);
  for (let i = 0; i < 20; i++) {
    if (!(await isOdessaUp()) && (!proc || proc.exitCode !== null)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (proc && proc.exitCode === null) {
    log('Servidor não saiu sozinho: encerrando a árvore de processos.');
    await killTree(proc.pid);
  }
}

async function shutdown({ confirmed }) {
  if (shuttingDown) return;
  if (!confirmed && (await liveOnAir())) {
    const { response } = await dialog.showMessageBox(mainWindow && mainWindow.isVisible() ? mainWindow : null, {
      type: 'warning',
      buttons: ['Cancelar', 'Desligar mesmo assim'],
      defaultId: 0,
      cancelId: 0,
      title: 'Desligar o Odessa',
      message: 'A live está no ar.',
      detail: 'Desligar agora deixa o overlay do OBS vazio e para as respostas no chat.',
    });
    if (response !== 1) return;
  }
  shuttingDown = true;
  log('Desligando o Odessa.');
  if (mainWindow) mainWindow.hide();
  if (tray) tray.setToolTip('Odessa: desligando…');
  if (!DEV) await stopBackend();
  quitting = true;
  if (tray) tray.destroy();
  app.quit();
}

async function restartBackend() {
  shuttingDown = true; // segura o supervisor enquanto troca
  await stopBackend();
  shuttingDown = false;
  crashes.length = 0;
  startBackend();
  if (await waitUntilUp(45)) mainWindow && mainWindow.webContents.reload();
}

ipcMain.handle('odessa:shutdown', () => shutdown({ confirmed: true }));
ipcMain.on('odessa:hide', () => mainWindow && mainWindow.hide());

// ── Primeira vez: Ollama e OBS (o instalador não os empacota) ──────────────
function firstRunChecks() {
  const marker = (name) => path.join(LOCAL_DIR, name);
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const ollama =
    fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')) ||
    (process.env.PATH || '').split(';').some((d) => d && fs.existsSync(path.join(d, 'ollama.exe')));
  if (!ollama && !fs.existsSync(marker('ollama-prompt-shown'))) {
    shell.openExternal('https://ollama.com/download/windows');
    fs.writeFileSync(marker('ollama-prompt-shown'), '');
  }
  const obs = programFiles.some((p) => fs.existsSync(path.join(p, 'obs-studio', 'bin', '64bit', 'obs64.exe')));
  if (!obs && !fs.existsSync(marker('obs-prompt-shown'))) {
    shell.openExternal('https://obsproject.com/download');
    fs.writeFileSync(marker('obs-prompt-shown'), '');
  }
}

// ── Início ────────────────────────────────────────────────────────────────
async function boot() {
  createTray();
  // Baixar do Estúdio: "Salvar como" já com o nome automático do servidor.
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  if (DEV) {
    createMain();
    return;
  }

  createSplash();
  fs.mkdirSync(LOCAL_DIR, { recursive: true });

  if (await isOdessaUp()) {
    log('Servidor já estava no ar: só abrindo a janela.');
  } else if (await isPortInUse(PORT)) {
    log(`Porta ${PORT} ocupada por outro programa.`);
    dialog.showErrorBox(
      'Odessa: porta ocupada',
      `A porta ${PORT} está sendo usada por outro programa, então o Odessa não consegue iniciar.\n\nFeche esse programa (ou reinicie o computador) e abra o Odessa de novo.`,
    );
    quitting = true;
    app.quit();
    return;
  } else {
    if (!fs.existsSync(PY_EXE)) {
      dialog.showErrorBox('Odessa: instalação incompleta', `Não encontrei o Python do Odessa em:\n${PY_EXE}\n\nReinstale o Odessa.`);
      quitting = true;
      app.quit();
      return;
    }
    ensureEnvFile();
    setSplash('Iniciando o servidor…');
    startBackend();
    const ready = await waitUntilUp(45);
    if (!ready && !backend) {
      dialog.showErrorBox('Odessa: erro ao iniciar', `O servidor do Odessa não conseguiu iniciar. Veja o log em:\n${path.join(LOG_DIR, 'backend.err.log')}`);
      quitting = true;
      if (tray) tray.destroy();
      app.quit();
      return;
    }
    if (!ready) log('Servidor lento para responder (45 s): abrindo a janela mesmo assim.');
  }

  setSplash('Abrindo…');
  createMain();
  firstRunChecks();
}
