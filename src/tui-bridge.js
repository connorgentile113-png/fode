import http from 'node:http';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';

// Codex's real TUI speaks JSON-RPC over a WebSocket, including over Unix sockets.
// Translate request IDs through the existing stdio client; never start a second
// agent merely to display the first one.
export class TuiBridge {
  constructor({socketPath, getCodex, request, reply}) {
    Object.assign(this,{socketPath,getCodex,request,reply});
    this.clients=new Set();this.chat=null;this.turns=new Map();
  }
  async listen() {
    await fs.rm(this.socketPath,{force:true});
    this.server=http.createServer((_,res)=>{res.writeHead(404);res.end();});
    this.wss=new WebSocketServer({noServer:true,maxPayload:900_000});
    this.server.on('upgrade',(req,socket,head)=>{
      // Browser pages must never access the terminal protocol.
      if(req.headers.origin){socket.destroy();return;}
      this.wss.handleUpgrade(req,socket,head,ws=>this.connect(ws));
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.socketPath,resolve);});
    await fs.chmod(this.socketPath,0o600);
  }
  send(ws,message) {
    if(ws.readyState!==WebSocket.OPEN)return;
    if(ws.bufferedAmount>4_000_000){ws.terminate();return;}
    ws.send(JSON.stringify(message));
  }
  connect(ws) {
    const client={ws,initialized:false,threadId:null};this.clients.add(client);
    ws.on('error',()=>{});ws.on('close',()=>this.clients.delete(client));
    ws.on('message',async bytes=>{
      let m;
      try {
        m=JSON.parse(bytes.toString());
        if(!m.method){if(client.initialized && m.id!==undefined)this.reply(m);return;}
        if(m.method==='initialized')return;
        if(m.method==='initialize'){
          if(client.initialized)throw new Error('Already initialized');
          const cx=await this.getCodex();client.initialized=true;
          this.send(ws,{id:m.id,result:cx.initialization});return;
        }
        if(!client.initialized)throw new Error('Initialize first');
        if(/^account\/(login|logout)/.test(m.method))throw new Error('Use your existing Codex login; Fode does not manage authentication');
        const result=await this.request(m.method,m.params||{});
        if(['thread/start','thread/resume'].includes(m.method))client.threadId=result.thread.id;
        // ChatGPT display turns are local presentation data, not fabricated Codex output.
        if(['thread/resume','thread/read'].includes(m.method) && result.thread) {
          const extra=this.turns.get(result.thread.id)||[];
          result.thread.turns=[...(result.thread.turns||[]),...extra].sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
        }
        if(m.method==='thread/turns/list' && !m.params.cursor) {
          const extra=this.turns.get(m.params.threadId)||[];
          const active=this.chat?.threadId===m.params.threadId?[this.chat.turn]:[];
          result.data=[...result.data,...extra,...active].sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
          if(m.params.sortDirection!=='asc')result.data.reverse();
        }
        if(m.id!==undefined)this.send(ws,{id:m.id,result});
      } catch(error) {if(m?.id!==undefined)this.send(ws,{id:m.id,error:{code:-32000,message:error.message}});}
    });
  }
  event(message) {
    for(const c of this.clients) {
      const threadId=message.params?.threadId;
      if(c.initialized && (!threadId || !c.threadId || threadId===c.threadId))this.send(c.ws,message);
    }
  }
  startChat(threadId,prompt) {
    this.endChat('interrupted');
    const turn={id:randomUUID(),status:'inProgress',items:[],startedAt:Math.floor(Date.now()/1000),completedAt:null,error:null};
    const item={id:randomUUID(),type:'agentMessage',text:'',phase:'final_answer'};
    this.chat={threadId,turn,item,text:''};
    this.event({method:'turn/started',params:{threadId,turn}});
    if(prompt) {
      const user={id:randomUUID(),type:'userMessage',content:[{type:'text',text:prompt,text_elements:[]}]};
      turn.items.push(user);
      this.event({method:'item/started',params:{threadId,turnId:turn.id,item:user,startedAtMs:Date.now()}});
      this.event({method:'item/completed',params:{threadId,turnId:turn.id,item:user,completedAtMs:Date.now()}});
    }
    this.event({method:'item/started',params:{threadId,turnId:turn.id,item,startedAtMs:Date.now()}});
    this.streamChat('[ChatGPT / Fode]\n');
    return {turn};
  }
  streamChat(text) {
    if(!this.chat)return;
    const {threadId,turn,item}=this.chat;
    // Upstream can revise a snapshot. Keep the full latest text for completion;
    // append a revision marker rather than duplicating all preceding tokens.
    const delta=text.startsWith(item.text)?text.slice(item.text.length):'\n[Updated response]\n'+text;
    item.text=text;
    if(delta)this.event({method:'item/agentMessage/delta',params:{threadId,turnId:turn.id,itemId:item.id,delta}});
  }
  endChat(status='completed') {
    if(!this.chat)return;
    const {threadId,turn,item}=this.chat;this.chat=null;
    turn.items.push({...item});turn.status=status;turn.completedAt=Math.floor(Date.now()/1000);
    const history=this.turns.get(threadId)||[];history.push(turn);if(history.length>100)history.shift();this.turns.set(threadId,history);
    this.event({method:'item/completed',params:{threadId,turnId:turn.id,item,completedAtMs:Date.now()}});
    this.event({method:'turn/completed',params:{threadId,turn}});
  }
  async close() {
    for(const c of this.clients)c.ws.terminate();this.wss?.close();
    if(this.server)await new Promise(resolve=>this.server.close(resolve));
    await fs.rm(this.socketPath,{force:true});
  }
}
