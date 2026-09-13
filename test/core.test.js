import test from 'node:test';
import assert from 'node:assert/strict';
import {Decoder,encode,MAX_FRAME} from '../src/wire.js';
import {parseAction} from '../src/protocol.js';
test('native frames survive single-byte fragmentation and coalescing',async()=>{
  const d=new Decoder(),out=[];d.on('data',v=>out.push(v));
  const values=[{text:'Unicode 🌲\n'}, {id:12,result:{ok:true}}];
  const bytes=Buffer.concat(values.map(encode));
  for(const byte of bytes)d.write(Buffer.from([byte]));d.end();
  await new Promise(resolve=>d.on('end',resolve));assert.deepEqual(out,values);
});
test('oversize and truncated frames fail closed',async()=>{
  for(const bytes of [Buffer.from([255,255,255,127]),Buffer.from([4,0,0,0,123])]){
    const d=new Decoder();const error=new Promise(resolve=>d.on('error',resolve));d.resume();d.end(bytes);assert.ok(await error);
  }
  assert.throws(()=>encode({text:'x'.repeat(MAX_FRAME)}));
});
test('only a complete, nonce-bound command block is actionable',()=>{
  const block='```fode\n'+JSON.stringify({nonce:'run-1',tool:'shell',command:'pwd'})+'\n```';
  assert.equal(parseAction(block,'run-1').command,'pwd');
  assert.equal(parseAction(block.slice(0,-3),'run-1'),null);
  assert.equal(parseAction('```bash\npwd\n```','run-1'),null);
  assert.throws(()=>parseAction(block,'another-run'));
  assert.throws(()=>parseAction(block+'\n'+block,'run-1'));
  assert.throws(()=>parseAction('```fode\n{"nonce":"run-1","tool":"rpc"}\n```','run-1'));
});
