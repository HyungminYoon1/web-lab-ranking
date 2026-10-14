import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startLocalDev} from './local-dev.mjs';
import {MAX_BODY} from '../src/domain.js';
import {verifyLocalTransport} from './verify-local-transport.mjs';

// Exercise the supported loopback entry, Wrangler and SQLite Durable Objects.
// Never use a remote binding, deployed endpoint, existing DB or request retry.
const require=createRequire(import.meta.url),execFileAsync=promisify(execFile);
assert.equal(MAX_BODY,49152,'The application limit must not change');
assert.equal(process.env.MINIFLARE_WORKERD_PATH,undefined,'Use the locked runtime, not an environment override');
process.env.WRANGLER_SEND_METRICS='false';
const root=path.resolve('output/local-transport-20261014');
await fs.mkdir(root,{recursive:true});
const evidence=await fs.mkdtemp(path.join(root,'regression-'));
const report={environment:'LOCAL_WORKERD',startedAt:new Date().toISOString(),node:process.version,platform:process.platform,
  wrangler:require('wrangler/package.json').version,workerd:require('workerd').version,limitBytes:MAX_BODY,
  productionWrites:0,retries:0,matrices:[],boundaries:[],runtimeDiagnostics:{unreadStreamErrors:0},status:'RUNNING'};
const originalError=console.error,originalWarn=console.warn;
function diagnostics(original){return (...args)=>{
  const message=args.map(value=>String(value)).join(' ');
  if(message.includes("Can't read from request stream after response has been sent."))report.runtimeDiagnostics.unreadStreamErrors++;
  original(...args);
};}
console.error=diagnostics(originalError);console.warn=diagnostics(originalWarn);
let worker,base;
const ownIdentities=new Set();
const ORIGIN='https://hyungminyoon1.github.io';

