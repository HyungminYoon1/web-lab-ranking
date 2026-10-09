import test from "node:test";
import assert from "node:assert/strict";
import {validIdentity,readIdentity,mountRanking} from "../client/ranking-client.js";
const identity={version:1,playerId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",token:"a".repeat(64)};
test("ranking identity exact version and bounded credential shape",()=>{
  assert.equal(validIdentity(identity),true);
  for(const bad of[null,{}, {...identity,extra:1},{...identity,version:2},{...identity,token:"x".repeat(64)},{...identity,playerId:"plain-name"}])assert.equal(validIdentity(bad),false);
});
test("ranking credential reads only its approved key and fails closed",()=>{
  const storage={getItem(key){assert.equal(key,"web-lab-ranking-identity-v1");return JSON.stringify(identity);}};
  assert.deepEqual(readIdentity(storage),identity);
  for(const raw of["bad-json","x".repeat(257),JSON.stringify({...identity,extra:1})])assert.equal(readIdentity({getItem:()=>raw}),null);
  assert.equal(readIdentity({getItem(){throw Error("denied");}}),null);
  assert.equal(readIdentity(null),null);
});
test("transport rejects an unapproved origin before DOM or credentials",()=>{
  for(const apiBase of["https://example.com","https://web-lab-ranking.hyeongmin92.workers.dev.evil.example","http://web-lab-ranking.hyeongmin92.workers.dev"])
    assert.throws(()=>mountRanking({root:{},adapter:{},apiBase}),/endpoint not allowed/);
});
