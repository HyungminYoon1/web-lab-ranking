import {definitions} from "../src/domain.js";
import {neonActions,parcelActions} from "../test/fixtures.js";
const base=process.argv[2]??"http://127.0.0.1:9131",origin=process.argv[3]??"http://127.0.0.1:4179",results=[];
async function call(path,method="GET",body,token,expected=200){
  const headers={Origin:origin};
  if(body!==undefined)headers["Content-Type"]="application/json";
  if(token)headers.Authorization="Bearer "+token;
  const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const json=await response.json();
  if(response.status!==expected)throw Error("HTTP status mismatch for "+path+": "+response.status+" "+(json.error??"unknown"));
  return json;
}
const health=await call("/health");if(health.games.length!==2)throw Error("Board count");
const player=await call("/v1/identities","POST",{},null,201);
try{
  for(const d of definitions()){
    const run=await call("/v1/runs","POST",{playerId:player.playerId,game:d.game,rulesVersion:d.rulesVersion,challengeId:d.challengeId},player.token,201);
    const body={playerId:player.playerId,runId:run.runId,game:d.game,rulesVersion:d.rulesVersion,challengeId:d.challengeId,nickname:"QA검증",actions:d.game==="neon-tactics"?neonActions:parcelActions};
    await call("/v1/scores","POST",{...body,actions:[]},player.token,422);
    const started=performance.now(),won=await call("/v1/scores","POST",body,player.token,201);
    const board=await call("/v1/boards/"+d.game);
    const retry=await call("/v1/scores","POST",body,player.token,201);
    if(won.score!==retry.score||!board.entries.some(e=>e.nickname==="QA검증"&&e.score===won.score))throw Error("Persistence/idempotency mismatch");
    results.push({game:d.game,score:won.score,httpRoundTripMs:Math.round(performance.now()-started),boardVerified:true});
    await call("/v1/scores","POST",{...body,score:99999},player.token,400);
  }
}finally{
  await call("/v1/identity","DELETE",{playerId:player.playerId},player.token);
}
for(const d of definitions()){
  const board=await call("/v1/boards/"+d.game);if(board.entries.some(e=>e.nickname==="QA검증"))throw Error("QA record not erased");
}
const denied=await fetch(base+"/v1/boards/neon-tactics",{headers:{Origin:"https://outside.invalid"}});
if(denied.status!==403)throw Error("CORS origin bypass");
console.log(JSON.stringify({evidence:base.startsWith("http://127.")?"LOCAL_WORKERD_HTTP_SQLITE":"LIVE_HTTP_SQLITE",results,negativeCases:"PASS",testIdentityAndScores:"REMOVED",credentials:"NEVER_LOGGED"}));
