// Offline server-deadline UI checks. Fake API, fake clock, no real payments.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const baseTime = Date.UTC(2026, 10, 8, 10);
const clientTime = baseTime + 6 * 3600_000;

async function main() {
    let state;
    function reset(extra = {}) { state = { elapsed: 0, orders: [], requests: [], user: 7001, paid: new Set(), active: false, discount: 0, held: false, badIdentity: false,
        postOverride: null, getOverride: null, getDelay: 0, inFlight: 0, maxReads: 0, ...extra }; }
    reset();
    const iso = ms => new Date(ms).toISOString();
    const tariffs = () => [1, 3, 6, 12].map(months => ({ months, price_kopecks: months === 6 ? Math.round(99900 * (100 - state.discount) / 100) : ({1:19900,3:54900,12:179900}[months]), discount_percent: months === 6 ? state.discount : 0 }));
    function status(order) { return state.paid.has(order.order_id) ? 'paid' : baseTime + state.elapsed >= order.deadline ? 'expired' : 'pending'; }
    function result(order) {
        const paid = state.paid.has(order.order_id);
        if (paid) state.active = true;
        return { order_id: order.order_id, provider: order.provider, currency: order.provider === 'yookassa' ? 'RUB' : 'XTR', months: order.months,
            ...(order.provider === 'yookassa' ? { amount_kopecks: order.amount } : { amount: order.amount }), status: status(order), payment_status: paid ? 'paid' : 'pending',
            expires_at: iso(order.deadline), created_at: iso(order.created), server_time: iso(baseTime + state.elapsed), request_id: order.key,
            invoice_url: 'https://t.me/$offline', confirmation_url: 'https://yoomoney.ru/checkout/offline', checkout_delivery: { state: 'sent', bot_url: 'https://t.me/SOLTestBot' } };
    }
    function json(res, body, code = 200) { res.writeHead(code, {'Content-Type':'application/json'}).end(JSON.stringify(body)); }
    const server = http.createServer(async (req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        if (name.startsWith('/api/')) state.requests.push({ name, method: req.method });
        if (name === '/api/bootstrap') return json(res, { user: { id: state.user }, subscription: { active: state.active, days_left: state.active ? 30 : 0 }, tariffs: tariffs(),
            payment: { channel: 'telegram_stars', currency: 'XTR', enabled: true, server_time: iso(baseTime + state.elapsed),
                tariffs: tariffs().map(t => ({ months:t.months, amount:Math.ceil(t.price_kopecks/200), discount_percent:t.discount_percent })),
                providers:{ yookassa:{ enabled:true,currency:'RUB',tariffs:tariffs().map(t=>({ months:t.months,amount_kopecks:t.price_kopecks,discount_percent:t.discount_percent,quote_token:'signed' })) } },
                pending_orders:state.orders.filter(o=>o.user===state.user&&!state.paid.has(o.order_id)).slice().reverse().map(result),
                discount_pending:state.held?[{months:6,order_id:state.orders[0]?.order_id,provider:'telegram_stars'}]:[] }, referral:{bot_username:'SOLTestBot'} });
        if (['/api/payments/invoice','/api/payments/yookassa/order'].includes(name)) {
            const chunks=[];for await(const c of req) chunks.push(c);
            const body=JSON.parse(Buffer.concat(chunks).toString()), provider=name.endsWith('/invoice')?'telegram_stars':'yookassa';
            const key=req.headers['idempotency-key']; state.requests.at(-1).key=key;
            let order=state.orders.find(o=>o.key===key&&o.user===state.user&&o.provider===provider);
            if(!order){ const id=String(state.orders.length+1).padStart(12,'0'); order={order_id:`11111111-1111-4111-8111-${id}`,provider,months:body.months,amount:body.expected_amount,key,user:state.user,created:baseTime+state.elapsed,deadline:baseTime+state.elapsed+600000};state.orders.push(order); }
            return json(res,{...result(order),...state.postOverride});
        }
        if(name.startsWith('/api/payments/orders/')) {
            const order=state.orders.find(o=>o.order_id===name.split('/').at(-1)&&o.user===state.user);
            if(!order) return json(res,{detail:'Not found'},404);
            state.inFlight++;state.maxReads=Math.max(state.maxReads,state.inFlight);
            if(state.getDelay)await new Promise(resolve=>setTimeout(resolve,state.getDelay));
            state.inFlight--;const body={...result(order),...state.getOverride};if(state.badIdentity)body.order_id='wrong-order';return json(res,body);
        }
        const file=name==='/'?'index.html':name.slice(1);
        if(!['index.html','style.css','appearance.css','appearance.js','app.js','config.js'].includes(file))return res.writeHead(404).end();
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
        res.end(file==='config.js'?'':await fs.readFile(path.join(root,file)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    let browser,checks=0;const errors=[];
    async function pageFor() {
        const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(now=>{ window.fakeNow=now;Date.now=()=>window.fakeNow;window.opened=[];
            const button={setText(){},setParams(){},enable(){},disable(){},show(){},hide(){},onClick(){},showProgress(){},hideProgress(){}};
            window.Telegram={WebApp:{initData:'offline',ready(){},expand(){},MainButton:button,HapticFeedback:{selectionChanged(){},impactOccurred(){}},openInvoice(url,cb){window.invoiceCallback=cb;opened.push(url)},openLink(){},openTelegramLink(){}}};
        },clientTime);
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>userData?.id===7001);
        await page.locator('#btn-nav-1').click();await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});return page;
    }
    const posts=()=>state.requests.filter(r=>r.method==='POST').length;
    async function idle(page){await page.waitForFunction(()=>!paymentInProgress&&!yookassaCheckBusy&&!paymentOrderChecks.size)}
    async function stars(page){await page.evaluate(()=>{selectTariff(6);openPaymentSheet();window.invoiceCallback=null});await page.locator('#pay-stars').click();await page.waitForFunction(()=>Boolean(window.invoiceCallback));await page.reload();await page.waitForFunction(()=>userData?.id===7001);await page.locator('#btn-nav-1').click();await idle(page)}
    async function advance(page,seconds){state.elapsed+=seconds*1000;await page.evaluate(ms=>{window.fakeNow+=ms;renderPaymentCountdowns()},seconds*1000);await page.waitForFunction(()=>!paymentOrderChecks.size)}
    const time=page=>page.locator('#profile-payment-deadlines .payment-deadline-value').first().textContent();
    async function check(name,fn){reset();await fn();checks++;console.log(`PASS ${name}`)}
    try {
        browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
        await check('no countdown before server-created order; server clock offsets a six-hour client skew',async()=>{
            const page=await pageFor();assert.equal(await page.locator('#profile-payment-deadlines').isHidden(),true);assert.equal(posts(),0);
            await stars(page);assert.equal(await time(page),'10:00');assert.equal(posts(),1);assert.equal(await page.locator('#payment-sheet-backdrop').isHidden(),true);
            await page.context().close();
        });
        await check('countdown survives native invoice close, sheet reopen and reload without restarting',async()=>{
            const page=await pageFor();await stars(page);const deadline=state.orders[0].deadline;await advance(page,90);assert.equal(await time(page),'08:30');
            await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});assert.equal(await page.locator('#sheet-payment-deadlines .payment-deadline-value').textContent(),'08:30');
            await page.reload();await page.waitForFunction(()=>userData?.id===7001);await idle(page);assert.equal(await time(page),'08:30');assert.equal(state.orders[0].deadline,deadline);assert.equal(posts(),1);await page.context().close();
        });
        await check('last 60 seconds are amber without blinking and timer updates preserve focused controls',async()=>{
            const page=await pageFor();await stars(page);await advance(page,541);assert.equal(await time(page),'00:59');
            const row=page.locator('#profile-payment-deadlines .payment-deadline');assert.equal(await row.evaluate(el=>el.classList.contains('payment-deadline-warning')),true);
            assert.equal(await row.locator('.payment-deadline-value').evaluate(el=>getComputedStyle(el).animationName),'none');
            const button=row.locator('button');await button.focus();const handle=await button.elementHandle();await advance(page,1);assert.equal(await handle.evaluate(el=>el===document.activeElement),true);
            if(process.env.SOL_PAYMENT_EXPIRY_SCREENSHOT_DIR){
                const dir=path.resolve(process.env.SOL_PAYMENT_EXPIRY_SCREENSHOT_DIR);await fs.mkdir(dir,{recursive:true});
                for(const width of [320,440]){await page.setViewportSize({width,height:844});await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,`payment-expiry-${width}.png`)});}
            }
            await page.context().close();
        });
        await check('expiry performs read-only verification, never auto-creates, and explicit retry keeps old ID history',async()=>{
            const page=await pageFor();await stars(page);const old=state.orders[0];await advance(page,600);
            assert.equal(await page.locator('#profile-payment-deadlines').isHidden(),true);assert.equal(await page.evaluate(()=>selectedMonths),null);assert.equal(posts(),1);assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});await stars(page);assert.equal(posts(),2);assert.notEqual(state.orders[1].key,old.key);
            assert.equal(await page.evaluate(id=>paymentOrderHistory[`telegram_stars:${id}`].archived,old.order_id),true);
            assert.ok((await page.locator('#profile-payment-deadlines').textContent()).includes('10:00'));await page.context().close();
        });
        await check('late paid on archived expired order updates subscription without deleting a newer attempt',async()=>{
            const page=await pageFor();await stars(page);const old=state.orders[0];await advance(page,600);await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});await stars(page);
            const newer=state.orders[1];state.paid.add(old.order_id);await page.evaluate(id=>checkPaymentOrder('telegram_stars',id),old.order_id);await idle(page);
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);assert.equal(await page.evaluate(()=>paymentAttempts[6].orderId),newer.order_id);assert.equal(posts(),2);await page.context().close();
        });
        await check('expired held discount refreshes displayed price and requires another explicit click before full-price order',async()=>{
            state.discount=30;const page=await pageFor();await stars(page);assert.equal(state.orders[0].amount,350);await advance(page,600);state.discount=0;state.held=true;
            await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});await page.locator('#pay-stars').click();await idle(page);assert.equal(posts(),1);assert.equal(await page.locator('#stars-price').textContent(),'500 ⭐');
            assert.equal(await page.locator('#payment-discount-pending').isHidden(),false);await stars(page);assert.equal(posts(),2);assert.equal(state.orders[1].amount,500);await page.context().close();
        });
        await check('Stars and YooKassa deadlines remain independent and restore together from backend',async()=>{
            const page=await pageFor();await stars(page);await advance(page,120);await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});await page.locator('#pay-yookassa').click();await idle(page);
            const values=await page.locator('#profile-payment-deadlines .payment-deadline-value').allTextContents();assert.ok(values.includes('08:00')&&values.includes('10:00'));
            await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>userData?.id===7001);await idle(page);
            assert.equal(await page.locator('#profile-payment-deadlines .payment-deadline').count(),2);assert.equal(posts(),2);
            const saved=await page.evaluate(()=>JSON.stringify({stars:paymentAttempts,rub:yookassaAttempts,history:paymentOrderHistory}));assert.ok(!saved.includes('https:')&&!saved.includes('quote_token')&&!saved.includes('initData'));
            state.user=7002;await page.evaluate(()=>loadBootstrap(false));assert.equal(await page.locator('#profile-payment-deadlines').isHidden(),true);await page.context().close();
        });
        await check('wrong returned order identity cannot change an expired payment or create a replacement',async()=>{
            const page=await pageFor();await stars(page);state.badIdentity=true;await advance(page,600);await page.evaluate(()=>{selectTariff(6);openPaymentSheet()});await page.locator('#pay-stars').click();await idle(page);
            assert.equal(posts(),1);assert.equal(await page.evaluate(()=>isSubscribedUser),false);await page.context().close();
        });
        await check('Stars creation validates UUID, provider, currency and exact server amount before native invoice',async()=>{
            for(const override of [{order_id:'invalid'}, {provider:'yookassa'}, {currency:'RUB'}, {amount:501}]) {
                reset({postOverride:override});const page=await pageFor();await page.locator('#pay-stars').click();await idle(page);
                assert.equal(await page.evaluate(()=>opened.length),0);assert.equal(await page.evaluate(()=>isSubscribedUser),false);await page.context().close();
            }
        });
        await check('native paid polling rejects wrong order, provider, currency and amount before updating subscription',async()=>{
            for(const override of [{order_id:'22222222-2222-4222-8222-222222222222'}, {provider:'yookassa'}, {currency:'RUB'}, {amount:501}]) {
                reset();const page=await pageFor();await page.locator('#pay-stars').click();await page.waitForFunction(()=>Boolean(window.invoiceCallback));
                state.paid.add(state.orders[0].order_id);state.getOverride=override;
                await page.evaluate(()=>window.invoiceCallback('paid'));await idle(page);
                assert.equal(await page.evaluate(()=>isSubscribedUser),false);assert.equal(await page.evaluate(()=>paymentAttempts[6].status),'pending');await page.context().close();
            }
        });
        await check('native late-paid refresh preserves a newer attempt restored by bootstrap',async()=>{
            const page=await pageFor();await page.locator('#pay-stars').click();await page.waitForFunction(()=>Boolean(window.invoiceCallback));
            const old=state.orders[0];const newer={...old,order_id:'22222222-2222-4222-8222-222222222222',key:'44444444-4444-4444-8444-444444444444',created:baseTime+1000,deadline:baseTime+601000};
            state.orders.push(newer);state.paid.add(old.order_id);await page.evaluate(()=>window.invoiceCallback('paid'));await idle(page);
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);assert.equal(await page.evaluate(()=>paymentAttempts[6].orderId),newer.order_id);assert.equal(posts(),1);await page.context().close();
        });
        await check('recovery checks all nine expired orders plus current late-paid order with three workers and single-flight focus',async()=>{
            state.elapsed=700000;
            for(let i=1;i<=10;i++)state.orders.push({order_id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,provider:'telegram_stars',months:6,amount:500,
                key:`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`,user:7001,created:baseTime+(i===10?700000:i*1000),deadline:baseTime+(i===10?1300000:600000+i*1000)});
            const page=await pageFor();await page.waitForFunction(()=>!paymentRecoveryBatch&&!paymentOrderChecks.size);
            state.requests=[];state.getDelay=35;state.maxReads=0;state.paid.add(state.orders[9].order_id);
            await page.evaluate(()=>Promise.all([checkPendingPaymentOrders(),checkPendingPaymentOrders(),(window.dispatchEvent(new Event('focus')),checkPendingPaymentOrders())]));await idle(page);
            const reads=state.requests.filter(r=>r.name.startsWith('/api/payments/orders/'));
            assert.equal(reads.length,10);assert.equal(new Set(reads.map(r=>r.name)).size,10);assert.equal(state.maxReads,3);
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);assert.equal(posts(),0);await page.context().close();
        });
        assert.deepEqual(errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
