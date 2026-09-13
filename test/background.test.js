import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('background uses a pinned inactive tab, reuses it, rejects other tabs, and acknowledges sends',async()=>{
  let receive,handler;const outbound=[],tabs=[],stored={};
  const tick=()=>new Promise(r=>setTimeout(r,20));
  const port={onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(){}},postMessage(m){outbound.push(m);queueMicrotask(()=>receive({id:m.id,result:{browser:true,requests:[]}}));}};
  const browser={
    runtime:{id:'fode@fode.local',connectNative:()=>port,onMessage:{addListener(fn){handler=fn;}}},
    storage:{local:{get:async()=>stored,set:async v=>Object.assign(stored,v),remove:async key=>{delete stored[key];}}},
    browserAction:{setBadgeText(){},setBadgeBackgroundColor(){}},
    alarms:{create(){},onAlarm:{addListener(){}}},
    tabs:{create:async opts=>{const tab={...opts,id:40+tabs.length};tabs.push(tab);return tab;},get:async id=>tabs.find(t=>t.id===id),sendMessage:async()=>({sent:true}),onRemoved:{addListener(){}},update:async()=>{}},
  };
  const context=vm.createContext({browser,console,setTimeout,clearTimeout,queueMicrotask,setInterval(){}});
  vm.runInContext(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8'),context);
  await tick();receive({type:'chat.send',data:{id:'d1',jobId:'job',text:'Task'}});await tick();
  assert.equal(tabs.length,1);assert.equal(tabs[0].active,false);assert.equal(tabs[0].pinned,true);
  assert.ok(outbound.some(m=>m.type==='chat.ack' && m.data.id==='d1'));
  receive({type:'chat.send',data:{id:'d2',jobId:'job',text:'Result'}});await tick();assert.equal(tabs.length,1);
  const count=outbound.length;
  await handler({type:'stream',data:{text:'bad'}},{tab:{id:999},url:'https://chatgpt.com/'});assert.equal(outbound.length,count);
  await handler({type:'stream',data:{text:'good'}},{tab:{id:40},url:'https://chatgpt.com/'});
  assert.equal(outbound.at(-1).data.jobId,'job');
});
