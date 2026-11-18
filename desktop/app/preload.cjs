const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('localNeural',{
  available:process.argv.includes('--bta-neural-ready'),
  frame:(width,height,buffer)=>ipcRenderer.invoke('nr:frame',width,height,buffer),
  mode:exact=>ipcRenderer.send('nr:mode',!!exact),
  enable:on=>ipcRenderer.send('nr:enabled',!!on)
});
