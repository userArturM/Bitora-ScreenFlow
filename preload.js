const {contextBridge,ipcRenderer} = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('desktop', {
  sources:invoke('sources'), select:invoke('select'), begin:invoke('begin'),
  append:invoke('append'), finish:invoke('finish'), library:invoke('library'),
  open:invoke('open'), reveal:invoke('reveal'), folder:invoke('folder'),
  chooseFolder:invoke('choose-folder'), saveAs:invoke('save-as'), minimize:invoke('minimize'),
  closeReady:invoke('close-ready'),
  onCommand:callback => ipcRenderer.on('command',(_,command)=>callback(command))
});
