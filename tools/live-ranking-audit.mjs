import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {neonActions, parcelMachines} from '../test/fixtures.js';

const API='https://web-lab-ranking.hyeongmin92.workers.dev';
const SITE='https://hyungminyoon1.github.io';
const KEY='web-lab-ranking-identity-v1';
const GAMES=['neon-tactics','parcel-panic'];
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const fingerprint=entry=>JSON.stringify([entry.nickname,entry.score,entry.tieBreak,entry.achievedAt]);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Explicit, manual production audit only. Tests may import its guards, but do
// not execute the production lifecycle; CI has no production audit command.
// Credentials live in fresh browser contexts and this closure, never artifacts.
// No response substitution, API proxy, state injection, tracing or HAR capture.
export async function createLiveRankingAudit({writerBrowser,observerBrowser,evidenceDir,allowProductionWrites=false}){
  assert.ok(allowProductionWrites===true,'Explicit user-approved production writes required');
  assert.ok(writerBrowser!==observerBrowser,'Independent browser processes required');
  await fs.mkdir(evidenceDir,{recursive:true});
  const startedAt=new Date().toISOString(),suffix=crypto.randomBytes(3).toString('hex');
  const states=new Map(),baseline={},events=[],checks=[],faults=[];
  const labels=Object.fromEntries(GAMES.map((game,i)=>[game,`QA1014${i?'P':'N'}${suffix}`]));
  let initialised=false;
  const record=(name,ok)=>{assert.ok(ok,name);checks.push({name,at:new Date().toISOString()});};
  async function boards(){
    const result={};
    for(const game of GAMES){
      const response=await fetch(API+'/v1/boards/'+game,{headers:{Origin:SITE},signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,200,'Public board GET');
      const data=await response.json();assert.ok(Array.isArray(data.entries),'Public board shape');result[game]=data.entries;
    }
    return result;
  }
  function preserved(current){
    for(const game of GAMES){
      const available=current[game].map(fingerprint);
      for(const entry of baseline[game]){
        const index=available.indexOf(fingerprint(entry));assert.ok(index>=0,game+' pre-existing public record preserved');available.splice(index,1);
      }
    }
  }
  async function initial(){
    assert.ok(!initialised,'Audit already initialised');Object.assign(baseline,await boards());
    for(const game of GAMES){assert.ok(baseline[game].length<49,'Pause on a crowded top-50 board');assert.ok(!baseline[game].some(e=>Object.values(labels).includes(e.nickname)),'Unique test nickname required');}
    initialised=true;return {baselineCounts:Object.fromEntries(GAMES.map(g=>[g,baseline[g].length])),labels};
  }
  async function open(page,game){
    await page.goto(SITE+'/'+game+'/',{waitUntil:'networkidle'});
    if(game==='neon-tactics'&&await page.locator('#welcome-master').isVisible())await page.locator('#welcome-master').click();
    await page.locator('#public-ranking > details > summary').click();
  }
  async function target(page,x,y){
    const board=page.locator('#board');await board.focus();
    const cx=Number(await board.getAttribute('data-cursor-x')),cy=Number(await board.getAttribute('data-cursor-y'));
    for(let i=0;i<Math.abs(x-cx);i++)await page.keyboard.press(x>cx?'ArrowRight':'ArrowLeft');
    for(let i=0;i<Math.abs(y-cy);i++)await page.keyboard.press(y>cy?'ArrowDown':'ArrowUp');
  }
  async function shot(state,label,observer=false){
    const page=observer?state.observerPage:state.page;
    await page.locator('#public-ranking').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(evidenceDir,state.game+'-'+label+'.png'),scale:'css'});
  }
  async function prepare(game){
    assert.ok(initialised&&GAMES.includes(game)&&!states.has(game),'Fresh allowlisted game required');
    const context=await writerBrowser.newContext({viewport:{width:1440,height:1000}});
    const observerContext=await observerBrowser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage(),observerPage=await observerContext.newPage();
    const state={game,context,page,observerContext,observerPage,identity:null,identityReady:Promise.resolve(),identityRequests:0,deleted:false,dialogAccept:true,score:game==='neon-tactics'?4280:1457};
    states.set(game,state);
    for(const [surface,who] of [[page,'writer'],[observerPage,'observer']]){
      surface.on('pageerror',()=>faults.push({game,who,type:'pageerror'}));
      surface.on('response',response=>{
        const url=new URL(response.url());if(url.origin!==API)return;
        const event={game,who,method:response.request().method(),path:url.pathname,status:response.status(),at:new Date().toISOString()};events.push(event);
        if(url.pathname==='/v1/identities'&&who==='writer'&&response.ok()){
          state.identityReady=response.json().then(value=>{assert.ok(typeof value.playerId==='string'&&typeof value.token==='string','Created identity shape');state.identity=value;}).catch(()=>faults.push({game,type:'identity_capture'}));
        }
      });
    }
    // Guards only continue or abort actual requests. They never fake a response.
    await context.route(API+'/**',async route=>{
      try{
        const request=route.request(),method=request.method(),url=new URL(request.url());
        if(method==='GET'||method==='OPTIONS'){await route.continue();return;}
        assert.ok(['POST','DELETE'].includes(method),'Unexpected write method');
        const body=JSON.parse(request.postData()??'null');
        if(method==='POST'&&url.pathname==='/v1/identities'){
          assert.ok(++state.identityRequests===1&&Object.keys(body).length===0,'Only one fresh identity per game');
        }else{
          await state.identityReady;
          assert.ok(state.identity&&body.playerId===state.identity.playerId,'Writes must belong to this audit identity');
          assert.ok(request.headers().authorization==='Bearer '+state.identity.token,'Own credential required');
          if(method==='DELETE')assert.ok(url.pathname==='/v1/identity'&&Object.keys(body).length===1,'Only own identity cleanup allowed');
          else{
            assert.ok(['/v1/runs','/v1/scores'].includes(url.pathname)&&body.game===game,'Only current game writes allowed');
            if(url.pathname==='/v1/scores')assert.ok(body.nickname===labels[game]&&!Object.hasOwn(body,'score'),'Only labelled real-action submission allowed');
          }
        }
        await route.continue();
      }catch{faults.push({game,type:'write_guard'});await route.abort('blockedbyclient');}
    });
    await observerContext.route(API+'/**',async route=>{
      if(['GET','OPTIONS'].includes(route.request().method()))await route.continue();
      else{faults.push({game,type:'observer_write_blocked'});await route.abort('blockedbyclient');}
    });
    page.on('dialog',dialog=>state.dialogAccept?dialog.accept():dialog.dismiss());
    await open(page,game);await open(observerPage,game);
    if(game==='neon-tactics')await observerPage.addLocatorHandler(observerPage.locator('#welcome-dialog'),()=>observerPage.locator('#welcome-master').click());
    record(game+' fresh writer identity absent',await page.evaluate(key=>localStorage.getItem(key)===null,KEY));
    record(game+' independent observer identity absent',await observerPage.evaluate(key=>localStorage.getItem(key)===null,KEY));
    record(game+' no automatic ranking writes',events.every(e=>e.game!==game||e.method==='GET'||e.method==='OPTIONS'));
    await shot(state,'initial');
    await button(page,'공개 기록 도전').click();
    await page.locator('.ranking-status').filter({hasText:'도전 시작 ·'}).waitFor({timeout:20000});
    await state.identityReady;record(game+' own identity captured',!!state.identity);
    for(const other of states.values())if(other!==state&&other.identity)record('different identity per game',other.identity.playerId!==state.identity.playerId);
    record(game+' incomplete score cannot submit',await button(page,'완료 기록 등록').isDisabled());
    return {game,started:true,label:labels[game]};
  }
  async function play(game){
    const state=states.get(game),page=state.page;
    if(game==='neon-tactics')for(const action of neonActions){
      if(action.type==='endTurn'){await page.locator('#end-turn').click();continue;}
      await page.locator('[data-unit="'+action.unitId+'"]').click();
      await page.locator(action.type==='skill'?'#skill-mode':'#move-mode').click();
      await target(page,action.x,action.y);await page.keyboard.press('Enter');
    }else{
      for(const machine of parcelMachines){
        await page.locator('[data-tool="'+machine.type+'"]').click();
        await page.locator('[data-direction="'+machine.dir+'"]').click();
        await target(page,machine.x,machine.y);await page.locator('#place').click();
      }
      for(let i=0;i<142;i++)await page.locator('#step').click();
    }
    record(game+' actual UI completion score',(await page.locator('#result-numbers').textContent()).includes(String(state.score)));
    await shot(state,'completed');await page.locator('#result-close').click();
    record(game+' completed submission enabled',await button(page,'완료 기록 등록').isEnabled());
    const prior=events.filter(e=>e.game===game&&e.path==='/v1/scores').length;
    await page.getByRole('textbox',{name:'닉네임 (선택)',exact:true}).fill('<qa>');await button(page,'완료 기록 등록').click();
    await page.locator('.ranking-status').filter({hasText:'닉네임은 16자 이내'}).waitFor();
    record(game+' invalid nickname rejected without score request',events.filter(e=>e.game===game&&e.path==='/v1/scores').length===prior);
    await page.getByRole('textbox',{name:'닉네임 (선택)',exact:true}).fill(labels[game]);
    return {game,uiScore:state.score,readyToSubmit:true};
  }
  async function observe(game,present=true){
    const state=states.get(game),page=state.observerPage;
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#public-ranking > details > summary').click();
    const responsePromise=page.waitForResponse(r=>r.url()===API+'/v1/boards/'+game&&r.request().method()==='GET');
    await button(page,'순위 보기').click();const response=await responsePromise;assert.equal(response.status(),200,'Observer live board GET');
    const data=await response.json();
    await page.locator('.ranking-status').filter({hasText:'같은 점수·동률 조건'}).waitFor();
    const matches=data.entries.filter(entry=>entry.nickname===labels[game]);
    record(game+(present?' independent Edge sees saved score':' independent Edge confirms deletion'),present?matches.length===1&&matches[0].score===state.score:matches.length===0);
    const rows=page.locator('.ranking-board tbody tr').filter({hasText:labels[game]});
    record(game+(present?' rendered row matches server score':' rendered row removed'),present?await rows.count()===1&&(await rows.textContent()).includes(state.score.toLocaleString('ko-KR')):await rows.count()===0);
    record(game+' observer never gains registration identity',await page.evaluate(key=>localStorage.getItem(key)===null,KEY));
    if(present){
      await page.locator('.ranking-privacy > summary').click();record(game+' observer cannot delete writer record',await button(page,'공개 기록 삭제').isDisabled());
    }
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:width===1440?1000:900});
      await shot(state,(present?'observer-record-':'observer-deleted-')+width,true);
      record(game+' ranking viewport fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    return {game,present,score:matches[0]?.score??null};
  }
  async function submit(game){
    const state=states.get(game),page=state.page;
    const responsePromise=page.waitForResponse(r=>r.url()===API+'/v1/scores'&&r.request().method()==='POST');
    await button(page,'완료 기록 등록').click();const response=await responsePromise;
    const result=await response.json();
    record(game+' production server accepted legal inputs',response.ok()&&result.accepted===true&&result.score===state.score);
    await page.locator('.ranking-status').filter({hasText:state.score.toLocaleString('ko-KR')+'점 검증 완료'}).waitFor({timeout:20000});
    await page.locator('.ranking-board').filter({hasText:labels[game]}).waitFor();
    record(game+' second submit disabled after acceptance',await button(page,'완료 기록 등록').isDisabled());
    state.submitted=true;state.serverResult={status:response.status(),score:result.score,tieBreak:result.tieBreak};
    await shot(state,'registered');preserved(await boards());
    return {game,...state.serverResult};
  }
  async function cancelDelete(game){
    const state=states.get(game),page=state.page;
    await page.locator('.ranking-privacy > summary').click();
    const before=events.filter(e=>e.method==='DELETE').length;state.dialogAccept=false;
    await button(page,'공개 기록 삭제').click();await button(page,'공개 기록 삭제').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('.ranking-privacy button').disabled);
    record(game+' cancelled deletion makes no DELETE',events.filter(e=>e.method==='DELETE').length===before);
    record(game+' cancelled deletion preserves own authority',await page.evaluate(key=>localStorage.getItem(key)!==null,KEY));
    state.dialogAccept=true;return {game,cancelled:true};
  }
  async function remove(game){
    const state=states.get(game),page=state.page;
    if(!await page.locator('.ranking-privacy').getAttribute('open')){
      if(!await button(page,'공개 기록 삭제').isVisible())await page.locator('.ranking-privacy > summary').click();
    }
    state.dialogAccept=true;
    record(game+' deleting only fresh audit-owned identity',await page.evaluate(({key,owned})=>JSON.parse(localStorage.getItem(key)??'null')?.playerId===owned,{key:KEY,owned:state.identity.playerId}));
    const responsePromise=page.waitForResponse(r=>r.url()===API+'/v1/identity'&&r.request().method()==='DELETE');
    await button(page,'공개 기록 삭제').click();const response=await responsePromise;const result=await response.json();
    record(game+' production deletion acknowledged',response.ok()&&result.deleted===true);
    await page.locator('.ranking-status').filter({hasText:'공개 기록이 삭제되었습니다.'}).waitFor();state.deleted=true;
    record(game+' writer registration identity removed',await page.evaluate(key=>localStorage.getItem(key)===null,KEY));
    await shot(state,'deleted');const current=await boards();preserved(current);
    record(game+' test record absent on server',!current[game].some(e=>e.nickname===labels[game]));
    for(const other of states.values())if(other!==state&&other.submitted&&!other.deleted)record('deleting '+game+' preserves other test identity',current[other.game].some(e=>e.nickname===labels[other.game]&&e.score===other.score));
    return {game,deleted:true};
  }
  async function finish(){
    const current=await boards();preserved(current);
    for(const game of GAMES){record(game+' own production record cleaned',states.get(game)?.deleted===true&&!current[game].some(e=>e.nickname===labels[game]));}
    record('no browser or ownership guard errors',faults.length===0);
    record('observer performed no write requests',events.every(e=>e.who!=='observer'||['GET','OPTIONS'].includes(e.method)));
    const report={status:'PASS',environment:'PUBLIC_PAGES_PUBLIC_WORKER',startedAt,finishedAt:new Date().toISOString(),writer:'Chrome '+writerBrowser.version(),observer:'Edge '+observerBrowser.version(),labels,baselineCounts:Object.fromEntries(GAMES.map(g=>[g,baseline[g].length])),finalCounts:Object.fromEntries(GAMES.map(g=>[g,current[g].length])),baselineFingerprint:digest(baseline),finalFingerprint:digest(current),checks,events,faults,results:GAMES.map(game=>({game,...states.get(game).serverResult,deleted:states.get(game).deleted})),scope:{realUI:true,stateInjection:false,responseFixtures:false,providerDatabaseDirectAccess:false,otherPlayerMutations:false,credentialsInArtifacts:false}};
    await fs.writeFile(path.join(evidenceDir,'live-ranking-results.json'),JSON.stringify(report,null,2)+'\r\n','utf8');
    return report;
  }
  async function cleanup(){
    const result=[];
    for(const state of states.values()){
      await state.identityReady;
      if(state.identity&&!state.deleted){
        const response=await fetch(API+'/v1/identity',{method:'DELETE',headers:{Origin:SITE,'Content-Type':'application/json',Authorization:'Bearer '+state.identity.token},body:JSON.stringify({playerId:state.identity.playerId}),signal:AbortSignal.timeout(15000)});
        const data=await response.json();state.deleted=response.ok()&&data.deleted===true;
        result.push({game:state.game,fallbackCleanup:true,status:response.status(),deleted:state.deleted});
        assert.ok(state.deleted,'Own-identity cleanup requires attention; keep browser open');
      }
      await state.context.close();await state.observerContext.close();state.identity=null;
    }
    return result;
  }
  return {initial,prepare,play,submit,observe,cancelDelete,remove,finish,cleanup,labels,
    page:game=>states.get(game)?.page,observerPage:game=>states.get(game)?.observerPage,
    safeStatus:()=>({checks:checks.length,events:[...events],faults:[...faults]})};
}
