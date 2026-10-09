import test from "node:test";
import assert from "node:assert/strict";
import {definition,definitions,verified,nickname,compare,submission,POLICY,digest} from "../src/domain.js";
import {RankingRepository} from "../src/repository.js";
import {RankingService} from "../src/service.js";
import {route} from "../src/controller.js";
import {storage} from "./sqlite-adapter.js";
import {neonActions,parcelActions} from "./fixtures.js";

function harness(){
  const db=storage(),repository=new RankingRepository(db);let now=Date.UTC(2026,9,9);
  const service=new RankingService(repository,{clock:()=>now});
  return {db,repository,service,advance(ms){now+=ms;},get now(){return now;}};
}
async function identity(h){const player=await h.service.createIdentity({});return {...player,authorization:"Bearer "+player.token};}
async function attempt(h,p,game="neon-tactics"){const d=definition(game),run=await h.service.start({playerId:p.playerId,game,rulesVersion:d.rulesVersion,challengeId:d.challengeId},p.authorization);return {playerId:p.playerId,runId:run.runId,game,rulesVersion:d.rulesVersion,challengeId:d.challengeId,nickname:"테스트",actions:game==="neon-tactics"?neonActions:parcelActions};}
const rejects=(action,code)=>assert.rejects(action,e=>e.code===code);

