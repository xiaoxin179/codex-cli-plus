const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const pty = require('node-pty');
const { validDirectory, dimensions, shellArguments, terminalEnvironment } = require('./session.cjs');
const { ActivityTracker } = require('./activity.cjs');
const { resolveLaunch, cleanTitle } = require('./terminal-utils.js');
const { loadSettings } = require('./settings.cjs');
// Keep settings stable while giving each release its own process lock. A newly
// launched update must not be redirected into an older, still-running binary.
const settingsDirectory = app.getPath('userData');
const runtimeDirectory = path.join(settingsDirectory, 'runtime', app.getVersion());
fs.mkdirSync(runtimeDirectory, { recursive: true });
app.setPath('userData', runtimeDirectory);
app.setAppUserModelId('com.local.codexcliplus');
const windows = new Map();
let settings = {}, settingsPath;
function saveSettings() { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8'); }
function send(state, event, data) {
  if (!state.win.isDestroyed()) state.win.webContents.send(event, data);
}
function owner(event) {
  const state = windows.get(event.sender.id);
  if (!state) throw new Error('窗口已关闭');
  return state;
}
function stop(state, id) {
  const session = state.sessions.get(id);
  if (!session) return;
  state.sessions.delete(id);
  try { session.pty.kill(); } catch {}
  updateWindow(state);
}
function updateWindow(state) {
  if (state.win.isDestroyed()) return;
  const busy = [...state.sessions.values()].filter(s => s.activity.state.busy).length;
  const active = state.sessions.get(state.activeId);
  state.win.setTitle(`${busy ? `[${busy} 个运行中] ` : ''}${active ? active.title : '首页'} · Codex CLI Plus`);
  state.busy = busy > 0;
}
function createWindow(profile) {
  const win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 760, minHeight: 480,
    title: 'Codex CLI Plus', icon: settings.icon && fs.existsSync(settings.icon) ? settings.icon : path.join(__dirname, '../assets/icon.ico'),
    backgroundColor: '#14171f', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const state = { win, sessions: new Map(), profile, busy: false, activeId: null };
  windows.set(win.webContents.id, state);
  const senderId = win.webContents.id;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (state.sessions.size && !state.allowClose) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', title: '关闭窗口', message: `关闭此窗口的 ${state.sessions.size} 个会话？`, detail: '其中运行的程序也会结束，其他窗口不受影响。', buttons: ['取消', '关闭窗口'], defaultId: 0, cancelId: 0 });
      if (choice === 0) event.preventDefault();
    }
  });
  win.on('closed', () => {
    for (const session of state.sessions.values()) { try { session.pty.kill(); } catch {} }
    state.sessions.clear();
    windows.delete(senderId);
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return state;
}
const primary = process.env.TERMINAL_TEST === '1' || app.requestSingleInstanceLock();
if (!primary) app.quit();
else {
  app.on('second-instance', () => { if (app.isReady()) createWindow(); });
  app.whenReady().then(() => {
    settingsPath = path.join(settingsDirectory, 'settings.json');
    settings = loadSettings(settingsDirectory, path.join(app.getPath('appData'), 'codex-terminal'));
    settings.cwd = validDirectory(settings.cwd);
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const state of windows.values()) {
    state.allowClose = true;
    for (const id of [...state.sessions.keys()]) stop(state, id);
  }
});
ipcMain.handle('settings:get', event => ({ cwd: settings.cwd, profiles: settings.profiles, initialProfile: owner(event).profile || null }));
ipcMain.handle('window:new', (event, profileId) => {
  owner(event);
  createWindow(settings.profiles.find(p => p.id === profileId));
});
ipcMain.handle('directory:choose', async event => {
  const result = await dialog.showOpenDialog(owner(event).win, { title: '选择工作目录', defaultPath: settings.cwd, properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
function broadcastProfiles() {
  for (const state of windows.values()) send(state, 'profiles:changed', settings.profiles);
}
ipcMain.handle('profile:save', (event, input = {}) => {
  owner(event);
  const launch = resolveLaunch(input);
  const name = (typeof input.name === 'string' ? input.name.trim() : '') || (launch.sessionId ? `Codex · ${launch.sessionId.slice(0, 8)}` : '');
  if (!name) throw new Error('请填写会话名称或会话 ID');
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  if (cwd && (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) throw new Error('工作目录不存在');
  const profile = { id: settings.profiles.some(p => p.id === input.id) ? input.id : randomUUID(), name: name.slice(0, 80), cwd, ...launch };
  settings.profiles = settings.profiles.filter(p => p.id !== profile.id).concat(profile);
  if (profile.cwd) settings.cwd = profile.cwd;
  saveSettings(); broadcastProfiles();
  return profile;
});
ipcMain.handle('profile:delete', (event, id) => {
  owner(event);
  settings.profiles = settings.profiles.filter(p => p.id !== id);
  saveSettings(); broadcastProfiles();
});
ipcMain.handle('icon:choose', async event => {
  const result = await dialog.showOpenDialog(owner(event).win, { title: '选择任务栏图标', properties: ['openFile'], filters: [{ name: '图标', extensions: ['ico', 'png'] }] });
  if (result.canceled) return false;
  const source = result.filePaths[0], icon = nativeImage.createFromPath(source);
  if (icon.isEmpty()) throw new Error('无法读取该图标。');
  const target = path.join(settingsDirectory, `custom-icon${path.extname(source).toLowerCase()}`);
  if (source !== target) fs.copyFileSync(source, target);
  settings.icon = target; saveSettings();
  for (const state of windows.values()) state.win.setIcon(icon);
  return true;
});
ipcMain.handle('terminal:create', (event, options = {}) => {
  const state = owner(event), id = randomUUID();
  const profile = settings.profiles.find(p => p.id === options.profileId);
  const requestedCwd = (profile ? profile.cwd : options.cwd) || settings.cwd;
  const cwd = validDirectory(requestedCwd);
  if (profile?.cwd && cwd !== profile.cwd) return { ok: false, error: '保存的工作目录已不存在，请先编辑此会话。' };
  const title = profile ? profile.name : path.basename(cwd) || 'PowerShell';
  try {
    const command = resolveLaunch(profile || {}).command;
    const activity = new ActivityTracker(value => {
      if (!state.sessions.has(id)) return;
      send(state, 'terminal:activity', { id, ...value });
      updateWindow(state);
    });
    const terminal = pty.spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), shellArguments(command), {
      name: 'xterm-256color', ...dimensions(options.cols, options.rows), cwd,
      env: terminalEnvironment(process.env, app.getVersion()), useConpty: true, useConptyDll: true
    });
    state.sessions.set(id, { pty: terminal, activity, title });
    if (command) activity.set(true, 'foreground', '程序运行中');
    terminal.onData(data => {
      if (!state.sessions.has(id)) return;
      activity.output(data);
      send(state, 'terminal:data', { id, data });
    });
    terminal.onExit(({ exitCode }) => {
      if (!state.sessions.has(id)) return;
      state.sessions.delete(id);
      send(state, 'terminal:exit', { id, exitCode });
      updateWindow(state);
    });
    return { ok: true, id, cwd, title, pid: terminal.pid };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('terminal:close', (event, id) => { stop(owner(event), id); });
ipcMain.on('terminal:title', (event, { id, title } = {}) => {
  const state = owner(event), session = state.sessions.get(id);
  if (!session || typeof title !== 'string') return;
  const clean = cleanTitle(title);
  if (!clean || clean === session.title) return;
  session.title = clean;
  updateWindow(state);
});
ipcMain.on('terminal:active', (event, id) => { const state = owner(event); state.activeId = id; updateWindow(state); });
ipcMain.on('terminal:input', (event, { id, data } = {}) => {
  const session = owner(event).sessions.get(id);
  if (session && typeof data === 'string' && data.length <= 1024 * 1024) { session.activity.input(data); session.pty.write(data); }
});
ipcMain.on('terminal:resize', (event, { id, cols, rows } = {}) => {
  const session = owner(event).sessions.get(id);
  if (session) { const size = dimensions(cols, rows); try { session.pty.resize(size.cols, size.rows); } catch {} }
});
