const {contextBridge,ipcRenderer} = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('desktop', {
  mediaUrl:invoke('media-url'),shotsList:invoke('shots-list'),shotAction:invoke('shot-action'),clipboardPng:invoke('clipboard-png'),trimVideo:invoke('trim-video'),diagnosticLog:invoke('diagnostic-log'),diagnosticSave:invoke('diagnostic-save'),updatesCheck:invoke('updates-check'),updatesOpen:invoke('updates-open'),updatesDownload:invoke('updates-download'),updatesInstall:invoke('updates-install'),updatesStatus:invoke('updates-status'),updatesCancel:invoke('updates-cancel'),updatesResult:invoke('updates-result'),panelState:invoke('panel-state'),
  sources:invoke('sources'), select:invoke('select'), begin:invoke('begin'),
  append:invoke('append'), finish:invoke('finish'), library:invoke('library'),
  open:invoke('open'), reveal:invoke('reveal'), folder:invoke('folder'),
  chooseFolder:invoke('choose-folder'), saveAs:invoke('save-as'), minimize:invoke('minimize'),
  closeReady:invoke('close-ready'),
  screenshotSave:invoke('screenshot-save'), screenshotHide:invoke('screenshot-hide'),
  screenshotRestore:invoke('screenshot-restore'), screenshotReveal:invoke('screenshot-reveal'),
  screenshotsFolder:invoke('screenshots-folder'),
  info:invoke('info'), rename:invoke('rename'), remove:invoke('remove'),
  repair:invoke('repair'), convert:invoke('convert'), disk:invoke('disk'),
  config:invoke('config'), setConfig:invoke('set-config'), state:invoke('state'),
  onCommand:callback => ipcRenderer.on('command',(_,command)=>callback(command))
});
