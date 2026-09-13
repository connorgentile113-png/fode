import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Decoder,encode} from './wire.js';
import {socketPath} from './paths.js';

export function requestLaunch(data) {
  return new Promise((resolve,reject)=>{
    const socket=net.connect(socketPath),decoder=new Decoder();socket.pipe(decoder);
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('Fode launch timed out'));},70_000);
    const fail=e=>{clearTimeout(timer);socket.destroy();reject(e);};
    socket.on('error',fail);decoder.on('error',fail);
    socket.on('connect',()=>socket.write(encode({id:1,type:'launch',data})));
    decoder.on('data',m=>{if(m.id!==1)return;clearTimeout(timer);socket.end();m.error?reject(new Error(m.error)):resolve(m.result);});
    socket.on('end',()=>{clearTimeout(timer);reject(new Error('Fode disconnected during launch'));});
  });
}
export async function launchCodex(args) {
  if(args[0]!=='codex')throw new Error('Usage: fode launch codex [--cwd PATH]');
  const data={cwd:process.cwd()};
  for(let i=1;i<args.length;i++) {
    if(args[i]==='--cwd' && args[i+1])data.cwd=args[++i];
    else throw new Error('Usage: fode launch codex [--cwd PATH]');
  }
  if(!process.stdin.isTTY || !process.stdout.isTTY)throw new Error('Run fode launch codex in an interactive terminal');
  let session;
  try {session=await requestLaunch(data);}
  catch(error) {
    if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;
    const service=spawn('systemctl',['--user','start','fode.service'],{stdio:'inherit'});
    const [code]=await once(service,'exit');if(code!==0)throw new Error('Start the harness with fode serve, then retry');
    for(let i=0;i<30;i++) {
      try{session=await requestLaunch(data);break;}catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,100));}
    }
    if(!session)throw new Error('Fode service did not become ready');
  }
  console.log('Opening Codex with Fode. Type a task here to send it through ChatGPT.');
  if(!session.browser)console.log('Firefox is not connected yet. Load the Fode extension to receive ChatGPT replies.');
  const child=spawn(process.env.FODE_CODEX || 'codex',['--remote',session.endpoint,'resume',session.threadId,'--no-alt-screen'],{stdio:'inherit',cwd:session.cwd});
  // The foreground process group already delivers terminal signals to Codex.
  const keepAlive=()=>{};process.on('SIGINT',keepAlive);
  try{const [code]=await once(child,'exit');process.exitCode=code??1;}
  finally{process.removeListener('SIGINT',keepAlive);}
}
