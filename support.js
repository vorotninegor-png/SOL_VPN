/* Ticket UI only. Prices, VPN, games and existing admin actions stay in app.js. */
(() => {
    'use strict';
    const $=selector=>document.querySelector(selector);
    const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
    const icon=name=>window.SolUI.icon(name);
    const abort=()=>new DOMException('Account or view changed','AbortError');
    const uuid=()=>crypto.randomUUID();
    const action=(label,symbol,fn,cls='')=>{const b=node('button','support-button '+cls);b.type='button';if(symbol)b.insertAdjacentHTML('beforeend',icon(symbol));b.append(node('span','',label));b.addEventListener('click',()=>void fn());return b;};
    const pathId=id=>{if(!Number.isSafeInteger(Number(id))||Number(id)<1)throw Error('Некорректный номер обращения');return Number(id);};
    const motion=()=>window.SolAppearance?.animationsAllowed()!==false&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx={owner:null,admin:false,revision:0,controllers:new Set(),timer:null,polling:false,cursor:null,caps:null,
        overlay:null,open:false,trigger:null,background:[],urls:new Set(),unread:new Map(),pendingCancels:new Set(),userView:null,adminView:null};

    async function request(path,options={},version=ctx.revision){
        if(version!==ctx.revision)throw abort();
        const controller=new AbortController();ctx.controllers.add(controller);
        try{const result=await apiFetch(path,{...options,signal:controller.signal});if(version!==ctx.revision)throw abort();return result;}
        finally{ctx.controllers.delete(controller);}
    }
    function cancellationKey(){return `sol-support-cancel:${ctx.owner}`;}
    function persistCancels(){try{localStorage.setItem(cancellationKey(),JSON.stringify([...ctx.pendingCancels]));}catch(_){/* Session cleanup still works. */}}
    async function cleanup(version){
        for(const identity of [...ctx.pendingCancels]){
            try{await request(`/api/support/drafts/${pathId(identity)}`,{method:'DELETE'},version);}
            catch(error){if(![404,409].includes(error.status))throw error; /* Gone/submitted: never delete an open ticket. */}
            if(version!==ctx.revision)throw abort();ctx.pendingCancels.delete(identity);persistCancels();
        }
    }
    function revokeMedia(){for(const url of ctx.urls)URL.revokeObjectURL(url);ctx.urls.clear();}
    function badges(){
        const count=[...ctx.unread.values()].reduce((a,b)=>a+b,0);
        document.querySelectorAll('.support-unread-total').forEach(el=>{el.textContent=count>99?'99+':String(count);el.hidden=!count;});
    }
    function errorText(error){return error.status===404||error.status===503?'Поддержка Mini App пока недоступна. Откройте Telegram-бота или попробуйте позже.':error.message||'Не удалось связаться с поддержкой';}
    function notify(message,type='info'){ctx.notice?.remove();showToast(message,type);ctx.notice=$('#toast-container')?.lastElementChild;}

    class View{
        constructor(root,role){this.root=root;this.role=role;this.ownerRevision=ctx.revision;this.serial=0;this.offset=0;this.selected=null;this.form=null;this.posting=false;this.nodes=new Map();this.replyUploads=[];this.replyKey=null;this.frozenReply=null;this.listRows=[];this.urls=new Set();}
        valid(serial=this.serial){return this.ownerRevision===ctx.revision&&this.root.isConnected&&serial===this.serial;}
        active(){return !document.hidden&&(this.role==='user'?ctx.open:Boolean($('#screen-admin.active')&&!this.root.inert));}
        clearMedia(){for(const url of this.urls){URL.revokeObjectURL(url);ctx.urls.delete(url);}this.urls.clear();}
        dropUploads(){for(const file of this.replyUploads)if(file.uploadId||file.key)void this.api(`/api/support/uploads/${file.uploadId||file.key}`,{method:'DELETE'}).catch(()=>{});this.replyUploads=[];}
        api(path,opts={}){return request(path,opts,this.ownerRevision);}
        notice(error){if(error.name!=='AbortError'&&this.valid())notify(errorText(error),'error');}
        frame(title,back){
            this.root.replaceChildren();const header=node('header','support-heading');
            if(back)header.append(action('Назад','back',back,'support-back'));
            header.append(node('h3','',title));this.root.append(header);
            this.status=node('p','support-status');this.status.setAttribute('role','status');this.root.append(this.status);
        }
        async list(reset=true,preserve=false){
            const serial=++this.serial;this.dropUploads();this.clearMedia();this.selected=null;this.form=null;this.posting=false;this.frozenReply=null;this.replyKey=null;
            const wanted=preserve?Math.max(30,this.listRows.length):30;
            if(reset&&!preserve){this.offset=0;this.listRows=[];this.frame(this.role==='admin'?'Тикеты SOL VPN':'Мои обращения',this.role==='user'?()=>closeOverlay():null);this.body=node('div','support-list support-scroll');this.root.append(this.body);}
            if(!preserve)this.status.textContent='Загружаем обращения…';
            try{
                await cleanup(this.ownerRevision);
                const base=this.role==='admin'?'/api/admin/support/tickets':'/api/support/tickets';
                let result=await this.api(`${base}?offset=${reset?0:this.offset}&limit=30`),incoming=result.tickets;
                while(preserve&&result.has_more&&incoming.length<wanted){result=await this.api(`${base}?offset=${incoming.length}&limit=30`);incoming.push(...result.tickets);}
                if(!this.valid(serial))return;
                const top=this.body.scrollTop;
                this.listRows=reset?incoming:[...this.listRows,...incoming.filter(t=>!this.listRows.some(old=>old.id===t.id))];
                this.offset=this.listRows.length;this.body.replaceChildren();
                if(!this.listRows.length)this.body.append(node('p','support-empty','Активных обращений пока нет.'));
                let lastUser=null;
                for(const ticket of this.listRows){
                    if(this.role==='admin'&&ticket.user_number!==lastUser){
                        const heading=node('h4','support-user-heading');heading.append(document.createTextNode(`${ticket.user_number}. `));
                        const name=node('a','support-user-link',ticket.full_name);
                        if(/^tg:\/\/user\?id=\d+$/.test(ticket.profile_url||''))name.href=ticket.profile_url;
                        heading.append(name);this.body.append(heading);lastUser=ticket.user_number;
                    }
                    const card=node('article','support-card');card.dataset.ticketId=ticket.id;
                    const unread=ctx.unread.get(ticket.id)||ticket.unread_count||0;card.classList.toggle('support-new',unread>0);
                    const content=action(`№${ticket.id} — ${ticket.subject}`,null,()=>this.chat(ticket.id),'support-ticket-title');
                    card.append(content,node('p','support-ticket-state',unread?`Новых сообщений: ${unread}`:ticket.last_direction==='admin'?'Ответ поддержки':'Ожидает ответа'));
                    if(this.role==='admin'){
                        card.append(node('p','support-preview',ticket.description));
                        const buttons=node('div','support-row-actions');buttons.append(action('Открыть чат','message',()=>this.chat(ticket.id),'support-chat-action'),action('Закрыть тикет','close',()=>this.confirmClose(ticket.id),'support-close-action'));card.append(buttons);
                    }
                    this.body.append(card);
                }
                if(result.has_more)this.body.append(action('Показать ещё','plus',()=>this.list(false)));
                if(this.role==='user')this.body.append(action('Создать тикет','plus',()=>this.create(),'support-new-ticket'));
                if(preserve)this.body.scrollTop=top;
                this.status.textContent='';this.needsRefresh=false;this.root.querySelector('.support-retry')?.remove();
            }catch(error){if(!this.valid(serial))return;this.needsRefresh=true;this.status.textContent=errorText(error);if(!this.root.querySelector('.support-retry'))this.root.append(action('Повторить','refresh',()=>this.list(),'support-retry'));this.botLink();}
        }
        botLink(){if(ctx.caps?.bot_url){const link=node('a','support-bot-link','Открыть Telegram-бота');link.href=ctx.caps.bot_url;this.root.append(link);}}
        async create(){
            const serial=++this.serial;this.frame('Новый тикет',()=>this.cancelForm());this.status.textContent='Готовим форму…';
            this.form={key:uuid(),reserveKey:uuid(),draft:null,uploads:[],busy:false,frozen:null};
            const reservedForm=this.form;
            const previousReserve=ctx.reserveTask||Promise.resolve();let finishReserve;
            const reserveTask=new Promise(resolve=>{finishReserve=resolve;});ctx.reserveTask=reserveTask;
            try{
                await previousReserve;if(!this.valid(serial))return;
                await cleanup(this.ownerRevision);
                const draft=await this.api('/api/support/drafts',{method:'POST',headers:{'Idempotency-Key':this.form.reserveKey}});
                if(!this.valid(serial)){if(reservedForm.cancelRequested&&this.ownerRevision===ctx.revision){ctx.pendingCancels.add(draft.id);persistCancels();await cleanup(this.ownerRevision);}return;}this.form.draft=draft;
                this.root.querySelector('h3').textContent=`Создание тикета №${draft.id}`;
                const form=node('form','support-form support-scroll');
                this.subject=node('input');this.subject.type='text';this.subject.maxLength=120;this.subject.placeholder='Тема обращения';this.subject.required=true;this.subject.value=draft.subject;
                this.description=node('textarea');this.description.maxLength=4096;this.description.rows=7;this.description.placeholder='Опишите проблему';this.description.required=true;this.description.value=draft.description;
                for(const [text,input]of[['Тема',this.subject],['Проблема',this.description]]){const label=node('label','support-field',text);label.append(input);form.append(label);input.addEventListener('input',()=>this.formState());}
                this.fileList=node('div','support-files');form.append(this.fileList);
                const pending=await this.api(`/api/support/tickets/${draft.id}/uploads`);if(!this.valid(serial))return;
                this.form.uploads=[...(draft.attachments||[]).map(file=>({attachment:file,ready:true,existing:true})),...pending.uploads.map(file=>this.pendingFile(file))];
                this.attach=action('Добавить файлы','plus',()=>this.pickFiles(true),'support-attach');this.attach.hidden=!ctx.caps?.uploads;form.append(this.attach);
                this.send=action('Отправить','send',()=>this.submit(),'support-submit');form.append(this.send);
                form.addEventListener('submit',e=>{e.preventDefault();void this.submit();});this.root.append(form);
                this.status.textContent='До отправки обращение не поступит администратору.';this.renderUploads(true);this.formState();this.subject.focus({preventScroll:true});
            }catch(error){if(this.valid(serial)){this.status.textContent=errorText(error);this.root.append(action('Назад','back',()=>this.cancelForm()));}}
            finally{finishReserve();if(ctx.reserveTask===reserveTask)ctx.reserveTask=null;}
        }
        formState(){if(!this.form||!this.send)return;const busy=this.form.busy;this.send.disabled=busy||!this.subject.value.trim()||!this.description.value.trim()||this.form.uploads.some(u=>!u.ready);if(this.attach)this.attach.disabled=busy||Boolean(this.form.frozen)||this.form.uploads.some(u=>!u.ready&&!u.error);this.send.querySelector('span').textContent=busy?'Отправляем…':this.form.frozen?'Повторить отправку':'Отправить';}
        async saveDraft(){
            const draft=this.form.draft;
            const updated=await this.api(`/api/support/drafts/${draft.id}`,{method:'PUT',body:JSON.stringify({subject:this.subject.value.trim(),description:this.description.value.trim(),version:draft.draft_version})});
            this.form.draft=updated;
        }
        async submit(){
            if(!this.form||this.form.busy||this.send.disabled)return;
            const form=this.form,serial=this.serial;form.busy=true;this.formState();
            const payload=form.frozen||{draft_id:form.draft.id,version:form.draft.draft_version,subject:this.subject.value.trim(),description:this.description.value.trim()};
            this.subject.disabled=true;this.description.disabled=true;this.attach.disabled=true;
            try{
                const result=await this.api('/api/support/tickets',{method:'POST',headers:{'Idempotency-Key':form.key},body:JSON.stringify(payload)});
                if(!this.valid(serial))return;this.form=null;notify(`Тикет №${result.id} отправлен`);await this.chat(result.id);
            }catch(error){
                if(!this.valid(serial))return;
                if(!error.status||error.status>=500){form.frozen=payload;this.status.textContent='Результат не подтверждён. Повтор отправит тот же запрос без создания второго тикета.';}
                else{this.status.textContent=errorText(error);this.subject.disabled=false;this.description.disabled=false;form.frozen=null;if(error.status===409)this.root.append(action('Обновить форму','refresh',()=>this.create()));}
            }finally{if(this.valid(serial)&&this.form===form){form.busy=false;this.attach.disabled=Boolean(form.frozen);this.formState();}}
        }
        async cancelForm(close=false){
            if(this.form?.busy){notify('Дождитесь результата отправки');return false;}
            const identity=this.form?.draft?.id;
            if(this.form)this.form.cancelRequested=true;
            if(identity){ctx.pendingCancels.add(identity);persistCancels();}
            this.form=null;this.serial++;this.root.replaceChildren();
            if(close)hideOverlay();else void this.list();
            try{await cleanup(this.ownerRevision);}catch(error){this.notice(error);}
            return true;
        }
        async pickFiles(draft){
            const input=node('input');input.type='file';input.multiple=true;
            input.addEventListener('change',()=>void this.files([...input.files],draft),{once:true});input.click();
        }
        pendingFile(file){return {name:file.filename,key:file.id,uploadId:file.id,ready:file.state==='ready',error:file.state==='ready'?null:'Загрузка не подтверждена; можно удалить и выбрать файл заново'};}
        async files(files,draft){
            const serial=this.serial,record=draft?this.form:null;
            if(draft&&(!record||record.busy||record.frozen))return;
            const list=draft?record.uploads:this.replyUploads;
            if(files.length+list.length>10){notify('Можно прикрепить до 10 файлов','error');return;}
            for(const file of files){
                if(!this.valid(serial))return;
                const kind=['image/jpeg','image/png','image/webp'].includes(file.type)?'photo':file.type==='video/mp4'?'video':'document';
                const limit=kind==='photo'?ctx.caps.photo_max_bytes:ctx.caps.file_max_bytes;
                if(file.size>limit){notify('Файл слишком большой: фото до 10 МБ, остальные до 20 МБ','error');continue;}
                const entry={name:file.name,key:uuid(),ready:false};list.push(entry);this.renderUploads(draft);
                try{
                    if(draft)await this.saveDraft();
                    const identity=draft?record.draft.id:this.selected.id;
                    const result=await this.api(`/api/support/tickets/${identity}/uploads?kind=${kind}&filename=${encodeURIComponent(file.name.slice(0,200))}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','Idempotency-Key':entry.key},body:file});
                    if(!this.valid(serial))return;
                    entry.ready=true;entry.uploadId=result.upload_id;
                    if(draft)record.draft=result.ticket;
                }catch(error){if(!this.valid(serial))return;entry.error=errorText(error);this.notice(error);}
                this.renderUploads(draft);
            }
        }
        renderUploads(draft){
            const list=draft?this.form?.uploads:this.replyUploads,target=draft?this.fileList:this.replyFileList;
            if(!list||!target)return;target.replaceChildren();
            for(const entry of list){const row=node('div','support-file-chip');row.append(node('span','',`${entry.name||entry.attachment?.filename||'Вложение'} · ${entry.error?'не загружено':entry.ready?'готово':'загрузка…'}`));
                row.append(action('Удалить','close',async()=>{
                    if(!entry.ready&&!entry.error)return;
                    try{const path=entry.existing?`/api/support/drafts/${this.form.draft.id}/attachments/${entry.attachment.id}`:`/api/support/uploads/${entry.uploadId||entry.key}`;await this.api(path,{method:'DELETE'});list.splice(list.indexOf(entry),1);if(draft)this.form.draft=await this.api(`/api/support/tickets/${this.form.draft.id}`);this.renderUploads(draft);}catch(error){this.notice(error);}
                },'support-file-remove'));target.append(row);}
            if(draft)this.formState();else this.replyState();
        }
        async chat(identity){
            const serial=++this.serial;this.dropUploads();this.clearMedia();this.form=null;this.nodes.clear();this.posting=false;this.frozenReply=null;this.replyKey=null;this.incomplete=true;
            this.before=null;this.hasHistory=false;this.readSeen=0;this.pendingRead=0;this.reading=null;
            this.frame(`Тикет №${identity}`,()=>this.list());this.status.textContent='Загружаем историю…';
            try{
                const ticket=await this.api(`/api/support/tickets/${pathId(identity)}`);if(!this.valid(serial))return;this.selected=ticket;
                const title=node('p','support-topic',ticket.subject);this.root.append(title);
                if(this.role==='admin'){const name=node('a','support-user-link',ticket.full_name);if(/^tg:\/\/user\?id=\d+$/.test(ticket.profile_url||''))name.href=ticket.profile_url;this.root.append(name);}
                this.messages=node('div','support-messages support-scroll');this.messages.setAttribute('role','log');this.messages.setAttribute('aria-label','Переписка тикета');this.root.append(this.messages);
                this.messages.addEventListener('scroll',()=>{if(this.messages.scrollHeight-this.messages.scrollTop-this.messages.clientHeight<90)void this.markRead();},{passive:true});
                this.older=action('Ранее','back',()=>this.history(true));this.messages.append(this.older);
                const pending=await this.api(`/api/support/tickets/${identity}/uploads`);if(!this.valid(serial))return;this.replyUploads=pending.uploads.map(file=>this.pendingFile(file));
                this.composer=node('form','support-composer');this.replyFileList=node('div','support-files');this.composer.append(this.replyFileList);
                const row=node('div','support-compose-row');
                this.replyInput=node('textarea');this.replyInput.rows=2;this.replyInput.maxLength=4096;this.replyInput.placeholder='Сообщение';this.replyInput.setAttribute('aria-label','Сообщение в тикет');this.replyInput.addEventListener('input',()=>this.replyState());
                this.replyAttach=action('Файл','plus',()=>this.pickFiles(false),'support-icon-button');this.replyAttach.hidden=!ctx.caps.uploads;
                this.replySend=action('Отправить','send',()=>this.reply(),'support-icon-button');
                row.append(this.replyAttach,this.replyInput,this.replySend);this.composer.append(row);this.composer.addEventListener('submit',e=>{e.preventDefault();void this.reply();});this.root.append(this.composer);
                this.incomplete=false;this.renderUploads(false);await this.history();if(!this.valid(serial))return;this.closedState();this.replyState();if(!this.needsRefresh&&this.selected.status!=='closed')this.status.textContent='';
            }catch(error){if(this.valid(serial)){this.needsRefresh=true;this.status.textContent=errorText(error);}}
        }
        closedState(){const closed=this.selected?.status==='closed';if(this.composer)this.composer.hidden=closed;if(closed)this.status.textContent='Тикет закрыт. История сохранена.';}
        async history(older=false){
            if(!this.selected||!this.messages||this.loadingHistory?.serial===this.serial)return;
            const serial=this.serial,identity=this.selected.id,lock={serial};this.loadingHistory=lock;
            try{
                const suffix=older&&this.before?`?before=${this.before}`:'';
                const result=await this.api(`/api/support/tickets/${identity}/messages${suffix}`);
                if(!this.valid(serial)||this.selected.id!==identity)return;
                const height=this.messages.scrollHeight,top=this.messages.scrollTop,atBottom=height-top-this.messages.clientHeight<90;
                for(const message of result.messages){
                    if(this.nodes.has(message.id))continue;
                    const bubble=node('article','support-message');bubble.dataset.messageId=message.id;
                    bubble.dataset.side=(this.role==='admin'?message.direction==='admin':message.direction==='user')?'own':'peer';
                    bubble.append(node('p','support-message-author',message.direction==='admin'?'Поддержка':'Пользователь'),node('p','support-message-text',message.text));
                    for(const attachment of message.attachments||[])bubble.append(this.attachment(attachment));
                    const time=node('time','',new Date(message.created_at*1000).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(message.created_at*1000).toISOString();bubble.append(time);
                    this.nodes.set(message.id,bubble);
                }
                let previous=this.older;
                for(const[id,bubble]of [...this.nodes].sort((a,b)=>a[0]-b[0])){if(previous.nextElementSibling!==bubble)this.messages.insertBefore(bubble,previous.nextElementSibling);previous=bubble;}
                if(older||!this.before){this.before=result.before;this.older.hidden=!result.has_more;}
                if(older)this.messages.scrollTop=top+this.messages.scrollHeight-height;else if(atBottom||!this.hasHistory)this.messages.scrollTop=this.messages.scrollHeight;
                this.hasHistory=true;this.pendingRead=result.read_event;
                if(this.messages.scrollHeight-this.messages.scrollTop-this.messages.clientHeight<90)await this.markRead();
                this.needsRefresh=false;if(!this.frozenReply&&this.selected.status!=='closed')this.status.textContent='';
            }catch(error){if(this.valid(serial)){this.needsRefresh=true;this.status.textContent=errorText(error);}}finally{if(this.loadingHistory===lock)this.loadingHistory=null;}
        }
        async markRead(){
            if(!this.active()||!this.selected||this.reading||this.pendingRead<=this.readSeen||this.messages.scrollHeight-this.messages.scrollTop-this.messages.clientHeight>=90)return;
            const identity=this.selected.id,event=this.pendingRead,serial=this.serial,lock={};this.reading=lock;
            try{await this.api(`/api/support/tickets/${identity}/read`,{method:'POST',body:JSON.stringify({event_id:event})});if(this.valid(serial)&&this.selected.id===identity){this.readSeen=event;ctx.unread.delete(identity);badges();}}
            catch(error){if(error.name!=='AbortError')this.notice(error);}finally{if(this.reading===lock)this.reading=null;}
        }
        attachment(attachment){
            const box=node('div','support-attachment');const label=attachment.filename||({photo:'Фото',video:'Видео',document:'Документ'}[attachment.kind]||'Вложение');
            const open=action(label,'plus',async()=>{
                const controller=new AbortController(),version=this.ownerRevision,serial=this.serial;ctx.controllers.add(controller);open.disabled=true;
                try{
                    const response=await fetch(apiUrl(`/api/support/attachments/${pathId(attachment.id)}`),{headers:{'X-Telegram-Init-Data':tg.initData},cache:'no-store',signal:controller.signal});
                    if(!response.ok)throw Error('Не удалось получить файл. Попробуйте через Telegram-бота.');const blob=await response.blob();if(version!==ctx.revision||!this.valid(serial)||!box.isConnected)throw abort();
                    const url=URL.createObjectURL(blob);ctx.urls.add(url);this.urls.add(url);
                    if(attachment.kind==='photo'){const img=node('img');img.alt=label;img.src=url;box.replaceChildren(img);}
                    else if(attachment.kind==='video'&&blob.type.startsWith('video/')){const video=node('video');video.controls=true;video.src=url;box.replaceChildren(video);}
                    else{const link=node('a','support-download',label);link.href=url;link.download=label;box.replaceChildren(link);link.click();}
                }catch(error){this.notice(error);}finally{ctx.controllers.delete(controller);open.disabled=false;}
            });box.append(open);return box;
        }
        replyState(){if(!this.replySend)return;this.replySend.disabled=this.posting||(!this.replyInput.value.trim()&&!this.replyUploads.length)||this.replyUploads.some(u=>!u.ready);this.replyAttach.disabled=this.posting||Boolean(this.frozenReply)||this.replyUploads.some(u=>!u.ready&&!u.error);this.replySend.querySelector('span').textContent=this.frozenReply?'Повторить отправку':'Отправить';}
        async reply(){
            if(this.replySend.disabled||this.posting)return;const serial=this.serial;this.posting=true;this.replyKey||=uuid();this.replyState();
            const payload=this.frozenReply||{text:this.replyInput.value.trim(),upload_ids:this.replyUploads.map(u=>u.uploadId)};
            this.replyInput.disabled=true;this.replyAttach.disabled=true;
            try{
                await this.api(`/api/support/tickets/${this.selected.id}/messages`,{method:'POST',headers:{'Idempotency-Key':this.replyKey},body:JSON.stringify(payload)});
                if(!this.valid(serial))return;this.replyInput.value='';this.replyUploads=[];this.replyKey=null;this.frozenReply=null;this.renderUploads(false);await this.history();
            }catch(error){if(!this.valid(serial))return;if(!error.status||error.status>=500){this.frozenReply=payload;this.status.textContent='Результат не подтверждён. Повтор использует тот же запрос.';}else this.frozenReply=null;this.notice(error);}
            finally{if(this.valid(serial)){this.posting=false;this.replyInput.disabled=Boolean(this.frozenReply);this.replyAttach.disabled=Boolean(this.frozenReply);this.replyState();}}
        }
        async confirmClose(identity){
            try{
                const result=await this.api(`/api/admin/support/tickets/${identity}/close-preview`,{method:'POST'});
                const trigger=this.root.querySelector(`[data-ticket-id="${identity}"] .support-close-action`)||this.root.querySelector('button');
                window.SolUI.openChoice({trigger,title:`Закрыть тикет №${identity}? История сохранится.`,options:[['cancel','Отмена'],['close','Закрыть тикет']],value:'cancel',onChoose:value=>{if(value==='close')void(async()=>{
                    try{await this.api(`/api/admin/support/tickets/${identity}/close`,{method:'POST',body:JSON.stringify({confirmation:result.confirmation})});notify(`Тикет №${identity} закрыт`);await this.list();}catch(error){this.notice(error);}
                })();}});
            }catch(error){this.notice(error);}
        }
        async update(){if(this.form||this.posting||!this.active()||$('.choice-backdrop:not([hidden])'))return;try{if(this.selected&&this.incomplete){await this.chat(this.selected.id);return;}if(this.selected){const current=await this.api(`/api/support/tickets/${this.selected.id}`);this.selected=current;await this.history();this.closedState();}else await this.list(true,true);}catch(error){if(this.valid()){this.needsRefresh=true;this.status.textContent=errorText(error);}}}
    }

    function hideOverlay(){
        if(!ctx.open)return;ctx.open=false;const overlay=ctx.overlay;
        overlay.classList.remove('is-open');overlay.inert=true;
        for(const[el,inert,aria]of ctx.background){el.inert=inert;if(aria===null)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden',aria);}ctx.background=[];
        const revision=ctx.revision;setTimeout(()=>{if(revision===ctx.revision&&!ctx.open)overlay.hidden=true;},motion()?440:0);
        ctx.trigger?.focus({preventScroll:true});tg?.BackButton?.hide?.();ctx.userView?.clearMedia();if(typeof updatePaymentCta==='function')updatePaymentCta();
    }
    async function closeOverlay(){if(ctx.userView?.form)return ctx.userView.cancelForm(true);hideOverlay();return true;}
    async function openOverlay(){
        window.SolUI.closeChoice(true);const rect=ctx.trigger.getBoundingClientRect(),app=$('.app-container').getBoundingClientRect();
        ctx.overlay.style.setProperty('--support-top',`${Math.max(0,rect.top-app.top)}px`);ctx.overlay.style.setProperty('--support-bottom',`${Math.max(0,app.bottom-rect.bottom)}px`);
        ctx.overlay.hidden=false;ctx.overlay.inert=false;ctx.open=true;ctx.background=[...ctx.overlay.parentElement.children].filter(el=>el!==ctx.overlay).map(el=>[el,el.inert,el.getAttribute('aria-hidden')]);
        for(const[el]of ctx.background){el.inert=true;el.setAttribute('aria-hidden','true');}
        void ctx.overlay.offsetHeight;ctx.overlay.classList.add('is-open');tg?.BackButton?.show?.();if(typeof updatePaymentCta==='function')updatePaymentCta();await ctx.userView.list();ctx.overlay.querySelector('button')?.focus({preventScroll:true});
    }
    function createUI(){
        const button=action('Написать в техподдержку','message',openOverlay,'support-entry');button.id='support-open';button.append(node('span','support-unread-total'));ctx.trigger=button;$('#terminal-box-element').after(button);
        const overlay=node('section','support-overlay');overlay.id='support-overlay';overlay.hidden=true;overlay.inert=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Поддержка SOL VPN');$('.app-container').append(overlay);ctx.overlay=overlay;ctx.userView=new View(overlay,'user');
        if(ctx.admin&&ctx.owner==='8544752152'){
            const screen=$('#screen-admin'),base=screen.querySelector('.admin-scroll-content'),header=screen.querySelector('.admin-header');
            const tabs=node('div','support-admin-tabs');tabs.id='support-admin-tabs';tabs.setAttribute('role','tablist');
            const stage=node('div','support-admin-stage'),old=node('div','support-admin-original'),tickets=node('section','support-admin-tickets');tickets.id='support-admin-tickets';tickets.inert=true;tickets.setAttribute('role','tabpanel');
            base.before(stage);old.append(base);stage.append(old,tickets);header.after(tabs);screen.classList.add('has-support-tabs');ctx.adminView=new View(tickets,'admin');
            const original=action('Админ-панель',null,()=>select(false)),support=action('Тикеты','message',()=>select(true));original.setAttribute('role','tab');support.setAttribute('role','tab');support.append(node('span','support-unread-total'));tabs.append(original,support);
            original.id='support-admin-tab-main';support.id='support-admin-tab-tickets';old.id='support-admin-original';old.setAttribute('role','tabpanel');old.setAttribute('aria-labelledby',original.id);tickets.setAttribute('aria-labelledby',support.id);original.setAttribute('aria-controls',old.id);support.setAttribute('aria-controls',tickets.id);
            tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const on=event.key==='End'||event.key==='ArrowRight';select(on);(on?support:original).focus();});
            function select(on){stage.classList.toggle('show-support',on);old.inert=on;tickets.inert=!on;original.setAttribute('aria-selected',String(!on));support.setAttribute('aria-selected',String(on));original.tabIndex=on?-1:0;support.tabIndex=on?0:-1;if(on)void ctx.adminView.list();}
            select(false);ctx.adminDestroy=()=>{stage.before(base);stage.remove();tabs.remove();screen.classList.remove('has-support-tabs');};
        }
        badges();
    }
    async function poll(initial=false){
        if(!ctx.owner||ctx.polling||document.hidden||!ctx.caps?.enabled)return;
        ctx.polling=true;const version=ctx.revision;
        try{
            const result=await request(`/api/support/events?after=${ctx.cursor||0}&initial=${initial||ctx.cursor===null?1:0}`,{},version);
            if(document.hidden)return;
            ctx.cursor=result.cursor;ctx.unread=new Map(result.unread.map(item=>[item.ticket_id,item.count]));badges();
            if(result.events.length){
                const last=result.events.filter(event=>event.notify!==false&&event.notify!==0).at(-1);if(last)notify(last.kind==='closed'?`Тикет №${last.ticket_id} закрыт`:last.kind==='opened'?`Новый тикет №${last.ticket_id}`:`Новый ответ в тикете №${last.ticket_id}`);
                for(const event of result.events)if(event.kind==='closed')await request(`/api/support/tickets/${event.ticket_id}/read`,{method:'POST',body:JSON.stringify({event_id:event.id})},version);
            }
            for(const view of[ctx.userView,ctx.adminView])if(view?.active()){if(result.events.length||view.needsRefresh)await view.update();else if(view.selected&&!view.incomplete)await view.markRead();}
        }catch(error){if(error.name!=='AbortError'&&ctx.open)ctx.userView.status.textContent=errorText(error);}
        finally{if(version===ctx.revision){ctx.polling=false;if(!document.hidden){clearTimeout(ctx.timer);ctx.timer=setTimeout(()=>void poll(),4000);}}}
    }
    function reset(){
        clearTimeout(ctx.timer);ctx.timer=null;for(const c of ctx.controllers)c.abort();ctx.controllers.clear();
        hideOverlay();ctx.notice?.remove();ctx.notice=null;ctx.adminDestroy?.();ctx.adminDestroy=null;ctx.trigger?.remove();ctx.overlay?.remove();ctx.trigger=null;ctx.overlay=null;
        ctx.userView=null;ctx.adminView=null;ctx.cursor=null;ctx.caps=null;ctx.unread.clear();ctx.polling=false;ctx.reserveTask=null;revokeMedia();
    }
    async function setUser(user,admin){
        if(window.SOL_SUPPORT_ENABLED!==true)return;
        const owner=String(user?.id??user?.user_id??'');if(owner===ctx.owner&&Boolean(admin)===ctx.admin)return;
        reset();ctx.revision++;ctx.owner=owner;ctx.admin=Boolean(admin);ctx.pendingCancels.clear();if(!owner)return;
        try{ctx.pendingCancels=new Set(JSON.parse(localStorage.getItem(cancellationKey())||'[]').filter(n=>Number.isSafeInteger(n)&&n>0));}catch(_){}
        const version=ctx.revision;
        try{ctx.caps=await request('/api/support/capabilities',{},version);if(version!==ctx.revision)return;createUI();if(ctx.caps.enabled)await poll(true);}
        catch(error){if(error.name!=='AbortError'&&version===ctx.revision){ctx.caps={enabled:false,uploads:false};createUI();}}
    }
    document.addEventListener('visibilitychange',()=>{clearTimeout(ctx.timer);if(!document.hidden)void poll();});
    document.addEventListener('keydown',event=>{
        if(!ctx.open||$('.choice-backdrop:not([hidden])'))return;
        if(event.key==='Escape'){event.preventDefault();void closeOverlay();return;}
        if(event.key==='Tab'){const list=[...ctx.overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);if(!list.length)return;const index=list.indexOf(document.activeElement),next=(index+(event.shiftKey?-1:1)+list.length)%list.length;event.preventDefault();list[next].focus();}
    });
    window.SolSupport={setUser,refresh:()=>poll(),isBlocking:()=>ctx.open,back(){if(ctx.open){if(ctx.userView?.form)void ctx.userView.cancelForm();else if(ctx.userView?.selected)void ctx.userView.list();else void closeOverlay();return true;}if(ctx.adminView?.selected&&$('#screen-admin.active')){void ctx.adminView.list();return true;}return false;},onNavigation(screen){if(ctx.open&&screen!=='info')void closeOverlay();if(screen==='admin')queueMicrotask(()=>{if(ctx.adminView?.active())void ctx.adminView.update().catch(error=>ctx.adminView?.notice(error));});},snapshot:()=>({owner:ctx.owner,cursor:ctx.cursor,open:ctx.open,unread:[...ctx.unread],pendingCancels:[...ctx.pendingCancels]})};
})();
