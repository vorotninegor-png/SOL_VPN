// Shared local fixture for appearance and payment UI. External traffic is blocked.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
async function fixture(){
    const state={requests:[],orders:[],users:[],active:new Set(),elapsed:0,base:Date.UTC(2026,10,8,12),discount:30,bootstrapDelay:0,forcePending:false,failStatus:false};
    const errors=[];
    const now=()=>state.base+state.elapsed;
    const tariffs=()=>[1,3,6,12].map(months=>({months,price_kopecks:Math.round(({1:19900,3:54900,6:99900,12:179900}[months])*(months===6?100-state.discount:100)/100),discount_percent:months===6?state.discount:0}));
    const orderStatus=o=>['paid','refunded','canceled','error'].includes(o.status)?o.status:!state.forcePending&&now()>=o.created+600000?'expired':o.status||'pending';
    const result=o=>({order_id:o.id,provider:o.provider,channel:o.provider,currency:o.provider==='yookassa'?'RUB':'XTR',months:o.months,
        ...(o.provider==='yookassa'?{amount_kopecks:o.amount}:{amount:o.amount}),status:orderStatus(o),payment_status:o.status||'pending',
        created_at:new Date(o.created).toISOString(),expires_at:new Date(o.created+600000).toISOString(),server_time:new Date(now()).toISOString(),request_id:o.key,
        invoice_url:'https://t.me/$offline',confirmation_url:'https://example.test/checkout',checkout_delivery:{state:'sent',bot_url:'https://t.me/SolOfflineBot'}});
    function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));}
    const server=http.createServer(async(req,res)=>{
        const url=new URL(req.url,'http://localhost'),name=url.pathname,uid=Number(req.headers['x-telegram-init-data'])||7001;
        if(name.startsWith('/api/'))state.requests.push({name,url:req.url,method:req.method,uid});
        if(name==='/api/bootstrap'){
            if(state.bootstrapDelay)await new Promise(resolve=>setTimeout(resolve,state.bootstrapDelay));
            return json(res,{user:{id:uid},is_admin:uid===8544752152,subscription:{active:state.active.has(uid),days_left:30},tariffs:tariffs(),referral:{bot_username:'SolOfflineBot'},
                admin:uid===8544752152?{users:[],approved_users:state.users.filter(u=>u.vip_admin_granted)}:undefined,
                payment:{channel:'telegram_stars',currency:'XTR',enabled:true,server_time:new Date(now()).toISOString(),tariffs:tariffs().map(t=>({months:t.months,amount:Math.ceil(t.price_kopecks/200),discount_percent:t.discount_percent})),
                    providers:{yookassa:{enabled:false,currency:'RUB',tariffs:[]}},pending_orders:state.orders.filter(o=>o.uid===uid&&!['paid','refunded','canceled','error'].includes(o.status)).slice().reverse().map(result)}});
        }
        if(name==='/api/payments/invoice'){
            const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
            const key=req.headers['idempotency-key'];state.requests.at(-1).key=key;
            let order=state.orders.find(o=>o.key===key&&o.uid===uid);
            if(!order){const id=`33333333-3333-4333-8333-${String(state.orders.length+1).padStart(12,'0')}`;order={id,key,uid,provider:'telegram_stars',months:body.months,amount:body.expected_amount,created:now(),status:'pending'};state.orders.push(order);}
            return json(res,result(order));
        }
        if(name.startsWith('/api/payments/orders/')){
            if(state.failStatus)return json(res,{detail:'offline'},503);
            const order=state.orders.find(o=>o.id===name.split('/').at(-1)&&o.uid===uid);return order?json(res,result(order)):json(res,{detail:'not found'},404);
        }
        if(name==='/api/admin/users'){
            if(uid!==8544752152)return json(res,{detail:'forbidden'},403);
            const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||50),q=url.searchParams.get('q')||'';
            const found=state.users.filter(u=>`${u.name} ${u.user_id}`.includes(q));const users=found.slice(offset,offset+limit);
            return json(res,{users,approved_users:state.users.filter(u=>u.vip_admin_granted),pagination:{total:found.length,next_offset:offset+users.length,has_more:offset+users.length<found.length},capabilities:{}});
        }
        if(name.startsWith('/api/'))return json(res,{detail:'not found'},404);
        const file=name==='/'?'index.html':name.slice(1);
        if(!['index.html','style.css','appearance.css','miniapp-ui.css','appearance.js','miniapp-ui.js','app.js','config.js'].includes(file))return res.writeHead(404).end();
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(file==='config.js'?'':await fs.readFile(path.join(root,file)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
    async function page({uid=7001,width=390,height=844,reducedMotion='reduce',storage={},early=true,fallback=false,wait=true,blockedStorage=false,weak=false}={}){
        const context=await browser.newContext({viewport:{width,height},reducedMotion});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(({uid,storage,early,base,fallback,blockedStorage,weak})=>{
            for(const[k,v]of Object.entries(storage))localStorage.setItem(k,JSON.stringify(v));
            if(blockedStorage){Storage.prototype.getItem=()=>{throw Error('blocked storage')};Storage.prototype.setItem=()=>{throw Error('blocked storage')};}
            if(weak){Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});}
            window.fakeNow=base;Date.now=()=>window.fakeNow;
            window.mainButtonState={visible:false,progress:false};window.nativeInvoices=[];window.toastEvents=[];
            window.Telegram={WebApp:{initData:String(uid),initDataUnsafe:early?{user:{id:uid}}:{},ready(){},expand(){},HapticFeedback:{selectionChanged(){},impactOccurred(){}},
                MainButton:{setText(v){mainButtonState.text=v},setParams(v){Object.assign(mainButtonState,v)},show(){mainButtonState.visible=true},hide(){mainButtonState.visible=false},enable(){},disable(){},showProgress(){mainButtonState.progress=true},hideProgress(){mainButtonState.progress=false},onClick(fn){window.mainClick=fn}},
                BackButton:{onClick(){},show(){},hide(){}},openInvoice(url,callback){nativeInvoices.push(url);window.invoiceCallback=callback},openTelegramLink(url){window.openedTelegram=url}}};
            if(fallback)document.startViewTransition=undefined;
            window.addEventListener('load',()=>{const original=window.showToast;window.showToast=(...args)=>{toastEvents.push(args[0]);return original(...args)};});
        },{uid,storage,early,base:now(),fallback,blockedStorage,weak});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
        if(wait)await page.waitForFunction(()=>serverOnline);return page;
    }
    async function idle(page){await page.waitForFunction(()=>!paymentInProgress&&!paymentOrderChecks.size);}
    async function select(page,months=6){await page.evaluate(months=>{selectTariff(months);openPaymentSheet()},months);}
    async function invoice(page,months=6){await select(page,months);await page.evaluate(()=>window.invoiceCallback=null);await page.locator('#pay-stars').click();await page.waitForFunction(()=>Boolean(window.invoiceCallback));return state.orders.at(-1);}
    async function advance(page,seconds){state.elapsed+=seconds*1000;await page.evaluate(ms=>{fakeNow+=ms;renderPaymentCountdowns()},seconds*1000);await page.waitForFunction(()=>!paymentOrderChecks.size);}
    return {state,errors,browser,page,origin,now,result,select,invoice,idle,advance,paid(order){order.status='paid';state.active.add(order.uid)},async close(){await browser.close();await new Promise(resolve=>server.close(resolve))}};
}
module.exports={fixture};
