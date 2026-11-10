// HTTP contract fake; the real backend is covered separately by test_support_api.py.
const {fixture}=require('./browser-fixture.cjs');
async function supportFixture(){
    const f=await fixture();f.state.supportEnabled=true;
    const s={tickets:[],events:[],requests:[],uploads:new Map(),cache:new Map(),reads:new Map(),next:1040,mid:0,eid:0,createLoseOnce:false,replyLoseOnce:false,cancelFailOnce:false,reserveDelay:0};
    const clone=x=>JSON.parse(JSON.stringify(x));
    const unread=uid=>{const map=new Map();for(const e of s.events)if(e.target===uid&&e.id>(s.reads.get(`${uid}:${e.ticket_id}`)||0))map.set(e.ticket_id,(map.get(e.ticket_id)||0)+1);return [...map].map(([ticket_id,count])=>({ticket_id,count}));};
    function emit(t,kind,target,message_id=null){s.events.push({id:++s.eid,ticket_id:t.id,kind,target,message_id});}
    function draft(uid){let t=s.tickets.find(t=>t.uid===uid&&t.status==='draft');if(!t){t={id:++s.next,uid,user_no:s.tickets.filter(t=>t.uid===uid).length+1,user_number:new Set(s.tickets.filter(t=>t.status!=='draft').map(t=>t.uid)).size+1,subject:'',description:'',status:'draft',draft_version:0,attachments:[],messages:[],created_at:1700000000,full_name:`Имя <&> ${uid===7001?'Александр':'Мария'}`,profile_url:`tg://user?id=${uid}`};s.tickets.push(t);}return t;}
    function addMessage(t,text,direction='user',attachments=[]){const m={id:++s.mid,text,direction,created_at:1700000000+s.mid,attachments};t.messages.push(m);emit(t,'message',direction==='admin'?t.uid:8544752152,m.id);return m;}
    function open(t,subject,description){t.subject=subject;t.description=description;t.status='open';t.opened_at=1700000000;t.user_number=[...new Set(s.tickets.filter(x=>x.status!=='draft').map(x=>x.uid))].indexOf(t.uid)+1;t.messages.push({id:++s.mid,text:description,direction:'user',created_at:1700000000+s.mid,attachments:clone(t.attachments)});emit(t,'opened',8544752152,s.mid);return t;}
    const publicTicket=t=>({...clone(t),uid:undefined,messages:undefined,attachments:t.status==='draft'?clone(t.attachments):[],last_direction:t.messages.at(-1)?.direction||'user',unread_count:0});
    f.state.supportHandler=async(req,res,url,uid,json)=>{
        const p=url.pathname,method=req.method,key=req.headers['idempotency-key'];
        const chunks=[];try{for await(const c of req)chunks.push(c);}catch(_){return true;}
        const raw=Buffer.concat(chunks);let body={};if(raw.length&&!p.endsWith('/uploads'))body=JSON.parse(raw.toString());
        s.requests.push({p,method,key,uid,body,rawLength:raw.length});
        const send=(value,status=200)=>{json(res,value,status);return true;};
        const own=t=>t&&(t.uid===uid||uid===8544752152)&&!(t.status==='draft'&&t.uid!==uid);
        if(p==='/api/support/capabilities')return send({enabled:true,uploads:true,max_attachments:10,photo_max_bytes:10485760,file_max_bytes:20971520,bot_url:'https://t.me/SolOfflineBot'});
        if(p==='/api/support/drafts'&&method==='POST'){
            const t=draft(uid);if(s.reserveDelay)await new Promise(r=>setTimeout(r,s.reserveDelay));return send(publicTicket(t));
        }
        let match;
        if(match=p.match(/^\/api\/support\/drafts\/(\d+)(?:\/attachments\/(\d+))?$/)){
            const t=s.tickets.find(t=>t.id===+match[1]);if(!t)return send({ok:true});if(!own(t))return send({detail:'Недоступно'},404);
            if(method==='DELETE'){
                if(s.cancelFailOnce){s.cancelFailOnce=false;return send({detail:'offline'},503);}
                if(t.status!=='draft')return send({detail:'Уже отправлен'},409);
                if(match[2]){t.attachments=t.attachments.filter(a=>a.id!==+match[2]);t.draft_version++;}
                else s.tickets.splice(s.tickets.indexOf(t),1);
                return send({ok:true});
            }
            if(body.version!==t.draft_version)return send({detail:'Черновик изменился'},409);
            Object.assign(t,{subject:body.subject,description:body.description,draft_version:t.draft_version+1});return send(publicTicket(t));
        }
        if(p==='/api/support/tickets'&&method==='POST'){
            const cache=`${uid}:${key}`;if(s.cache.has(cache))return send(s.cache.get(cache));
            const t=s.tickets.find(t=>t.id===body.draft_id&&t.uid===uid)||draft(uid);open(t,body.subject,body.description);
            const result=publicTicket(t);s.cache.set(cache,result);
            if(s.createLoseOnce){s.createLoseOnce=false;return send({detail:'response lost'},500);}return send(result);
        }
        if(p==='/api/support/tickets'||p==='/api/admin/support/tickets'){
            if(p.includes('/admin/')&&uid!==8544752152)return send({detail:'forbidden'},403);
            const all=s.tickets.filter(t=>t.status==='open'&&(p.includes('/admin/')||t.uid===uid));const offset=+(url.searchParams.get('offset')||0),limit=+(url.searchParams.get('limit')||30);
            return send({tickets:all.slice(offset,offset+limit).map(t=>({...publicTicket(t),unread_count:unread(uid).find(x=>x.ticket_id===t.id)?.count||0})),total:all.length,has_more:offset+limit<all.length});
        }
        if(p==='/api/support/events'){
            const after=+(url.searchParams.get('after')||0),initial=url.searchParams.get('initial')==='1',events=s.events.filter(e=>e.id>after&&(e.target===uid||uid===8544752152||s.tickets.find(t=>t.id===e.ticket_id)?.uid===uid));
            const u=unread(uid);return send({events:initial?[]:events.map(({target,...e})=>({...e,notify:target===uid})),cursor:s.eid,unread:u,unread_count:u.reduce((n,r)=>n+r.count,0)});
        }
        if(match=p.match(/^\/api\/support\/tickets\/(\d+)(?:\/(messages|uploads|read))?$/)){
            const t=s.tickets.find(t=>t.id===+match[1]);if(!own(t))return send({detail:'Недоступно'},404);
            if(!match[2]){if(s.delayTicket)await new Promise(resolve=>setTimeout(resolve,s.delayTicket));return send(publicTicket(t));}
            if(match[2]==='read'){s.reads.set(`${uid}:${t.id}`,Math.max(s.reads.get(`${uid}:${t.id}`)||0,body.event_id));return send({ok:true});}
            if(match[2]==='messages'&&method==='GET'){
                const before=+(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER),rows=t.messages.filter(m=>m.id<before),latest=rows.slice(-30);
                return send({messages:latest,has_more:rows.length>30,before:latest[0]?.id||null,read_event:s.eid});
            }
            if(match[2]==='messages'){
                if(t.status==='closed')return send({detail:'Тикет закрыт'},409);
                const cache=`${uid}:${key}`;if(s.cache.has(cache))return send(s.cache.get(cache));
                const files=(body.upload_ids||[]).map(id=>{const upload=s.uploads.get(id);upload.used=true;return upload.attachment;});const m=addMessage(t,body.text,uid===8544752152?'admin':'user',files);const result={ticket_id:t.id,message_id:m.id};s.cache.set(cache,result);
                if(s.replyLoseOnce){s.replyLoseOnce=false;return send({detail:'response lost'},500);}return send(result);
            }
            if(method==='GET')return send({uploads:[...s.uploads].filter(([id,u])=>u.ticket===t.id&&u.uid===uid&&!u.draft&&!u.used).map(([id,u])=>({id,state:'ready',filename:u.attachment.filename,kind:u.attachment.kind,size:u.attachment.size}))});
            const id=100+s.uploads.size,attachment={id,kind:url.searchParams.get('kind'),filename:url.searchParams.get('filename'),size:raw.length,download_url:`/api/support/attachments/${id}`};
            s.uploads.set(key,{attachment,ticket:t.id,uid,draft:t.status==='draft'});if(t.status==='draft'){t.attachments.push(attachment);t.draft_version++;}
            return send({upload_id:key,state:'ready',ticket:publicTicket(t)});
        }
        if(match=p.match(/^\/api\/support\/uploads\/(.+)$/)){
            const file=s.uploads.get(match[1]);if(file){const t=s.tickets.find(t=>t.id===file.ticket);t.attachments=t.attachments.filter(a=>a.id!==file.attachment.id);t.draft_version++;s.uploads.delete(match[1]);}return send({ok:true});
        }
        if(p.startsWith('/api/support/attachments/')){res.writeHead(200,{'Content-Type':'application/octet-stream'}).end('safe file');return true;}
        if(match=p.match(/^\/api\/admin\/support\/tickets\/(\d+)\/(close-preview|close)$/)){
            if(uid!==8544752152)return send({detail:'forbidden'},403);const t=s.tickets.find(t=>t.id===+match[1]);
            if(match[2]==='close-preview')return send({confirmation:'nonce1234567'});
            if(t.status!=='closed'){t.status='closed';emit(t,'closed',t.uid);}return send({ok:true,status:'closed'});
        }
        return send({detail:'not found'},404);
    };
    return {...f,s,draft,open,addMessage,emit};
}
module.exports={supportFixture};
