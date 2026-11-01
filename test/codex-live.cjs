// Opt-in integration test: runs one short real Codex turn using the local login.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
process.env.TERMINAL_TEST = '1';
process.env.NO_COLOR = '1';
const profileDir = path.join(__dirname, '../artifacts/codex-live-profile');
fs.mkdirSync(profileDir, { recursive: true });
fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({cwd:os.homedir(), profiles:[]}));
app.setPath('userData', profileDir);
const appRoot = process.env.SMOKE_APP ? path.resolve(path.dirname(process.env.SMOKE_APP), '..') : path.join(__dirname, '..');
const nativePty = require(path.join(appRoot, 'node_modules/node-pty'));
const originalSpawn = nativePty.spawn;
const lifecycle = [];
const codexColorSignals = new Set();
const sgrSignals = new Set();
nativePty.spawn = function(...args) {
  const terminal = originalSpawn(...args);
  let pending = '';
  terminal.onData(data => {
    pending = (pending + data).slice(-32768);
    const pattern = /\x1b\]7501;([^\x1b\x07]*)(?:\x07|\x1b\\)/g;
    let match;
    while ((match=pattern.exec(pending))) lifecycle.push(match[1]);
    if (lifecycle.length) {
      for (const sgr of pending.matchAll(/\x1b\[([0-9;:]+)m/g)) sgrSignals.add(sgr[1]);
      for (const color of pending.matchAll(/\x1b\[((?:38;(?:2;\d+;\d+;\d+|5;\d+))|(?:3[0-7]|9[0-7]))(?=;|m)/g)) codexColorSignals.add(color[1]);
    }
    const last = pending.lastIndexOf('\x1b]7501;');
    pending = last >= 0 && !/[\x07]/.test(pending.slice(last)) && !pending.slice(last).endsWith('\x1b\\') ? pending.slice(last) : pending.endsWith('\x1b') ? '\x1b' : '';
  });
  return terminal;
};
require(process.env.SMOKE_APP || '../src/main.cjs');
const timeout = setTimeout(() => {console.error('Real Codex test timed out', JSON.stringify(lifecycle));app.quit();app.exit(1);},100000);
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(win, expression, label, attempts=200) {
  for(let i=0;i<attempts;i++) {
    if(await win.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}; lifecycle=${JSON.stringify(lifecycle)}`);
}
app.whenReady().then(async()=>{
  const win=BrowserWindow.getAllWindows()[0];
  await waitFor(win, "typeof settings !== 'undefined' && settings.cwd", 'app ready');
  const id=await win.webContents.executeJavaScript('createSession().then(s=>s.id)');
  await waitFor(win, `sessions.get('${id}').activity.kind==='prompt'`, 'shell prompt');
  await win.webContents.executeJavaScript(`api.input('${id}', 'codex\\r')`);
  await waitFor(win, `sessions.get('${id}').activity.kind==='agent-idle'`, 'Codex idle before input',350);
  if (process.env.CODEX_COLOR_PROBE_ONLY === '1') {
    await delay(1200);
    console.log(JSON.stringify({sgrSignals:[...sgrSignals],colorSignals:[...codexColorSignals],lifecycle}));
    clearTimeout(timeout); app.quit(); return;
  }
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${id}').indicator.classList.contains('busy')`),false);
  await win.webContents.executeJavaScript(`api.input('${id}', 'Reply with exactly CODEX_STATUS_OK. Do not use tools.')`);
  await delay(800);
  await win.webContents.executeJavaScript(`api.input('${id}', '\\r')`);
  await waitFor(win, `sessions.get('${id}').activity.kind==='agent-working'`, 'Codex starts working',350);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${id}').indicator.classList.contains('busy')`),true);
  assert.match(win.getTitle(), /运行中/);
  await waitFor(win, `['agent-done','agent-idle'].includes(sessions.get('${id}').activity.kind)`, 'Codex turn finished',600);
  await delay(400);
  const screen = await win.webContents.executeJavaScript(`(()=>{const b=sessions.get('${id}').term.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString(true)).join('\\n');})()`);
  fs.writeFileSync(path.join(__dirname,'../artifacts/codex-live-screen.txt'),screen);
  await waitFor(win, `(()=>{const t=sessions.get('${id}').term; return [t.buffer.normal,t.buffer.alternate].some(b=>Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString()).some(line=>/^[\\s•·●-]*CODEX_STATUS_OK[.!]?\\s*$/.test(line)));})()`, 'actual successful Codex reply',100);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${id}').indicator.classList.contains('busy')`),false);
  assert.doesNotMatch(win.getTitle(), /运行中/);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${id}').alive`),true);
  assert.ok(codexColorSignals.size > 0, 'Real Codex must emit foreground color commands despite the host NO_COLOR=1; SGR='+JSON.stringify([...sgrSignals]));
  const result={realCodex:true,successfulReply:true,realCodexColors:true,colorSignalCount:codexColorSignals.size,colorSignals:[...codexColorSignals].slice(-12),initialIdle:true,workingSpinner:true,completionStopsSpinner:true,processStillAlive:true,lifecycle};
  fs.writeFileSync(path.join(__dirname,'../artifacts/codex-live-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  clearTimeout(timeout);app.quit();
}).catch(error=>{console.error(error);app.quit();app.exit(1);});
