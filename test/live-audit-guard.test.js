import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveRankingAudit} from '../tools/live-ranking-audit.mjs';

test('live audit cannot start without explicit boolean production authorization',async()=>{
  for(const allowProductionWrites of [undefined,false,'true',1]){
    await assert.rejects(createLiveRankingAudit({allowProductionWrites}),/Explicit user-approved production writes required/);
  }
});

test('live audit cannot confuse one browser with an independent observer',async()=>{
  const browser={};
  await assert.rejects(createLiveRankingAudit({writerBrowser:browser,observerBrowser:browser,allowProductionWrites:true}),/Independent browser processes required/);
});
