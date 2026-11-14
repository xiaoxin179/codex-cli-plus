const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const profile = path.resolve('artifacts', `startup-check-${process.pid}`);
fs.mkdirSync(profile, {recursive:true});
fs.writeFileSync(path.join(profile,'settings.json'), JSON.stringify({cwd:process.cwd(),profiles:[]}));
app.setPath('userData', profile);
const launcherMode = process.env.STARTUP_LAUNCHER_CHECK === '1';
const markerDirectory = launcherMode ? fs.mkdtempSync(path.join(require('node:os').tmpdir(),'codex-cli-plus-')) : null;
const marker = markerDirectory && path.join(markerDirectory,'startup.ready');
if (marker) process.env.CODEX_CLI_PLUS_READY_FILE = marker;
else delete process.env.CODEX_CLI_PLUS_READY_FILE;
delete process.env.TERMINAL_TEST;
require(process.env.SMOKE_APP || '../src/main.cjs');
const readyHandlers = ipcMain.listeners('window:ready');
let failureMessage = null;
dialog.showMessageBox = async (_win, options) => { failureMessage = options; return {response:0}; };
ipcMain.removeAllListeners('window:ready');
let pendingReady;
ipcMain.on('window:ready', event => { pendingReady = event; });
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const timeout = setTimeout(() => { console.error('Startup check timed out'); app.exit(1); },15000);
app.whenReady().then(async () => {
  for (let n=0; n<100 && !pendingReady; n++) await delay(100);
  assert.ok(pendingReady, 'homepage reports readiness');
  const all = BrowserWindow.getAllWindows();
  const splash = all.find(w => w.webContents.getURL().endsWith('/startup.html'));
  const main = all.find(w => w.webContents.getURL().endsWith('/index.html'));
  assert.ok(main);
  if (launcherMode) {
    assert.equal(splash, undefined, 'native launcher owns progress; no second splash');
    assert.equal(main.isVisible(), false);
    assert.equal(fs.existsSync(marker), false, 'no readiness signal before homepage ready');
    for (const handler of readyHandlers) handler(pendingReady);
    assert.equal(main.isVisible(), true);
    assert.equal(fs.readFileSync(marker,'utf8'), 'ready');
    fs.rmSync(markerDirectory,{recursive:true});
    clearTimeout(timeout); main.destroy();
    console.log(JSON.stringify({launcherReadiness:true,hiddenUntilReady:true,noDuplicateSplash:true}));
    app.exit(0); return;
  }
  assert.ok(splash);
  assert.equal(splash.isVisible(),true);
  assert.equal(main.isVisible(),false,'main stays hidden until initialized');
  assert.equal(await splash.webContents.executeJavaScript("getComputedStyle(document.querySelector('.track span')).animationName"),'travel');
  const first = await splash.webContents.executeJavaScript("getComputedStyle(document.querySelector('.track span')).transform");
  await delay(180);
  assert.notEqual(await splash.webContents.executeJavaScript("getComputedStyle(document.querySelector('.track span')).transform"),first,'loading bar animates');
  fs.writeFileSync(path.join(profile,'startup.png'),(await splash.webContents.capturePage()).toPNG());
  if (process.env.STARTUP_FAILURE_CHECK === '1') {
    await main.loadFile(path.join(profile, 'missing-page.html')).catch(() => {});
    assert.equal(failureMessage?.title, '启动失败');
  } else {
    for (const handler of readyHandlers) handler(pendingReady);
  }
  await delay(100);
  assert.equal(splash.isDestroyed(),true);
  assert.equal(main.isVisible(),true);
  if (!process.env.STARTUP_FAILURE_CHECK) assert.equal(await main.webContents.executeJavaScript("document.querySelector('#home').hidden"),false);
  console.log(JSON.stringify({startupVisible:true,animated:true,waitsForHome:true,automaticTransition:true,failureHandled:!!failureMessage,screenshot:path.join(profile,'startup.png')}));
  clearTimeout(timeout);
  main.destroy();
  app.exit(0);
}).catch(error => {console.error(error); app.exit(1);});
