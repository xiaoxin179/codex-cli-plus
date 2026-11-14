const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration(); process.env.TERMINAL_TEST = '1';
const directory = path.join(__dirname, '../artifacts/tree-smoke-' + process.pid);
fs.mkdirSync(directory, {recursive:true});
const codexHome = path.join(directory, 'codex');
process.env.CODEX_HOME = codexHome;
fs.mkdirSync(path.join(codexHome, 'sessions'), {recursive:true});
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
for (const id of ids) fs.writeFileSync(path.join(codexHome, 'sessions', `rollout-${id}.jsonl`), JSON.stringify({type:'session_meta',payload:{id,cwd:process.cwd()},timestamp:'2026-11-14T00:00:00Z'})+'\n');
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({profiles:[
 {id:'p0',name:'首页开发',sessionId:ids[0],cwd:''},
 {id:'p1',name:'卡顿排查',sessionId:ids[1],cwd:''},
 {id:'p2',name:'另一个项目',cwd:path.join(process.cwd(),'test')},
 {id:'p3',name:'未识别会话',cwd:''}
],tree:[{id:'old',type:'group',name:'旧分组',parent:'root'},{id:'p0',parent:'old'}]}));
app.setPath('userData', directory);
require(process.env.SMOKE_APP || '../src/main.cjs');
const delay = ms => new Promise(r=>setTimeout(r,ms));
const timeout = setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(r=>win.webContents.once('did-finish-load',r)); await delay(400);
    const js = code => win.webContents.executeJavaScript(code);
    await js('api.refreshWorkspaces()'); await delay(100);
    assert.equal(await js('document.querySelectorAll(".profile").length'),4);
    assert.equal(await js("settings.tree.filter(n=>n.type==='group').length"),3);
    const group = await js("settings.tree.find(n=>n.id==='p0').parent");
    assert.equal(await js("settings.tree.find(n=>n.id==='p1').parent"),group);
    assert.equal(await js("settings.profiles.find(p=>p.id==='p0').cwd"),'');
    assert.equal(await js("settings.profiles.find(p=>p.id==='p0').workspaceCwd"),process.cwd());
    await js(`api.changeTree({action:'toggle',id:${JSON.stringify(group)},collapsed:true})`); await delay(50);
    assert.equal(await js('document.querySelectorAll(".profile").length'),2);
    await js("document.getElementById('profile-search').value='卡顿排查'; renderProfiles()"); await delay(50);
    assert.equal(await js('document.querySelectorAll(".profile").length'),1);
    await js("document.getElementById('profile-search').value=''; renderProfiles()");
    await js(`api.changeTree({action:'toggle',id:${JSON.stringify(group)},collapsed:false})`);
    await js('sessionCanvas.fit()'); await delay(100);
    const before = await js("document.getElementById('tree-world').style.transform");
    await js("document.getElementById('tree-plus').click()");
    assert.notEqual(await js("document.getElementById('tree-world').style.transform"),before);
    await js("(()=>{const c=document.getElementById('tree-canvas');c.setPointerCapture=()=>{};c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:100,clientY:100}));c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:180,clientY:160}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()");
    await js(`(()=>{const source=document.querySelector('[data-node-id="p1"]'), target=document.querySelector('[data-node-id="p0"]'), data=new DataTransfer(), r=target.getBoundingClientRect();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data,clientY:r.top+2}));})()`); await delay(100);
    assert.deepEqual(await js(`settings.tree.filter(n=>n.parent===${JSON.stringify(group)}).map(n=>n.id)`),['p1','p0']);
    await assert.rejects(js("api.changeTree({action:'move',id:'p0',target:'p2',position:'before'})"));
    await js('api.newWindow()'); await delay(500);
    const other=BrowserWindow.getAllWindows().find(w=>w!==win);
    await js(`api.changeTree({action:'toggle',id:${JSON.stringify(group)},collapsed:true})`); await delay(100);
    assert.equal(await other.webContents.executeJavaScript(`settings.tree.find(n=>n.id===${JSON.stringify(group)}).collapsed`),true);
    await js(`api.changeTree({action:'toggle',id:${JSON.stringify(group)},collapsed:false})`);
    other.close();
    // A newer turn changes the automatically discovered workspace after refresh.
    fs.appendFileSync(path.join(codexHome,'sessions',`rollout-${ids[1]}.jsonl`),JSON.stringify({type:'turn_context',payload:{cwd:path.join(process.cwd(),'test')},timestamp:'2026-11-14T01:00:00Z'})+'\n');
    await js('api.refreshWorkspaces()');
    assert.equal(await js("settings.tree.find(n=>n.id==='p1').parent"),await js("settings.tree.find(n=>n.id==='p2').parent"));
    await js(`api.saveProfile({id:'p1',name:'卡顿排查',sessionId:${JSON.stringify(ids[1])},cwd:${JSON.stringify(process.cwd())}})`);
    assert.equal(await js("settings.tree.find(n=>n.id==='p1').parent"),group);
    await js('sessionCanvas.fit()'); await delay(100);
    fs.writeFileSync(path.join(directory,'canvas.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.reload(); await new Promise(r=>win.webContents.once('did-finish-load',r)); await delay(200);
    assert.equal(await js("settings.tree.find(n=>n.id==='p0').parent"),group);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'settings.json'))).tree.find(n=>n.id==='p0').parent,group);
    console.log(JSON.stringify({ok:true,directory})); clearTimeout(timeout); app.exit(0);
  } catch(error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
