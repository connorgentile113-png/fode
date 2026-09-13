import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
export class Codex extends EventEmitter {
  constructor() { super(); this.pending = new Map(); this.nextId = 0; }
  async start() {
    this.child = spawn(process.env.FODE_CODEX || 'codex', ['app-server', '--listen', 'stdio://'], {stdio: ['pipe','pipe','pipe']});
    this.child.stdin.on('error', () => {});
    this.child.stderr.on('data', data => this.emit('diagnostic', data.toString()));
    const failed = error => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
      this.pending.clear(); this.emit('exit', error.message);
    };
    this.child.on('error', failed);
    this.child.on('exit', code => failed(new Error(`Codex exited (${code})`)));
    createInterface({input:this.child.stdout}).on('line', line => {
      try {
        const m = JSON.parse(line);
        if (m.method) this.emit('event', m);
        else if (this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } catch (error) { this.emit('diagnostic', error.message); }
    });
    await this.rpc('initialize', {clientInfo:{name:'fode',title:'Fode',version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.send({method:'initialized',params:{}});
  }
  send(message) { this.child.stdin.write(JSON.stringify(message) + '\n'); }
  rpc(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex timed out: ${method}`)); }, 60_000);
      this.pending.set(id, {resolve,reject,timer});
      this.send({id,method,params});
    });
  }
  close() { this.child?.kill('SIGTERM'); }
}
