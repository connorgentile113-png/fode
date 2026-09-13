// Opt-in live smoke test; uses the existing Codex account and makes one model turn.
import {Codex} from '../src/codex.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fode-smoke-'));
const cx=new Codex();let tool=false,delta=false;
const timeout=setTimeout(()=>{console.error('Live smoke timed out');cx.close();process.exit(1);},120_000);
try {
  const done=new Promise((resolve,reject)=>cx.on('event',m=>{
    if(m.id!==undefined){cx.send({id:m.id,result:{decision:'decline'}});reject(new Error('Unexpected approval request'));}
    if(m.method==='item/started' && m.params.item?.type==='commandExecution')tool=true;
    if(m.method==='item/agentMessage/delta')delta=true;
    if(m.method==='turn/completed') m.params.turn.status==='completed'?resolve():reject(new Error(JSON.stringify(m.params.turn)));
  }));
  await cx.start();
  const models=await cx.rpc('model/list',{});
  const model=process.env.FODE_TEST_MODEL || models.data.find(m=>m.isDefault).model;
  console.log(`Testing advertised default: ${model}`);
  const {thread}=await cx.rpc('thread/start',{cwd:dir,model,approvalPolicy:'never',sandbox:'read-only'});
  await cx.rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:'Test the terminal tool by running exactly: printf FODE_SMOKE_OK . Do not read or modify files. Then reply FODE_SMOKE_OK.'}]});
  await done;
  if(!tool || !delta)throw new Error(`Missing events: terminal=${tool}, text delta=${delta}`);
  console.log('PASS: real Codex initialize, thread, terminal execution, text streaming and turn completion');
} finally {clearTimeout(timeout);cx.close();await fs.rm(dir,{recursive:true,force:true});}