test("only fixed approved hardest boards, versions and actual legal witnesses",()=>{
  assert.deepEqual(definitions().map(d=>[d.game,d.levelId]),[["parcel-panic",14],["neon-tactics",16]]);
  assert.equal(verified("neon-tactics",neonActions).score,4280);
  assert.equal(verified("parcel-panic",parcelActions).score,1457);
  assert.throws(()=>definition("sense-lab"));
  for(const [game,actions]of[["neon-tactics",neonActions],["parcel-panic",parcelActions]]){
    assert.throws(()=>verified(game,[]),e=>e.code==="challenge_not_completed");
    assert.throws(()=>verified(game,[...actions,{type:"tick"}]),e=>e.code==="illegal_replay");
    assert.throws(()=>verified(game,[{type:"setScore",score:99999}]),e=>e.code==="illegal_replay");
  }
});
test("nickname is bounded NFC plain text and scores use deterministic ties",()=>{
  assert.equal(nickname("  하늘  "),"하늘");assert.equal(nickname(""),"");
  for(const value of ["<script>","🙂","x".repeat(17),"a\n<script>"])assert.throws(()=>nickname(value));
  assert.equal(compare({score:100,tieBreak:[1,2]},{score:100,tieBreak:[1,2]}),0);
  assert.ok(compare({score:100,tieBreak:[1,2]},{score:100,tieBreak:[2,1]})<0);
});
test("anonymous credential is hashed, invalid bearer/foreign identity denied",async()=>{
  const h=harness(),p=await identity(h);
  assert.equal(h.repository.player(p.playerId).digest===p.token,false);
  assert.equal(h.repository.player(p.playerId).digest===await digest(p.token),true);
  await rejects(()=>h.service.start({playerId:p.playerId,game:"neon-tactics",rulesVersion:definition("neon-tactics").rulesVersion,challengeId:definition("neon-tactics").challengeId},"Bearer "+"0".repeat(64)),"unauthorized");
  h.db.close();
});
test("server recomputes real score; single-use retry and public projection",async()=>{
  const h=harness(),p=await identity(h),body=await attempt(h,p);
  const result=await h.service.submit(body,p.authorization);assert.equal(result.score,4280);assert.equal(result.improved,true);
  const retry=await h.service.submit(body,p.authorization);assert.deepEqual(retry,result);assert.equal(h.repository.count("bests"),1);
  const entry=h.service.board(body.game).entries[0];assert.equal(entry.rank,1);assert.equal(entry.nickname,"테스트");assert.equal(entry.score,4280);
  assert.deepEqual(Object.keys(entry).sort(),["rank","nickname","score","tieBreak","achievedAt"].sort());
  assert.equal(JSON.stringify(entry).includes(p.playerId),false);assert.equal(JSON.stringify(entry).includes(p.token),false);
  await rejects(()=>h.service.submit({...body,score:99999},p.authorization),"invalid_fields");
  const fresh=await attempt(h,p);assert.equal((await h.service.submit(fresh,p.authorization)).improved,false);
  h.db.close();
});
test("equal verified outcomes share rank, not an arrival-time speed advantage",async()=>{
  const h=harness(),a=await identity(h),b=await identity(h);
  await h.service.submit(await attempt(h,a),a.authorization);h.advance(50000);
  await h.service.submit(await attempt(h,b),b.authorization);
  assert.deepEqual(h.service.board("neon-tactics").entries.map(x=>x.rank),[1,1]);h.db.close();
});
test("no fabricated/assisted/incomplete/version-mismatched result accepted",async()=>{
  const h=harness(),p=await identity(h),body=await attempt(h,p);
  await rejects(()=>h.service.submit({...body,rulesVersion:"old"},p.authorization),"rules_changed");
  await rejects(()=>h.service.submit({...body,actions:[]},p.authorization),"challenge_not_completed");
  await rejects(()=>h.service.submit({...body,actions:[{type:"hint"}]},p.authorization),"illegal_replay");
  await rejects(()=>h.service.submit({...body,actions:Array.from({length:21},()=>({type:"endTurn"}))},p.authorization),"action_limit");
  assert.equal(h.repository.count("bests"),0);h.db.close();
});
test("ticket binds player and game; expiry fails without losing private game",async()=>{
  const h=harness(),p=await identity(h),q=await identity(h),body=await attempt(h,p);
  await rejects(()=>h.service.submit({...body,playerId:q.playerId},q.authorization),"unknown_attempt");
  const d=definition("parcel-panic");
  await rejects(()=>h.service.submit({...body,game:d.game,rulesVersion:d.rulesVersion,challengeId:d.challengeId,actions:parcelActions},p.authorization),"rules_changed");
  h.advance(POLICY.ticketMs+1);
  await assert.rejects(()=>h.service.submit(body,p.authorization),e=>["unknown_attempt","attempt_expired"].includes(e.code));assert.equal(h.repository.count("bests"),0);h.db.close();
});
test("authenticated delete isolates another player's record and both own games",async()=>{
  const h=harness(),a=await identity(h),b=await identity(h);
  for(const game of ["parcel-panic","neon-tactics"])await h.service.submit(await attempt(h,a,game),a.authorization);
  await h.service.submit(await attempt(h,b),b.authorization);
  await rejects(()=>h.service.remove({playerId:a.playerId},b.authorization),"unauthorized");
  assert.equal((await h.service.remove({playerId:a.playerId},a.authorization)).deleted,true);
  assert.equal(h.repository.count("players"),1);assert.equal(h.repository.count("bests"),1);
  assert.equal(h.service.board("neon-tactics").entries.length,1);assert.equal(h.service.board("parcel-panic").entries.length,0);h.db.close();
});
test("inactivity retention cleans expired data and no longer authenticates",async()=>{
  const h=harness(),p=await identity(h);await h.service.submit(await attempt(h,p),p.authorization);
  h.advance(POLICY.retentionMs+1);h.service.board("neon-tactics");assert.equal(h.repository.count("bests"),0);
  await rejects(()=>h.service.remove({playerId:p.playerId},p.authorization),"unauthorized");h.db.close();
});
test("expired records are hidden even while bounded physical cleanup is pending",async()=>{
  const h=harness(),p=await identity(h);await h.service.submit(await attempt(h,p),p.authorization);
  h.advance(POLICY.retentionMs+1);
  assert.equal(h.repository.count("bests"),1);
  assert.equal(h.repository.board(definition("neon-tactics"),h.now).length,0);
  h.db.close();
});
test("daily caps reject new work without overwriting verified scores",async()=>{
  const h=harness(),p=await identity(h);await h.service.submit(await attempt(h,p),p.authorization);
  h.repository.sql.exec("UPDATE daily SET requests=? WHERE day=?",POLICY.requestsPerDay,Math.floor(h.now/86400000));
  assert.throws(()=>h.service.board("neon-tactics"),e=>e.code==="daily_limit");
  assert.equal(h.repository.count("bests"),1);h.advance(86400000);assert.equal(h.service.board("neon-tactics").entries.length,1);
  h.repository.sql.exec("UPDATE daily SET runs=? WHERE day=?",POLICY.runsPerDay,Math.floor(h.now/86400000));
  await rejects(()=>attempt(h,p),"daily_limit");h.db.close();
});
test("JSON transport rejects oversize, unknown fields and internal error leaks",async()=>{
  const h=harness(),url="https://ranking.test/v1/identities";
  const request=(body,contentType="application/json")=>new Request(url,{method:"POST",headers:{"Content-Type":contentType},body});
  for(const [body,type,status]of[["{}","text/plain",415],["not JSON","application/json",400],['{"token":"fake"}',"application/json",400],[" ".repeat(49153),"application/json",413]]){
    const result=await route(request(body,type),h.service);assert.equal(result.status,status);assert.deepEqual(Object.keys(await result.json()),["error"]);
  }
  const health=await route(new Request("https://ranking.test/health"),h.service);assert.equal(health.status,200);
  const created=await route(request("{}"),h.service);assert.equal(created.status,201);
  const fail=await route(new Request("https://ranking.test/v1/boards/neon-tactics"),{board(){throw new Error("private credentials SQL");}});
  assert.deepEqual(await fail.json(),{error:"service_unavailable"});h.db.close();
});
