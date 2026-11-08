const assert=require('node:assert/strict');
const {fixture}=require('./browser-fixture.cjs');
async function main(){const f=await fixture();let checks=0;
const test=async(name,fn)=>{f.state.orders=[];f.state.requests=[];f.state.active.clear();f.state.elapsed=0;await fn();checks++;console.log(`PASS ${name}`)};
const visibleRows=page=>page.locator('#profile-payment-deadlines .payment-deadline:not(.is-leaving)').count();
try{
 await test('a restored unpaid order shows its original timer without selecting a tariff or CTA',async()=>{
  const p=await f.page();const order=await f.invoice(p);await p.reload();await p.waitForFunction(()=>serverOnline);await p.locator('#btn-nav-1').click();
  assert.equal(await p.evaluate(()=>selectedMonths),null);assert.equal(await p.evaluate(()=>mainButtonState.visible),false);assert.equal(await visibleRows(p),1);
  assert.equal(await p.evaluate(()=>paymentAttempts[6].orderId),order.id);assert.equal(f.state.requests.filter(r=>r.method==='POST').length,1);await p.context().close();
 });
 await test('native cancellation cleans visible state and progress but keeps the server order and retry key',async()=>{
  const p=await f.page();const order=await f.invoice(p);await p.evaluate(()=>invoiceCallback('cancelled'));await f.idle(p);
  assert.equal(await p.evaluate(()=>selectedMonths),null);assert.equal(await p.evaluate(()=>mainButtonState.visible||mainButtonState.progress),false);assert.equal(await visibleRows(p),0);
  assert.equal(order.status,'pending');assert.equal(await p.evaluate(()=>paymentAttempts[6].key),order.key);
  await p.reload();await p.waitForFunction(()=>serverOnline);assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>selectedMonths),null);
  await f.invoice(p);assert.equal(f.state.orders.at(-1).key,order.key);await p.evaluate(()=>invoiceCallback('cancelled'));await p.context().close();
 });
 await test('closing a chooser with no order clears selection and never creates a payment',async()=>{
  const p=await f.page();const before=f.state.orders.length;await f.select(p);await p.locator('#payment-sheet-close').click();
  assert.equal(await p.evaluate(()=>selectedMonths),null);assert.equal(await p.evaluate(()=>mainButtonState.visible),false);assert.equal(f.state.orders.length,before);await p.context().close();
 });
 await test('server-confirmed expiry removes the row and CTA, notifies once and never returns after reload',async()=>{
  const p=await f.page();const order=await f.invoice(p);await p.reload();await p.waitForFunction(()=>serverOnline);await p.locator('#btn-nav-1').click();
  await f.select(p);await f.advance(p,600);await p.waitForTimeout(250);
  assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>selectedMonths),null);assert.equal(await p.evaluate(()=>mainButtonState.visible),false);
  assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t==='Время оплаты истекло').length),1);
  await p.evaluate(id=>checkPaymentOrder('telegram_stars',id),order.id);assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t==='Время оплаты истекло').length),1);
  await p.reload();await p.waitForFunction(()=>serverOnline);assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>toastEvents.length),0);await p.context().close();
 });
 await test('local zero alone only checks status and does not claim expiry or discard an unpaid order',async()=>{
  const p=await f.page();const order=await f.invoice(p);await p.reload();await p.waitForFunction(()=>serverOnline);await p.locator('#btn-nav-1').click();f.state.forcePending=true;
  await f.advance(p,600);assert.equal(await visibleRows(p),1);assert.match(await p.locator('#profile-payment-deadlines').textContent(),/Проверяем оплату/);
  assert.equal(await p.evaluate(()=>toastEvents.includes('Время оплаты истекло')),false);assert.equal(order.status,'pending');f.state.forcePending=false;await p.evaluate(id=>checkPaymentOrder('telegram_stars',id),order.id);assert.equal(await visibleRows(p),0);await p.context().close();
 });
 await test('verified paid clears the chooser and notifies once, while a late old payment preserves newer UI',async()=>{
  const p=await f.page();const old=await f.invoice(p);await p.evaluate(()=>invoiceCallback('cancelled'));await f.idle(p);await f.advance(p,600);
  const newer=await f.invoice(p);f.paid(old);await p.evaluate(id=>checkPaymentOrder('telegram_stars',id),old.id);
  assert.equal(await p.evaluate(()=>isSubscribedUser),true);assert.equal(await p.evaluate(()=>paymentAttempts[6].orderId),newer.id);assert.equal(await p.evaluate(()=>selectedMonths),6);
  f.paid(newer);await p.evaluate(()=>invoiceCallback('paid'));await f.idle(p);
  assert.equal(await p.evaluate(()=>selectedMonths),null);assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>mainButtonState.visible||mainButtonState.progress),false);
  assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t.includes('Оплата подтверждена сервером')).length),2);
  await p.evaluate(()=>checkPendingPaymentOrders());assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t.includes('Оплата подтверждена сервером')).length),2);await p.context().close();
 });
 await test('all legacy VIPs beyond page one remain gold and present in a complete source-aware list',async()=>{
  f.state.users=Array.from({length:235},(_,i)=>({user_id:9000+i,name:`User ${i}`,username:'',isVip:[2,152,230].includes(i),vip_admin_granted:i===152,vip_protected:[2,230].includes(i),hasSub:[2,152,230].includes(i)}));
  const p=await f.page({uid:8544752152});await p.locator('#btn-nav-4').click();await p.waitForFunction(()=>vipDirectory.complete);
  assert.equal(await p.locator('#approved-users-drum .drum-item').count(),3);assert.equal(await p.locator('#approved-users-drum button:disabled').count(),2);
  const legacy=p.locator('[data-action="toggle-admin-vip"][data-user-id="9002"]');assert.equal(await legacy.getAttribute('aria-pressed'),'true');assert.equal(await legacy.evaluate(el=>el.classList.contains('admin-vip-active')),true);
  assert.equal(f.state.requests.filter(r=>r.method==='POST'&&r.name.includes('admin')).length,0);await p.context().close();
 });
 await test('VIP refresh accepts newer backend rights rather than a stale local cached grant',async()=>{
  const p=await f.page({uid:8544752152});await p.locator('#btn-nav-4').click();await p.waitForFunction(()=>vipDirectory.complete);
  await p.evaluate(()=>adminVipValues.set(9002,{isVip:true,hasSub:true,vip_admin_granted:true,vip_protected:false}));
  Object.assign(f.state.users[2],{isVip:false,hasSub:false,vip_admin_granted:false,vip_protected:false});await p.evaluate(()=>loadVipDirectory(true));
  assert.equal(await p.locator('#approved-users-drum .drum-item').count(),2);assert.equal(await p.locator('[data-action="toggle-admin-vip"][data-user-id="9002"]').getAttribute('aria-pressed'),'false');await p.context().close();
 });
 await test('a stale pending callback cannot resurrect already confirmed paid UI or repeat success',async()=>{
  const p=await f.page();const order=await f.invoice(p);f.paid(order);await p.evaluate(()=>invoiceCallback('paid'));await f.idle(p);
  await p.evaluate(id=>{const record=paymentOrderHistory[`telegram_stars:${id}`];syncPaymentExpiry(record,{status:'pending',payment_status:'pending'});rememberPaymentOrder(record,'telegram_stars');renderPaymentCountdowns()},order.id);
  assert.equal(await p.evaluate(id=>paymentOrderHistory[`telegram_stars:${id}`].status,order.id),'paid');assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t.includes('Оплата подтверждена сервером')).length),1);await p.context().close();
 });
 await test('bootstrap-confirmed expiry of a currently visible order notifies once and clears the UI',async()=>{
  const p=await f.page();const order=await f.invoice(p);f.state.elapsed=600000;
  await p.evaluate(()=>loadBootstrap(false));assert.equal(await visibleRows(p),0);assert.equal(await p.evaluate(()=>selectedMonths),null);
  assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t==='Время оплаты истекло').length),1);await p.evaluate(()=>loadBootstrap(false));
  assert.equal(await p.evaluate(()=>toastEvents.filter(t=>t==='Время оплаты истекло').length),1);assert.equal(order.status,'pending');await p.context().close();
 });
 assert.deepEqual(f.errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
}finally{await f.close()}}
main().catch(e=>{console.error(e);process.exitCode=1});
