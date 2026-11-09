/* Presentation helpers only: no API, payment, identity or permission state. */
(() => {
    "use strict";
    const shapes = {
        bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
        user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
        game:'<path d="M7 7h10c4 0 6 11 3 12-2 1-4-3-5-3H9c-1 0-3 4-5 3C1 18 3 7 7 7Z"/><path d="M7 10v5m-2.5-2.5h5M16 11h.01M19 14h.01"/>',
        info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
        key:'<circle cx="8" cy="8" r="4.5"/><path d="m11.2 11.2 9.3 9.3m-3-3 2.5-2.5m-5.5-.5 2.5-2.5"/>',
        rocket:'<path d="M14 5c3-3 7-2 7-2s1 4-2 7l-7 7-5-5 7-7ZM8 11H3l4-5h6m0 10v5l5-4v-5M6 16l-3 5 5-3"/><circle cx="16" cy="8" r="1.5"/>',
        copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
        card:'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18M6 15h4"/>',
        lock:'<rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3m-4.5 5v2.5"/>',
        planet:'<circle cx="12" cy="12" r="7"/><path d="M5 9c-4 0-4 4 0 6s10 1 14-2 3-5 0-5"/>',
        spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
        back:'<path d="m14 5-7 7 7 7"/>',
        left:'<path d="m15 5-7 7 7 7"/>',
        right:'<path d="m9 5 7 7-7 7"/>',
        crown:'<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7Z"/><path d="M6 22h12"/>',
        gift:'<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
        tag:'<path d="m3 12 9 9 9-9V3h-9L3 12Z"/><circle cx="16" cy="8" r="1"/>',
        calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
        users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.65"/>',
        search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
        profile:'<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0M18 3h3v3M21 3l-5 5"/>',
        message:'<path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9ZM7 8h10M7 12h7"/>',
        send:'<path d="m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2"/>',
        check:'<path d="m4 12 5 5L20 6"/>',
        warning:'<path d="M10.3 4a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3l8-14ZM12 9v4m0 4h.01"/>',
        close:'<path d="m6 6 12 12M18 6 6 18"/>',
        plus:'<path d="M12 4v16M4 12h16"/>',
        refresh:'<path d="M20 7V3l-4 4M4 17v4l4-4M20 7a9 9 0 0 0-15-2M4 17a9 9 0 0 0 15 2"/>',
        settings:'<path d="m9 3-1 3-3 1-2 3 2 2v3l3 2 1 4h6l1-4 3-2v-3l2-2-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>'
    };
    const decorative = { '⚡':'bolt','👤':'user','🎮':'game','💡':'info','🔑':'key','🚀':'rocket','🎁':'gift','👥':'users','📋':'copy','💳':'card','🔒':'lock','🪐':'planet','👑':'crown','🔥':'tag','🎉':'spark','🚨':'warning','⚠':'warning' };
    // Currency ⭐ and ₽ deliberately stay text. No HTML from server messages is parsed.
    const emoji = /(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
    const motion = () => window.SolAppearance?.animationsAllowed() !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    function icon(name, extra = '') {
        return `<svg class="sol-icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name] || shapes.spark}</svg>`;
    }
    function text(element, value, leadingIcon) {
        if (!element) return;
        element.replaceChildren();
        if (leadingIcon) element.insertAdjacentHTML('beforeend', icon(leadingIcon));
        for (const part of String(value ?? '').split(emoji)) {
            if (!part) continue;
            if (part.replace(/\uFE0F/g,'') !== '⭐' && /^\p{Extended_Pictographic}/u.test(part)) element.insertAdjacentHTML('beforeend', icon(decorative[part.replace(/\uFE0F/g,'')] || 'spark'));
            else element.append(document.createTextNode(part));
        }
    }
    const chevrons = new WeakMap();
    function disclosure(button, expanded, animate = true) {
        if (!button) return;
        button.setAttribute('aria-expanded', String(expanded));
        let svg = button.querySelector('.sol-chevron');
        if (!svg) { button.insertAdjacentHTML('beforeend', icon('right', 'sol-chevron')); svg = button.querySelector('.sol-chevron'); }
        const path = svg.firstElementChild;
        const previous = chevrons.get(button);
        if (previous) cancelAnimationFrame(previous.frame);
        const from = previous?.points || [9,5,16,12,9,19];
        const to = expanded ? [5,9,12,16,19,9] : [9,5,16,12,9,19];
        const state = {points:from,frame:0}; chevrons.set(button,state);
        const draw = points => path.setAttribute('d',`M${points[0]} ${points[1]}L${points[2]} ${points[3]}L${points[4]} ${points[5]}`);
        if (!animate || !motion()) { state.points=to;draw(to);return; }
        const start = performance.now();
        const step = now => {
            const t = Math.min(1,(now-start)/320), ease = 1-(1-t)**3;
            state.points = from.map((n,i)=>n+(to[i]-n)*ease);draw(state.points);
            if(t<1 && motion()) state.frame=requestAnimationFrame(step);else {state.points=to;draw(to);}
        };
        state.frame=requestAnimationFrame(step);
    }
    const activeDetails = new Map();
    document.addEventListener('sol:appearance-change',()=>{
        if(!motion())for(const settle of activeDetails.values())settle();
    });
    function enhanceDetails(details) {
        if (details.dataset.uiDetails) return;
        details.dataset.uiDetails='true';
        const summary=details.querySelector('summary'),body=document.createElement('div');body.className='ui-details-body';
        while(summary.nextSibling)body.append(summary.nextSibling);details.append(body);
        let expanded=details.open,animation,revision=0;
        body.id ||= `ui-details-${++detailsCount}`;summary.setAttribute('aria-controls',body.id);
        disclosure(summary,expanded,false);body.inert=!expanded;
        summary.addEventListener('click',event=>{
            event.preventDefault();expanded=!expanded;const version=++revision;
            const height=details.open?body.getBoundingClientRect().height:0;
            const opacity=details.open?getComputedStyle(body).opacity:0;
            animation?.cancel();activeDetails.delete(details);details.open=true;body.inert=!expanded;disclosure(summary,expanded);
            const finish=()=>{if(version!==revision)return;details.open=expanded;animation=null;activeDetails.delete(details);details.dispatchEvent(new Event('sol:disclosure-settled'));};
            if (!motion() || !body.animate) {finish();return;}
            animation=body.animate([{height:`${height}px`,opacity,transform:expanded?'translateY(8px)':'translateY(0)'},{height:expanded?`${body.scrollHeight}px`:'0px',opacity:expanded?1:0,transform:expanded?'translateY(0)':'translateY(8px)'}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)'});
            animation.onfinish=finish;
            activeDetails.set(details,()=>{animation?.cancel();finish();});
        });
    }
    let detailsCount=0,choice=null,backdrop,dialog,closeTimer;
    function ensureDialog() {
        if(backdrop)return;
        backdrop=document.createElement('div');backdrop.className='choice-backdrop';backdrop.hidden=true;
        backdrop.innerHTML=`<section class="choice-dialog" id="appearance-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-choice-title" tabindex="-1"><header><h3 id="appearance-choice-title"></h3><button type="button" class="choice-close" aria-label="Закрыть выбор">${icon('close')}</button></header><div class="choice-options" role="group" aria-labelledby="appearance-choice-title"></div></section>`;
        document.body.append(backdrop);dialog=backdrop.firstElementChild;
        backdrop.addEventListener('click',event=>{if(event.target===backdrop || event.target.closest('.choice-close'))closeChoice();});
        document.addEventListener('keydown',event=>{
            if(!choice)return;
            if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeChoice();return;}
            const buttons=[...dialog.querySelectorAll('button')];const options=buttons.slice(1);
            if(event.key==='Tab'){
                const current=buttons.indexOf(document.activeElement),next=(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length;
                event.preventDefault();buttons[next].focus();
            }else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
                const current=options.indexOf(document.activeElement);
                const next=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;
                event.preventDefault();options[next]?.focus();
            }
        },true);
        document.addEventListener('focusin',event=>{if(choice && !dialog.contains(event.target))dialog.focus({preventScroll:true});});
    }
    function openChoice({trigger,title,options,value,onChoose}) {
        closeChoice(true);ensureDialog();clearTimeout(closeTimer);
        const background=[...document.body.children].filter(el=>el!==backdrop && !['SCRIPT','STYLE'].includes(el.tagName)).map(el=>({el,inert:el.inert,hidden:el.getAttribute('aria-hidden')}));
        choice={trigger,background};
        dialog.querySelector('h3').textContent=title;
        const list=dialog.querySelector('.choice-options');list.replaceChildren();
        for(const [key,label] of options){
            const button=document.createElement('button');button.type='button';button.className='choice-option';button.dataset.choiceValue=key;
            button.setAttribute('aria-pressed',String(key===value));text(button,label);button.insertAdjacentHTML('beforeend',icon(key===value?'check':'right'));
            button.addEventListener('click',()=>{closeChoice();onChoose(key);});list.append(button);
        }
        trigger.setAttribute('aria-expanded','true');
        backdrop.hidden=false;backdrop.removeAttribute('aria-hidden');backdrop.classList.remove('is-open');
        // One fixed overlay; no cloned DOM, persistent GPU layers or animated backdrop blur.
        void dialog.offsetHeight;backdrop.classList.add('is-open');
        (list.querySelector('[aria-pressed="true"]')||list.firstElementChild||dialog).focus({preventScroll:true});
        for(const {el} of background){el.inert=true;el.setAttribute('aria-hidden','true');}
    }
    function closeChoice(immediate=false) {
        if(immediate && backdrop){clearTimeout(closeTimer);backdrop.hidden=true;}
        if(!choice)return false;
        const {trigger,background}=choice;choice=null;
        for(const {el,inert,hidden} of background){el.inert=inert;if(hidden===null)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden',hidden);}
        trigger.setAttribute('aria-expanded','false');backdrop.classList.remove('is-open');backdrop.setAttribute('aria-hidden','true');
        if(immediate || !motion())backdrop.hidden=true;
        else closeTimer=setTimeout(()=>{backdrop.hidden=true;},440);
        if(!immediate && trigger.isConnected && trigger.getClientRects().length)trigger.focus({preventScroll:true});
        return true;
    }
    let initialized=false;
    function init() {
        if(initialized)return;initialized=true;
        document.querySelectorAll('[data-sol-icon]').forEach(slot=>{slot.innerHTML=icon(slot.dataset.solIcon);});
        document.querySelectorAll('.appearance-section, .faq-ad-info').forEach(el=>{if(el.tagName==='DETAILS')enhanceDetails(el);});
        for(const [button,panel] of [['promo-trigger-card','promo-drawer'],['ref-trigger-card','ref-drawer'],['tariffs-toggle-btn','tariffs-flow']]){
            const trigger=document.getElementById(button);if(!trigger)continue;trigger.setAttribute('aria-controls',panel);disclosure(trigger,false,false);document.getElementById(panel).inert=true;
        }
    }
    window.SolUI={icon,text,disclosure,enhanceDetails,openChoice,closeChoice,init};
    document.addEventListener('DOMContentLoaded',init,{once:true});
})();
