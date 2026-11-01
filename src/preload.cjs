const { contextBridge, ipcRenderer } = require('electron');
const listen = (event, callback) => { ipcRenderer.on(event, (_event, data) => callback(data)); };
contextBridge.exposeInMainWorld('desktop', {
  settings: () => ipcRenderer.invoke('settings:get'),
  chooseDirectory: () => ipcRenderer.invoke('directory:choose'),
  chooseIcon: () => ipcRenderer.invoke('icon:choose'),
  newWindow: profileId => ipcRenderer.invoke('window:new', profileId),
  saveProfile: profile => ipcRenderer.invoke('profile:save', profile),
  deleteProfile: id => ipcRenderer.invoke('profile:delete', id),
  create: options => ipcRenderer.invoke('terminal:create', options),
  close: id => ipcRenderer.invoke('terminal:close', id),
  active: id => ipcRenderer.send('terminal:active', id),
  setTitle: (id, title) => ipcRenderer.send('terminal:title', { id, title }),
  input: (id, data) => ipcRenderer.send('terminal:input', { id, data }),
  resize: (id, size) => ipcRenderer.send('terminal:resize', { id, ...size }),
  onData: callback => listen('terminal:data', callback),
  onExit: callback => listen('terminal:exit', callback),
  onActivity: callback => listen('terminal:activity', callback),
  onProfiles: callback => listen('profiles:changed', callback)
});
