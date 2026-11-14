// Opt-in local CLI check. Types into the composer without submitting a turn.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
process.env.TERMINAL_TEST = '1';
const profile = path.join(__dirname, `../artifacts/newline-profile-${process.pid}`);
fs.mkdirSync(profile, {recursive:true});
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({cwd:path.resolve(__dirname, '..'),profiles:[]}));
const codexHome = path.join(profile, 'codex');
fs.mkdirSync(codexHome, {recursive:true});
process.env.CODEX_HOME = codexHome;
// Placeholder for the isolated local provider, never a real account credential.
fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({OPENAI_API_KEY:'local-keyboard-check-placeholder'}));
fs.writeFileSync(path.join(codexHome, 'config.toml'), `model = "keyboard-check"
model_provider = "keyboard-check"
[model_providers.keyboard-check]
name = "Local keyboard check"
base_url = "http://127.0.0.1:9"
wire_api = "responses"
requires_openai_auth = false
[projects.${JSON.stringify(path.resolve(__dirname, '..'))}]
trust_level = "trusted"
`);
app.setPath('userData', profile);
require('../src/main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => { console.error('Codex newline check timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const wait = async (expression, label) => {
    for (let n = 0; n < 150; n++) {
      if (await win.webContents.executeJavaScript(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await wait('typeof settings !== "undefined" && settings.cwd', 'app ready');
  const id = await win.webContents.executeJavaScript('createSession().then(s=>s.id)');
  await wait(`sessions.get('${id}').activity.kind==='prompt'`, 'shell ready');
  const command = `& '${process.env.CODEX_BINARY.replace(/'/g, "''")}' --no-daemon --no-alt-screen\r`;
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(id)},${JSON.stringify(command)})`);
  const screen = `(()=>{const t=sessions.get('${id}').term;const b=t.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString(true)).join('\\n')})()`;
  await wait(`(${screen}).includes('Ask Codex')`, 'Codex composer');
  await delay(3000);
  win.show(); win.focus();
  await wait('document.hasFocus()', 'composer focus');
  await win.webContents.executeJavaScript(`api.input('${id}','NEWLINE_FIRST')`);
  await delay(200);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return',modifiers:['shift']});
  await delay(200);
  await win.webContents.executeJavaScript(`api.input('${id}','NEWLINE_SECOND')`);
  await delay(500);
  const text = await win.webContents.executeJavaScript(screen);
  fs.writeFileSync(path.join(profile, 'composer.txt'), text);
  assert.doesNotMatch(text, /Thinking|Working|Reconnecting|stream disconnected/, 'Shift+Enter must not submit a turn');
  assert.match(text, /NEWLINE_FIRST[^\n]*\n[^\n]*NEWLINE_SECOND/, 'composer contains two separate lines');
  console.log(JSON.stringify({realCodex:true,shiftEnterNewline:true,noTurnSubmitted:true}));
  clearTimeout(timer);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.exit(1); });
