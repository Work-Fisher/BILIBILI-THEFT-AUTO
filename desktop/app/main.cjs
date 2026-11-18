const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gameDirectory = path.join(__dirname, 'game');
const backendDirectory = path.join(process.resourcesPath, 'neural');
const neuralReady = ['video2dlssnr.exe', 'nvngx_dlss.dll', 'nvngx_dlssnr.dll', 'nvngx.dll_dlssnr.dll']
  .every(name => fs.existsSync(path.join(backendDirectory, name)));
const gameOrigin = 'btagame://local/';
const title = 'BILIBILI THEFT AUTO';
let win, processor, request, status = '准备中';
let diagnostics = '', exact = false;
protocol.registerSchemesAsPrivileged([{scheme:'btagame', privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);

function titleStatus(value) {
  status = value;
  if (win && !win.isDestroyed()) win.setTitle(title + '  ·  ' + status + (status === 'DLSS 5 NR 已开启' ? (exact ? ' · 逐帧' : ' · 行车') : '') + '  |  F7 模式 · F8 开关');
}
function stop(reason) {
  const proc = processor;
  processor = null;
  if (request) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
    request = null;
  }
  if (proc && !proc.killed) proc.kill();
}
function start(width, height) {
  stop('重建渲染尺寸');
  diagnostics = '';
  const tool = path.join(backendDirectory,'video2dlssnr.exe');
  const proc = spawn(tool,['--nr-video','--nr-in',width+'x'+height,'--nr-style','1','--nr-intensity','0.85'],{
    cwd:backendDirectory,windowsHide:true,stdio:['pipe','pipe','pipe']
  });
  proc.size = width+'x'+height;
  processor = proc;
  proc.stderr.on('data', chunk => {
    if (processor === proc) diagnostics = (diagnostics + chunk.toString()).slice(-5000);
  });
  function failed(message) {
    if (processor !== proc) return;
    const detail = diagnostics.split(/[\r\n]+/).filter(Boolean).slice(-8).join('\n');
    try { fs.writeFileSync(path.join(app.getPath('userData'),'neural-error.log'),message+'\n'+detail); } catch {}
    stop(message);
    titleStatus('神经渲染不可用 · 原画运行');
  }
  proc.on('error', err => failed(err.message));
  proc.stdin.on('error', err => failed(err.message));
  proc.on('close', code => failed('渲染进程已退出 ('+code+')'));
  proc.stdout.on('data', chunk => {
    if (processor !== proc || !request) return;
    const job = request;
    if (job.offset+chunk.length > job.output.length) { failed('输出帧尺寸异常'); return; }
    chunk.copy(job.output,job.offset);
    job.offset += chunk.length;
    if (job.offset === job.output.length) {
      clearTimeout(job.timer);
      request = null;
      job.resolve(job.output);
      if (status !== 'DLSS 5 NR 已开启') titleStatus('DLSS 5 NR 已开启');
    }
  });
  return proc;
}
function fromGame(event) {
  return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame.url.startsWith(gameOrigin);
}
function processFrame(width,height,rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width<64 || height<64 || width>1280 || height>900 || !(rgba instanceof Uint8Array) || rgba.byteLength!==width*height*4)
    throw new Error('无效画面');
  if (request) throw new Error('上一帧仍在处理');
  const proc = processor && processor.size === width+'x'+height ? processor : start(width,height);
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {stop('神经渲染超时'); titleStatus('超时 · 原画运行');},60000);
    request = {resolve,reject,timer,output:Buffer.allocUnsafe(rgba.byteLength),offset:0};
    proc.stdin.write(rgba);
  });
}
ipcMain.handle('nr:frame', async(event,width,height,buffer)=>{
  if(!fromGame(event))throw new Error('无效窗口');
  const output=await processFrame(width,height,new Uint8Array(buffer));
  return output.buffer;
});
ipcMain.on('nr:mode',(event,value)=>{if (fromGame(event)) {exact=!!value;titleStatus(status);}});
ipcMain.on('nr:enabled',(event,on) => {
  if (!fromGame(event)) return;
  if (!on) stop('已切换至原画');
  titleStatus(on?'等待神经渲染首帧':'原画');
});
app.whenReady().then(() => {
  protocol.handle('btagame', req => {
    const url = new URL(req.url);
    const file = path.resolve(gameDirectory,'.'+decodeURIComponent(url.pathname));
    if (url.hostname!=='local' || !file.startsWith(gameDirectory+path.sep)) return new Response(null,{status:404});
    return net.fetch(pathToFileURL(file).href,{headers:req.headers});
  });
  win = new BrowserWindow({width:1280,height:720,useContentSize:true,show:false,backgroundColor:'#16131b',autoHideMenuBar:true,
    webPreferences:{additionalArguments:neuralReady ? ['--bta-neural-ready'] : [],preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.removeMenu();
  win.on('page-title-updated',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if (!url.startsWith(gameOrigin)) event.preventDefault();});
  win.on('ready-to-show',()=>win.show());
  win.on('closed',()=>{stop('窗口关闭'); win=null;});
  win.webContents.on('render-process-gone',()=>stop('游戏渲染已停止'));
  titleStatus(neuralReady ? '等待神经渲染首帧' : '原画运行');
  win.loadURL(gameOrigin+'cn.html');
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>stop('游戏退出'));
