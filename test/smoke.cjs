const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
process.env.TERMINAL_TEST = '1';
process.env.NO_COLOR = '1';
process.env.FORCE_COLOR = '0';
process.env.TERM = 'dumb';
const profileDir = path.join(__dirname, '../artifacts/smoke-profile-v3');
fs.mkdirSync(profileDir, { recursive: true });
const stubDir = path.join(profileDir, 'bin');
fs.mkdirSync(stubDir, {recursive:true});
const argvFile = path.join(profileDir, 'resume-argv.json');
fs.rmSync(argvFile, {force:true});
process.env.TERMINAL_ARGV_FILE = argvFile;
process.env.PATH = stubDir + path.delimiter + process.env.PATH;
fs.writeFileSync(path.join(stubDir, 'codex.cmd'), `@echo off\r\nnode "${path.join(__dirname,'argv-fixture.cjs')}" %*\r\n`);
fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ profiles: [] }));
app.setPath('userData', profileDir);
require(process.env.SMOKE_APP || '../src/main.cjs');
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.quit(); app.exit(1); }, 65000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression, label) {
  for (let i = 0; i < 150; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  const diagnostic = await win.webContents.executeJavaScript("JSON.stringify({sessions:[...sessions.values()].map(s=>({title:s.title,activity:s.activity})),lines:(()=>{const b=activeSession()?.term.buffer.active;return b?Array.from({length:Math.min(b.length,8)},(_,i)=>b.getLine(b.length-Math.min(b.length,8)+i).translateToString(true)):[]})()})");
  throw new Error('Timed out: ' + label + '; ' + diagnostic);
}
async function waitTitle(win, text) {
  for (let i = 0; i < 50; i++) {
    if (win.getTitle().includes(text)) return;
    await delay(100);
  }
  throw new Error('Native window title did not update: ' + text);
}
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
  await waitFor(win, "typeof settings !== 'undefined' && settings.cwd && !document.getElementById('home').hidden", 'home');
  assert.equal(await win.webContents.executeJavaScript('sessions.size'), 0);
  const first = await win.webContents.executeJavaScript('(async()=>{const s=await createSession(); return {id:s.id,pid:s.pid}})()');
  await waitFor(win, `sessions.get('${first.id}').activity.kind === 'prompt'`, 'initial prompt');
  const second = await win.webContents.executeJavaScript('(async()=>{const s=await createSession(); return {id:s.id,pid:s.pid}})()');
  assert.notEqual(first.pid, second.pid);
  await waitFor(win, `sessions.get('${second.id}').activity.kind === 'prompt'`, 'second prompt');
  await win.webContents.executeJavaScript(`api.input('${first.id}', "Start-Sleep -Seconds 3; Write-Output ('FIRST_' + 'DONE')\\r")`);
  await waitFor(win, `sessions.get('${first.id}').activity.busy && !sessions.get('${second.id}').activity.busy`, 'independent busy state');
  assert.match(win.getTitle(), /1 个运行中/);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${first.id}').indicator.classList.contains('busy')`), true);
  await delay(800);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${first.id}').activity.busy`), true);
  await win.webContents.executeJavaScript(`api.input('${second.id}', "Write-Output ('SECOND_' + 'OK'); Write-Output ([char]0x4e2d + [string][char]0x6587)\\r")`);
  await waitFor(win, `(()=>{const b=sessions.get('${second.id}').term.buffer.active; return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString()).join(' ').includes('SECOND_OK')})()`, 'second output');
  await waitFor(win, `!sessions.get('${first.id}').activity.busy`, 'completion');
  // Use real console and OSC title updates over the PTY, including a hidden tab.
  const titleCommand = "$Host.UI.RawUI.WindowTitle = 'Codex Rename A'\r";
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(first.id)}, ${JSON.stringify(titleCommand)})`);
  await waitFor(win, `sessions.get('${first.id}').label.textContent === 'Codex Rename A'`, 'background title update');
  assert.doesNotMatch(win.getTitle(), /Codex Rename A/);
  await win.webContents.executeJavaScript(`selectSession('${first.id}')`);
  await waitTitle(win, 'Codex Rename A');
  assert.match(win.getTitle(), /Codex Rename A/);
  const oscTitle = "[Console]::Write(([string][char]27)+']2;Codex Rename B'+[string][char]27+'\\'); Start-Sleep -Milliseconds 200\r";
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(first.id)}, ${JSON.stringify(oscTitle)})`);
  await waitFor(win, `sessions.get('${first.id}').label.textContent === 'Codex Rename B'`, 'OSC 2 renamed title');
  await waitTitle(win, 'Codex Rename B');
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${first.id}').closeButton.getAttribute('aria-label')`), '关闭 Codex Rename B');
  const spinnerTitle = `node '${path.join(__dirname, 'title-fixture.cjs').replace(/'/g, "''")}'\r`;
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(first.id)}, ${JSON.stringify(spinnerTitle)})`);
  await waitFor(win, `sessions.get('${first.id}').title === 'Codex Rename B' && !sessions.get('${first.id}').activity.busy`, 'deduplicated title spinner');
  assert.doesNotMatch(win.getTitle(), /[\u2800-\u28ff]/);
  const clearTitle = "[Console]::Write(([string][char]27)+']0;'+[char]7)\r";
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(first.id)}, ${JSON.stringify(clearTitle)})`);
  await waitFor(win, `sessions.get('${first.id}').title === sessions.get('${first.id}').initialTitle`, 'empty title restores session name');
  await win.webContents.executeJavaScript(`selectSession('${second.id}')`);
  const colorCommand = `node '${path.join(__dirname, 'color-fixture.cjs').replace(/'/g, "''")}'\r`;
  await win.webContents.executeJavaScript(`api.input(${JSON.stringify(second.id)}, ${JSON.stringify(colorCommand)})`);
  await waitFor(win, `(()=>{const b=sessions.get('${second.id}').term.buffer.active; return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString(true)).includes('COLOR_FIXTURE_DONE');})()`, 'color fixture');
  const colors = await win.webContents.executeJavaScript(`(()=>{
    const b=sessions.get('${second.id}').term.buffer.active;
    const lines=Array.from({length:b.length},(_,i)=>b.getLine(i));
    const sample=label=>{
      const line=lines.find(l=>l.translateToString(true)===label);
      if(!line) throw new Error('Missing color sample: '+label);
      const cell=line.getCell(0);
      return {palette:cell.isFgPalette(),rgb:cell.isFgRGB(),color:cell.getFgColor(),bold:Boolean(cell.isBold()),italic:Boolean(cell.isItalic()),underline:Boolean(cell.isUnderline())};
    };
    if(!lines.some(l=>l.translateToString(true)==='NO_COLOR=unset')) throw new Error('NO_COLOR leaked into terminal');
    if(!lines.some(l=>l.translateToString(true)==='COLOR_DEPTH=24')) throw new Error('Truecolor auto-detection failed');
    return {auto:sample('AUTO_COLOR'),red:sample('ANSI16_RED'),bright:sample('ANSI16_BRIGHT_RED'),indexed:sample('ANSI256_RED'),rgb:sample('TRUECOLOR_GREEN'),style:sample('BOLD_ITALIC_UNDERLINE')};
  })()`);
  assert.equal(colors.auto.palette, true); assert.equal(colors.auto.color, 2);
  assert.equal(colors.red.color, 1); assert.equal(colors.bright.color, 9);
  assert.equal(colors.indexed.color, 196); assert.equal(colors.rgb.rgb, true);
  assert.equal(colors.rgb.color, 0x12ab34);
  assert.ok(colors.style.bold && colors.style.italic && colors.style.underline);
  if (process.env.SMOKE_SCREENSHOT === '1') {
    win.show(); win.focus(); await delay(400);
    fs.writeFileSync(path.join(__dirname,'../artifacts/colors.png'),(await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript('selectSession(null);editProfile()');
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-cwd').value"), '');
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-cwd').required"), false);
  await win.webContents.executeJavaScript("document.getElementById('profile-name').value='Smoke project';document.getElementById('profile-form').requestSubmit()");
  await waitFor(win, "settings.profiles.length === 1 && !document.getElementById('profile-dialog').open", 'save without working directory');
  const saved = await win.webContents.executeJavaScript('settings.profiles[0]');
  assert.equal(saved.cwd, '');
  await win.webContents.executeJavaScript(`editProfile(settings.profiles[0])`);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-cwd').value"), '');
  await win.webContents.executeJavaScript("document.getElementById('profile-dialog').close()");
  const invalidRejected = await win.webContents.executeJavaScript("api.saveProfile({name:'Invalid directory',cwd:'Z:\\\\nonexistent-codex-test-directory'}).then(()=>false,()=>true)");
  assert.equal(invalidRejected, true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(profileDir, 'settings.json'))).profiles.some(p => p.id === saved.id));
  await win.webContents.executeJavaScript('selectSession(null)');
  if (process.env.SMOKE_SCREENSHOT === '1') {
    win.show(); win.focus(); await delay(500);
    fs.writeFileSync(path.join(__dirname,'../artifacts/home-v3.png'),(await win.webContents.capturePage()).toPNG());
  }
  const duplicates = await win.webContents.executeJavaScript(`Promise.all([createSession({id:'${saved.id}'}),createSession({id:'${saved.id}'})]).then(list=>list.map(s=>({id:s.id,pid:s.pid})))`);
  assert.notEqual(duplicates[0].pid, duplicates[1].pid);
  for (const duplicate of duplicates) await win.webContents.executeJavaScript(`closeSession('${duplicate.id}',true)`);
  await win.webContents.executeJavaScript(`api.newWindow('${saved.id}')`);
  for (let i = 0; BrowserWindow.getAllWindows().length < 2 && i < 50; i++) await delay(100);
  const other = BrowserWindow.getAllWindows().find(w => w !== win);
  assert.ok(other);
  await waitFor(other, 'typeof sessions !== "undefined" && sessions.size === 1', 'profile in new window');
  await other.webContents.executeJavaScript(`api.close('${first.id}')`);
  await other.webContents.executeJavaScript(`api.setTitle('${second.id}', 'FOREIGN WINDOW TITLE')`);
  await delay(100);
  assert.doesNotMatch(win.getTitle(), /FOREIGN WINDOW TITLE/);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${first.id}').alive`), true);
  await win.webContents.executeJavaScript(`closeSession('${first.id}',true)`);
  assert.equal(await win.webContents.executeJavaScript(`sessions.has('${first.id}')`), false);
  assert.equal(await win.webContents.executeJavaScript(`sessions.get('${second.id}').alive`), true);
  await win.webContents.executeJavaScript(`selectSession('${second.id}');setFontSize(14)`);
  win.show(); win.focus(); await delay(200);
  win.webContents.sendInputEvent({type:'mouseWheel',x:250,y:200,deltaX:0,deltaY:100,modifiers:['control']});
  await delay(400);
  assert.notEqual(await win.webContents.executeJavaScript('fontSize'), 14);
  assert.equal(win.webContents.getZoomFactor(), 1);
  await win.webContents.executeJavaScript('setFontSize(14)');
  // Exercise native Agent progress OSC over a real PTY, not just the parser.
  await win.webContents.executeJavaScript(`api.input('${second.id}', "[Console]::Write(([string][char]27)+']9;4;3'+[char]7); Start-Sleep -Seconds 2; [Console]::Write(([string][char]27)+']9;4;0'+[char]7)\\r")`);
  await waitFor(win, `sessions.get('${second.id}').activity.kind === 'reported' && sessions.get('${second.id}').activity.busy`, 'agent progress start');
  if (process.env.SMOKE_SCREENSHOT === '1') {
    fs.writeFileSync(path.join(__dirname,'../artifacts/terminal-v3.png'),(await win.webContents.capturePage()).toPNG());
  }
  await waitFor(win, `!sessions.get('${second.id}').activity.busy`, 'agent progress stop');
  await win.webContents.executeJavaScript(`api.deleteProfile('${saved.id}')`);
  await waitFor(other, 'settings.profiles.length === 0', 'cross-window profile sync');
  const resumeId = '12345678-1234-4abc-8def-123456789abc';
  const expectedCommand = `codex --no-daemon resume ${resumeId}`;
  await win.webContents.executeJavaScript(`selectSession(null);editProfile();document.getElementById('profile-session-id').value='${resumeId}';updateLaunchPreview()`);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-command').value"), expectedCommand);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-command').readOnly"), true);
  await win.webContents.executeJavaScript("document.getElementById('profile-form').requestSubmit()");
  await waitFor(win, "settings.profiles.length===1 && !document.getElementById('profile-dialog').open", 'ID-only profile save');
  const resumeProfile = await win.webContents.executeJavaScript('settings.profiles[0]');
  assert.equal(resumeProfile.sessionId, resumeId);
  assert.equal(resumeProfile.command, expectedCommand);
  assert.equal(resumeProfile.cwd, '');
  assert.ok(resumeProfile.name);
  await win.webContents.executeJavaScript('editProfile(settings.profiles[0])');
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('profile-session-id').value"), resumeId);
  await win.webContents.executeJavaScript("document.getElementById('profile-dialog').close();createSession(settings.profiles[0]).then(s=>s.id)");
  for(let i=0;i<100 && !fs.existsSync(argvFile);i++) await delay(100);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile,'utf8')), ['--no-daemon','resume',resumeId]);
  await win.webContents.executeJavaScript(`api.deleteProfile('${resumeProfile.id}')`);
  await win.webContents.executeJavaScript('selectSession(null)');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ home:true, independentPTYs:true, backgroundSpinner:true, silentWork:true, completion:true, profilesPersisted:true, independentWindows:true, closeIsolation:true, ctrlWheel:true, nativeAgentProgress:true, profileSync:true, autoColors:true, ansi16:true, ansi256:true, truecolor:true, textStyles:true, dynamicTitles:true, backgroundTitleIsolation:true, rendererErrors:0 }));
  clearTimeout(timeout); app.quit();
}).catch(error => { console.error(error); app.quit(); app.exit(1); });