// A bounded HTTP client with an explicit framing mode, including DELETE bodies.
// Responses/tokens stay in memory; reports contain only byte counts and assertions.
function wire(body,{method='POST',route='/v1/identities',token,contentType='application/json',chunked=false,stream=false,headersOnly=false,abort=false}={}){
  return new Promise((resolve,reject)=>{
    const headers={Origin:ORIGIN,'Content-Type':contentType,...(token?{Authorization:'Bearer '+token}:{})};
    if(chunked)headers['Transfer-Encoding']='chunked';else headers['Content-Length']=String(Buffer.byteLength(body));
    let sent=0,ended=false,timer,done=false;
    const request=http.request(base+route,{method,headers,agent:false,timeout:10000},response=>{
      const parts=[];let size=0;
      clearTimeout(timer);
      response.on('data',chunk=>{size+=chunk.length;if(size>16384){request.destroy(new Error('Response bound exceeded'));return;}parts.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{
        done=true;let data;const text=Buffer.concat(parts).toString('utf8');try{data=JSON.parse(text);}catch{}
        // Stop an unfinished synthetic stream only after receiving the response.
        const beforeEnd=!ended;request.destroy();
        resolve({status:response.statusCode,data,sent,beforeEnd});
      });
    });
    request.on('timeout',()=>request.destroy(new Error('Request timeout')));
    request.on('error',error=>{clearTimeout(timer);if(!done)reject(error);});
    if(abort){
      request.flushHeaders();request.write(body.slice(0,16));sent=16;
      timer=setTimeout(()=>{done=true;request.destroy();resolve({aborted:true,sent});},10);return;
    }
    if(headersOnly){request.flushHeaders();return;}
    if(stream){
      const bytes=Buffer.from(body);
      const write=()=>{
        if(done||request.destroyed)return;
        const end=Math.min(sent+8192,bytes.length);request.write(bytes.subarray(sent,end));sent=end;
        if(sent===bytes.length){ended=true;request.end();}else timer=setTimeout(write,3);
      };write();return;
    }
    ended=true;sent=Buffer.byteLength(body);request.end(body);
  });
}
async function create(body='{}',options={}){
  const result=await wire(body,options);
  if(result.status===201&&result.data?.playerId&&result.data?.token)ownIdentities.add(result.data);
  assert.equal(result.status,201,'Normal/boundary identity creation must succeed');
  assert.ok(result.data?.playerId&&result.data?.token,'Identity response must contain required fields');
  return result.data;
}
async function remove(identity){
  const result=await wire(JSON.stringify({playerId:identity.playerId}),{method:'DELETE',route:'/v1/identity',token:identity.token});
  assert.equal(result.status,200,'Own synthetic local identity must be removable');assert.equal(result.data?.deleted,true);
  ownIdentities.delete(identity);
}
async function followup(){const identity=await create();await remove(identity);}
async function boundaries(){
  for(const bytes of [49151,49152]){
    for(const chunked of [false,true]){
      const identity=await create('{}'+' '.repeat(bytes-2),{chunked});await remove(identity);
      report.boundaries.push({name:'accepted-at-or-below-limit',bytes,chunked,status:201});
    }
  }
  for(const bytes of [49153,60012,1048576]){
    const result=await wire('{}'+' '.repeat(bytes-2),{headersOnly:true});
    assert.equal(result.status,413);assert.equal(result.data?.error,'payload_too_large');assert.equal(result.sent,0);
    await followup();report.boundaries.push({name:'reject-declared-oversize-before-body',declaredBytes:bytes,sentBytes:0,status:413,followup:201});
  }
  const stream=await wire(' '.repeat(262144),{chunked:true,stream:true});
  assert.equal(stream.status,413);assert.equal(stream.data?.error,'payload_too_large');
  assert.ok(stream.beforeEnd&&stream.sent<262144,'Reject the live stream before EOF without draining it');
  await followup();report.boundaries.push({name:'reject-live-chunked-stream',fixtureBytes:262144,sentBytes:stream.sent,beforeEnd:stream.beforeEnd,status:413,followup:201});
  const aborted=await wire(' '.repeat(49152),{abort:true});assert.equal(aborted.aborted,true);
  await followup();report.boundaries.push({name:'client-abort-mid-upload',sentBytes:aborted.sent,followup:201});
  const media=await wire('text/plain',{contentType:'text/plain'});assert.equal(media.status,415);
  await followup();report.boundaries.push({name:'unsupported-media-then-valid',status:415,followup:201});
}
try{
  worker=await startLocalDev({port:0,persistTo:path.join(evidence,'state'),logLevel:'error',watch:false});
  base=worker.url;
  const matrix=[
    {transport:'fetch',cycles:60},{transport:'fresh',cycles:60},{transport:'keepalive',cycles:60},
    {transport:'keepalive',chunked:true,cycles:60},{transport:'fresh',chunked:true,cycles:30},
    {transport:'fetch',payloadBytes:49153,cycles:30},{transport:'keepalive',chunked:true,payloadBytes:49153,cycles:30},
    {transport:'fetch',payloadBytes:1048576,cycles:10},{transport:'keepalive',chunked:true,payloadBytes:1048576,cycles:10}
  ];
  for(const options of matrix){
    const result=await verifyLocalTransport(base,options);report.matrices.push(result);
    console.log(JSON.stringify({transport:result.transport,chunked:result.chunked,bytes:result.oversizeBytes,cycles:result.cycles,status:result.status,failures:result.failures.length}));
    assert.equal(result.failures.length,0,'Oversize rejection must not break a following request');
  }
  await boundaries();
  // Existing full route, CORS, ownership, legal replay and deletion regression.
  const edges=await execFileAsync(process.execPath,['tools/verify-local-edges.mjs',base],{timeout:45000,maxBuffer:1048576,encoding:'utf8'});
  const edgeResult=JSON.parse(edges.stdout);assert.equal(edgeResult.pass,32);report.existingEdges=edgeResult;
  assert.equal(ownIdentities.size,0,'All boundary-test identities are deleted');
  assert.ok(worker.stats.bufferedBytesMax<=MAX_BODY);assert.ok(worker.stats.forwardedBytesMax<=MAX_BODY);
  report.gate=worker.stats;
  report.status='PASS';
}catch(error){
  report.status='FAIL';report.failure={name:error.name,code:error.code,assertion:error.operator};
  // Avoid serializing assertions' actual/expected values or child output.
  console.error('LOCAL TRANSPORT FAIL:',error.name,error.code??'',error.operator??'');process.exitCode=1;
}finally{
  for(const identity of ownIdentities){try{await remove(identity);}catch{report.cleanupFailed=true;report.status='FAIL';process.exitCode=1;}}
  if(worker)await worker.stop();
  console.error=originalError;console.warn=originalWarn;
  if(report.runtimeDiagnostics.unreadStreamErrors){
    report.status='FAIL';report.failure??={name:'NativeStreamDiagnostic',count:report.runtimeDiagnostics.unreadStreamErrors};process.exitCode=1;
  }
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\r\n','utf8');
  console.log(JSON.stringify({status:report.status,cycles:report.matrices.reduce((sum,item)=>sum+item.cycles,0),boundaries:report.boundaries.length,
    existingEdges:report.existingEdges?.pass,runtimeDiagnostics:report.runtimeDiagnostics,productionWrites:0,evidence:path.relative(process.cwd(),evidence)}));
}
