/* global Terminal, FitAddon */
const api = window.desktop;
const element = id => document.getElementById(id);
const sessions = new Map();
const pending = new Map();
const closed = new Set();
let activeId = null, settings = { profiles: [] }, editingId = null;
const storedSize = Number(localStorage.getItem('terminalFontSize'));
let fontSize = storedSize >= 8 && storedSize <= 48 ? storedSize : 14;
function report(error) { element('status').textContent = error.message || String(error); }
function activeSession() { return sessions.get(activeId); }
function refit(session = activeSession()) {
  if (!session || session.panel.hidden) return;
  session.fit.fit();
  if (session.alive) api.resize(session.id, { cols: session.term.cols, rows: session.term.rows });
}
function setFontSize(size) {
  fontSize = Math.max(8, Math.min(48, size));
  localStorage.setItem('terminalFontSize', String(fontSize));
  for (const session of sessions.values()) session.term.options.fontSize = fontSize;
  element('font-size').textContent = `${fontSize}px`;
  refit();
}
function updateStatus() {
  const session = activeSession();
  element('status').textContent = session ? session.activity.label : `首页 · ${sessions.size} 个会话`;
  element('cwd').textContent = session ? session.cwd : '';
  element('cwd').title = session ? session.cwd : '';
  element('font-size').textContent = session ? `${fontSize}px` : '';
}
function selectSession(id) {
  activeId = id;
  element('home').hidden = Boolean(id);
  element('home-tab').classList.toggle('selected', !id);
  for (const session of sessions.values()) {
    session.panel.hidden = session.id !== id;
    session.tab.classList.toggle('selected', session.id === id);
    session.selectButton.setAttribute('aria-selected', String(session.id === id));
  }
  api.active(id);
  updateStatus();
  requestAnimationFrame(() => { refit(); activeSession()?.term.focus(); });
}
function updateActivity(session, activity) {
  session.activity = activity;
  session.indicator.classList.toggle('busy', activity.busy);
  session.indicator.classList.toggle('ended', !session.alive);
  session.indicator.title = activity.label;
  session.selectButton.title = `${session.title} · ${activity.label}\n${session.cwd}`;
  if (session.id === activeId) updateStatus();
}
function updateTitle(session, title) {
  const clean = TerminalUtils.cleanTitle(title);
  session.title = clean || session.initialTitle;
  session.label.textContent = session.title;
  session.panel.setAttribute('aria-label', session.title);
  session.closeButton.setAttribute('aria-label', `关闭 ${session.title}`);
  session.selectButton.title = `${session.title} · ${session.activity.label}\n${session.cwd}`;
  api.setTitle(session.id, session.title);
}
function queue(id, event) {
  if (closed.has(id)) return;
  const events = pending.get(id) || [];
  events.push(event);
  pending.set(id, events);
}
function deliver(session, event) {
  if (event.type === 'data') session.term.write(event.data);
  if (event.type === 'activity') updateActivity(session, event);
  if (event.type === 'exit') {
    session.alive = false;
    updateActivity(session, { busy: false, kind: 'ended', label: `已结束 · ${event.exitCode}` });
    session.term.writeln(`\r\n[会话已结束，退出码 ${event.exitCode}]`);
  }
}
api.onData(event => { const s = sessions.get(event.id); if (s) deliver(s, { ...event, type: 'data' }); else queue(event.id, { ...event, type: 'data' }); });
api.onActivity(event => { const s = sessions.get(event.id); if (s) deliver(s, { ...event, type: 'activity' }); else queue(event.id, { ...event, type: 'activity' }); });
api.onExit(event => { const s = sessions.get(event.id); if (s) deliver(s, { ...event, type: 'exit' }); else queue(event.id, { ...event, type: 'exit' }); });
async function closeSession(id, force = false) {
  const session = sessions.get(id);
  if (!session) return;
  if (!force && session.alive && !window.confirm(`关闭“${session.title}”？其中运行的程序也会结束。`)) return;
  await api.close(id);
  closed.add(id); pending.delete(id); sessions.delete(id);
  session.term.dispose(); session.panel.remove(); session.tab.remove();
  if (activeId === id) selectSession([...sessions.keys()].at(-1) || null);
  else updateStatus();
}
async function createSession(profile) {
  try {
    const result = await api.create({ profileId: profile?.id, cols: 100, rows: 30 });
    if (!result.ok) throw new Error(result.error);
    const panel = document.createElement('section');
    panel.className = 'terminal-panel'; panel.setAttribute('aria-label', result.title);
    element('panels').append(panel);
    const term = new Terminal({ cursorBlink: true, fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize,
      scrollback: 10000, theme: { background: '#0B0C0A', foreground: '#e6e8e2', cursor: '#00E676', selectionBackground: '#314632' } });
    const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(panel);
    const tab = document.createElement('div'); tab.className = 'tab';
    const selectButton = document.createElement('button'); selectButton.className = 'tab-select'; selectButton.setAttribute('role', 'tab');
    const indicator = document.createElement('span'); indicator.className = 'indicator'; indicator.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 8; index++) {
      const dot = document.createElement('span'); dot.className = 'indicator-dot';
      dot.style.setProperty('--step', String(index)); indicator.append(dot);
    }
    const label = document.createElement('span'); label.className = 'tab-label';
    const number = [...sessions.values()].filter(s => s.baseTitle === result.title).length + 1;
    const title = number > 1 ? `${result.title} · ${number}` : result.title;
    label.textContent = title;
    selectButton.append(indicator, label);
    const close = document.createElement('button'); close.className = 'close-tab'; close.setAttribute('aria-label', `关闭 ${title}`);
    close.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    tab.append(selectButton, close); element('tabs').append(tab);
    const session = { ...result, baseTitle: result.title, initialTitle: title, title, panel, term, fit, tab, indicator, label, closeButton: close, selectButton, alive: true, activity: { busy: false, kind: 'starting', label: '启动中' } };
    sessions.set(result.id, session);
    selectButton.onclick = () => selectSession(result.id);
    close.onclick = () => closeSession(result.id).catch(report);
    term.onData(data => { if (session.alive) api.input(session.id, data); });
    term.onTitleChange(title => updateTitle(session, title));
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey) return true;
      if (event.shiftKey && event.code === 'KeyC') {
        if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(report);
        return false;
      }
      if (event.shiftKey && event.code === 'KeyV') {
        navigator.clipboard.readText().then(text => term.paste(text)).catch(report); return false;
      }
      if (['Equal', 'Minus', 'Digit0'].includes(event.code)) {
        event.preventDefault(); setFontSize(event.code === 'Digit0' ? 14 : fontSize + (event.code === 'Equal' ? 1 : -1)); return false;
      }
      return true;
    });
    panel.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.deltaY) setFontSize(fontSize + (event.deltaY < 0 ? 1 : -1));
    }, { passive: false, capture: true });
    for (const event of pending.get(result.id) || []) deliver(session, event);
    pending.delete(result.id);
    selectSession(result.id);
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return session;
  } catch (error) { report(error); throw error; }
}
function button(text, action, className = '') {
  const b = document.createElement('button'); b.textContent = text; b.className = className;
  b.onclick = () => Promise.resolve().then(action).catch(report);
  return b;
}
function renderProfiles() {
  element('profiles').replaceChildren();
  element('empty-hint').hidden = settings.profiles.length > 0;
  for (const profile of settings.profiles) {
    const card = document.createElement('article'); card.className = 'profile';
    const title = document.createElement('h2'); title.textContent = profile.name;
    const directory = document.createElement('p'); directory.textContent = profile.cwd || '未指定工作目录';
    const command = document.createElement('p'); command.className = 'command'; command.textContent = profile.command || 'PowerShell 命令行';
    const actions = document.createElement('div'); actions.className = 'profile-actions';
    actions.append(button('打开', () => createSession(profile), 'primary'), button('独立窗口', () => api.newWindow(profile.id)),
      button('编辑', () => editProfile(profile), 'quiet'), button('删除', () => {
        if (window.confirm(`删除常用会话“${profile.name}”？已打开的终端不受影响。`)) return api.deleteProfile(profile.id);
      }, 'quiet'));
    card.append(title, directory, command, actions); element('profiles').append(card);
  }
}
function editProfile(profile) {
  editingId = profile?.id || null;
  element('profile-heading').textContent = profile ? '编辑常用会话' : '添加常用会话';
  element('profile-name').value = profile?.name || '';
  element('profile-cwd').value = profile?.cwd || '';
  element('profile-session-id').value = profile?.sessionId || '';
  element('profile-command').readOnly = false;
  element('profile-command').value = profile?.sessionId ? '' : profile?.command || '';
  updateLaunchPreview();
  element('profile-error').textContent = '';
  element('profile-dialog').showModal();
}
let customCommand = '';
function updateLaunchPreview() {
  const command = element('profile-command');
  const sessionId = element('profile-session-id').value.trim();
  if (sessionId) {
    if (!command.readOnly) customCommand = command.value;
    command.readOnly = true;
    try { command.value = TerminalUtils.resolveLaunch({ sessionId }).command; }
    catch { command.value = ''; }
    command.placeholder = '填写完整的会话 ID 后自动生成恢复命令';
  } else {
    if (command.readOnly) command.value = customCommand;
    command.readOnly = false;
    command.placeholder = '留空进入命令行，例如 codex 或 npm run dev';
  }
}
element('profile-session-id').oninput = updateLaunchPreview;
element('profile-form').onsubmit = async event => {
  event.preventDefault(); element('save-profile').disabled = true;
  try {
    await api.saveProfile({ id: editingId, name: element('profile-name').value, sessionId: element('profile-session-id').value, cwd: element('profile-cwd').value, command: element('profile-command').value });
    element('profile-dialog').close();
  } catch (error) { element('profile-error').textContent = error.message; }
  finally { element('save-profile').disabled = false; }
};
element('browse-directory').onclick = async () => { try { const cwd = await api.chooseDirectory(); if (cwd) element('profile-cwd').value = cwd; } catch (error) { report(error); } };
element('cancel-profile').onclick = () => element('profile-dialog').close();
element('add-profile').onclick = () => editProfile();
element('home-tab').onclick = () => selectSession(null);
element('new-tab').onclick = element('blank-terminal').onclick = () => createSession().catch(report);
element('new-window').onclick = () => api.newWindow().catch(report);
element('icon-button').onclick = () => { element('settings-menu').open = false; api.chooseIcon().catch(report); };
api.onProfiles(profiles => { settings.profiles = profiles; renderProfiles(); });
new ResizeObserver(() => refit()).observe(element('workspace'));
document.addEventListener('keydown', event => {
  if (!event.ctrlKey || !event.shiftKey || element('profile-dialog').open) return;
  if (!['KeyT', 'KeyN', 'KeyH', 'KeyW'].includes(event.code)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.code === 'KeyT') createSession().catch(report);
  if (event.code === 'KeyN') api.newWindow().catch(report);
  if (event.code === 'KeyH') selectSession(null);
  if (event.code === 'KeyW' && activeId) closeSession(activeId).catch(report);
}, true);
api.settings().then(value => {
  settings = value; renderProfiles(); selectSession(null);
  if (value.initialProfile) return createSession(value.initialProfile);
}).catch(report);
