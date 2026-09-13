/* global browser */
(() => {
  'use strict';
  if(window.__fodeLoaded) return;window.__fodeLoaded=true;
  const assistantSelector='[data-message-author-role="assistant"]';
  const composerSelector='#prompt-textarea, textarea[data-id="root"], textarea[placeholder="Ask ChatGPT"], [contenteditable="true"][role="textbox"]';
  let active=null, previous='', stableSince=0, sawBusy=false, completed=false;
  let baseline=new Set(), timer=null, submitting=false;
  const busy=()=>!!document.querySelector('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]');
  const report=message=>browser.runtime.sendMessage({type:'page.error',message}).catch(()=>{});
  function assistantId(node,index) {return node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || `index-${index}`;}
  function responseText(node) {
    const clone=node.cloneNode(true);
    // innerText alone loses fenced-code language markers in ChatGPT's rendered DOM.
    clone.querySelectorAll('pre').forEach(pre=>{
      const code=pre.querySelector('code');if(!code)return;
      const lang=code.className.match(/language-([\w-]+)/)?.[1] || (pre.textContent.includes('fode')?'fode':'');
      pre.replaceWith(document.createTextNode(`\n\x60\x60\x60${lang}\n${code.textContent}\n\x60\x60\x60\n`));
    });
    clone.querySelectorAll('button').forEach(n=>n.remove());
    return clone.textContent;
  }
  async function scan() {
    if(!active || completed) return;
    if(busy()) sawBusy=true;
    const nodes=[...document.querySelectorAll(assistantSelector)];
    const index=nodes.length-1,node=nodes[index];
    if(!node || baseline.has(assistantId(node,index))) return;
    const text=responseText(node);
    if(text!==previous) {
      previous=text;stableSince=Date.now();
      await browser.runtime.sendMessage({type:'stream',data:{messageId:assistantId(node,index),text,complete:false}}).catch(()=>{});
    }
    // Require an explicit completed-message control, or a witnessed busy→idle transition.
    const container=node.closest('article') || node.parentElement;
    const finishedControl=container?.querySelector('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [aria-label="Copy response"]');
    if(text && !busy() && (sawBusy || finishedControl) && Date.now()-stableSince>1500) {
      try {
        await browser.runtime.sendMessage({type:'stream',data:{messageId:assistantId(node,index),text,complete:true}});
        completed=true;
      } catch(error) {report(error.message);}
    }
  }
  function observe() {
    if(timer) return;
    timer=setInterval(()=>scan().catch(e=>report(e.message)),250);
  }
  async function send(data) {
    if(submitting) return {error:'A message is being submitted'};
    if(sessionStorage.getItem('fode.sent.'+data.id)) return {sent:true};
    const composer=document.querySelector(composerSelector);
    if(!composer) return {error:'ChatGPT composer unavailable. Sign in to ChatGPT in the pinned tab.'};
    if(busy()) return {error:'Waiting for ChatGPT to finish'};
    if((composer.value || composer.textContent || '').trim()) return {error:'The managed composer contains a draft. Send or clear it to continue.'};
    submitting=true;
    try {
      baseline=new Set([...document.querySelectorAll(assistantSelector)].map(assistantId));
      active=data;previous='';completed=false;sawBusy=false;stableSince=Date.now();
      sessionStorage.setItem('fode.active',JSON.stringify({data,baseline:[...baseline]}));
      if(composer.tagName==='TEXTAREA') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,data.text);
        composer.dispatchEvent(new Event('input',{bubbles:true}));
      } else {
        composer.replaceChildren(...data.text.split('\n').map(line=>{const p=document.createElement('p');p.textContent=line||'\u200b';return p;}));
        composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:data.text}));
      }
      // Framework state updates may commit after the input event.
      for(let i=0;i<30;i++) {
        const button=document.querySelector('[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
        if(button && !button.disabled) {
          // Record before clicking: after a crash, never blindly duplicate a terminal task.
          sessionStorage.setItem('fode.sent.'+data.id,'1');button.click();observe();return {sent:true};
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return {error:'ChatGPT send button did not become ready. Inspect the pinned tab.'};
    } finally {submitting=false;}
  }
  browser.runtime.onMessage.addListener(m=>{
    if(m.type==='send') return send(m.data);
    if(m.type==='stop') {active=null;sessionStorage.removeItem('fode.active');document.querySelector('[data-testid="stop-button"]')?.click();return Promise.resolve({stopped:true});}
  });
  try {
    const saved=JSON.parse(sessionStorage.getItem('fode.active'));
    if(saved){active=saved.data;baseline=new Set(saved.baseline);observe();}
  } catch { /* no saved run */ }
  browser.runtime.sendMessage({type:'ready'}).catch(()=>{});
})();
