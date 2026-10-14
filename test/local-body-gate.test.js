import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createLocalBodyGate} from '../tools/local-body-gate.mjs';

test('local gate rejects oversized length/chunks before forwarding and preserves the next POST',async()=>{
  let forwarded=0,maxForwarded=0;
  const gate=await createLocalBodyGate({port:0,forward:async request=>{
    const body=await request.arrayBuffer();forwarded++;maxForwarded=Math.max(maxForwarded,body.byteLength);
    return Response.json({bytes:body.byteLength},{status:201});
  }});
  try{
    for(const bytes of [49151,49152]){
      const response=await fetch(gate.url,{method:'POST',body:'x'.repeat(bytes)});
      assert.equal(response.status,201);assert.equal((await response.json()).bytes,bytes);
    }
    const before=forwarded;
    for(const bytes of [49153,60012,1048576]){
      const response=await fetch(gate.url,{method:'POST',body:'x'.repeat(bytes)});
      assert.equal(response.status,413);assert.equal((await response.json()).error,'payload_too_large');
      const next=await fetch(gate.url,{method:'POST',body:'{}'});assert.equal(next.status,201);await next.arrayBuffer();
    }
    const status=await new Promise((resolve,reject)=>{
      const request=http.request(gate.url,{method:'POST',headers:{'Transfer-Encoding':'chunked'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
      request.on('error',reject);for(let i=0;i<8;i++)request.write(Buffer.alloc(8192));request.end();
    });
    assert.equal(status,413);assert.equal(forwarded,before+3);assert.equal(maxForwarded,49152);
    assert.equal(gate.stats.forwardedBytesMax,49152);assert.ok(gate.stats.bufferedBytesMax<=49152);
  }finally{await gate.stop();}
});

test('a rejected origin cannot receive a reflected CORS header from the gate',async()=>{
  const gate=await createLocalBodyGate({port:0,forward:async()=>new Response(null)});
  try{
    const response=await fetch(gate.url,{method:'POST',headers:{Origin:'https://untrusted.example'},body:'x'.repeat(60012)});
    assert.equal(response.status,413);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);await response.arrayBuffer();
  }finally{await gate.stop();}
});

test('Fetch-decoded upstream responses do not retain compressed wire headers',async()=>{
  const gate=await createLocalBodyGate({port:0,forward:async()=>Response.json({ok:true},{headers:{'Content-Encoding':'gzip','Content-Length':'31'}})});
  try{
    const response=await fetch(gate.url);assert.equal(response.headers.get('Content-Encoding'),null);
    assert.deepEqual(await response.json(),{ok:true});
  }finally{await gate.stop();}
});

test('1 MiB rejection survives a client delaying response reads for 300ms',async()=>{
  let forwarded=0;
  const gate=await createLocalBodyGate({port:0,forward:async()=>{forwarded++;return new Response(null);}});
  try{
    const result=await new Promise((resolve,reject)=>{
      const request=http.request(gate.url,{method:'POST',headers:{'Content-Length':'1048576'},timeout:3000},response=>{
        response.pause();const parts=[];
        response.on('error',reject);response.on('data',chunk=>parts.push(chunk));
        response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(Buffer.concat(parts).toString('utf8'))}));
        setTimeout(()=>response.resume(),300);
      });
      request.on('timeout',()=>request.destroy(new Error('timeout')));request.on('error',reject);request.end(Buffer.alloc(1048576));
    });
    assert.equal(result.status,413);assert.equal(result.data.error,'payload_too_large');assert.equal(forwarded,0);
  }finally{await gate.stop();}
});

test('Expect oversized headers receive 413 without 100-continue or upstream work',async()=>{
  let forwarded=0,continued=false;
  const gate=await createLocalBodyGate({port:0,forward:async()=>{forwarded++;return new Response(null);}});
  try{
    const status=await new Promise((resolve,reject)=>{
      const request=http.request(gate.url,{method:'POST',headers:{'Content-Length':'60012',Expect:'100-continue'},timeout:3000},response=>{
        response.resume();response.on('end',()=>{request.destroy();resolve(response.statusCode);});response.on('error',reject);
      });
      request.on('continue',()=>{continued=true;request.end(Buffer.alloc(60012));});request.on('error',reject);
      request.on('timeout',()=>request.destroy(new Error('timeout')));request.flushHeaders();
    });
    assert.equal(status,413);assert.equal(continued,false);assert.equal(forwarded,0);assert.equal(gate.stats.bufferedBytesMax,0);
  }finally{await gate.stop();}
});

test('a stalled partial upload times out without forwarding and a following request works',async()=>{
  let forwarded=0;
  const gate=await createLocalBodyGate({port:0,uploadTimeoutMs:40,forward:async()=>{forwarded++;return new Response(null,{status:201});}});
  try{
    const status=await new Promise((resolve,reject)=>{
      const request=http.request(gate.url,{method:'POST',headers:{'Content-Length':'49152'},timeout:3000},response=>{
        response.resume();response.on('end',()=>{request.destroy();resolve(response.statusCode);});response.on('error',reject);
      });
      request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('timeout')));request.write('incomplete');
    });
    assert.equal(status,408);assert.equal(forwarded,0);
    const next=await fetch(gate.url,{method:'POST',body:'{}'});assert.equal(next.status,201);await next.arrayBuffer();assert.equal(forwarded,1);
  }finally{await gate.stop();}
});

test('valid framed bodies preserve authorization and route; forwarding failures fail closed',async()=>{
  let failuresForwarded=0;
  const gate=await createLocalBodyGate({port:0,forward:async request=>{
    if(new URL(request.url).pathname==='/unavailable'){failuresForwarded++;throw new Error('synthetic upstream failure');}
    assert.equal(request.headers.get('Authorization'),'Bearer synthetic-only');
    assert.equal(request.method,'DELETE');assert.deepEqual(await request.json(),{playerId:'fixture'});
    return Response.json({deleted:true});
  }});
  try{
    const response=await fetch(gate.url+'/v1/identity',{method:'DELETE',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({playerId:'fixture'})});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true});
    const unavailable=await fetch(gate.url+'/unavailable');assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'service_unavailable'});
    assert.equal(failuresForwarded,1,'No transparent retry of a failed request');
  }finally{await gate.stop();}
});

test('local-origin reflection is explicitly enabled and never wildcard',async()=>{
  for(const allowLocal of [false,true]){
    const gate=await createLocalBodyGate({port:0,allowLocal,forward:async()=>new Response(null)});
    try{
      for(const origin of ['http://127.0.0.1:4178','https://untrusted.example']){
        const response=await fetch(gate.url,{method:'POST',headers:{Origin:origin},body:'x'.repeat(49153)});
        assert.equal(response.status,413);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'),allowLocal&&origin==='http://127.0.0.1:4178'?origin:null);
        await response.arrayBuffer();
      }
    }finally{await gate.stop();}
  }
});
