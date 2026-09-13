import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Codex } from './codex.js';
import { Decoder, encode } from './wire.js';
import { socketPath, stateDir } from './paths.js';
import { instruction, parseAction } from './protocol.js';

export async function serve() {
  if (process.platform !== 'linux') throw new Error('Fode currently supports Linux only');
  await fs.mkdir(stateDir, {recursive:true,mode:0o700});
  await fs.chmod(stateDir, 0o700);
  const occupied = await new Promise(resolve => {
    const s = net.connect(socketPath); s.on('connect', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false));
  });
  if (occupied) throw new Error('Fode is already running');
  await fs.rm(socketPath, {force:true});
  const clients = new Set(); let browser = null, job = null, codex = null, boot = null;
  const requests = new Map(); let outbox = null; let sequence = 0;
  const history = [];
  const send = (socket, value) => {
    if (!socket || socket.destroyed) return;
    if (socket.writableLength > 4_000_000) { socket.destroy(); return; }
    try { socket.write(encode(value)); } catch { socket.destroy(); }
  };
  const status = () => ({browser:!!browser,job:job && {id:job.id,state:job.state,cwd:job.cwd,threadId:job.threadId,turnId:job.turnId,steps:job.steps},requests:[...requests.values()]});
  const emit = (type, data) => {
    const event = {type,data,seq:++sequence};
    history.push(event); if (history.length > 200) history.shift();
    for (const c of clients) send(c,event);
  };
  const update = () => emit('status',status());
  const deliver = text => {
    outbox = {type:'chat.send',data:{id:randomUUID(),jobId:job.id,text}};
    job.state = 'waiting-chatgpt'; send(browser,outbox); update();
  };
  const getCodex = async () => {
    if (boot) return boot;
    codex = new Codex();
    codex.on('exit', message => { boot=null; requests.clear(); if(job && !['done','stopped'].includes(job.state)) job.state='error'; emit('error',message); update(); });
    codex.on('event', m => {
      if (m.id !== undefined) requests.set(m.id,m);
      emit('codex',m);
      if (m.id !== undefined) update();
      if (!job || m.params?.threadId !== job.threadId) return;
      if (m.method === 'turn/started') job.turnId=m.params.turn.id;
      if (m.method === 'item/agentMessage/delta') job.output=(job.output + m.params.delta).slice(-100_000);
      if (m.method === 'turn/completed' && job.state === 'running-codex') {
        job.turnId=null;
        const turn=m.params.turn;
        deliver(`Fode result for step ${job.steps} (${turn.status}):\n${job.output || JSON.stringify(turn.error || 'No text output.')}\n\nContinue the task or emit a done block. Run nonce: ${job.nonce}`);
      }
    });
    boot=codex.start().then(()=>codex).catch(error => {boot=null;throw error;});
    return boot;
  };
  const handle = async (c,m) => {
    const d=m.data || {};
    switch(m.type) {
      case 'hello':
        if(d.role==='browser') {
          if(browser && browser!==c) browser.destroy();
          browser=c; if(outbox) send(c,outbox);
        }
        return status();
      case 'status': return status();
      case 'watch': for(const e of history) send(c,e); return status();
      case 'start': {
        if(job && !['done','stopped','error'].includes(job.state)) throw new Error('A job is active. Stop it before starting another.');
        if(typeof d.prompt!=='string' || !d.prompt.trim() || d.prompt.length>100_000) throw new Error('A prompt of 1–100000 characters is required');
        const cwd=path.resolve(d.cwd || process.cwd());
        if(!(await fs.stat(cwd)).isDirectory()) throw new Error('Working directory does not exist');
        job={id:randomUUID(),nonce:randomUUID(),prompt:d.prompt,cwd,state:'starting',steps:0,seen:new Set(),output:'',maxSteps:d.maxSteps || 12};
        const startingJob=job;
        try {
          const cx=await getCodex();
          const params={cwd,approvalPolicy:'on-request',sandbox:'workspace-write'};
          if(d.fullAccess) {params.approvalPolicy='never';params.sandbox='danger-full-access';}
          // Use the server's advertised default; a global config may name a model
          // that this particular CLI build cannot serve.
          const models=await cx.rpc('model/list',{});
          const defaultModel=models.data?.find(m=>m.isDefault)?.model;
          if(d.model || defaultModel) params.model=d.model || defaultModel;
          const result=await cx.rpc('thread/start',params);
          if(job!==startingJob || job.state==='stopped') return status();
          job.threadId=result.thread.id; deliver(instruction(job));
        } catch(error) {job.state='error';update();throw error;}
        return status();
      }
      case 'chat.ack':
        if(c!==browser) throw new Error('Only the extension can acknowledge delivery');
        if(outbox?.data.id===d.id) outbox=null;
        return {};
      case 'chat.error':
        if(c!==browser) throw new Error('Only the extension can report page errors');
        emit('error',d.message); return {};
      case 'chat.stream': {
        if(c!==browser || d.jobId!==job?.id) throw new Error('Unmanaged chat');
        if(job.state!=='waiting-chatgpt') return {};
        emit('chatgpt',{text:d.text,complete:d.complete});
        if(!d.complete || job.seen.has(d.messageId)) return {};
        job.seen.add(d.messageId);
        const action=parseAction(d.text,job.nonce);
        if(!action) {job.state='done';emit('done',d.text);update();return {};}
        if(action.tool==='done') {job.state='done';emit('done',action.summary);update();return {};}
        if(++job.steps>job.maxSteps) {job.state='error';update();throw new Error('Step limit reached; start a new task to continue');}
        job.state='running-codex';job.output='';update();
        const prompt=action.tool==='shell' ? `Execute this requested shell command in ${job.cwd}, using your terminal tool. Report output and exit code. Apply your normal permissions and project instructions.\n\n${action.command}` : action.prompt;
        try {
          const result=await codex.rpc('turn/start',{threadId:job.threadId,input:[{type:'text',text:prompt}]});
          job.turnId=result.turn.id;update();
        } catch(error) {job.state='error';update();throw error;}
        return {};
      }
      case 'stop':
        outbox=null;
        if(job) {job.state='stopped'; if(job.turnId) await codex.rpc('turn/interrupt',{threadId:job.threadId,turnId:job.turnId});}
        send(browser,{type:'chat.stop'});update();return status();
      case 'rpc': {
        if(c===browser) throw new Error('Raw RPC is terminal-only');
        if(/^(account\/(login|logout)|initialize)/.test(d.method)) throw new Error('Authentication lifecycle is managed by your existing Codex installation');
        return (await getCodex()).rpc(d.method,d.params || {});
      }
      case 'reply':
        if(!requests.has(d.id)) throw new Error('No pending Codex request with that ID');
        codex.send({id:d.id,result:d.result});requests.delete(d.id);update();return {};
      default: throw new Error('Unknown message type');
    }
  };
  const server=net.createServer(c => {
    clients.add(c); const decoder=new Decoder(); c.pipe(decoder);
    // Serialize actions per connection so stream completion cannot race with itself.
    let chain=Promise.resolve();
    decoder.on('data',m => {chain=chain.then(async()=>{
      try {const result=await handle(c,m); if(m.id!==undefined) send(c,{id:m.id,result});}
      catch(error) {if(m.id!==undefined) send(c,{id:m.id,error:error.message});else emit('error',error.message);}
    });});
    decoder.on('error',()=>c.destroy());c.on('error',()=>{});
    c.on('close',()=>{clients.delete(c);if(browser===c){browser=null;update();}});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  await fs.chmod(socketPath,0o600);
  const close=()=>{codex?.close(); for(const c of clients)c.destroy();server.close();fs.rm(socketPath,{force:true}).finally(()=>process.exit(0));};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  console.log(`Fode listening on ${socketPath}`);
}
