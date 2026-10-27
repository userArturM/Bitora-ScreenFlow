const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panel',{command:c=>ipcRenderer.invoke('panel-command',c),onState:fn=>ipcRenderer.on('panel-state',(_,s)=>fn(s))});
