const { contextBridge, ipcRenderer } = require('electron');
const listen = (event, callback) => { ipcRenderer.on(event, (_event, data) => callback(data)); };
contextBridge.exposeInMainWorld('desktop', {
  refreshWorkspaces: () => ipcRenderer.invoke('workspaces:refresh'),
  lookupWorkspace: id => ipcRenderer.invoke('workspace:lookup', id),
  changeTree: input => ipcRenderer.invoke('tree:change', input),
  onTree: callback => listen('tree:changed', callback),
  settings: () => ipcRenderer.invoke('settings:get'),
  ready: () => ipcRenderer.send('window:ready'),
  chooseDirectory: () => ipcRenderer.invoke('directory:choose'),
  chooseIcon: () => ipcRenderer.invoke('icon:choose'),
  newWindow: profileId => ipcRenderer.invoke('window:new', profileId),
  saveProfile: profile => ipcRenderer.invoke('profile:save', profile),
  deleteProfile: id => ipcRenderer.invoke('profile:delete', id),
  moveProfile: (id, targetId) => ipcRenderer.invoke('profile:move', {id, targetId}),
  create: options => ipcRenderer.invoke('terminal:create', options),
  close: id => ipcRenderer.invoke('terminal:close', id),
  active: id => ipcRenderer.send('terminal:active', id),
  unreadCount: count => ipcRenderer.send('notification:count', count),
  setTitle: (id, title) => ipcRenderer.send('terminal:title', { id, title }),
  input: (id, data) => ipcRenderer.send('terminal:input', { id, data }),
  resize: (id, size) => ipcRenderer.send('terminal:resize', { id, ...size }),
  onData: callback => listen('terminal:data', callback),
  onExit: callback => listen('terminal:exit', callback),
  onActivity: callback => listen('terminal:activity', callback),
  onProfiles: callback => listen('profiles:changed', callback)
});
