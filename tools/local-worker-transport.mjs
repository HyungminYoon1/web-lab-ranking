import {MAX_BODY} from '../src/domain.js';

// Local-only handoff. The outer Node gate already bounds complete uploads, but
// enforce the cap independently in case its internal loopback port is called.
// Complete the native stream before any Durable Object can reject its copy.
// No JSON parsing, policy decisions, storage or logging belongs here.
export async function bufferLocalRequest(request){
  if(!request.body)return request;
  if(Number(request.headers.get('Content-Length')??0)>MAX_BODY){
    await request.body.cancel().catch(()=>{});
    return Response.json({error:'payload_too_large'},{status:413});
  }
  const reader=request.body.getReader(),parts=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BODY){await reader.cancel().catch(()=>{});return Response.json({error:'payload_too_large'},{status:413});}
      parts.push(value);
    }
    const body=new Uint8Array(size);let offset=0;
    for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
    return new Request(request,{body});
  }catch{
    await reader.cancel().catch(()=>{});
    return Response.json({error:'service_unavailable'},{status:503});
  }finally{reader.releaseLock();}
}
