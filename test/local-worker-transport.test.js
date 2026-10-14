import test from 'node:test';
import assert from 'node:assert/strict';
import {bufferLocalRequest} from '../tools/local-worker-transport.mjs';
import {MAX_BODY} from '../src/domain.js';

test('local handoff consumes the native body before a rejecting handler can cancel its copy',async()=>{
  let eof=false,canceled=false,pulls=0;
  const stream=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new TextEncoder().encode('text/plain'));else{eof=true;controller.close();}},cancel(){canceled=true;}});
  const native=new Request('http://127.0.0.1/v1/identities',{method:'POST',headers:{Origin:'https://hyungminyoon1.github.io','Content-Type':'text/plain',Authorization:'Bearer synthetic-only'},body:stream,duplex:'half'});
  const buffered=await bufferLocalRequest(native);
  assert.ok(buffered instanceof Request);assert.equal(eof,true);assert.equal(native.bodyUsed,true);assert.equal(canceled,false);
  assert.equal(native.body.locked,false,'Release the completed native reader');
  assert.equal(buffered.method,native.method);assert.equal(buffered.url,native.url);
  assert.deepEqual([...buffered.headers],[...native.headers]);
  await buffered.body.cancel();assert.equal(canceled,false,'Cancelling the detached copy must not touch native input');
});

test('local handoff preserves raw bytes, invalid JSON and exact cap rather than parsing',async()=>{
  for(const bytes of [new Uint8Array([0xff,0,0xc3]),new TextEncoder().encode('{'),new Uint8Array(MAX_BODY).fill(32)]){
    const source=new Request('http://127.0.0.1/v1/identity',{method:'DELETE',body:bytes});
    const buffered=await bufferLocalRequest(source);assert.ok(buffered instanceof Request);
    assert.deepEqual(new Uint8Array(await buffered.arrayBuffer()),bytes);
  }
  const empty=new Request('http://127.0.0.1/health');assert.equal(await bufferLocalRequest(empty),empty);
});

test('local handoff rejects declared or chunked overflow without draining arbitrary input',async()=>{
  for(const declared of [false,true]){
    let pulls=0,canceled=false;
    const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(MAX_BODY/2+1));},cancel(){canceled=true;}});
    const source=new Request('http://127.0.0.1/v1/identities',{method:'POST',headers:declared?{'Content-Length':String(MAX_BODY+1)}:{},body:stream,duplex:'half'});
    const rejected=await bufferLocalRequest(source);
    assert.ok(rejected instanceof Response);assert.equal(rejected.status,413);assert.deepEqual(await rejected.json(),{error:'payload_too_large'});
    assert.equal(canceled,true);assert.ok(pulls<=3,'Bounded reads, not a drain to EOF');assert.equal(source.body.locked,false);
  }
});

test('local handoff fails closed on a broken native stream without exposing internal errors',async()=>{
  const stream=new ReadableStream({pull(controller){controller.error(new Error('synthetic-private-detail'));}});
  const source=new Request('http://127.0.0.1/v1/identities',{method:'POST',body:stream,duplex:'half'});
  const rejected=await bufferLocalRequest(source);
  assert.equal(rejected.status,503);assert.deepEqual(await rejected.json(),{error:'service_unavailable'});assert.equal(source.body.locked,false);
});
