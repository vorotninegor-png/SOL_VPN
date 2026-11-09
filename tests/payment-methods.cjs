// Offline UI checks: API, Stars invoices and external checkout are all fakes.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const orderId='11111111-1111-4111-8111-111111111111';
const starsId='22222222-2222-4222-8222-222222222222';

async function main(){
    let state;
    function reset(extra={}){state={enabled:true,legacy:false,active:false,price:69930,stars:350,discount:30,
        orders:[],requests:[],links:[],status:'pending',failCreate:0,badUrl:null,badAmount:false,delivery:'sent',...extra}}
    reset();
    const base={1:19900,3:54900,6:99900,12:179900};
    const quote=months=>({months,amount_kopecks:months===6?state.price:base[months],discount_percent:months===6?state.discount:0,...(!state.missingQuote?{quote_token:`signed-quote-${months}`}:{})});
    const starQuote=months=>({months,amount:months===6?state.stars:({1:100,3:275,12:900}[months]),discount_percent:months===6?state.discount:0});
    function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value))}
    const server=http.createServer(async(req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/api/'))state.requests.push({path:name,method:req.method});
        if(name==='/api/bootstrap'){if(state.bootstrapDelay)await new Promise(resolve=>setTimeout(resolve,state.bootstrapDelay));return json(res,{user:{id:7001},subscription:{active:state.active,days_left:state.active?30:0},
            tariffs:[1,3,6,12].map(months=>({months,price_kopecks:quote(months).amount_kopecks,discount_percent:quote(months).discount_percent})),
            payment:{channel:'telegram_stars',currency:'XTR',enabled:true,tariffs:[1,3,6,12].map(starQuote),
                ...(!state.legacy?{providers:{yookassa:{currency:'RUB',enabled:state.enabled,tariffs:state.enabled?[1,3,6,12].map(quote):[]}},
                    pending_orders:state.orders.filter(o=>['pending','confirming','review'].includes(o.status)).map(o=>({order_id:o.order_id,provider:'yookassa',months:o.months,
                        amount_kopecks:o.amount_kopecks,discount_percent:o.discount_percent,status:o.status,request_id:o.key,
                        checkout_delivery:{state:state.delivery,bot_url:'https://t.me/SOLTestBot'}}))}:{})}});}
        if(name==='/api/payments/yookassa/order'){
            const chunks=[];for await(const c of req)chunks.push(c);
            const body=JSON.parse(Buffer.concat(chunks).toString());
            state.requests.at(-1).body=body;state.requests.at(-1).key=req.headers['idempotency-key'];
            if(!state.enabled)return json(res,{detail:'ЮKassa отключена'},503);
            if(state.failCreate===409){state.failCreate=0;state.price=79920;state.stars=400;state.discount=20;return json(res,{detail:'Стоимость изменилась; обновите тарифы'},409)}
            let order=state.orders.find(o=>o.key===req.headers['idempotency-key']);
            if(!order){order={order_id:orderId,provider:'yookassa',currency:'RUB',months:body.months,amount_kopecks:body.expected_amount,
                discount_percent:quote(body.months).discount_percent,status:'pending',key:req.headers['idempotency-key']};state.orders.push(order)}
            if(state.failCreate)return json(res,{detail:'Создание не подтверждено'},503);
            return json(res,{...order,amount_kopecks:order.amount_kopecks+(state.badAmount?1:0),confirmation_url:state.badUrl||'https://yoomoney.ru/checkout/offline',checkout_delivery:{state:state.delivery,bot_url:'https://t.me/SOLTestBot'}});
        }
        if(name===`/api/payments/orders/${orderId}`){
            if(state.statusDelay)await new Promise(resolve=>setTimeout(resolve,state.statusDelay));
            const order=state.orders[0];order.status=state.status;
            if(state.status==='paid')state.active=true;
            return json(res,{...order,confirmation_url:state.badUrl||'https://yoomoney.ru/checkout/offline',checkout_delivery:{state:state.delivery,bot_url:'https://t.me/SOLTestBot'}});
        }
        if(name==='/api/payments/invoice'){
            const chunks=[];for await(const c of req)chunks.push(c);
            state.requests.at(-1).body=JSON.parse(Buffer.concat(chunks).toString());state.requests.at(-1).key=req.headers['idempotency-key'];
            if(state.invoiceDelay)await new Promise(resolve=>setTimeout(resolve,state.invoiceDelay));
            return json(res,{provider:'telegram_stars',currency:'XTR',amount:starQuote(state.requests.at(-1).body.months).amount,order_id:starsId,status:'pending',invoice_url:'https://t.me/$offline'});
        }
        if(name===`/api/payments/orders/${starsId}`){state.active=true;return json(res,{order_id:starsId,provider:'telegram_stars',currency:'XTR',amount:350,status:'paid'})}
        const file=name==='/'?'index.html':name.slice(1);
        if(!['index.html','app.js','appearance.js','miniapp-ui.js','style.css','appearance.css','miniapp-ui.css','config.js'].includes(file))return res.writeHead(404).end();
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
        res.end(file==='config.js'?'':await fs.readFile(path.join(root,file)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    let browser,checks=0;const errors=[];
    async function pageFor(width=440,options={}){
        const context=await browser.newContext({viewport:{width,height:850},reducedMotion:options.motion||'reduce'});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{
            window.invoices=[];window.checkoutLinks=[];window.botLinks=[];
            const main={text:'',active:false,visible:false,setText(v){this.text=v},setParams(v){this.active=v.is_active},
                show(){this.visible=true},hide(){this.visible=false},enable(){this.active=true},disable(){this.active=false},onClick(fn){window.mainClick=fn},showProgress(){},hideProgress(){}};
            window.Telegram={WebApp:{initData:'offline',ready(){},expand(){},MainButton:main,HapticFeedback:{selectionChanged(){},impactOccurred(){}},
                openLink(url){checkoutLinks.push(url)},openTelegramLink(url){botLinks.push(url)},openInvoice(url,callback){invoices.push(url);window.invoiceCallback=callback}}};
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin);await page.waitForFunction(()=>userData?.id===7001);
        await page.locator('#btn-nav-1').click();
        await page.evaluate(()=>toggleTariffs(true));
        await page.locator('#tariff-6m').click();
        if(options.open!==false) await page.evaluate(()=>window.mainClick());
        return page;
    }
    async function check(name,fn){reset();await fn();checks++;console.log(`PASS ${name}`)}
    async function idle(page){await page.waitForFunction(()=>!paymentInProgress&&!yookassaCheckBusy)}
    try{
        browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
        await check('ruble-only cards and exact discounted prices appear in the chooser',async()=>{
            const page=await pageFor();
            assert.equal(await page.locator('#yookassa-price').textContent(),'699,30 ₽');assert.equal(await page.locator('#stars-price').textContent(),'350 ⭐');
            assert.match(await page.locator('#discount-tag-6m').textContent(),/30%/);
            assert.equal(await page.locator('#price-6m').textContent(),'699,30 ₽');
            assert.equal(await page.locator('#payment-cost').textContent(),'699,30 ₽');
            assert.match(await page.locator('#payment-cost-label').textContent(),/со скидкой/);
            assert.equal(await page.evaluate(()=>tg.MainButton.visible),false);
            await page.locator('#payment-sheet-close').click();await page.locator('#tariff-3m').click();await page.evaluate(()=>window.mainClick());assert.equal(await page.locator('#yookassa-price').textContent(),'549,00 ₽');
            assert.equal(await page.locator('#stars-price').textContent(),'275 ⭐');await page.context().close();
        });
        await check('YooKassa creates once and directs the user to the bot without auto-opening checkout',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            assert.deepEqual(await page.evaluate(()=>checkoutLinks),[]);
            await page.locator('#checkout-open-bot').click();assert.deepEqual(await page.evaluate(()=>botLinks),['https://t.me/SOLTestBot']);
            assert.equal(await page.locator('#checkout-open-link').isVisible(),false);
            assert.equal(await page.evaluate(()=>invoices.length),0);assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            const request=state.requests.find(r=>r.path==='/api/payments/yookassa/order');
            assert.deepEqual(request.body,{months:6,expected_currency:'RUB',expected_amount:69930,quote_token:'signed-quote-6'});
            assert.match(request.key,/^[0-9a-f-]{36}$/i);assert.equal(await page.locator('#check-yookassa').isVisible(),true);
            assert.equal(state.requests.some(r=>r.path.startsWith('/api/web/')),false);await page.context().close();
        });
        await check('Stars flow remains openInvoice with server confirmation and separate key',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            await page.locator('#pay-stars').click();await page.waitForFunction(()=>invoices.length===1);
            const rub=state.requests.find(r=>r.path==='/api/payments/yookassa/order');const stars=state.requests.find(r=>r.path==='/api/payments/invoice');
            assert.notEqual(rub.key,stars.key);assert.equal(stars.body.expected_amount,350);assert.equal(stars.body.expected_currency,'XTR');
            await page.evaluate(()=>invoiceCallback('paid'));await idle(page);assert.equal(await page.evaluate(()=>isSubscribedUser),true);await page.context().close();
        });
        await check('disabled or old backend shows unavailable YooKassa while Stars stays usable',async()=>{
            for(const config of [{enabled:false},{legacy:true},{missingQuote:true}]){
                reset(config);const page=await pageFor();assert.equal(await page.locator('#pay-yookassa').isDisabled(),true);
                assert.equal(await page.locator('#pay-stars').isDisabled(),false);
                await page.evaluate(()=>payWithYookassa());assert.equal(state.orders.length,0);await page.context().close();
            }
        });
        await check('pending and return events do not grant; server paid updates the subscription',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            await page.locator('#check-yookassa').click();await idle(page);assert.equal(await page.evaluate(()=>isSubscribedUser),false);
            state.status='paid';await page.locator('#check-yookassa').click();await idle(page);
            assert.equal(await page.evaluate(()=>isSubscribedUser),true);assert.equal(await page.locator('#checkout-status').textContent(),'');assert.equal(await page.evaluate(()=>selectedMonths),null);assert.match(await page.locator('#toast-container').textContent(),/подтверждена сервером/);
            await page.context().close();
        });
        await check('pending order restores after clearing storage without opening browser automatically',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            const first=state.requests.find(r=>r.path==='/api/payments/yookassa/order').key;
            const storage=await page.evaluate(()=>localStorage.getItem('sol-checkout:7001:yookassa'));
            assert.ok(!storage.includes('https:')&&!storage.includes('quote_token')&&!storage.includes('initData'));
            await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>userData?.id===7001);await idle(page);assert.equal(await page.evaluate(()=>selectedMonths),null);
            assert.equal(await page.evaluate(()=>checkoutLinks.length),0);assert.equal(await page.evaluate(()=>yookassaAttempts[6].key),first);
            await page.context().close();
        });
        await check('lost response and retry reuse the same order and key',async()=>{
            state.failCreate=503;const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            const first=state.requests.find(r=>r.path==='/api/payments/yookassa/order').key;
            state.failCreate=0;await page.locator('#pay-yookassa').click();await idle(page);
            const requests=state.requests.filter(r=>r.path==='/api/payments/yookassa/order');assert.equal(requests[1].key,first);
            assert.equal(state.orders.length,1);await page.context().close();
        });
        await check('409 refreshes quotes and requires a new explicit payment click',async()=>{
            state.failCreate=409;const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            assert.equal(await page.evaluate(()=>checkoutLinks.length),0);assert.equal(await page.locator('#yookassa-price').textContent(),'799,20 ₽');
            await page.locator('#pay-yookassa').click();await idle(page);
            const requests=state.requests.filter(r=>r.path==='/api/payments/yookassa/order');assert.notEqual(requests[0].key,requests[1].key);
            assert.equal(requests[1].body.expected_amount,79920);await page.context().close();
        });
        await check('invalid confirmation URLs and mismatched amounts never open links',async()=>{
            for(const config of [{badUrl:'http://insecure/'},{badUrl:'javascript:alert(1)'},{badUrl:'https://u:p@example.org/'},{badAmount:true}]){
                reset(config);const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
                assert.equal(await page.evaluate(()=>checkoutLinks.length),0);assert.equal(await page.evaluate(()=>isSubscribedUser),false);await page.context().close();
            }
        });
        await check('cancellation and refund never claim a new paid subscription',async()=>{
            for(const status of ['canceled','refunded','review']){
                reset();const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);state.status=status;
                await page.locator('#check-yookassa').click();await idle(page);assert.equal(await page.evaluate(()=>isSubscribedUser),false);await page.context().close();
            }
        });
        await check('disabling YooKassa keeps pending status checks and working Stars',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);state.enabled=false;
            await page.evaluate(()=>loadBootstrap(false));assert.equal(await page.locator('#pay-yookassa').isDisabled(),true);
            assert.equal(await page.locator('#check-yookassa').isVisible(),true);assert.equal(await page.locator('#pay-stars').isDisabled(),false);
            state.status='paid';await page.locator('#check-yookassa').click();await idle(page);assert.equal(await page.evaluate(()=>isSubscribedUser),true);
            await page.context().close();
        });
        await check('tariff stays fixed during creation and can change after checkout opens',async()=>{
            const page=await pageFor();await page.evaluate(()=>{void payWithYookassa();selectTariff(3)});await idle(page);
            assert.equal(await page.evaluate(()=>selectedMonths),6);
            await page.locator('#payment-sheet-close').click();await page.locator('#tariff-3m').click();await page.evaluate(()=>window.mainClick());assert.equal(await page.evaluate(()=>selectedMonths),3);
            assert.equal(await page.locator('#yookassa-price').textContent(),'549,00 ₽');await page.context().close();
        });
        await check('fallback explicitly opens the existing order without another POST',async()=>{
            reset({delivery:'failed'});const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            assert.equal(await page.evaluate(()=>checkoutLinks.length),0);
            await page.locator('#checkout-open-link').click();await idle(page);
            assert.deepEqual(await page.evaluate(()=>checkoutLinks),['https://yoomoney.ru/checkout/offline']);
            assert.equal(state.requests.filter(r=>r.path==='/api/payments/yookassa/order').length,1);await page.context().close();
        });
        await check('unknown bot delivery offers the same safe fallback without re-creating checkout',async()=>{
            reset({delivery:'unknown',bootstrapDelay:120});const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            state.status='paid';await page.locator('#checkout-open-link').click();await idle(page);
            assert.equal(await page.evaluate(()=>checkoutLinks.length),0);assert.equal(await page.evaluate(()=>isSubscribedUser),true);
            assert.equal(state.orders.length,1);await page.context().close();
        });
        await check('GET delivery recovery and bootstrap after cleared storage restore the sent bot link',async()=>{
            reset({delivery:'pending'});const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            assert.equal(await page.locator('#checkout-open-link').isVisible(),true);state.delivery='sent';
            await page.locator('#check-yookassa').click();await idle(page);assert.equal(await page.locator('#checkout-open-bot').isVisible(),true);
            assert.equal(await page.locator('#checkout-open-link').isVisible(),false);
            await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>userData?.id===7001);await idle(page);assert.equal(await page.evaluate(()=>selectedMonths),null);
            await page.evaluate(()=>{selectTariff(6);window.mainClick()});await page.locator('#checkout-open-bot').click();
            assert.deepEqual(await page.evaluate(()=>botLinks),['https://t.me/SOLTestBot']);assert.equal(state.orders.length,1);await page.context().close();
        });
        await check('closing during fallback status check does not open an external browser later',async()=>{
            reset({delivery:'failed',statusDelay:160});const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);
            await page.evaluate(()=>{void openExistingCheckout();closePaymentSheet()});await idle(page);
            assert.equal(await page.evaluate(()=>checkoutLinks.length),0);assert.equal(state.orders.length,1);await page.context().close();
        });
        await check('closing during Stars creation suppresses late invoice UI and preserves its key',async()=>{
            reset({invoiceDelay:160});const page=await pageFor();await page.evaluate(()=>{void paySelectedTariff()});await page.waitForTimeout(45);await page.evaluate(()=>closePaymentSheet());await idle(page);
            assert.equal(await page.evaluate(()=>invoices.length),0);assert.equal(state.requests.filter(r=>r.path==='/api/payments/invoice').length,1);
            assert.ok(await page.evaluate(()=>paymentAttempts[6].orderId));await page.context().close();
        });
        await check('old snapshot prices are explicitly marked when a new discount lowers the headline price',async()=>{
            const page=await pageFor();await page.locator('#pay-yookassa').click();await idle(page);await page.locator('#pay-stars').click();
            await page.waitForFunction(()=>invoices.length===1);await page.evaluate(()=>invoiceCallback('cancelled'));await idle(page);
            state.price=59940;state.stars=300;state.discount=40;await page.evaluate(async()=>{await loadBootstrap(false);selectTariff(6);window.mainClick()});
            assert.equal(await page.locator('#payment-cost').textContent(),'599,40 ₽');assert.equal(await page.locator('#yookassa-price').textContent(),'699,30 ₽');
            assert.equal(await page.locator('#stars-price').textContent(),'350 ⭐');assert.equal(await page.locator('#payment-snapshot-note').isVisible(),true);
            assert.equal(await page.locator('#yookassa-saved-note').isVisible(),true);assert.equal(await page.locator('#stars-saved-note').isVisible(),true);
            assert.equal(state.requests.filter(r=>r.method==='POST').length,2);await page.context().close();
        });
        await check('opening and closing the chooser creates no payment and restores background focus',async()=>{
            const page=await pageFor(440,{open:false});assert.equal(await page.evaluate(()=>tg.MainButton.text),'Оплатить');
            await page.locator('#tariffs-toggle-btn').focus();await page.evaluate(()=>window.mainClick());
            assert.equal(await page.locator('#payment-methods').getAttribute('role'),'dialog');
            await page.locator('#payment-sheet-close').click();
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),false);
            assert.equal(await page.evaluate(()=>document.querySelector('.app-container').inert),false);
            await page.evaluate(()=>{selectTariff(6);window.mainClick()});await page.mouse.click(8,8);
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),false);
            assert.equal(state.orders.length,0);assert.equal(state.requests.some(r=>r.method==='POST'),false);await page.context().close();
        });
        await check('focus trap, Escape, swipe down and browser fallback work',async()=>{
            const page=await pageFor();await page.locator('#payment-sheet-close').focus();await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(()=>document.activeElement.id),'pay-stars');await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(()=>document.activeElement.id),'payment-sheet-close');await page.keyboard.press('Escape');
            await page.evaluate(()=>{delete tg.MainButton;selectTariff(6);updatePaymentCta()});await page.locator('#payment-open-button').click();
            const box=await page.locator('#payment-sheet-swipe').boundingBox();await page.mouse.move(box.x+15,box.y+10);await page.mouse.down();
            await page.mouse.move(box.x+15,box.y+110,{steps:6});await page.mouse.up();
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),false);assert.equal(state.orders.length,0);await page.context().close();
        });
        await check('330 ms rise and reverse survive rapid close-reopen without leaving the app inert',async()=>{
            const page=await pageFor(440,{open:false,motion:'no-preference'});await page.evaluate(()=>window.mainClick());
            assert.equal(await page.locator('#payment-methods').evaluate(el=>getComputedStyle(el).transitionDuration),'0.33s, 0.33s');
            await page.waitForTimeout(65);const opacity=await page.locator('#payment-methods').evaluate(el=>Number(getComputedStyle(el).opacity));
            assert.ok(opacity>0&&opacity<1);
            await page.waitForTimeout(350);await page.evaluate(()=>{closePaymentSheet();selectTariff(6);openPaymentSheet()});await page.waitForTimeout(400);
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),true);await page.evaluate(()=>closePaymentSheet());
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),true);await page.waitForTimeout(400);
            assert.equal(await page.locator('#payment-sheet-backdrop').isVisible(),false);assert.equal(await page.evaluate(()=>document.querySelector('.app-container').inert),false);
            assert.equal(state.orders.length,0);await page.context().close();
        });
        await check('440 px, narrow and desktop layouts keep both prices and controls readable',async()=>{
            for(const width of [320,360,440,768]){
                const page=await pageFor(width);await page.locator('#payment-methods').scrollIntoViewIfNeeded();
                const geometry=await page.evaluate(()=>{const p=document.querySelector('#payment-methods');return {overflow:document.documentElement.scrollWidth>innerWidth,
                    panel:p.scrollWidth>p.clientWidth,buttons:[...p.querySelectorAll('.payment-method')].map(b=>({h:b.clientHeight,overflow:b.scrollWidth>b.clientWidth}))}});
                assert.equal(geometry.overflow,false);assert.equal(geometry.panel,false);assert.ok(geometry.buttons.every(b=>b.h>=44&&!b.overflow));
                if(width===440&&process.env.SOL_CHECKOUT_SCREENSHOT_DIR){await fs.mkdir(process.env.SOL_CHECKOUT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SOL_CHECKOUT_SCREENSHOT_DIR,'payment-methods-440.png')})}
                await page.context().close();
            }
        });
        assert.deepEqual(errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
