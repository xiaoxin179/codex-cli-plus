const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
process.env.TERMINAL_TEST='1';
const directory=path.resolve('artifacts',`profile-order-${process.pid}`);
fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'settings.json');
fs.writeFileSync(file,JSON.stringify({cwd:process.cwd(),profiles:[
  {id:'a',name:'Visible A',cwd:'',command:''},
  {id:'b',name:'Other B',cwd:'',command:''},
  {id:'c',name:'Visible C',cwd:'',command:''}
]}));
app.setPath('userData',directory);
require(process.env.SMOKE_APP || '../src/main.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timer=setTimeout(()=>{console.error('Profile order check timed out');app.exit(1);},20000);
async function wait(win,expression) {
  for(let n=0;n<100;n++){if(await win.webContents.executeJavaScript(expression))return;await delay(50);}
  throw new Error('Timed out: '+expression);
}
const order="settings.profiles.map(p=>p.id).join(',')";
app.whenReady().then(async()=>{
  const win=BrowserWindow.getAllWindows()[0];
  await wait(win,"typeof settings!=='undefined' && settings.profiles.length===3");
  await win.webContents.executeJavaScript('api.newWindow()');
  await delay(100);
  const other=BrowserWindow.getAllWindows().find(w=>w!==win);
  await wait(other,"typeof settings!=='undefined' && settings.profiles.length===3");
  async function drag(from,to){
    await win.webContents.executeJavaScript(`(()=>{
      const source=document.querySelector('[data-profile-id="${from}"]');
      const target=document.querySelector('[data-profile-id="${to}"]');
      const transfer=new DataTransfer();
      source.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});
      target.dispatchEvent(over);
      if(!over.defaultPrevented)throw new Error('Drop target rejected card');
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    })()`);
  }
  await drag('a','c');
  await wait(win,`${order}==='b,c,a'`);
  await wait(other,`${order}==='b,c,a'`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).profiles.map(p=>p.id),['b','c','a']);
  await win.webContents.executeJavaScript("api.saveProfile({...settings.profiles.find(p=>p.id==='c'),name:'Visible C edited'})");
  await wait(win,"settings.profiles.find(p=>p.id==='c').name==='Visible C edited'");
  assert.equal(await win.webContents.executeJavaScript(order),'b,c,a','editing preserves order');
  await win.webContents.executeJavaScript("document.getElementById('profile-search').value='Visible';renderProfiles()");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#profiles .profile').length"),2);
  await drag('a','c');
  await wait(win,`${order}==='b,a,c'`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).profiles.map(p=>p.id),['b','a','c']);
  // Cancel a drag: neither DOM order nor persisted order changes.
  await win.webContents.executeJavaScript(`(()=>{const card=document.querySelector('[data-profile-id="a"]');const dt=new DataTransfer();card.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
  assert.equal(await win.webContents.executeJavaScript(order),'b,a,c');
  const rejected=await win.webContents.executeJavaScript("api.moveProfile('missing','a').then(()=>false,()=>true)");
  assert.equal(rejected,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).profiles.map(p=>p.id),['b','a','c']);
  // Re-read settings from disk as a new process would on startup.
  const {loadSettings}=require('../src/settings.cjs');
  assert.deepEqual(loadSettings(directory,directory).profiles.map(p=>p.id),['b','a','c']);
  console.log(JSON.stringify({dragReorder:true,savedToDisk:true,crossWindowSync:true,filteredDrag:true,cancelPreservesOrder:true,editPreservesOrder:true,reloadPreservesOrder:true,invalidMoveRejected:true}));
  clearTimeout(timer); for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
