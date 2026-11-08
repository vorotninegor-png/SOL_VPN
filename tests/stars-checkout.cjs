// Offline browser integration. All API responses and Telegram calls are local fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
    let scenario;
    function reset(extra = {}) {
        scenario = { enabled: true, price: 100, active: false, invoiceStatus: 'pending',
            statuses: ['paid'], reads: 0, requests: [], failInvoice: false, mismatch: false, failStatus: false, ...extra };
    }
    reset();
    const tariffs = [1,3,6,12].map((months,i) => ({ months, price_kopecks:[19900,54900,99900,179900][i], discount_percent:0 }));
    function json(res, body, status=200) { res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(body)); }
    const server = http.createServer(async (req,res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        if (name === '/api/bootstrap') return json(res, {
            user:{id:7001}, subscription:{active:scenario.active,days_left:scenario.active?30:0}, tariffs,
            payment:{channel:'telegram_stars',currency:'XTR',enabled:scenario.enabled,mode:'test',
                tariffs:tariffs.map((t,i) => ({months:t.months,amount:scenario.price+i*100,discount_percent:0}))}
        });
        if (name === '/api/payments/invoice') {
            const chunks=[]; for await (const c of req) chunks.push(c);
            const body=JSON.parse(Buffer.concat(chunks).toString());
            scenario.requests.push({body,key:req.headers['idempotency-key']});
            if (scenario.failInvoice) return json(res,{detail:'Статус счёта неизвестен'},502);
            return json(res,{order_id:'33333333-3333-4333-8333-333333333333',channel:'telegram_stars',invoice_url:'https://t.me/$offline',currency:'XTR',
                amount:body.expected_amount+(scenario.mismatch?1:0),status:scenario.invoiceStatus});
        }
        if (name === '/api/payments/orders/33333333-3333-4333-8333-333333333333') {
            scenario.reads++;
            if (scenario.failStatus) return json(res,{detail:'Недоступно'},503);
            const status=scenario.statuses[Math.min(scenario.reads-1,scenario.statuses.length-1)];
            if (status === 'paid') scenario.active=true;
            return json(res,{order_id:'33333333-3333-4333-8333-333333333333',channel:'telegram_stars',status,amount:100,currency:'XTR'});
        }
        const file=name==='/'?'index.html':name.slice(1);
        if (!['index.html','app.js','appearance.js','style.css','appearance.css','config.js'].includes(file)) return res.writeHead(404).end();
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
        res.end(file==='config.js'?'':await fs.readFile(path.join(root,file)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    let browser,checks=0;
    const errors=[];
    async function newPage() {
        const context=await browser.newContext({viewport:{width:390,height:844}});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{
            window.openedInvoices=[];window.paymentToasts=[];
            const button={text:'',active:false,setText(text){this.text=text},setParams(p){this.active=p.is_active},
                enable(){this.active=true},disable(){this.active=false},show(){},hide(){},showProgress(){},hideProgress(){},onClick(){}};
            window.Telegram={WebApp:{initData:'offline',ready(){},expand(){},MainButton:button,
                HapticFeedback:{selectionChanged(){},impactOccurred(){}},openInvoice(url,callback){openedInvoices.push(url);window.invoiceCallback=callback}}};
        });
        const page=await context.newPage();
        page.on('pageerror',err=>errors.push(err.message));
        await page.goto(origin);
        await page.waitForFunction(()=>userData?.id===7001);
        await page.evaluate(()=>{const original=showToast;showToast=(text,type)=>{paymentToasts.push(text);original(text,type)};selectTariff(1)});
        return page;
    }
    async function check(name,fn){reset();await fn();checks++;console.log(`PASS ${name}`)}
    async function finish(page,status){await page.evaluate(status=>window.invoiceCallback(status),status);await page.waitForFunction(()=>!paymentInProgress)}
    try {
        browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
        await check('cards stay in rubles and the chooser exposes the server Stars quote',async()=>{
            const page=await newPage();
            for (const [i,months] of [1,3,6,12].entries()) assert.equal((await page.locator(`#price-${months}m`).textContent()).replace(/\s/g,''),['199,00₽','549,00₽','999,00₽','1799,00₽'][i]);
            assert.equal(await page.evaluate(()=>tg.MainButton.text),'Оплатить');
            assert.equal(await page.evaluate(()=>tg.MainButton.active),true);
            await page.evaluate(()=>openPaymentSheet());
            assert.equal(await page.locator('#stars-price').textContent(),'100 ⭐');
            assert.equal(scenario.requests.length,0);
            await page.context().close();
        });
        await check('off prevents requests and a client-side live override',async()=>{
            scenario.enabled=false;
            const page=await newPage();
            await page.evaluate(()=>paySelectedTariff());
            assert.equal(scenario.requests.length,0);
            await page.evaluate(()=>openPaymentSheet());
            assert.equal(await page.locator('#pay-stars').isDisabled(),true);
            await page.context().close();
        });
        await check('invoice includes exact quote, XTR and stable idempotency key; double click is ignored',async()=>{
            const page=await newPage();
            await page.evaluate(()=>Promise.all([paySelectedTariff(),paySelectedTariff()]));
            assert.equal(scenario.requests.length,1);
            assert.deepEqual(scenario.requests[0].body,{months:1,expected_currency:'XTR',expected_amount:100});
            assert.match(scenario.requests[0].key,/^[0-9a-f-]{36}$/i);
            assert.equal(await page.evaluate(()=>openedInvoices.length),1);
            await finish(page,'cancelled');
            assert.equal(scenario.reads,0);
            assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            assert.ok((await page.evaluate(()=>paymentToasts)).includes('Оплата отменена'));
            await page.context().close();
        });
        await check('cancelled and failed payments reopen the same order',async()=>{
            const page=await newPage();
            await page.evaluate(()=>paySelectedTariff());await finish(page,'failed');
            await page.evaluate(()=>{selectTariff(1);return paySelectedTariff()});await finish(page,'cancelled');
            assert.equal(scenario.requests[0].key,scenario.requests[1].key);
            assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            await page.context().close();
        });
        await check('paid waits for server fulfillment before refreshing subscription',async()=>{
            scenario.statuses=['confirming','paid'];
            const page=await newPage();
            await page.evaluate(()=>paySelectedTariff());
            await finish(page,'paid');
            assert.equal(scenario.reads,2);
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);
            assert.equal(await page.evaluate(()=>Object.keys(paymentAttempts).length),0);
            await page.context().close();
        });
        await check('client paid without server confirmation cannot grant a subscription',async()=>{
            scenario.statuses=['confirming'];
            const page=await newPage();
            await page.evaluate(()=>paySelectedTariff());await finish(page,'paid');
            assert.equal(scenario.reads,8);
            assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            assert.ok((await page.evaluate(()=>paymentToasts)).some(t=>t.includes('Подтверждение ещё не получено')));
            await page.context().close();
        });
        await check('pending can complete and status errors do not claim success',async()=>{
            const page=await newPage();
            await page.evaluate(()=>paySelectedTariff());await finish(page,'pending');
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);
            await page.context().close();
            reset({failStatus:true});
            const errorPage=await newPage();
            await errorPage.evaluate(()=>paySelectedTariff());await finish(errorPage,'paid');
            assert.equal(await errorPage.evaluate(()=>isSubscribedUser),false);
            await errorPage.context().close();
        });
        await check('price mismatch never opens Telegram checkout',async()=>{
            scenario.mismatch=true;
            const page=await newPage();await page.evaluate(()=>paySelectedTariff());
            assert.equal(await page.evaluate(()=>openedInvoices.length),0);
            assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            await page.context().close();
        });
        await check('lost invoice response reuses key after page reload',async()=>{
            scenario.failInvoice=true;
            const page=await newPage();await page.evaluate(()=>paySelectedTariff());
            const first=scenario.requests[0].key;
            scenario.failInvoice=false;
            await page.reload();await page.waitForFunction(()=>userData?.id===7001);
            await page.evaluate(()=>{selectTariff(1);return paySelectedTariff()});
            assert.equal(scenario.requests[1].key,first);
            await finish(page,'cancelled');await page.context().close();
        });
        await check('issued quote survives rate changes, reload and choosing another tariff',async()=>{
            const page=await newPage();await page.evaluate(()=>paySelectedTariff());await finish(page,'cancelled');
            const key=scenario.requests[0].key;
            scenario.price=55;
            await page.evaluate(async()=>{await loadBootstrap(false);selectTariff(3);selectTariff(1)});
            await page.evaluate(()=>openPaymentSheet());
            assert.equal(await page.locator('#stars-price').textContent(),'100 ⭐');
            await page.reload();await page.waitForFunction(()=>userData?.id===7001);
            await page.evaluate(()=>{selectTariff(1);return paySelectedTariff()});
            assert.equal(scenario.requests[1].key,key);
            assert.equal(scenario.requests[1].body.expected_amount,100);
            await finish(page,'cancelled');await page.context().close();
        });
        await check('already paid order is reconciled without reopening the invoice',async()=>{
            scenario.invoiceStatus='paid';scenario.active=true;
            const page=await newPage();await page.evaluate(()=>paySelectedTariff());
            assert.equal(await page.evaluate(()=>openedInvoices.length),0);
            assert.equal(await page.evaluate(()=>paymentInProgress),false);
            await page.context().close();
        });
        await check('older WebView creates a UUID without crypto.randomUUID',async()=>{
            const page=await newPage();
            await page.evaluate(()=>{crypto.randomUUID=undefined;return paySelectedTariff()});
            assert.match(scenario.requests[0].key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            await finish(page,'cancelled');await page.context().close();
        });
        assert.deepEqual(errors,[]);
        console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {
        await browser?.close();await new Promise(resolve=>server.close(resolve));
    }
}
main().catch(err=>{console.error(err);process.exitCode=1});
