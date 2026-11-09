const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture}=require('./browser-fixture.cjs');
async function choose(page, selector, value){await page.locator(selector).click();await page.locator(`[data-choice-value="${value}"]`).click();}
async function main(){const f=await fixture();let checks=0;const test=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`)};
const saved=(settings,presets=[])=>({version:1,settings,presets});
try{
 const page=await f.page();await page.locator('#btn-nav-1').click();await page.locator('[data-action="open-settings"]').click();
 await test('all six themes and Classic Light apply real app tokens immediately',async()=>{
  assert.equal(await page.locator('[data-appearance-theme]').count(),6);
  for(const name of ['cosmic','classic','ocean','aurora','solar','matrix']){await page.locator(`[data-appearance-theme="${name}"]`).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),name);}
  await page.locator('[data-appearance-theme="classic"]').click();await choose(page,'[data-appearance-setting="classicMode"]','light');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).color),'rgb(23, 35, 56)');assert.equal(await page.evaluate(()=>document.documentElement.style.colorScheme),'light');
 });
 await test('stars, gradients, surfaces, button shape, glow and response update actual UI',async()=>{
  const result=await page.evaluate(()=>{SolAppearance.update({stars:false,gradients:false,cardStyle:'solid',cardRadius:8,buttonStyle:'outline',buttonRadius:4,glow:false,response:80});return {star:getComputedStyle(document.getElementById('stardust-box')).opacity,gradient:getComputedStyle(document.querySelector('.app-container')).backgroundImage,radius:getComputedStyle(document.querySelector('.sub-card')).borderRadius,button:getComputedStyle(document.querySelector('.settings-open')).borderRadius,shadow:getComputedStyle(document.getElementById('connect-btn')).boxShadow}});
  assert.equal(result.star,'0');assert.equal(result.gradient,'none');assert.equal(result.radius,'8px');assert.equal(result.button,'4px');assert.equal(result.shadow,'none');
 });
 await test('each palette and surface style keeps primary and secondary text contrasted',async()=>{
  const results=await page.evaluate(()=>{
   const lum=hex=>{const v=hex.match(/[\da-f]{2}/gi).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
   const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};const rows=[];
   for(const theme of ['cosmic','classic','ocean','aurora','solar','matrix'])for(const classicMode of ['dark','light'])for(const cardStyle of ['glass','solid','outline']){
    SolAppearance.update({theme,classicMode,cardStyle,animations:false});const css=getComputedStyle(document.documentElement);rows.push([theme,classicMode,cardStyle,ratio(css.getPropertyValue('--sol-text').trim(),css.getPropertyValue('--sol-bg').trim()),ratio(css.getPropertyValue('--sol-muted').trim(),css.getPropertyValue('--sol-bg').trim())]);
   }return rows;
  });for(const row of results){assert.ok(row[3]>=4.5,row.join(' '));assert.ok(row[4]>=4.5,row.join(' '));}
 });
 await test('valid random combinations differ and never change the active tab or financial state',async()=>{
  const result=await page.evaluate(()=>{const snapshots=[];for(let i=0;i<40;i++){SolAppearance.randomize();snapshots.push(SolAppearance.snapshot().settings)}return {snapshots,tab:document.querySelector('.screen.active').id,selectedMonths}});
  for(let i=1;i<result.snapshots.length;i++)assert.notDeepEqual(result.snapshots[i],result.snapshots[i-1]);
  assert.equal(result.tab,'screen-settings');assert.equal(result.selectedMonths,null);assert.equal(f.state.requests.filter(r=>r.method==='POST').length,0);
 });
 await test('20 named presets persist, use plain text, apply/delete and reset retains presets',async()=>{
  await page.evaluate(()=>SolAppearance.update({theme:'matrix',randomOnLaunch:true}));
  // Drive through the public preference API; names never become HTML.
  await page.evaluate(()=>{for(let i=0;i<20;i++)SolAppearance.savePreset(i===0?'<img src=x onerror=alert(1)>':`Пресет ${i}`)});
  assert.equal(await page.locator('#appearance-presets .appearance-preset').count(),20);assert.equal(await page.locator('#appearance-presets img').count(),0);
  assert.match(await page.evaluate(()=>SolAppearance.savePreset('Лишний')),/20/);
  const id=await page.evaluate(()=>SolAppearance.snapshot().presets[0].id);await page.evaluate(id=>{SolAppearance.update({theme:'solar'});SolAppearance.applyPreset(id)},id);
  assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.theme),'matrix');assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),true);
  await page.evaluate(()=>SolAppearance.reset());assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.theme),'cosmic');assert.equal(await page.locator('.appearance-preset').count(),20);
  await page.evaluate(id=>SolAppearance.deletePreset(id),id);assert.equal(await page.locator('.appearance-preset').count(),19);
 });
 await test('preferences and presets remain isolated between Telegram users',async()=>{
  await page.evaluate(()=>{SolAppearance.setUser(7001);SolAppearance.update({theme:'ocean'});SolAppearance.setUser(7002)});
  assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.theme),'cosmic');assert.equal(await page.locator('.appearance-preset').count(),0);
  await page.evaluate(()=>{SolAppearance.update({theme:'solar'});SolAppearance.setUser(7001)});assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.theme),'ocean');assert.equal(await page.locator('.appearance-preset').count(),19);
 });
 await test('saved theme is applied in the head before delayed bootstrap without a default-theme flash',async()=>{
  f.state.bootstrapDelay=600;const p=await f.page({storage:{'sol-appearance:v1:7001':saved({theme:'aurora'})},wait:false});
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'aurora');assert.equal(await p.evaluate(()=>document.documentElement.dataset.appearanceReady),'true');await p.waitForFunction(()=>serverOnline);f.state.bootstrapDelay=0;await p.context().close();
 });
 await test('random-on-launch runs once per document, survives saving, and tab switches do not regenerate',async()=>{
  const p=await f.page({storage:{'sol-appearance:v1:7001':saved({randomOnLaunch:true})}});const first=await p.evaluate(()=>SolAppearance.snapshot().settings);
  await p.locator('#btn-nav-1').click();await p.locator('#btn-nav-3').click();assert.deepEqual(await p.evaluate(()=>SolAppearance.snapshot().settings),first);
  await p.evaluate(()=>SolAppearance.savePreset('Случайная'));assert.equal(await p.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),true);
  await p.reload();await p.waitForFunction(()=>serverOnline);assert.notDeepEqual(await p.evaluate(()=>SolAppearance.snapshot().settings),first);await p.context().close();
 });
 await test('Smooth Blend, Radial Wave and Liquid Morph complete without stale palette callbacks',async()=>{
  const p=await f.page({reducedMotion:'no-preference'});
  for(const transition of ['smooth','radial','liquid']){await p.evaluate(transition=>{SolAppearance.update({transition,animations:true});SolAppearance.update({theme:'solar'});SolAppearance.update({theme:'ocean'})},transition);await p.waitForFunction(()=>document.documentElement.dataset.theme==='ocean');await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>document.documentElement.dataset.themeTransition),'none');}
  await p.context().close();
 });
 await test('reduced motion and older WebViews retain immediate working controls',async()=>{
  const p=await f.page({fallback:true});await p.evaluate(()=>SolAppearance.update({theme:'matrix',transition:'radial'}));assert.equal(await p.evaluate(()=>document.documentElement.dataset.motion),'off');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'matrix');await p.context().close();
  const weak=await f.page({weak:true,reducedMotion:'no-preference'});await weak.evaluate(()=>SolAppearance.update({theme:'aurora',transition:'liquid'}));assert.equal(await weak.evaluate(()=>document.documentElement.dataset.effects),'simple');assert.equal(await weak.evaluate(()=>document.documentElement.dataset.themeTransition),'smooth');await weak.context().close();
 });
 await test('appearance settings and payment sheet fit all requested widths and desktop',async()=>{
  await page.evaluate(()=>{SolAppearance.setUser(7001);SolAppearance.reset()});
  for(const width of [320,360,390,440,1024]){await page.setViewportSize({width,height:900});await page.evaluate(()=>switchNav(1,'settings'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await f.select(page);const box=await page.locator('#payment-methods').boundingBox();assert.ok(box.y>=900*.44&&box.y<=900*.51,`${width}: top ${box.y}`);assert.ok(box.y+box.height<=901);await page.evaluate(()=>closePaymentSheet());}
 });
 await test('Classic Light keeps actual profile actions, selected FAQ and admin inputs readable',async()=>{
  await page.evaluate(()=>{SolAppearance.update({theme:'classic',classicMode:'light',animations:false});switchNav(1,'profile')});
  assert.equal(await page.locator('.act-title').first().evaluate(el=>getComputedStyle(el).color),'rgb(23, 35, 56)');
  await page.evaluate(()=>{switchNav(3,'info');answerFAQ(9)});
  assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').evaluate(el=>getComputedStyle(el).color),'rgb(23, 35, 56)');
  assert.equal(await page.locator('#admin-promo-name').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(223, 230, 238)');
 });
 await test('three random modes work through settings and preset saves do not disable startup mode',async()=>{
  await page.evaluate(()=>switchNav(1,'settings'));await choose(page,'#appearance-mode','generated');
  assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),false);assert.equal(await page.locator('#appearance-mode').evaluate(el=>el.value),'generated');
  await choose(page,'#appearance-mode','startup');assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),true);
  await page.locator('#appearance-preset-name').fill('В режиме запуска');await page.locator('#appearance-save').click();assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),true);
  await choose(page,'#appearance-mode','fixed');assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.randomOnLaunch),false);
 });
 await test('blocked or invalid local storage cannot break controls or leak another user preferences',async()=>{
  const p=await f.page({blockedStorage:true});await p.evaluate(()=>{SolAppearance.update({theme:'solar'});SolAppearance.setUser(7002)});assert.equal(await p.evaluate(()=>SolAppearance.snapshot().settings.theme),'cosmic');
  await p.evaluate(()=>SolAppearance.setUser(7001));assert.equal(await p.evaluate(()=>SolAppearance.snapshot().settings.theme),'solar');assert.equal(await p.evaluate(()=>SolAppearance.snapshot().storageAvailable),false);await p.context().close();
  const invalid=await f.page({storage:{'sol-appearance:v1:7001':saved({theme:'bad',opacity:-100,cardRadius:999,animations:'yes'})}});const config=await invalid.evaluate(()=>SolAppearance.snapshot().settings);
  assert.equal(config.theme,'cosmic');assert.equal(config.opacity,35);assert.equal(config.cardRadius,32);assert.equal(typeof config.animations,'boolean');await invalid.context().close();
 });
 await test('keyboard-size viewport keeps settings scrollable and current preferences intact',async()=>{
  await page.evaluate(()=>switchNav(1,'settings'));const before=await page.evaluate(()=>SolAppearance.snapshot().settings);await page.setViewportSize({width:390,height:330});await page.locator('#appearance-preset-name').scrollIntoViewIfNeeded();await page.locator('#appearance-preset-name').fill('С клавиатурой');
  const box=await page.locator('#appearance-preset-name').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=330);assert.deepEqual(await page.evaluate(()=>SolAppearance.snapshot().settings),before);await page.setViewportSize({width:390,height:844});
 });
 await test('continuous slider updates never capture full-screen View Transition snapshots',async()=>{
  const p=await f.page({reducedMotion:'no-preference'});const calls=await p.evaluate(()=>{let calls=0;document.startViewTransition=update=>{calls++;update();return {ready:Promise.resolve(),finished:Promise.resolve(),skipTransition(){}}};for(let i=0;i<50;i++)SolAppearance.update({glowIntensity:i,cardRadius:i%30});return calls});assert.equal(calls,0);await p.context().close();
 });
 if(process.env.SOL_APPEARANCE_SCREENSHOT_DIR){await fs.mkdir(process.env.SOL_APPEARANCE_SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:390,height:844});for(const theme of ['cosmic','classic','ocean','aurora','solar','matrix']){await page.evaluate(theme=>{SolAppearance.update({theme,animations:false});switchNav(1,'settings')},theme);await page.screenshot({path:path.join(process.env.SOL_APPEARANCE_SCREENSHOT_DIR,`${theme}-390.png`)});}await page.evaluate(()=>SolAppearance.update({theme:'classic',classicMode:'light'}));await page.screenshot({path:path.join(process.env.SOL_APPEARANCE_SCREENSHOT_DIR,'classic-light-390.png')});}
 assert.deepEqual(f.errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
}finally{await f.close()}}
main().catch(e=>{console.error(e);process.exitCode=1});
