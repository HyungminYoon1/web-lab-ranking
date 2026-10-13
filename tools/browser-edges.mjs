import assert from 'node:assert/strict';
import { neonActions, parcelMachines } from '../test/fixtures.js';
const PUBLIC='https://web-lab-ranking.hyeongmin92.workers.dev';
const KEY='web-lab-ranking-identity-v1';
const loopback=base=>assert.equal(new URL(base).hostname,'127.0.0.1');
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function open(page,base,game){
  await page.goto(base+'/'+game+'/');
  if(game==='neon-tactics')await page.locator('#welcome-master').click();
  await page.locator('#public-ranking > details > summary').click();
}
async function target(page,x,y){
  const board=page.locator('#board');await board.focus();
  const cx=Number(await board.getAttribute('data-cursor-x')),cy=Number(await board.getAttribute('data-cursor-y'));
  for(let i=0;i<Math.abs(x-cx);i++)await page.keyboard.press(x>cx?'ArrowRight':'ArrowLeft');
  for(let i=0;i<Math.abs(y-cy);i++)await page.keyboard.press(y>cy?'ArrowDown':'ArrowUp');
}

// Actual game UI -> intercepted exact API origin -> local workerd/SQLite.
// No production request is forwarded and no credential or request body is logged.
export async function verifyRankingLocal(browser,base,api,{capture}={}){
  loopback(base);loopback(api);const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const checks=[],errors=[],identities=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await context.route(PUBLIC+'/**',async route=>{
    const r=route.request(),url=new URL(r.url());
    const headers={'Origin':new URL(base).origin};for(const key of ['content-type','authorization'])if(r.headers()[key])headers[key]=r.headers()[key];
    const response=await fetch(api+url.pathname,{method:r.method(),headers,body:r.postData()??undefined,signal:AbortSignal.timeout(15000)});
    const body=await response.text();if(url.pathname==='/v1/identities'&&response.ok)identities.push(JSON.parse(body));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
  });
  try{
    for(const game of ['neon-tactics','parcel-panic']){
      await page.setViewportSize({width:1440,height:1000});await open(page,base,game);
      await button(page,'공개 기록 도전').click();await page.locator('.ranking-status').filter({hasText:'도전 시작 ·'}).waitFor({timeout:20000});
      if(game==='neon-tactics')for(const c of neonActions){
        if(c.type==='endTurn'){await page.locator('#end-turn').click();continue;}
        await page.locator('[data-unit="'+c.unitId+'"]').click();await page.locator(c.type==='skill'?'#skill-mode':'#move-mode').click();await target(page,c.x,c.y);await page.keyboard.press('Enter');
      }
      else{
        for(const c of parcelMachines){await page.locator('[data-tool="'+c.type+'"]').click();await page.locator('[data-direction="'+c.dir+'"]').click();await target(page,c.x,c.y);await page.locator('#place').click();}
        for(let i=0;i<142;i++)await page.locator('#step').click();
      }
      const score=game==='neon-tactics'?4280:1457;check(game+' legal UI score',(await page.locator('#result-numbers').textContent()).includes(String(score)));
      await page.setViewportSize({width:320,height:900});await page.locator('#result-close').click();
      await page.getByRole('textbox',{name:'닉네임 (선택)',exact:true}).fill('Local browser');await button(page,'완료 기록 등록').click();
      await page.locator('.ranking-status').filter({hasText:score.toLocaleString('ko-KR')+'점 검증 완료'}).waitFor({timeout:20000});
      await page.locator('.ranking-board').filter({hasText:score.toLocaleString('ko-KR')}).waitFor();check(game+' SQLite board',true);
      check(game+' submit disables after accepted',await button(page,'완료 기록 등록').isDisabled());
      for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:900});check(game+' ranking fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      if(capture){await page.locator('#public-ranking').scrollIntoViewIfNeeded();await page.screenshot({path:capture+'/'+game+'-ranking-320.png',scale:'css'});}
    }
    await page.locator('.ranking-privacy > summary').click();await button(page,'공개 기록 삭제').click();await page.locator('.ranking-status').filter({hasText:'공개 기록이 삭제되었습니다.'}).waitFor();
    check('shared identity removed',await page.evaluate(k=>localStorage.getItem(k),KEY)===null);
    for(const game of ['neon-tactics','parcel-panic']){
      const data=await(await fetch(api+'/v1/boards/'+game)).json();check(game+' local fixture erased',!data.entries.some(e=>e.nickname==='Local browser'));
    }
    check('no page errors',errors.length===0);return{environment:'LOCAL_BROWSER_LOCAL_WORKERD',checks,errors,productionWrites:0};
  }finally{
    for(const p of identities){const r=await fetch(api+'/v1/identity',{method:'DELETE',headers:{Origin:new URL(base).origin,'Content-Type':'application/json',Authorization:'Bearer '+p.token},body:JSON.stringify({playerId:p.playerId})});assert.ok([200,401].includes(r.status),'local-only cleanup');}
    await context.close();
  }
}

// Explicit response fixtures, not a production outage or real service expiry.
export async function verifyRankingFailures(browser,base,game){
  loopback(base);const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();const checks=[],errors=[];
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};let mode='offline',calls=0;
  const definition=(await import('../src/domain.js')).definition(game);
  await context.route(PUBLIC+'/**',async route=>{calls++;if(mode==='offline'){await route.abort();return;}
    const data=mode==='valid'?{definition,entries:[{rank:1,nickname:'fixture',score:100}]}:mode==='invalid'?{definition,entries:[{rank:-1,nickname:'bad',score:100}]}:{error:mode};
    await route.fulfill({status:mode==='daily_limit'?429:mode==='service_unavailable'?503:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':new URL(base).origin},body:JSON.stringify(data)});
  });
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  try{
    await open(page,base,game);await button(page,'공개 기록 도전').click();check('cancelled opt-in makes no request',calls===0);
    await button(page,'순위 보기').click();await page.locator('.ranking-status').filter({hasText:'개인 플레이'}).waitFor();check('offline controls recover',await button(page,'순위 보기').isEnabled());
    mode='valid';await button(page,'순위 보기').click();await page.locator('.ranking-board').filter({hasText:'fixture'}).waitFor();const before=await page.locator('.ranking-board').textContent();
    mode='invalid';await button(page,'순위 보기').click();await page.locator('.ranking-status').filter({hasText:'연결할 수 없습니다'}).waitFor();check('invalid board preserves previous display',await page.locator('.ranking-board').textContent()===before);
    mode='daily_limit';await button(page,'순위 보기').click();await page.locator('.ranking-status').filter({hasText:'오늘 등록 한도'}).waitFor();check('quota explanation and retry',await button(page,'순위 보기').isEnabled());
    if(game==='neon-tactics'){await page.locator('#board').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');check('private controls usable',await page.locator('#end-turn').isEnabled());}
    else{await page.locator('[data-tool="sorter"]').click();await page.locator('#place').click();check('private controls usable',await page.locator('#undo').isEnabled());}
    check('no page errors',errors.length===0);return{game,environment:'BROWSER_RESPONSE_FIXTURE',checks,errors,productionWrites:0};
  }finally{await context.close();}
}
