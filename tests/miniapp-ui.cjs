// Offline visual/accessibility regressions. All API and Telegram traffic is mocked.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture}=require('./browser-fixture.cjs');
const artifacts=process.env.SOL_UI_SCREENSHOT_DIR;
async function settings(page){await page.evaluate(()=>switchNav(1,'settings'));}
async function section(page,name){const summary=page.locator('.appearance-section summary').filter({hasText:name});if(await summary.getAttribute('aria-expanded')!=='true')await summary.click();}
async function choose(page,name,value){await page.locator(`[data-appearance-choice="${name}"]`).click();await page.locator(`[data-choice-value="${value}"]`).click();}
async function geometry(page){return page.evaluate(()=>{const el=document.querySelector('.choice-dialog'),b=el.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth};});}
async function main(){const f=await fixture();let checks=0;
const test=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
try{
 const page=await f.page();
 await test('all static UI decorations are SVG; currency and user-authored text stay meaningful',async()=>{
  const result=await page.evaluate(()=>({text:document.querySelector('.app-container').textContent.replace(/⭐\uFE0F?/gu,''),nav:[...document.querySelectorAll('.nav-icon')].map(el=>el.querySelectorAll('svg').length),icons:[...document.querySelectorAll('.sol-icon')].map(el=>[el.getAttribute('aria-hidden'),el.getAttribute('focusable'),el.getAttribute('stroke-width')])}));
  assert.equal(/\p{Extended_Pictographic}/u.test(result.text),false);assert.deepEqual(result.nav,[1,1,1,1,1]);assert.ok(result.icons.length>20);assert.ok(result.icons.every(v=>v.join('|')==='true|false|1.4'));
  await settings(page);await page.locator('#appearance-preset-name').fill('Мой 🚀 стиль');await page.locator('#appearance-save').click();assert.match(await page.locator('#appearance-presets').textContent(),/Мой 🚀 стиль/);
 });
 await test('dynamic VIP, promo reset, balance, discounts and error notifications use safe SVG/text',async()=>{
  await page.evaluate(()=>{switchNav(1,'profile');updateSubscriptionUI({is_vip:true});resetPromoStyles();updateRefUI();updateTariffPricesUI();showToast('⚠️ Ошибка <img src=x onerror=alert(1)>','error');checkoutStatusText='⚠️ Проверка оплаты';renderPaymentMethods();adminActionStatus('🎉 Изменения сохранены');});
  for(const selector of ['#sub-days-left','#promo-header-text','#ref-pay-btn','#discount-tag-6m','.toast:last-child','#checkout-status','#admin-action-status']){
   assert.ok(await page.locator(`${selector} svg`).count()>0,selector);assert.equal(/\p{Extended_Pictographic}/u.test(await page.locator(selector).textContent()),false,selector);
  }
  assert.equal(await page.locator('.toast img').count(),0);assert.match(await page.locator('.toast').last().textContent(),/<img/);
  await page.evaluate(()=>{document.getElementById('toast-container')?.remove();checkoutStatusText='';renderPaymentMethods();});
 });
 await test('Stars and rubles are preserved even in mixed messages',async()=>{
  await page.evaluate(()=>showToast('🎁 250 ⭐ / 500 ₽ и 25 ⭐️'));
  const text=await page.locator('.toast').last().textContent();assert.match(text,/250 ⭐ \/ 500 ₽ и 25 ⭐️/);assert.ok(await page.locator('.toast:last-child svg').count()>0);
  await page.evaluate(()=>document.getElementById('toast-container')?.remove());
 });
 await test('promo and referral disclosures support keyboard and expose their expanded state',async()=>{
  await page.locator('#promo-trigger-card').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#promo-trigger-card').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#promo-drawer').evaluate(el=>el.inert),false);
  await page.locator('#ref-trigger-card').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#ref-trigger-card').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#promo-trigger-card').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#promo-drawer').evaluate(el=>el.inert),true);
 });
 await test('rapid tariff reversal cannot leave a reopened section hidden or its arrow stale',async()=>{
  await page.evaluate(()=>{toggleTariffs(true);toggleTariffs();toggleTariffs(true);});await page.waitForTimeout(650);
  assert.equal(await page.locator('#tariffs-flow').evaluate(el=>el.classList.contains('hidden-flow')),false);assert.equal(await page.locator('.tariff-card.show-card').count(),4);assert.equal(await page.locator('#tariffs-toggle-btn').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#tariffs-toggle-btn .sol-chevron path').getAttribute('d'),'M5 9L12 16L19 9');
 });
 await test('native details retain keyboard operation and morph line geometry without rotation',async()=>{
  await settings(page);const summary=page.locator('.appearance-section summary').filter({hasText:'Плашки'});await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.getAttribute('aria-expanded'),'true');assert.equal(await summary.locator('svg').evaluate(el=>getComputedStyle(el).transform),'none');
  await page.keyboard.press('Enter');assert.equal(await summary.getAttribute('aria-expanded'),'false');assert.equal(await summary.locator('path').getAttribute('d'),'M9 5L16 12L9 19');
 });
 await test('every old native settings select is replaced by a working dialog choice',async()=>{
  assert.equal(await page.locator('#appearance-controls select').count(),0);
  await section(page,'Плашки');await choose(page,'cardStyle','outline');
  await section(page,'Кнопки');await choose(page,'buttonStyle','glass');
  await section(page,'Анимации');await choose(page,'speed','fast');await choose(page,'transition','radial');
  await page.locator('[data-appearance-theme="classic"]').click();await choose(page,'classicMode','light');
  await choose(page,'randomMode','startup');
  const state=await page.evaluate(()=>SolAppearance.snapshot().settings);
  for(const [key,value]of Object.entries({cardStyle:'outline',buttonStyle:'glass',speed:'fast',transition:'radial',classicMode:'light',randomOnLaunch:true}))assert.equal(state[key],value);
 });
 await test('dialog has an accessible name, selected value, initial focus and locked background',async()=>{
  await page.locator('[data-appearance-choice="speed"]').click();const dialog=page.getByRole('dialog',{name:'Скорость'});assert.equal(await dialog.getAttribute('aria-modal'),'true');assert.equal(await page.locator('.choice-option[aria-pressed="true"]').getAttribute('data-choice-value'),'fast');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.choiceValue),'fast');assert.equal(await page.locator('.app-container').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('.app-container').evaluate(el=>el.inert),true);
 });
 await test('Tab and Shift+Tab wrap inside dialog; background focus is redirected',async()=>{
  await page.locator('.choice-option').last().focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'choice-close');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.choiceValue),'fast');
  await page.evaluate(()=>document.querySelector('#appearance-save').focus());assert.equal(await page.evaluate(()=>document.querySelector('.choice-dialog').contains(document.activeElement)),true);
 });
 await test('Escape cancels without changing settings, releases inert and restores trigger focus',async()=>{
  const before=await page.evaluate(()=>SolAppearance.snapshot().settings);await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>SolAppearance.snapshot().settings),before);assert.equal(await page.locator('.app-container').evaluate(el=>el.inert),false);assert.equal(await page.locator('.app-container').getAttribute('aria-hidden'),null);assert.equal(await page.evaluate(()=>document.activeElement.dataset.appearanceChoice),'speed');
 });
 await test('Arrow keys, Home/End and Enter work without pointer input',async()=>{
  await page.locator('[data-appearance-choice="speed"]').click();await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.choiceValue),'slow');await page.keyboard.press('End');await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.dataset.choiceValue),'normal');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>SolAppearance.snapshot().settings.speed),'normal');
 });
 await test('backdrop and close button cancel choices without creating network requests',async()=>{
  const before=f.state.requests.length;await page.locator('[data-appearance-choice="speed"]').click();await page.locator('.choice-backdrop').click({position:{x:3,y:3}});assert.equal(await page.locator('[data-appearance-choice="speed"]').getAttribute('aria-expanded'),'false');
  await page.locator('[data-appearance-choice="speed"]').click();await page.getByRole('button',{name:'Закрыть выбор',exact:true}).click();assert.equal(f.state.requests.length,before);
 });
 await test('identity change and navigation close the old choice and restore background state',async()=>{
  await page.locator('[data-appearance-choice="speed"]').click();await page.evaluate(()=>SolAppearance.setUser(7002));assert.equal(await page.locator('.choice-backdrop').isVisible(),false);assert.equal(await page.locator('.app-container').evaluate(el=>el.inert),false);
  await page.locator('[data-appearance-choice="speed"]').click();await page.evaluate(()=>switchNav(1,'profile'));assert.equal(await page.locator('.choice-backdrop').isVisible(),false);await page.evaluate(()=>{SolAppearance.setUser(7001);SolAppearance.reset();});
 });
 await test('dialog fits narrow, desktop and keyboard-height viewports in dark and light palettes',async()=>{
  await settings(page);await section(page,'Анимации');
  for(const light of [false,true])for(const [width,height]of [[320,568],[360,640],[390,844],[440,900],[1024,768],[390,330]]){
   await page.setViewportSize({width,height});await page.evaluate(light=>SolAppearance.update({theme:light?'classic':'cosmic',classicMode:light?'light':'dark'}),light);await page.locator('[data-appearance-choice="transition"]').click();
   const b=await geometry(page);assert.ok(b.x>=0&&b.y>=0&&b.right<=width+1&&b.bottom<=height+1,JSON.stringify(b));assert.equal(b.overflow,false);assert.equal(b.documentOverflow,false);await page.keyboard.press('Escape');
  }
 });
 await test('reduced motion has immediate geometry and zero transform animation',async()=>{
  await page.setViewportSize({width:390,height:844});await page.locator('[data-appearance-choice="speed"]').click();assert.equal(await page.locator('.choice-dialog').evaluate(el=>getComputedStyle(el).transform),'none');assert.equal(await page.locator('.choice-dialog').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await page.keyboard.press('Escape');
 });
 await test('older WebViews without WAAPI/view transitions keep details, choices and focus working',async()=>{
  const p=await f.page({fallback:true});await p.evaluate(()=>Element.prototype.animate=undefined);await settings(p);await section(p,'Анимации');await choose(p,'speed','slow');assert.equal(await p.evaluate(()=>SolAppearance.snapshot().settings.speed),'slow');await p.context().close();
 });
 await test('ordinary motion reverses arrows and sections cleanly while choices can close/reopen',async()=>{
  const p=await f.page({reducedMotion:'no-preference'});await settings(p);const summary=p.locator('.appearance-section summary').filter({hasText:'Анимации'});
  await summary.click();await p.waitForTimeout(90);const intermediate=await summary.locator('path').getAttribute('d');assert.notEqual(intermediate,'M9 5L16 12L9 19');assert.notEqual(intermediate,'M5 9L12 16L19 9');
  await summary.click();await summary.click();await p.waitForTimeout(500);assert.equal(await summary.locator('path').getAttribute('d'),'M5 9L12 16L19 9');assert.equal(await summary.evaluate(el=>el.parentElement.open),true);
  await p.locator('[data-appearance-choice="speed"]').click();await p.keyboard.press('Escape');await p.locator('[data-appearance-choice="speed"]').click();await p.waitForTimeout(600);assert.equal(await p.locator('.choice-backdrop').isVisible(),true);assert.equal(await p.locator('.app-container').evaluate(el=>el.inert),true);await p.keyboard.press('Escape');await p.waitForTimeout(500);assert.equal(await p.locator('.choice-backdrop').isVisible(),false);await p.context().close();
 });
 await test('switching to reduced motion settles an already expanding section',async()=>{
  const p=await f.page({reducedMotion:'no-preference'});await settings(p);const summary=p.locator('.appearance-section summary').filter({hasText:'Плашки'});await summary.click();await p.waitForTimeout(60);await p.emulateMedia({reducedMotion:'reduce'});
  await p.waitForFunction(()=>document.documentElement.dataset.motion==='off');assert.equal(await summary.evaluate(el=>el.parentElement.open),true);assert.equal(await summary.evaluate(el=>el.nextElementSibling.getAnimations().length),0);await p.context().close();
 });
 await test('weak devices use the simple transition, no backdrop blur or 3D effect',async()=>{
  const p=await f.page({weak:true,reducedMotion:'no-preference'});await settings(p);await section(p,'Анимации');await p.locator('[data-appearance-choice="speed"]').click();await p.waitForTimeout(500);assert.equal(await p.locator('.choice-backdrop').evaluate(el=>getComputedStyle(el).backdropFilter),'none');assert.equal(await p.locator('.choice-dialog').evaluate(el=>getComputedStyle(el).transform),'none');await p.keyboard.press('Escape');await p.evaluate(()=>SolAppearance.update({theme:'matrix',transition:'liquid'}));assert.equal(await p.evaluate(()=>document.documentElement.dataset.themeTransition),'smooth');await p.context().close();
 });
 await test('theme transitions tolerate rapid changes without stale palettes or permanent GPU layers',async()=>{
  const p=await f.page({reducedMotion:'no-preference'});
  for(const transition of ['smooth','radial','liquid']){
   await p.evaluate(transition=>{SolAppearance.update({transition});SolAppearance.update({theme:'solar'});SolAppearance.update({theme:'aurora'});},transition);await p.waitForFunction(()=>document.documentElement.dataset.themeTransition==='none');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'aurora');
  }
  assert.equal(await p.locator('.choice-dialog').count(),0);assert.equal(await p.locator('.app-container').evaluate(el=>getComputedStyle(el).willChange),'auto');await p.context().close();
 });
 await test('new cosmetic controls never send writes or enable YooKassa',async()=>{
  assert.equal(f.state.requests.filter(r=>r.method==='POST').length,0);assert.equal(await page.evaluate(()=>yookassaCatalog.enabled),false);assert.equal(await page.evaluate(()=>selectedMonths),null);
 });
 if(artifacts){
  await fs.mkdir(artifacts,{recursive:true});const p=await f.page({uid:8544752152});
  for(const theme of ['cosmic','classic','ocean','aurora','solar','matrix']){
   await p.evaluate(theme=>{SolAppearance.update({theme,classicMode:'dark'});switchNav(1,'profile');updateSubscriptionUI({is_vip:true});toggleTariffs(true);},theme);
   await p.screenshot({path:path.join(artifacts,`${theme}-profile-390.png`)});
  }
  await p.evaluate(()=>{SolAppearance.reset();switchNav(1,'settings');});await section(p,'Анимации');await p.locator('[data-appearance-choice="transition"]').click();await p.screenshot({path:path.join(artifacts,'dialog-390.png')});await p.keyboard.press('Escape');
  await p.setViewportSize({width:320,height:568});await p.evaluate(()=>SolAppearance.update({theme:'classic',classicMode:'light'}));await p.locator('[data-appearance-choice="speed"]').click();await p.screenshot({path:path.join(artifacts,'dialog-light-320.png')});await p.keyboard.press('Escape');
  await p.setViewportSize({width:390,height:844});await p.evaluate(()=>{SolAppearance.reset();switchNav(4,'admin');});await p.waitForTimeout(100);await p.screenshot({path:path.join(artifacts,'admin-390.png')});
  for(const [index,screen]of [[0,'tunnel'],[2,'games'],[3,'info']]){await p.evaluate(([index,screen])=>switchNav(index,screen),[index,screen]);await p.screenshot({path:path.join(artifacts,`${screen}-390.png`)});}
  await p.context().close();
  const animated=await f.page({reducedMotion:'no-preference'});
  for(const transition of ['smooth','radial','liquid']){
   await animated.evaluate(()=>{switchNav(1,'profile');SolAppearance.update({animations:false,theme:'cosmic'});});
   await animated.waitForTimeout(400);
   await animated.evaluate(transition=>{SolAppearance.update({animations:true,transition,speed:'slow'});SolAppearance.update({theme:'ocean'});},transition);
   await animated.waitForTimeout(230);await animated.screenshot({path:path.join(artifacts,`${transition}-midpoint.png`)});await animated.waitForFunction(()=>document.documentElement.dataset.themeTransition==='none');
  }
  await settings(animated);await section(animated,'Анимации');await animated.locator('[data-appearance-choice="speed"]').click();await animated.waitForTimeout(100);await animated.screenshot({path:path.join(artifacts,'dialog-rising.png')});await animated.context().close();
 }
 assert.deepEqual(f.errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
}finally{await f.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});
