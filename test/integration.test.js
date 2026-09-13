import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Decoder,encode} from '../src/wire.js';
import {WebSocket} from 'ws';

test('daemon → native messaging → ChatGPT command → Codex streaming → result, approvals, reconnect and stop',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fode-test-'));
  const fake=path.join(dir,'codex');
  await fs.writeFile(fake,`#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=m=>console.log(JSON.stringify(m));
let reply=false;
rl.on('line',line=>{
 const m=JSON.parse(line);
 if(!m.method){reply=true;return;}
 if(m.method==='initialized')return;
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thread-test'}}});
 if(m.method==='turn/start'){
   send({id:m.id,result:{turn:{id:'turn-test'}}});
   send({method:'turn/started',params:{threadId:'thread-test',turn:{id:'turn-test'}}});
   send({id:900,method:'item/commandExecution/requestApproval',params:{threadId:'thread-test',command:'pwd'}});
   const timer=setInterval(()=>{if(!reply)return;clearInterval(timer);
    send({method:'item/commandExecution/outputDelta',params:{threadId:'thread-test',delta:'terminal-output'}});
    send({method:'item/agentMessage/delta',params:{threadId:'thread-test',delta:'Completed test command'}});
    send({method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}}});
   },20);return;
 }
 send({id:m.id,result:{ok:true}});
});
`,{mode:0o755});
  const env={...process.env,FODE_STATE_DIR:dir,FODE_CODEX:fake};
  const daemon=spawn(process.execPath,['src/cli.js','serve'],{env,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{daemon.kill();await fs.rm(dir,{recursive:true,force:true});});
  await once(daemon.stdout,'data');
  assert.equal((await fs.stat(path.join(dir,'harness.sock'))).mode & 0o777,0o600);
  let id=0;
  function client(input,output,close){
    const decoder=new Decoder();input.pipe(decoder);const events=[],waiting=new Map();
    decoder.on('data',m=>{if(m.id && waiting.has(m.id)){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}else events.push(m);});
    t.after(close);
    return {events,call(type,data={}){return new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});output.write(encode({id:n,type,data}));});}};
  }
  const socket=net.connect(path.join(dir,'harness.sock'));await once(socket,'connect');
  const cli=client(socket,socket,()=>socket.destroy());
  const launched=await cli.call('launch',{cwd:dir});
  assert.equal(launched.threadId,'thread-test');
  assert.equal((await fs.stat(path.join(dir,'codex-tui.sock'))).mode & 0o777,0o600);
  const ws=new WebSocket('ws://localhost',{createConnection:()=>net.connect(path.join(dir,'codex-tui.sock'))});
  t.after(()=>ws.terminate());await once(ws,'open');
  const tuiEvents=[],tuiPending=new Map();
  ws.on('message',bytes=>{const m=JSON.parse(bytes);if(tuiPending.has(m.id)){const p=tuiPending.get(m.id);tuiPending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else tuiEvents.push(m);});
  const tuiCall=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;tuiPending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  await tuiCall('initialize',{});
  await tuiCall('thread/resume',{threadId:launched.threadId});
  assert.deepEqual((await tuiCall('thread/turns/list',{threadId:launched.threadId})).data,[]);
  const native=spawn(process.execPath,['src/native.js'],{env,stdio:['pipe','pipe','pipe']});
  const browser=client(native.stdout,native.stdin,()=>native.kill());
  await browser.call('hello',{role:'browser'});
  await cli.call('start',{prompt:'Test',cwd:dir});
  const waitFor=async predicate=>{for(let i=0;i<200;i++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw new Error('Event timeout');};
  const first=await waitFor(()=>browser.events.find(e=>e.type==='chat.send'));
  const nonce=first.data.text.match(/"nonce":"([^"]+)"/)[1];
  const text='```fode\n'+JSON.stringify({nonce,tool:'shell',command:'pwd'})+'\n```';
  await assert.rejects(cli.call('chat.stream',{jobId:first.data.jobId,text,complete:true,messageId:'x'}),/Unmanaged/);
  await browser.call('chat.ack',{id:first.data.id});
  await browser.call('chat.stream',{jobId:first.data.jobId,text,complete:false,messageId:'x'});
  assert.equal((await cli.call('status')).job.steps,0);
  await waitFor(()=>tuiEvents.find(e=>e.method==='item/agentMessage/delta' && e.params.delta.includes('pwd')));
  await browser.call('chat.stream',{jobId:first.data.jobId,text,complete:true,messageId:'x'});
  await waitFor(()=>browser.events.find(e=>e.type==='codex' && e.data.id===900));
  await cli.call('reply',{id:900,result:{decision:'accept'}});
  const result=await waitFor(()=>browser.events.find(e=>e.type==='chat.send' && e.data.id!==first.data.id));
  assert.match(result.data.text,/Completed test command/);
  assert.ok(browser.events.some(e=>e.type==='codex' && e.data.method==='item/commandExecution/outputDelta'));
  await browser.call('chat.stream',{jobId:first.data.jobId,text,complete:true,messageId:'x'});
  assert.equal((await cli.call('status')).job.steps,1);
  // Unacknowledged delivery survives extension/native-host reconnect.
  native.kill();
  const native2=spawn(process.execPath,['src/native.js'],{env,stdio:['pipe','pipe','pipe']});
  const browser2=client(native2.stdout,native2.stdin,()=>native2.kill());await browser2.call('hello',{role:'browser'});
  await waitFor(()=>browser2.events.find(e=>e.type==='chat.send' && e.data.id===result.data.id));
  await assert.rejects(browser2.call('rpc',{method:'model/list'}),/terminal-only/);
  await assert.rejects(cli.call('rpc',{method:'account/logout'}),/Authentication/);
  await cli.call('stop');assert.equal((await cli.call('status')).job.state,'stopped');
  const turn=await tuiCall('turn/start',{threadId:launched.threadId,input:[{type:'text',text:'Task typed inside Codex'}]});
  assert.equal(turn.turn.status,'inProgress');
  await waitFor(()=>browser2.events.find(e=>e.type==='chat.send' && e.data.text.includes('Task typed inside Codex')));
  await tuiCall('turn/interrupt',{threadId:launched.threadId,turnId:turn.turn.id});
  assert.equal((await cli.call('status')).job.state,'stopped');
  assert.ok((await tuiCall('thread/turns/list',{threadId:launched.threadId})).data.length>0);
});
