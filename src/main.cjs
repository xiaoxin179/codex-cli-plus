const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const pty = require('node-pty');
const { validDirectory, dimensions, shellArguments, terminalEnvironment } = require('./session.cjs');
const { ActivityTracker } = require('./activity.cjs');
const { createActivityLog } = require('./activity-log.cjs');
const { resolveLaunch, cleanTitle } = require('./terminal-utils.js');
const sessionTree = require('./session-tree.cjs');
const { createDiscovery, sessionId } = require('./workspace-discovery.cjs');
const discover = createDiscovery(process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex'));
const { loadSettings } = require('./settings.cjs');
const { badgeBitmap } = require('./badge.cjs');
function startupMarker(value) {
  if (typeof value !== 'string') return null;
  const resolved = path.resolve(value), directory = path.dirname(resolved);
  return path.basename(resolved) === 'startup.ready' &&
    path.basename(directory).startsWith('codex-cli-plus-') &&
    path.dirname(directory).toLowerCase() === path.resolve(require('node:os').tmpdir()).toLowerCase() ? resolved : null;
}
const launcherReadyFile = startupMarker(process.env.CODEX_CLI_PLUS_READY_FILE);
// Keep settings stable while giving each release its own process lock. A newly
// launched update must not be redirected into an older, still-running binary.
const settingsDirectory = app.getPath('userData');
const runtimeDirectory = path.join(settingsDirectory, 'runtime', app.getVersion());
const activityLog = createActivityLog(path.join(runtimeDirectory, 'diagnostics'), app.getVersion());
fs.mkdirSync(runtimeDirectory, { recursive: true });
app.setPath('userData', runtimeDirectory);
app.setAppUserModelId('com.local.codexcliplus');
const windows = new Map();
let settings = {}, settingsPath;
let badgeCount = -1, badgeImage = null;
function updateBadge() {
  const count = [...windows.values()].reduce((total, state) => total + state.unreadCount, 0);
  if (count !== badgeCount) {
    badgeCount = count;
    badgeImage = count ? nativeImage.createFromBitmap(badgeBitmap(count), { width: 32, height: 32 }) : null;
  }
  for (const state of windows.values()) {
    if (state.win.isDestroyed() || state.badgeCount === count) continue;
    state.win.setOverlayIcon(badgeImage, count ? `${count} 个会话回复已完成，未查看` : '');
    state.badgeCount = count;
  }
}
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
  activityLog.record(id, { event: 'session-close', lastState: session.activity.state.kind });
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
function createWindow(profile, startup = null, readyFile = null) {
  const win = new BrowserWindow({
    show: !startup && !readyFile,
    width: 1180, height: 800, minWidth: 760, minHeight: 480,
    title: 'Codex CLI Plus', icon: settings.icon && fs.existsSync(settings.icon) ? settings.icon : path.join(__dirname, '../assets/icon.ico'),
    backgroundColor: '#14171f', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const state = { win, sessions: new Map(), profile, busy: false, activeId: null, unreadCount: 0, badgeCount: -1 };
  windows.set(win.webContents.id, state);
  if (startup || readyFile) {
    let finished = false;
    const reveal = (ready = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(state.startupTimeout);
      if (!win.isDestroyed()) win.show();
      if (startup && !startup.isDestroyed()) startup.destroy();
      if (readyFile) {
        try { fs.writeFileSync(readyFile, ready ? 'ready' : 'error'); } catch (error) { console.error('Startup acknowledgement failed:', error.message); }
      }
    };
    state.reveal = reveal;
    state.startupTimeout = setTimeout(() => {
      reveal();
      if (!win.isDestroyed()) dialog.showMessageBox(win, {type:'warning', title:'启动较慢', message:'工作台还未准备好', detail:'你可以等待片刻，或关闭窗口后重新打开。'});
    }, 20000);
    win.webContents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      reveal();
      dialog.showMessageBox(win, {type:'error', title:'启动失败', message:'无法加载工作台', detail:description});
    });
    win.once('closed', reveal);
    startup?.once('closed', () => { if (!finished && !win.isDestroyed()) win.close(); });
  }
  updateBadge();
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
    for (const id of [...state.sessions.keys()]) stop(state, id);
    state.sessions.clear();
    windows.delete(senderId);
    updateBadge();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return state;
}
const primary = process.env.TERMINAL_TEST === '1' || app.requestSingleInstanceLock({readyFile:launcherReadyFile});
if (!primary) app.quit();
else {
  app.on('second-instance', (_event, _argv, _cwd, data) => { if (app.isReady()) createWindow(undefined, null, startupMarker(data?.readyFile)); });
  app.whenReady().then(async () => {
    let startup = null;
    if (process.env.TERMINAL_TEST !== '1' && !launcherReadyFile) {
      startup = new BrowserWindow({
        width:440, height:280, frame:false, resizable:false, maximizable:false,
        title:'正在启动 · Codex CLI Plus', backgroundColor:'#171d27',
        icon:path.join(__dirname, '../assets/icon.ico'),
        webPreferences:{contextIsolation:true, nodeIntegration:false, sandbox:true}
      });
      // Render feedback before loading settings or constructing the full UI.
      try { await startup.loadFile(path.join(__dirname, 'startup.html')); }
      catch { if (!startup.isDestroyed()) startup.destroy(); startup = null; }
      if (startup?.isDestroyed()) return;
    }
    settingsPath = path.join(settingsDirectory, 'settings.json');
    settings = loadSettings(settingsDirectory, path.join(app.getPath('appData'), 'codex-terminal'));
    settings.cwd = validDirectory(settings.cwd);
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    createWindow(undefined, startup, launcherReadyFile);
    refreshWorkspaces().catch(error => console.error('Workspace discovery:', error.message));
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const state of windows.values()) {
    state.allowClose = true;
    for (const id of [...state.sessions.keys()]) stop(state, id);
  }
});
app.on('will-quit', () => activityLog.flush());
ipcMain.handle('settings:get', event => ({ cwd: settings.cwd, profiles: settings.profiles, tree: sessionTree.normalize(settings.tree, settings.profiles), initialProfile: owner(event).profile || null }));
ipcMain.on('window:ready', event => { owner(event).reveal?.(true); });
ipcMain.handle('window:new', (event, profileId) => {
  owner(event);
  createWindow(settings.profiles.find(p => p.id === profileId));
});
ipcMain.handle('directory:choose', async event => {
  const result = await dialog.showOpenDialog(owner(event).win, { title: '选择工作目录', defaultPath: settings.cwd, properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
function broadcastProfiles() {
  settings.tree = sessionTree.normalize(settings.tree, settings.profiles);
  for (const state of windows.values()) send(state, 'tree:changed', { profiles: settings.profiles, tree: settings.tree });
  for (const state of windows.values()) send(state, 'profiles:changed', settings.profiles);
}
let refreshPending;
function refreshWorkspaces() {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    const found = await discover(settings.profiles);
    // Apply to current profiles after I/O, so edits and deletions are never undone.
    for (const profile of settings.profiles) {
      const value = found.get(sessionId(profile));
      if (value) profile.workspaceCwd = value.cwd;
      profile.workspaceError = value ? '' : found.errors.get(sessionId(profile)) || '';
    }
    settings.tree = sessionTree.normalize(settings.tree, settings.profiles);
    saveSettings(); broadcastProfiles();
    return { identified: settings.profiles.filter(p => p.cwd || p.workspaceCwd).length, unresolved: settings.profiles.filter(p => !p.cwd && !p.workspaceCwd).length };
  })().finally(() => { refreshPending = null; });
  return refreshPending;
}
ipcMain.handle('workspaces:refresh', event => { owner(event); return refreshWorkspaces(); });
ipcMain.handle('workspace:lookup', async (event, input) => {
  owner(event);
  const profile = resolveLaunch({ sessionId: input });
  return (await discover([profile])).get(sessionId(profile))?.cwd || '';
});
ipcMain.handle('tree:change', (event, input = {}) => {
  owner(event);
  const previous = settings.tree;
  settings.tree = sessionTree.change(settings.tree, settings.profiles, input, randomUUID());
  try { saveSettings(); } catch (error) { settings.tree = previous; throw error; }
  broadcastProfiles();
  return settings.tree;
});
ipcMain.handle('profile:save', async (event, input = {}) => {
  owner(event);
  const launch = resolveLaunch(input);
  if (input.favorite && !launch.sessionId) throw new Error('请填写当前会话 ID');
  if (input.favorite && !input.id) {
    const existing = settings.profiles.find(p => sessionId(p) === launch.sessionId.toLowerCase());
    if (existing) input = { ...input, id: existing.id };
  }
  const name = (typeof input.name === 'string' ? input.name.trim() : '') || (launch.sessionId ? `Codex · ${launch.sessionId.slice(0, 8)}` : '');
  if (!name) throw new Error('请填写会话名称或会话 ID');
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  if (cwd && (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) throw new Error('工作目录不存在');
  const profile = { id: settings.profiles.some(p => p.id === input.id) ? input.id : randomUUID(), name: name.slice(0, 80), cwd, ...launch };
  const found = await discover([profile]);
  profile.workspaceCwd = found.get(sessionId(profile))?.cwd || '';
  profile.workspaceError = found.errors.get(sessionId(profile)) || '';
    const existingIndex = settings.profiles.findIndex(p => p.id === profile.id);
    if (existingIndex < 0) settings.profiles.push(profile);
    else settings.profiles[existingIndex] = profile;
  if (profile.cwd) settings.cwd = profile.cwd;
  saveSettings(); broadcastProfiles();
  return profile;
});
ipcMain.handle('profile:delete', (event, id) => {
  owner(event);
  settings.profiles = settings.profiles.filter(p => p.id !== id);
  saveSettings(); broadcastProfiles();
});
ipcMain.handle('profile:move', (event, input = {}) => {
  owner(event);
  const {id, targetId} = input || {};
  if (typeof id !== 'string' || typeof targetId !== 'string') throw new Error('无效的会话排序');
  const previous = settings.profiles;
  const from = previous.findIndex(p => p.id === id), to = previous.findIndex(p => p.id === targetId);
  if (from < 0 || to < 0) throw new Error('会话列表已更新，请重新拖动');
  if (from === to) return previous;
  const next = previous.slice();
  const [profile] = next.splice(from, 1);
  next.splice(to, 0, profile);
  settings.profiles = next;
  try { saveSettings(); } catch (error) { settings.profiles = previous; throw error; }
  broadcastProfiles();
  return next;
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
  const requestedCwd = (profile ? profile.cwd || profile.workspaceCwd : options.cwd) || settings.cwd;
  const cwd = validDirectory(requestedCwd);
  if (profile && (profile.cwd || profile.workspaceCwd) && cwd !== requestedCwd) return { ok: false, error: '会话的工作目录已不存在，请先编辑此会话或刷新目录。' };
  const title = profile ? profile.name : path.basename(cwd) || 'PowerShell';
  try {
    const command = resolveLaunch(profile || {}).command;
    const activity = new ActivityTracker(value => {
      if (!state.sessions.has(id)) return;
      send(state, 'terminal:activity', { id, ...value });
      updateWindow(state);
    }, details => activityLog.record(id, details));
    const terminal = pty.spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), shellArguments(command), {
      name: 'xterm-256color', ...dimensions(options.cols, options.rows), cwd,
      env: terminalEnvironment(process.env, app.getVersion()), useConpty: true, useConptyDll: true
    });
    state.sessions.set(id, { pty: terminal, activity, title });
    activityLog.record(id, { event: 'session-start' });
    if (command) activity.set(true, 'foreground', '程序运行中');
    terminal.onData(data => {
      if (!state.sessions.has(id)) return;
      activity.output(data);
      send(state, 'terminal:data', { id, data });
    });
    terminal.onExit(({ exitCode }) => {
      if (!state.sessions.has(id)) return;
      activityLog.record(id, { event: 'session-exit', exitCode, lastState: activity.state.kind });
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
ipcMain.on('notification:count', (event, count) => {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000) return;
  owner(event).unreadCount = count;
  updateBadge();
});
ipcMain.on('terminal:input', (event, { id, data } = {}) => {
  const session = owner(event).sessions.get(id);
  if (session && typeof data === 'string' && data.length <= 1024 * 1024) { session.activity.input(data); session.pty.write(data); }
});
ipcMain.on('terminal:resize', (event, { id, cols, rows } = {}) => {
  const session = owner(event).sessions.get(id);
  if (session) { const size = dimensions(cols, rows); try { session.pty.resize(size.cols, size.rows); } catch {} }
});
