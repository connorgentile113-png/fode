/* global browser */
const $=id=>document.getElementById(id);
const call=(type,data)=>browser.runtime.sendMessage({type,data});
const error=e=>{$('error').textContent=e.message;};
browser.storage.local.get('cwd').then(s=>{$('cwd').value=s.cwd||'';});
$('task').onsubmit=async e=>{e.preventDefault();$('error').textContent='';const button=e.submitter;button.disabled=true;try{await browser.storage.local.set({cwd:$('cwd').value});await call('start',{prompt:$('prompt').value,cwd:$('cwd').value,fullAccess:$('full').checked});}catch(e){error(e);}finally{button.disabled=false;}};
$('show').onclick=()=>call('show').catch(error);
$('stop').onclick=()=>call('stop').catch(error);
let requestKey='';
async function refresh(){
  const v=await call('view');$('connection').textContent=v.connected?'● Listening':'○ Offline';$('state').textContent=v.status.job?.state||'Idle';
  const text=v.events.slice(-30).map(e=>{
    if(e.type==='codex')return e.data.params?.delta || e.data.method;
    if(e.type==='chatgpt')return e.data.text;
    if(e.type==='status')return null;
    return typeof e.data==='string'?e.data:JSON.stringify(e.data);
  }).filter(Boolean).join('\n');
  if($('events').textContent!==text){$('events').textContent=text||'Waiting for a signal.';$('events').scrollTop=$('events').scrollHeight;}
  const pending=v.status.requests||[],key=JSON.stringify(pending.map(r=>r.id));
  if(key!==requestKey){requestKey=key;$('requests').replaceChildren();for(const r of pending){
    const article=document.createElement('article'),title=document.createElement('p'),details=document.createElement('pre'),reply=document.createElement('textarea'),submit=document.createElement('button');
    title.textContent='Codex needs your input';details.textContent=JSON.stringify(r,null,2);reply.setAttribute('aria-label','JSON response');reply.value=r.method.includes('requestApproval')?' {"decision":"accept"}':'{}';submit.textContent='Send response';submit.onclick=()=>{try{call('reply',{id:r.id,result:JSON.parse(reply.value)}).catch(error);}catch(e){error(e);}};
    article.append(title,details,reply,submit);$('requests').append(article);
  }}
}
refresh().catch(error);setInterval(()=>refresh().catch(error),1000);
