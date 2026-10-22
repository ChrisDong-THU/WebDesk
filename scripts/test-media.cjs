const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { MediaNetwork } = require('../tests/media-network.cjs');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.WEBDESK_MEDIA_RESULTS || 'test-results/media-benchmark');
const hostExe = process.env.WEBDESK_MEDIA_HOST;
if (!hostExe) throw Error('Set WEBDESK_MEDIA_HOST to the isolated media_benchmark executable');
const variant = process.env.WEBDESK_MEDIA_VARIANT || 'candidate';
const codecList = (process.env.WEBDESK_MEDIA_CODECS || 'auto,VP8,H264,VP9,AV1').split(',');
const plan = codecList.flatMap(codec => process.env.WEBDESK_MEDIA_NETWORK_MBPS ? [
  {name:`${codec}-network-${process.env.WEBDESK_MEDIA_NETWORK_MBPS}Mbps`,codec,kbps:8000,mbps:Number(process.env.WEBDESK_MEDIA_NETWORK_MBPS),delayMs:20,loss:.01}
] : [
  { name:`${codec}-2Mbps`,codec,kbps:2000,mbps:1000,delayMs:0,loss:0 },
  ...(codec==='auto' ? [{ name:'auto-8Mbps',codec,kbps:8000,mbps:1000,delayMs:0,loss:0 },
    { name:'auto-network-2Mbps',codec,kbps:8000,mbps:2,delayMs:20,loss:0.01 }] : [])
]).map(s=>({...s,platformOrder:process.env.WEBDESK_MEDIA_NATIVE_ORDER==='1',receiverCodec:process.env.WEBDESK_MEDIA_RECEIVER_CODEC,width:3200,height:2000,heightLimit:Number(process.env.WEBDESK_MEDIA_HEIGHT||1080),fps:Number(process.env.WEBDESK_MEDIA_FPS||60)})).filter(s=>!process.env.WEBDESK_MEDIA_SCENARIO || s.name===process.env.WEBDESK_MEDIA_SCENARIO);
let network, host, window;
const hostLog = () => fs.openSync(path.join(out,variant+'-host.log'),'a');
const request = async (route,data={}) => {
  const response = await fetch('http://127.0.0.1:44402'+route,{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
  const result = await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;
};
fs.mkdirSync(out,{recursive:true});
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.whenReady().then(async()=>{
  // No installed service or installed executable is modified by this test.
  host=spawn(hostExe,[],{cwd:path.dirname(hostExe),windowsHide:true,stdio:['ignore',hostLog(),hostLog()]});
  const deadline=Date.now()+30000;let live=false;
  while(Date.now()<deadline){try{await request('/candidates');live=true;break;}catch{}await new Promise(r=>setTimeout(r,200));}
  if(!live)throw Error('Native test host did not start');
  ipcMain.handle('plan',()=>plan);
  ipcMain.handle('host',async(_e,route,data)=>{
    if(!['/start','/answer','/stats','/stop'].includes(route))throw Error('Invalid route');
    if(route==='/start'){network?.close();network=new MediaNetwork(data);}
    return request(route,data);
  });
  ipcMain.handle('candidates',async()=>{
    const candidates=await request('/candidates');
    if(candidates.length)console.log('Host candidates: '+JSON.stringify(candidates));
    const mapped=await Promise.all(candidates.map(c=>network.candidate(c)));
    return mapped.filter(Boolean);
  });
  ipcMain.handle('network',()=>network.metrics);
  ipcMain.handle('frame',(_e,name,url)=>{if(!plan.some(s=>s.name===name)||!url.startsWith('data:image/png;base64,'))throw Error('Invalid frame');fs.writeFileSync(path.join(out,variant+'-'+name+'.png'),Buffer.from(url.split(',')[1],'base64'));});
  const nativeSha256=createHash('sha256').update(fs.readFileSync(path.join(path.dirname(hostExe),'libwebrtc.dll'))).digest('hex');
  const save=value=>fs.writeFileSync(path.join(out,variant+'.json'),JSON.stringify({variant,nativeSha256,chrome:process.versions.chrome,platform:process.platform,results:value},null,2));
  ipcMain.handle('completed',(_e,value)=>{save(value);console.log(JSON.stringify({finished:value.at(-1).scenario.name,error:value.at(-1).error}));});
  ipcMain.handle('done',async(_e,value)=>{save(value);await request('/quit');network?.close();setTimeout(()=>app.exit(value.some(x=>x.error)?1:0),800);});
  ipcMain.handle('failed',async(_e,error)=>{console.error(error);await request('/quit');app.exit(1);});
  fs.writeFileSync(path.join(out,'preload.cjs'),`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('mediaBench',Object.fromEntries(['plan','host','candidates','network','frame','completed','done','failed'].map(name=>[name,(...args)=>ipcRenderer.invoke(name,...args)])));`);
  window=new BrowserWindow({show:false,webPreferences:{preload:path.join(out,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  window.webContents.setFrameRate(60);
  fs.copyFileSync(path.join(root,'tests/media-benchmark-renderer.js'),path.join(out,'renderer.js'));
  fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><title>WebDesk media receiver</title><script defer src="renderer.js"></script>');
  window.webContents.on('console-message',(_e,_l,message)=>console.log(message));
  await window.loadFile(path.join(out,'index.html'));
  setTimeout(()=>{console.error('Benchmark timeout');host?.kill();app.exit(1);},plan.length*55000+30000);
}).catch(e=>{console.error(e);host?.kill();network?.close();app.exit(1);});
app.on('will-quit',()=>{host?.kill();network?.close();});
