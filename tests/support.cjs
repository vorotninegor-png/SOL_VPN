const assert=require('node:assert/strict');
const {supportFixture}=require('./support-fixture.cjs');
async function main(){
    const f=await supportFixture();let checks=0;
    async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
    async function page(options={}){const p=await f.page(options);await p.waitForFunction(()=>Boolean(document.getElementById('support-open')));await p.waitForFunction(()=>SolSupport.snapshot().cursor!==null);return p;}
    async function open(p){await p.evaluate(()=>switchNav(3,'info'));await p.locator('#support-open').click();await p.locator('#support-overlay h3').filter({hasText:'Мои обращения'}).waitFor();}
    async function create(p){await open(p);await p.getByRole('button',{name:'Создать тикет',exact:true}).click();await p.locator('.support-form input').waitFor();}
    async function fill(p){await p.locator('.support-form input').fill('Не работает VPN');await p.locator('.support-form textarea').fill('Описание <script>window.bad=true</script> & 🚀');}
    async function send(p){await p.getByRole('button',{name:'Отправить',exact:true}).click();await p.locator('.support-composer').waitFor();}
    try{
        await check('disabled client flag leaves published FAQ and admin layout untouched',async()=>{
            f.state.supportEnabled=false;const p=await f.page();assert.equal(await p.locator('#support-open').count(),0);assert.equal(await p.locator('#support-admin-tabs').count(),0);f.state.supportEnabled=true;await p.context().close();
        });
        await check('entry uses SVG between terminal and questions; overlay preserves FAQ state and geometry',async()=>{
            const p=await page();await p.evaluate(()=>switchNav(3,'info'));await p.locator('[data-faq-id="2"]').click();await p.waitForTimeout(100);
            const before=await p.locator('.info-scroll-viewport').boundingBox();await p.locator('#support-open').click();assert.equal(await p.locator('#support-open svg').count(),1);assert.equal(await p.locator('[data-faq-id="2"]').getAttribute('aria-pressed'),'true');
            const after=await p.locator('.info-scroll-viewport').boundingBox();assert.deepEqual(before,after);
            await p.locator('#support-overlay .support-back').click();await p.waitForFunction(()=>!SolSupport.snapshot().open);assert.equal(await p.locator('[data-faq-id="2"]').getAttribute('aria-pressed'),'true');await p.context().close();
        });
        await check('blank forms stay grey and valid submission has green state without HTML parsing',async()=>{
            const p=await page();await create(p);const send=p.locator('.support-submit');assert.equal(await send.isDisabled(),true);
            await p.locator('.support-form input').fill('  ');await p.locator('.support-form textarea').fill('  ');assert.equal(await send.isDisabled(),true);
            await fill(p);assert.equal(await send.isEnabled(),true);assert.equal(await send.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 103, 68)');await send.click();await p.locator('.support-composer').waitFor();assert.equal(await p.getByRole('button',{name:'Ранее',exact:true,includeHidden:true}).isHidden(),true);assert.equal(await p.evaluate(()=>window.bad),undefined);assert.ok((await p.locator('.support-message-text').textContent()).includes('<script>'));await p.context().close();
        });
        await check('back cancels reserved draft and clears fields on next entry',async()=>{
            const p=await page();await create(p);await fill(p);const id=f.s.tickets.at(-1).id;
            await p.locator('#support-overlay .support-back').click();await p.getByRole('button',{name:'Создать тикет',exact:true}).waitFor();assert.equal(f.s.tickets.some(t=>t.id===id),false);
            await p.getByRole('button',{name:'Создать тикет',exact:true}).click();await p.locator('.support-form input').waitFor();assert.equal(await p.locator('.support-form input').inputValue(),'');assert.equal(await p.locator('.support-form textarea').inputValue(),'');await p.context().close();
        });
        await check('lost create response retries same idempotency key and creates one ticket',async()=>{
            const p=await page();await create(p);await fill(p);f.s.createLoseOnce=true;const before=f.s.tickets.filter(t=>t.status==='open').length;
            await p.locator('.support-submit').click();await p.getByRole('button',{name:'Повторить отправку',exact:true}).waitFor();assert.equal(await p.locator('.support-form input').isDisabled(),true);
            await p.getByRole('button',{name:'Повторить отправку',exact:true}).click();await p.locator('.support-composer').waitFor();const posts=f.s.requests.filter(r=>r.p==='/api/support/tickets'&&r.method==='POST').slice(-2);assert.equal(posts[0].key,posts[1].key);assert.equal(f.s.tickets.filter(t=>t.status==='open').length,before+1);await p.context().close();
        });
        await check('cancel failure is persisted per owner and cleaned before a new form',async()=>{
            const p=await page();await create(p);const identity=f.s.tickets.at(-1).id;f.s.cancelFailOnce=true;await p.locator('#support-overlay .support-back').click();await p.waitForTimeout(80);
            await p.evaluate(()=>SolSupport.refresh());await p.getByRole('button',{name:'Повторить',exact:true}).click().catch(()=>{});await p.getByRole('button',{name:'Создать тикет',exact:true}).waitFor();assert.equal(f.s.tickets.some(t=>t.id===identity),false);await p.context().close();
        });
        await check('uploads appear as chips and are sent once with the draft',async()=>{
            const p=await page();await create(p);await fill(p);const chooser=p.waitForEvent('filechooser');await p.getByRole('button',{name:'Добавить файлы',exact:true}).click();await(await chooser).setFiles({name:'файл.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
            await p.locator('.support-file-chip').filter({hasText:'готово'}).waitFor();await send(p);assert.equal(await p.locator('.support-attachment').count(),1);await p.context().close();
        });
        await check('chat posting and uncertain retry never duplicate a message',async()=>{
            const p=await page();await create(p);await fill(p);await send(p);const t=f.s.tickets.at(-1),before=t.messages.length;f.s.replyLoseOnce=true;
            await p.locator('.support-compose-row textarea').fill('Сообщение пользователя');await p.locator('.support-compose-row').getByRole('button',{name:'Отправить',exact:true}).click();await p.locator('.support-compose-row').getByRole('button',{name:'Повторить отправку',exact:true}).waitFor();
            await p.locator('.support-compose-row').getByRole('button',{name:'Повторить отправку',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.support-compose-row textarea').value==='');assert.equal(t.messages.length,before+1);await p.context().close();
        });
        await check('live bot replies update chat once, unread clears only when viewed, closed hides composer',async()=>{
            const p=await page();await create(p);await fill(p);await send(p);const t=f.s.tickets.at(-1);f.addMessage(t,'Ответ из Python','admin');await p.evaluate(()=>SolSupport.refresh());await p.getByText('Ответ из Python',{exact:true}).waitFor();const count=await p.locator('.support-message').count();await p.evaluate(()=>SolSupport.refresh());assert.equal(await p.locator('.support-message').count(),count);
            t.status='closed';f.emit(t,'closed',7001);await p.evaluate(()=>SolSupport.refresh());assert.equal(await p.locator('.support-composer').isVisible(),false);assert.ok((await p.locator('.support-status').textContent()).includes('закрыт'));await p.context().close();
        });
        await check('long history prepends older messages without duplicates',async()=>{
            const t=f.open(f.draft(7010),'Длинная история','Начало');for(let i=0;i<65;i++)f.addMessage(t,'Ответ '+i,'admin');const p=await page({uid:7010});await open(p);await p.getByRole('button',{name:`№${t.id} — Длинная история`,exact:true}).click();await p.locator('.support-message').first().waitFor();assert.equal(await p.locator('.support-message').count(),30);
            await p.getByRole('button',{name:'Ранее',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.support-message').length===60);assert.equal(new Set(await p.locator('.support-message').evaluateAll(rows=>rows.map(r=>r.dataset.messageId))).size,60);await p.context().close();
        });
        await check('admin tabs preserve the existing DOM, drafts and scroll; close requires confirmation',async()=>{
            const t=f.open(f.draft(7011),'Админский тикет','Проблема');const p=await page({uid:8544752152});await p.evaluate(()=>switchNav(4,'admin'));await p.locator('#admin-promo-name').fill('MYCODE');await p.evaluate(()=>{window.originalPromo=document.querySelector('#admin-promo-name');document.querySelector('.support-admin-original').scrollTop=180;});
            const scroll=await p.locator('.support-admin-original').evaluate(el=>el.scrollTop);await p.locator('#support-admin-tabs').getByRole('tab',{name:/Тикеты/}).click();await p.locator(`[data-ticket-id="${t.id}"]`).waitFor();assert.equal(await p.locator('.support-user-link').filter({hasText:'Имя'}).count()>0,true);
            await p.locator(`[data-ticket-id="${t.id}"] .support-close-action`).click();await p.locator('.choice-dialog').waitFor();assert.equal(t.status,'open');await p.getByRole('button',{name:'Закрыть тикет',exact:true}).last().click();await p.waitForFunction(id=>!document.querySelector(`[data-ticket-id="${id}"]`),t.id);assert.equal(t.status,'closed');
            await p.locator('#support-admin-tabs').getByRole('tab',{name:'Админ-панель',exact:true}).click();assert.equal(await p.locator('#admin-promo-name').inputValue(),'MYCODE');assert.equal(await p.evaluate(()=>originalPromo===document.querySelector('#admin-promo-name')),true);assert.equal(await p.locator('.support-admin-original').evaluate(el=>el.scrollTop),scroll);await p.context().close();
        });
        await check('ordinary users have no ticket admin tab and account change discards private UI',async()=>{
            const p=await page();assert.equal(await p.locator('#support-admin-tabs').count(),0);await open(p);await p.evaluate(()=>{Telegram.WebApp.initData='7002';applyBootstrap({user:{id:7002},is_admin:false});});await p.waitForFunction(()=>SolSupport.snapshot().owner==='7002'&&document.getElementById('support-open'));assert.equal(await p.locator('#support-overlay .support-message').count(),0);assert.equal(await p.locator('#support-admin-tabs').count(),0);await p.context().close();
        });
        await check('all themes and 320/360/390/440/desktop widths remain readable without horizontal overflow',async()=>{
            for(const width of [320,360,390,440,1024]){const p=await page({width});await open(p);for(const theme of ['cosmic','classic','ocean','aurora','solar','matrix']){await p.evaluate(theme=>SolAppearance.update({theme,classicMode:theme==='classic'?'light':'dark'}),theme);assert.equal(await p.locator('#support-overlay').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);}
                await p.context().close();}
        });
        await check('short keyboard viewport and reduced motion keep composer and controls visible',async()=>{
            const p=await page({width:320,height:360,reducedMotion:'reduce'});await create(p);await fill(p);await p.locator('.support-submit').scrollIntoViewIfNeeded();await send(p);const box=await p.locator('.support-compose-row').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=361);assert.equal(await p.locator('#support-overlay').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await p.context().close();
        });
        await check('native payment CTA is hidden only while support overlays and selection is preserved',async()=>{
            const p=await page();await p.evaluate(()=>selectTariff(6));await open(p);assert.equal(await p.evaluate(()=>mainButtonState.visible),false);assert.equal(await p.evaluate(()=>selectedMonths),6);await p.locator('#support-overlay .support-back').click();await p.waitForFunction(()=>!SolSupport.snapshot().open);assert.equal(await p.evaluate(()=>selectedMonths),6);assert.equal(await p.evaluate(()=>mainButtonState.visible),true);await p.context().close();
        });
        await check('returning after reload restores server history and does not auto-notify old events',async()=>{
            const t=f.open(f.draft(7022),'Сохранённый тикет','Переписка после входа');const p=await page({uid:7022});await open(p);await p.getByRole('button',{name:`№${t.id} — Сохранённый тикет`,exact:true}).click();await p.getByText('Переписка после входа',{exact:true}).waitFor();await p.reload();await p.waitForFunction(()=>document.getElementById('support-open')&&SolSupport.snapshot().cursor!==null);await open(p);await p.getByRole('button',{name:`№${t.id} — Сохранённый тикет`,exact:true}).click();await p.getByText('Переписка после входа',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>toastEvents.some(t=>t.includes('Новый тикет'))),false);await p.context().close();
        });
        await check('a late old-account response cannot expose a private ticket after account change',async()=>{
            const t=f.open(f.draft(7020),'SECRET_OWNER_A','Личное описание');const p=await page({uid:7020});await open(p);f.s.delayTicket=180;await p.getByRole('button',{name:`№${t.id} — SECRET_OWNER_A`,exact:true}).click();await p.evaluate(()=>{Telegram.WebApp.initData='7021';applyBootstrap({user:{id:7021},is_admin:false});});await p.waitForFunction(()=>SolSupport.snapshot().owner==='7021'&&document.getElementById('support-open'));await p.waitForTimeout(220);assert.equal(await p.locator('#support-overlay').textContent(),'');f.s.delayTicket=0;await p.context().close();
        });
        await check('hidden admin chat does not mark new messages read and refreshes when reopened',async()=>{
            const t=f.open(f.draft(7030),'READ_CHECK','Тест непрочитанных');const p=await page({uid:8544752152});await p.evaluate(()=>switchNav(4,'admin'));await p.getByRole('tab',{name:/Тикеты/}).click();await p.locator(`[data-ticket-id="${t.id}"] .support-chat-action`).click();await p.locator('#support-admin-tickets .support-composer').waitFor();await p.evaluate(()=>switchNav(1,'profile'));f.addMessage(t,'НЕПРОЧИТАНО','user');await p.evaluate(()=>SolSupport.refresh());assert.ok(await p.evaluate(id=>SolSupport.snapshot().unread.some(([key,count])=>key===id&&count>0),t.id));await p.evaluate(()=>switchNav(4,'admin'));await p.getByText('НЕПРОЧИТАНО',{exact:true}).waitFor();assert.equal(await p.evaluate(id=>SolSupport.snapshot().unread.some(([key,count])=>key===id&&count>0),t.id),false);await p.context().close();
        });
        await check('admin tab keyboard selection and overlay focus remain accessible',async()=>{
            const p=await page({uid:8544752152});await p.evaluate(()=>switchNav(4,'admin'));const main=p.getByRole('tab',{name:'Админ-панель',exact:true});await main.focus();await p.keyboard.press('ArrowRight');assert.equal(await p.getByRole('tab',{name:/Тикеты/}).getAttribute('aria-selected'),'true');await p.keyboard.press('ArrowLeft');assert.equal(await main.getAttribute('aria-selected'),'true');await open(p);await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.getElementById('support-overlay').contains(document.activeElement)),true);await p.context().close();
        });
        await check('same-account bot messages sync without duplicate notifications',async()=>{
            const t=f.open(f.draft(7040),'СВОЙ КАНАЛ','Начало');const p=await page({uid:7040});await open(p);await p.getByRole('button',{name:`№${t.id} — СВОЙ КАНАЛ`,exact:true}).click();await p.locator('.support-composer').waitFor();const before=await p.evaluate(()=>toastEvents.length);f.addMessage(t,'Написал сам через бота','user');await p.evaluate(()=>SolSupport.refresh());await p.getByText('Написал сам через бота',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>toastEvents.length),before);await p.context().close();
        });
        await check('new replies preserve old scroll and DOM nodes until the reader reaches the bottom',async()=>{
            const t=f.open(f.draft(7041),'ПРОКРУТКА','Начало');for(let i=0;i<40;i++)f.addMessage(t,'Старый текст '+i,'admin');const p=await page({uid:7041});await open(p);await p.getByRole('button',{name:`№${t.id} — ПРОКРУТКА`,exact:true}).click();await p.locator('.support-message').first().waitFor();await p.evaluate(()=>{const log=document.querySelector('.support-messages');log.scrollTop=0;window.oldBubble=log.querySelector('.support-message');});f.addMessage(t,'Новое внизу','admin');await p.evaluate(()=>SolSupport.refresh());assert.equal(await p.locator('.support-messages').evaluate(el=>el.scrollTop),0);assert.equal(await p.evaluate(()=>oldBubble===document.querySelector('.support-message')),true);assert.equal(await p.evaluate(id=>SolSupport.snapshot().unread.some(([key,count])=>key===id&&count>0),t.id),true);await p.locator('.support-messages').evaluate(el=>{el.scrollTop=el.scrollHeight;});await p.waitForFunction(id=>!SolSupport.snapshot().unread.some(([key,count])=>key===id&&count>0),t.id);await p.context().close();
        });
        await check('unsent chat files restore after reload and stay private until Send',async()=>{
            const t=f.open(f.draft(7042),'ФАЙЛ ПОСЛЕ ВХОДА','Начало');const p=await page({uid:7042});await open(p);await p.getByRole('button',{name:`№${t.id} — ФАЙЛ ПОСЛЕ ВХОДА`,exact:true}).click();await p.locator('.support-composer').waitFor();const chooser=p.waitForEvent('filechooser');await p.locator('.support-compose-row').getByRole('button',{name:'Файл',exact:true}).click();await(await chooser).setFiles({name:'restore.txt',mimeType:'text/plain',buffer:Buffer.from('test')});await p.locator('.support-file-chip').filter({hasText:'готово'}).waitFor();assert.equal(t.messages.length,1);await p.reload();await p.waitForFunction(()=>document.getElementById('support-open')&&SolSupport.snapshot().cursor!==null);await open(p);await p.getByRole('button',{name:`№${t.id} — ФАЙЛ ПОСЛЕ ВХОДА`,exact:true}).click();await p.locator('.support-file-chip').filter({hasText:'restore.txt'}).waitFor();await p.locator('.support-compose-row').getByRole('button',{name:'Отправить',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.support-attachment').length===1);assert.equal(t.messages.length,2);await p.context().close();
        });
        await check('Back during reservation cannot resurrect a cancelled form or reuse its number',async()=>{
            const p=await page({uid:7043});await open(p);f.s.reserveDelay=180;await p.getByRole('button',{name:'Создать тикет',exact:true}).click();await p.waitForTimeout(35);const cancelled=f.s.tickets.find(t=>t.uid===7043&&t.status==='draft')?.id;await p.locator('#support-overlay .support-back').click();await p.getByRole('button',{name:'Создать тикет',exact:true}).click();await p.locator('.support-form input').waitFor();assert.equal(await p.locator('.support-form input').inputValue(),'');const current=f.s.tickets.find(t=>t.uid===7043&&t.status==='draft');if(cancelled)assert.ok(current.id>cancelled);f.s.reserveDelay=0;await p.context().close();
        });
        assert.deepEqual(f.errors,[]);console.log(`${checks} checks passed; no browser JavaScript errors.`);
    }finally{await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
