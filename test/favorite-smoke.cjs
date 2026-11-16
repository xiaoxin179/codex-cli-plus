const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
app.disableHardwareAcceleration();process.env.TERMINAL_TEST='1';
const directory=path.resolve('artifacts/favorite-smoke-'+process.pid);
fs.mkdirSync(directory,{recursive:true});
process.env.CODEX_HOME=path.join(directory,'codex-home');
fs.mkdirSync(path.join(process.env.CODEX_HOME,'sessions'),{recursive:true});
fs.writeFileSync(path.join(directory,'settings.json'),JSON.stringify({cwd:process.cwd(),profiles:[]}));
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
for(const id of ids) fs.writeFileSync(path.join(process.env.CODEX_HOME,'sessions',`rollout-${id}.jsonl`),JSON.stringify({type:'session_meta',payload:{id,cwd:process.cwd()}})+'\n');
app.setPath('userData',directory);
require(process.env.SMOKE_APP||'../src/main.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
 const win=BrowserWindow.getAllWindows()[0];
 await new Promise(r=>win.webContents.once('did-finish-load',r));await delay(200);
 const js=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await delay(100);}throw Error('timeout: '+code)};
 const terminalIds=[];
 for(let i=0;i<2;i++){
  const id=await js('createSession().then(s=>s.id)');terminalIds.push(id);
  await js(`updateTitle(sessions.get('${id}'),'会话 ${i+1}')`);
 }
 // Right click the first tab while the second tab is selected.
 await js(`sessions.get('${terminalIds[0]}').tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:25}));`);
 assert.equal(await js("document.getElementById('session-context-menu').hidden"),false);
 await js("document.querySelector('#session-context-menu button').click()");
 assert.equal(await js("document.getElementById('profile-session-id').value"),'');
 assert.equal(await js("document.getElementById('profile-session-id').required"),true);
 await js(`document.getElementById('profile-session-id').value='${ids[0]}'; document.getElementById('profile-session-id').dispatchEvent(new Event('input'))`);
 await wait("document.getElementById('workspace-preview').textContent.includes('自动识别')");
 assert.equal(await js("document.getElementById('profile-session-id').value"),ids[0]);
 assert.equal(await js("document.getElementById('profile-name').value"),'会话 1');
 assert.ok((await js("document.getElementById('workspace-preview').textContent")).includes(process.cwd()));
 assert.equal(await js('settings.profiles.length'),0);
 await delay(200);
 fs.writeFileSync(path.join(directory,'favorite-dialog.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.getElementById('profile-form').requestSubmit()");
 await wait("!document.getElementById('profile-dialog').open");
 assert.equal(await js('settings.profiles.length'),1);
 await js(`addSessionFavorite(sessions.get('${terminalIds[0]}'))`);
 await js(`document.getElementById('profile-session-id').value='${ids[0]}'; updateLaunchPreview()`);
 await js("document.getElementById('profile-form').requestSubmit()");
 await wait("!document.getElementById('profile-dialog').open");
 assert.equal(await js('settings.profiles.length'),1);

 await js(`addSessionFavorite(sessions.get('${terminalIds[1]}'))`);
 await js("document.getElementById('cancel-profile').click()");assert.equal(await js('settings.profiles.length'),1);
 const plain=await js('createSession().then(s=>s.id)');
 await js(`addSessionFavorite(sessions.get('${plain}'))`);
 assert.equal(await js("document.getElementById('profile-session-id').value"),'');
 assert.equal(await js("document.getElementById('profile-session-id').required"),true);
 await js("document.getElementById('cancel-profile').click()");
 for(const id of [...terminalIds,plain])await js(`closeSession('${id}',true)`);
 clearTimeout(timeout);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({ok:true}));
 console.log(JSON.stringify({ok:true,directory}));app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});
