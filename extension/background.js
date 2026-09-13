/* global browser */
'use strict';
let port=null, connected=false, tabId=null, jobId=null, pending=null, retry=1000;
let status={browser:false}, events=[], requestId=0;
const requests=new Map();
function record(type,data) {events.push({type,data});if(events.length>100)events.shift();}
function rpc(type,data={}) {
  if(!port || !connected) return Promise.reject(new Error('Harness offline. Start the Fode user service.'));
  return new Promise((resolve,reject)=>{
    const id=++requestId,timer=setTimeout(()=>{requests.delete(id);reject(new Error('Harness request timed out'));},70000);
    requests.set(id,{resolve,reject,timer});port.postMessage({id,type,data});
  });
}
async function managedTab(newJob) {
  if(newJob) tabId=null;
  if(tabId!==null) {
    try {const t=await browser.tabs.get(tabId);if(t.url?.startsWith('https://chatgpt.com/')) return t;} catch { /* closed */ }
  }
  const t=await browser.tabs.create({url:'https://chatgpt.com/',active:false,pinned:true});
  tabId=t.id;await browser.storage.local.set({tabId,jobId});return t;
}
async function deliver(message) {
  const newJob=jobId!==message.jobId;jobId=message.jobId;pending=message;
  await managedTab(newJob);
  await browser.storage.local.set({tabId,jobId,pending});
  await trySend();
}
let sending=false;
async function trySend() {
  if(!pending || sending || tabId===null) return;
  sending=true;
  try {
    const result=await browser.tabs.sendMessage(tabId,{type:'send',data:pending});
    if(result?.sent) {
      const id=pending.id;pending=null;await browser.storage.local.remove('pending');
      await rpc('chat.ack',{id});
    } else if(result?.error) record('error',result.error);
  } catch { /* content script not ready; alarm retries */ }
  finally {sending=false;}
}
function connect() {
  if(port) return;
  port=browser.runtime.connectNative('local.fode');connected=true;
  port.onMessage.addListener(m=>{
    retry=1000;
    if(m.id!==undefined && requests.has(m.id)) {
      const r=requests.get(m.id);requests.delete(m.id);clearTimeout(r.timer);
      m.error?r.reject(new Error(m.error)):r.resolve(m.result);return;
    }
    if(m.type==='chat.send') deliver(m.data).catch(e=>record('error',e.message));
    else if(m.type==='chat.stop') {
      pending=null;browser.storage.local.remove('pending');
      if(tabId!==null) browser.tabs.sendMessage(tabId,{type:'stop'}).catch(()=>{});
    } else {
      if(m.type==='status') status=m.data;
      record(m.type,m.data);
    }
  });
  port.onDisconnect.addListener(()=>{
    const message=port?.error?.message;port=null;connected=false;
    for(const r of requests.values()){clearTimeout(r.timer);r.reject(new Error(message||'Harness disconnected'));}requests.clear();
    browser.browserAction.setBadgeText({text:'OFF'});
    setTimeout(connect,retry);retry=Math.min(retry*2,30000);
  });
  rpc('hello',{role:'browser'}).then(s=>{status=s;browser.browserAction.setBadgeText({text:'ON'});browser.browserAction.setBadgeBackgroundColor({color:'#426f50'});}).catch(e=>record('error',e.message));
}
browser.runtime.onMessage.addListener((m,sender)=>{
  if(sender.tab) {
    if(sender.tab.id!==tabId || !sender.url?.startsWith('https://chatgpt.com/')) return Promise.resolve({ignored:true});
    if(m.type==='ready') {trySend();return Promise.resolve({jobId});}
    if(m.type==='stream') return rpc('chat.stream',{...m.data,jobId});
    if(m.type==='page.error') return rpc('chat.error',{message:m.message});
    return Promise.resolve({ignored:true});
  }
  if(sender.id!==browser.runtime.id) return;
  if(m.type==='view') return Promise.resolve({connected,status,events,tabId});
  if(m.type==='show') return tabId===null?Promise.resolve():browser.tabs.update(tabId,{active:true});
  if(['start','stop','reply'].includes(m.type)) return rpc(m.type,m.data);
});
browser.tabs.onRemoved.addListener(id=>{if(id===tabId){tabId=null;browser.storage.local.remove('tabId');record('error','Managed tab closed. Pending messages will open a new pinned tab.');}});
browser.alarms.create('reconnect',{periodInMinutes:0.5});
browser.alarms.onAlarm.addListener(()=>{connect();trySend();});
setInterval(trySend,2000);
browser.storage.local.get(['tabId','jobId','pending']).then(saved=>{
  tabId=saved.tabId??null;jobId=saved.jobId??null;pending=saved.pending??null;connect();
});
