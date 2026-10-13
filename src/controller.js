import {Failure,MAX_BODY} from "./domain.js";

async function boundedJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type")??"")){await request.body?.cancel().catch(()=>{});throw new Failure(415,"json_required");}
  const declared=Number(request.headers.get("Content-Length")??0);
  if(declared>MAX_BODY){await request.body?.cancel().catch(()=>{});throw new Failure(413,"payload_too_large");}
  const reader=request.body?.getReader();if(!reader)throw new Failure(400,"missing_body");
  const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new Failure(413,"payload_too_large");}parts.push(value);}
  const all=new Uint8Array(size);let n=0;for(const p of parts){all.set(p,n);n+=p.length;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));}catch{throw new Failure(400,"invalid_json");}
}
export async function route(request,service){
  try{
    const path=new URL(request.url).pathname,method=request.method,auth=request.headers.get("Authorization");
    if(method==="GET"&&path==="/health")return Response.json(service.health());
    const board=/^\/v1\/boards\/([a-z-]+)$/.exec(path);
    if(method==="GET"&&board)return Response.json(service.board(board[1]));
    let result;
    if(method==="POST"&&path==="/v1/identities")result=await service.createIdentity(await boundedJson(request));
    else if(method==="POST"&&path==="/v1/runs")result=await service.start(await boundedJson(request),auth);
    else if(method==="POST"&&path==="/v1/scores")result=await service.submit(await boundedJson(request),auth);
    else if(method==="DELETE"&&path==="/v1/identity")result=await service.remove(await boundedJson(request),auth);
    else throw new Failure(404,"not_found");
    return Response.json(result,{status:method==="DELETE"?200:201});
  }catch(error){
    return Response.json({error:error instanceof Failure?error.code:"service_unavailable"},{status:error instanceof Failure?error.status:503});
  }
}
