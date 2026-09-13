import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
if(process.platform!=='linux') throw new Error('Linux only');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),home=os.homedir();
const bin=path.join(home,'.local/bin'),hosts=path.join(home,'.mozilla/native-messaging-hosts'),units=path.join(home,'.config/systemd/user');
for(const d of [bin,hosts,units])await fs.mkdir(d,{recursive:true});
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
for(const [name,file] of [['fode','cli.js'],['fode-native','native.js']]) {
  await fs.writeFile(path.join(bin,name),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root,'src',file))} "$@"\n`,{mode:0o755});
}
await fs.writeFile(path.join(hosts,'local.fode.json'),JSON.stringify({name:'local.fode',description:'Fode Linux Codex harness',path:path.join(bin,'fode-native'),type:'stdio',allowed_extensions:['fode@fode.local']},null,2));
const unitQuote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
if(/[\n\r]/.test(root)) throw new Error('Installation path cannot contain newlines');
const unit=`[Unit]\nDescription=Fode ChatGPT and Codex harness\n\n[Service]\nType=simple\nExecStart=${unitQuote(process.execPath)} ${unitQuote(path.join(root,'src/cli.js'))} serve\nWorkingDirectory=${root.replaceAll('%','%%')}\nEnvironment=${unitQuote('PATH='+process.env.PATH)}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
await fs.writeFile(path.join(units,'fode.service'),unit);
execFileSync('systemctl',['--user','daemon-reload'],{stdio:'inherit'});
execFileSync('systemctl',['--user','enable','--now','fode.service'],{stdio:'inherit'});
execFileSync('systemctl',['--user','is-active','--quiet','fode.service']);
console.log(`Installed Linux harness and Firefox native host.\nCLI: ${bin}/fode\nExtension: ${root}/extension/manifest.json\nUse a Mozilla-signed XPI for permanent Firefox installation. Development: about:debugging → This Firefox → Load Temporary Add-on.`);
