#!/usr/bin/env node
import net from 'node:net';
import { Decoder,encode } from './wire.js';
import { socketPath } from './paths.js';
import { serve } from './daemon.js';
import { launchCodex } from './launch.js';
const [command,...args]=process.argv.slice(2);
const help=`Fode • Linux Firefox / ChatGPT / Codex\n\n  fode launch codex                  Open Codex with Fode streaming into it\n  fode serve                         Run the persistent harness\n  fode run "task" [--cwd PATH] [--full-access] [--model NAME]\n  fode watch                         Stream ChatGPT, Codex and tool events\n  fode status                        Show connection and pending requests\n  fode stop                          Interrupt the current run\n  fode reply ID '{"decision":"accept"}'\n  fode rpc METHOD '{"params":"here"}'  Access the installed Codex protocol\n\nDefault: workspace-write with Codex approvals. --full-access grants this job\nunrestricted execution. Existing Codex login and configuration are retained.\n`;
try {
  if(command==='launch') await launchCodex(args);
  else if(command==='serve') await serve();
  else if(!command || ['help','--help','-h'].includes(command)) console.log(help);
  else {
    let type=command,data={};
    if(command==='run') {
      type='start'; const prompt=[];
      for(let i=0;i<args.length;i++) {
        if(args[i]==='--cwd') data.cwd=args[++i];
        else if(args[i]==='--model') data.model=args[++i];
        else if(args[i]==='--full-access') data.fullAccess=true;
        else prompt.push(args[i]);
      }
      data.prompt=prompt.join(' ');data.cwd ||= process.cwd();
    } else if(command==='rpc') data={method:args[0],params:JSON.parse(args[1]||'{}')};
    else if(command==='reply') {let id;try{id=JSON.parse(args[0]);}catch{id=args[0];}data={id,result:JSON.parse(args[1])};}
    else if(!['status','watch','stop'].includes(command)) throw new Error(help);
    const socket=net.connect(socketPath),decoder=new Decoder(); socket.pipe(decoder);
    socket.on('connect',()=>socket.write(encode({id:1,type,data})));
    socket.on('error',e=>{console.error(`Fode: ${e.message}. Run fode serve.`);process.exitCode=1;});
    decoder.on('error',e=>{console.error(e.message);socket.destroy();process.exitCode=1;});
    let chatText='';
    decoder.on('data',m=>{
      if(m.id===1) {
        console.log(JSON.stringify(m.error?{error:m.error}:m.result,null,2));
        if(m.error) process.exitCode=1;
        if(command!=='watch') socket.end();
      } else if(command==='watch') {
        const event=m.data;
        if(m.type==='codex' && event.method?.endsWith('/delta')) process.stdout.write(event.params.delta || '');
        else if(m.type==='chatgpt') {
          if(!event.text.startsWith(chatText)) {process.stdout.write('\n[ChatGPT] ');chatText='';}
          process.stdout.write(event.text.slice(chatText.length));chatText=event.text;
          if(event.complete){process.stdout.write('\n');chatText='';}
        }
        else console.log('\n'+JSON.stringify(m));
      }
    });
    process.once('SIGINT',()=>socket.destroy());
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
