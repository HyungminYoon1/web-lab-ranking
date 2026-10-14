import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {MAX_BODY} from '../src/domain.js';

const ORIGIN='https://hyungminyoon1.github.io';
const LARGE=JSON.stringify({value:'가'.repeat(20000)});

// A failing live workerd regression, not a response double. Loopback only;
// every request is sent once. No secret, identity response or request body is logged.
export async function verifyLocalTransport(base,{cycles=20,transport='fetch',chunked=false,payloadBytes}={}){
  const url=new URL(base);assert.ok(url.protocol==='http:'&&url.hostname==='127.0.0.1','Loopback only');
  assert.ok(Number.isInteger(cycles)&&cycles>=1&&cycles<=100,'Bounded cycles');
  assert.ok(['fetch','keepalive','fresh'].includes(transport),'Known transport');
  if(payloadBytes!==undefined)assert.ok(Number.isInteger(payloadBytes)&&payloadBytes>MAX_BODY&&payloadBytes<=1048576,'Bounded oversized fixture');
  const large=payloadBytes===undefined?LARGE:'{}'+' '.repeat(payloadBytes-2);
  const agent=transport==='keepalive'?new http.Agent({keepAlive:true,maxSockets:1}):false;
  const steps=[],failures=[],identities=[];let activeCycle=-1;
  async function send(route,body,method='POST',token){
    const headers={Origin:ORIGIN,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
    let status,contentType,text,socket;
    if(transport==='fetch'){
      const response=await fetch(base+route,{method,headers,body,signal:AbortSignal.timeout(10000)});
      status=response.status;contentType=response.headers.get('content-type');text=await response.text();
    }else{
      if(chunked)headers['Transfer-Encoding']='chunked';else headers['Content-Length']=String(Buffer.byteLength(body));
      ({status,contentType,text,socket}=await new Promise((resolve,reject)=>{
        const request=http.request(base+route,{method,headers,agent,timeout:10000},response=>{
          const parts=[];let size=0;
          response.on('data',chunk=>{size+=chunk.length;if(size>16384){request.destroy(new Error('Response bound exceeded'));return;}parts.push(chunk);});
          response.on('end',()=>resolve({status:response.statusCode,contentType:response.headers['content-type'],text:Buffer.concat(parts).toString('utf8'),socket:request.socket?.localPort}));
          response.on('error',reject);
        });
        request.on('timeout',()=>request.destroy(new Error('Request timeout')));request.on('error',reject);
        if(chunked){const bytes=Buffer.from(body);for(let n=0;n<bytes.length;n+=8192)request.write(bytes.subarray(n,n+8192));request.end();}else request.end(body);
      }));
    }
    let data;try{data=JSON.parse(text);}catch{}
    if(route==='/v1/identities'&&status===201&&data?.token&&data?.playerId)identities.push(data);
    const classified=data?.error??(data?'json':/Network connection lost/i.test(text)?'non_json_network_connection_lost':'non_json');
    const event={cycle:activeCycle,method,route,bytes:Buffer.byteLength(body),status,contentType,bodyKind:classified,...(socket?{localPort:socket}:{})};steps.push(event);
    return {event,data};
  }
  try{
    for(let i=0;i<cycles;i++){
      activeCycle=i;
      try{
        const rejected=await send('/v1/identities',large);
        if(rejected.event.status!==413||rejected.data?.error!=='payload_too_large')failures.push({cycle:i,stage:'oversize',...rejected.event});
        // Immediate next request, no sleep/retry/connection-close workaround.
        const normal=await send('/v1/identities','{}');
        if(normal.event.status!==201||!normal.data?.playerId||!normal.data?.token)failures.push({cycle:i,stage:'followup',...normal.event});
        if(normal.event.status===201&&normal.data?.token){
          const removed=await send('/v1/identity',JSON.stringify({playerId:normal.data.playerId}),'DELETE',normal.data.token);
          if(removed.event.status!==200||removed.data?.deleted!==true)failures.push({cycle:i,stage:'cleanup',...removed.event});
          else identities.splice(identities.indexOf(normal.data),1);
        }
      }catch(error){failures.push({cycle:i,stage:'transport',error:typeof error.code==='string'?error.code:error.name});}
    }
  }finally{
    for(const identity of identities){
      // Own synthetic local identities only; a failed cleanup remains a failure.
      try{const removed=await send('/v1/identity',JSON.stringify({playerId:identity.playerId}),'DELETE',identity.token);if(removed.data?.deleted!==true)failures.push({stage:'final_cleanup',status:removed.event.status});}catch{failures.push({stage:'final_cleanup',error:'transport'});}
    }
    if(agent)agent.destroy();
  }
  return {environment:'LOCAL_WORKERD',limitBytes:MAX_BODY,oversizeBytes:Buffer.byteLength(large),followupBytes:2,transport,chunked,cycles,productionWrites:0,retries:0,status:failures.length?'FAIL':'PASS',failures,steps};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [base,transport='fetch',count='20',evidence='output/local-transport-20261014/reproduction.json',mode='length']=process.argv.slice(2);
  const report=await verifyLocalTransport(base,{transport,cycles:Number(count),chunked:mode==='chunked'});
  await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\r\n','utf8');
  console.log(JSON.stringify({status:report.status,transport,chunked:report.chunked,cycles:report.cycles,limitBytes:report.limitBytes,oversizeBytes:report.oversizeBytes,followupBytes:2,failures:report.failures,productionWrites:0}));
  assert.equal(report.failures.length,0,'Each oversized 413 must be followed by a normal 201 with no retry');
}
