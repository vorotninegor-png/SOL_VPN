/* Cosmetic preferences only. Telegram authorization and payments remain in app.js/backend. */
(() => {
    "use strict";
    const root = document.documentElement;
    const themes = {
        cosmic: { name: "Cosmic", bg: "#171026", deep: "#070610", surface: "#241b37", text: "#f5f1ff", muted: "#c8bddb", accent: "#a775ff", fill: "#6435a6", glow: "#a775ff" },
        classic: { name: "Classic", bg: "#171a20", deep: "#0d1015", surface: "#262c35", text: "#f3f5f8", muted: "#bec6d1", accent: "#c6d0df", fill: "#45536a", glow: "#a6b8cf" },
        ocean: { name: "Deep Ocean", bg: "#07172e", deep: "#030b18", surface: "#112b49", text: "#edf7ff", muted: "#b1cbe3", accent: "#68b7ff", fill: "#175b97", glow: "#2e82d0" },
        aurora: { name: "Aurora", bg: "#0c2528", deep: "#041113", surface: "#16383b", text: "#ecfff8", muted: "#acd8cf", accent: "#54f3c6", fill: "#156c58", glow: "#54f3c6" },
        solar: { name: "Solar", bg: "#21160c", deep: "#100a05", surface: "#392818", text: "#fff7e9", muted: "#dfc7a4", accent: "#f5bb44", fill: "#80520d", glow: "#f5bb44" },
        matrix: { name: "Matrix", bg: "#09120e", deep: "#030806", surface: "#10271b", text: "#e9fff0", muted: "#a2d1b4", accent: "#42f58b", fill: "#176b36", glow: "#42f58b" }
    };
    const light = { bg: "#eff2f6", deep: "#dfe6ee", surface: "#ffffff", text: "#172338", muted: "#4a596d", accent: "#365477", fill: "#304d70", glow: "#527ba7" };
    const defaults = { theme: "cosmic", classicMode: "dark", stars: true, starIntensity: 65, gradients: true,
        cardStyle: "glass", cardRadius: 20, opacity: 82, shadow: 55, buttonStyle: "neon", buttonRadius: 16,
        buttonGlow: 55, response: 180, glow: true, glowIntensity: 55, animations: true, speed: "normal", transition: "liquid", randomOnLaunch: false, randomMode:"fixed" };
    const choices = { theme: Object.keys(themes), classicMode: ["dark", "light"], cardStyle: ["glass", "solid", "outline"],
        buttonStyle: ["filled", "outline", "neon", "glass"], speed: ["slow", "normal", "fast"], transition: ["smooth", "radial", "liquid"], randomMode:["fixed","generated","startup"] };
    const ranges = { starIntensity: [0,100], cardRadius: [0,32], opacity: [35,100], shadow: [0,100], buttonRadius: [0,30], buttonGlow: [0,100], response: [0,350], glowIntensity: [0,100] };
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const weakDevice = Number(navigator.deviceMemory || 8) <= 2 || Number(navigator.hardwareConcurrency || 8) <= 2;
    let owner, state = { ...defaults }, presets = [], transition, transitionRevision = 0, cleanupTimer, initialized = false;
    let storageAvailable = true;
    const memory = new Map();
    const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value,16)).join(", ");
    const safeOwner = value => /^\d{1,16}$/.test(String(value || "")) && Number(value) > 0 && Number(value) < 2**52 ? String(value) : null;
    const key = () => owner ? `sol-appearance:v1:${owner}` : null;
    const allowed = () => state.animations && !motionQuery?.matches;
    const duration = () => ({ slow: 740, normal: 560, fast: 380 })[state.speed];
    function normalize(value) {
        const result = { ...defaults };
        if (!value || typeof value !== "object" || Array.isArray(value)) return result;
        for (const [name, values] of Object.entries(choices)) if (values.includes(value[name])) result[name] = value[name];
        for (const [name, [min,max]] of Object.entries(ranges)) if (typeof value[name] === "number" && Number.isFinite(value[name])) result[name] = Math.round(Math.min(max,Math.max(min,value[name])));
        for (const name of ["stars","gradients","glow","animations","randomOnLaunch"]) if (typeof value[name] === "boolean") result[name] = value[name];
        return result;
    }
    function palette() { return state.theme === "classic" && state.classicMode === "light" ? { ...themes.classic, ...light } : themes[state.theme]; }
    function persist() {
        if (!key()) return;
        const value = JSON.stringify({ version: 1, settings: state, presets });
        memory.set(key(),value);
        try { localStorage.setItem(key(),value); } catch (_) { storageAvailable = false; }
        renderStatus();
    }
    function randomSettings() {
        const pick = values => values[Math.floor(Math.random()*values.length)];
        const next = { ...defaults, theme: pick(choices.theme), classicMode: pick(choices.classicMode),
            stars: Math.random() > .25, starIntensity: pick([25,45,65,85]), gradients: Math.random() > .2,
            cardStyle: pick(choices.cardStyle), cardRadius: pick([8,16,20,28]), opacity: pick([70,82,95]), shadow: pick([20,40,60]),
            buttonStyle: pick(choices.buttonStyle), buttonRadius: pick([8,14,20,26]), buttonGlow: pick([25,45,65]),
            glow: Math.random() > .2, glowIntensity: pick([25,45,65]), transition: pick(choices.transition), randomOnLaunch: state.randomOnLaunch };
        if (next.theme===state.theme && next.cardStyle===state.cardStyle && next.buttonStyle===state.buttonStyle) next.theme=choices.theme[(choices.theme.indexOf(next.theme)+1)%choices.theme.length];
        return next;
    }
    function setUser(value) {
        const nextOwner = safeOwner(value);
        if (owner === nextOwner) { root.dataset.appearanceReady = "true"; return; }
        window.SolUI?.closeChoice(true);
        owner = nextOwner; state = { ...defaults }; presets = [];
        let saved;
        let raw=key()&&memory.get(key());
        try { raw=(key()&&localStorage.getItem(key()))||raw; } catch (_) { storageAvailable=false; }
        try { saved=JSON.parse(raw||"null"); } catch (_) { /* Ignore invalid local preferences. */ }
        if (saved?.version === 1) {
            state = normalize(saved.settings);
            presets = (Array.isArray(saved.presets) ? saved.presets : []).slice(0,20)
                .filter(p => p && typeof p.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) && typeof p.name === "string")
                .map(p => ({ id:p.id, name:p.name.trim().slice(0,40) || "Моё оформление", settings:normalize(p.settings) }));
            presets = presets.filter((p,index) => presets.findIndex(row => row.id === p.id) === index);
        }
        if (state.randomOnLaunch) { state = randomSettings(); state.randomOnLaunch = true; persist(); }
        commit(false); renderPresets(); root.dataset.appearanceReady = "true";
    }
    function commit(animate = true, origin, paletteTransition = true) {
        // Theme snapshots must not retain the outgoing settings dialog/backdrop.
        if (paletteTransition) window.SolUI?.closeChoice(true);
        const revision = ++transitionRevision;
        transition?.skipTransition?.(); clearTimeout(cleanupTimer);
        const mode = animate && allowed() ? paletteTransition ? state.transition : "smooth" : "none";
        root.dataset.themeTransition = mode;
        root.style.setProperty("--theme-duration",`${duration()}ms`);
        const box = origin?.getBoundingClientRect?.();
        root.style.setProperty("--theme-x",`${box ? box.x+box.width/2 : innerWidth/2}px`);
        root.style.setProperty("--theme-y",`${box ? box.y+box.height/2 : innerHeight/2}px`);
        root.style.setProperty("--theme-radius",`${Math.hypot(innerWidth,innerHeight)}px`);
        const apply = () => {
            // A queued transition from an earlier click must never restore an old palette.
            if (revision !== transitionRevision) return;
            const p = palette(), isLight = state.theme === "classic" && state.classicMode === "light";
            const glow = state.glow ? state.glowIntensity/100 : 0;
            const variables = { "bg":p.bg, "bg-deep":p.deep, "surface-rgb":rgb(p.surface), "text":p.text, "muted":p.muted,
                "accent":p.accent,"accent-rgb":rgb(p.accent),"action-fill":p.fill,"glow-rgb":rgb(p.glow),
                "border":`rgba(${rgb(p.accent)}, ${isLight ? .35 : .32})`,"surface-opacity":state.opacity/100,
                "card-radius":`${state.cardRadius}px`,"button-radius":`${state.buttonRadius}px`,
                "surface-shadow":`0 10px 30px rgba(0,0,0,${state.shadow/100*(isLight ? .15 : .55)})`,
                "glow":`0 0 ${Math.round(glow*30)}px rgba(${rgb(p.glow)},${glow*.42})`,
                "button-glow":`0 0 ${Math.round(glow*state.buttonGlow*.35)}px rgba(${rgb(p.glow)},${glow*state.buttonGlow/100*.5})`,
                "response":`${state.response}ms`,"star-opacity":state.stars ? state.starIntensity/100 : 0,
                "star-color":isLight?"#526b87":"#ffffff", "success":isLight?"#087344":"#54e8aa", "error":isLight?"#ad2438":"#fca5a5", "warning":isLight?"#825300":"#f4c46a" };
            for (const [name,value] of Object.entries(variables)) root.style.setProperty(`--sol-${name}`,String(value));
            Object.assign(root.dataset,{ theme:state.theme, classicMode:state.classicMode, cardStyle:state.cardStyle, buttonStyle:state.buttonStyle,
                gradients:String(state.gradients), stars:String(state.stars), glow:String(state.glow && state.glowIntensity>0), motion:allowed()?"on":"off", palette:isLight?"light":"dark" });
            root.dataset.effects=weakDevice?"simple":"full";
            root.style.colorScheme = isLight ? "light" : "dark";
            renderControls();
            document.dispatchEvent(new CustomEvent("sol:appearance-change",{ detail:{ animations:allowed(), theme:state.theme, paletteTransition } }));
        };
        if (paletteTransition && ["smooth","radial","liquid"].includes(mode) && !weakDevice && typeof document.startViewTransition === "function" && !document.hidden) {
            try {
                transition = document.startViewTransition(apply);
                transition.ready?.catch(() => {});
                transition.finished?.catch(() => {}).finally(() => { if(revision===transitionRevision){root.dataset.themeTransition="none";transition=null;} });
            } catch (_) { apply(); }
        } else {
            if (mode!=="none") root.dataset.themeTransition="smooth";
            apply();
            cleanupTimer=setTimeout(()=>{if(revision===transitionRevision)root.dataset.themeTransition="none";},mode==="none"?0:duration()+80);
        }
    }
    function update(change, origin) { state=normalize({ ...state,...change });persist();commit(true,origin,Boolean(change.theme||change.classicMode)); }
    function randomize() { const randomOnLaunch=state.randomOnLaunch;state=randomSettings();state.randomOnLaunch=randomOnLaunch;state.randomMode=randomOnLaunch?"startup":"generated";persist();commit(true,document.getElementById("appearance-random")); }
    function savePreset(name) {
        name=String(name||"").trim().slice(0,40);
        if (!owner) return "Откройте приложение с авторизацией Telegram, чтобы сохранять оформления.";
        if (!name) return "Введите название оформления.";
        if (presets.length>=20) return "Можно сохранить до 20 оформлений. Удалите одно из сохранённых.";
        const id=crypto.randomUUID?.() || `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        presets.push({id,name,settings:{...state}});persist();renderPresets();return "";
    }
    function applyPreset(id) { const preset=presets.find(p=>p.id===id);if(!preset)return;const mode=state.randomOnLaunch;state={...preset.settings,randomOnLaunch:mode};persist();commit(); }
    function deletePreset(id) { presets=presets.filter(p=>p.id!==id);persist();renderPresets(); }
    function reset() { state={...defaults};persist();commit(); }
    function renderStatus(message) {
        const status=document.getElementById("appearance-storage-status");
        if(status)status.textContent=message || (!storageAvailable?"Хранилище недоступно: изменения действуют в текущем сеансе.":!owner?"Настройки действуют в текущем сеансе. Для сохранения нужна авторизация Telegram.":"Сохраняется автоматически на этом устройстве.");
    }
    function renderControls() {
        document.querySelectorAll("[data-appearance-theme]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.appearanceTheme===state.theme)));
        document.querySelectorAll("[data-appearance-setting]").forEach(control=>{
            const name=control.dataset.appearanceSetting;
            if(control.type==="checkbox")control.checked=state[name];else control.value=String(state[name]);
            const out=document.getElementById(`appearance-value-${name}`);if(out)out.textContent=`${state[name]}${name==="response"?" мс":["cardRadius","buttonRadius"].includes(name)?" px":"%"}`;
        });
        const classic=document.getElementById("appearance-classic");if(classic)classic.hidden=state.theme!=="classic";
        const mode=document.getElementById("appearance-mode");if(mode)mode.value=state.randomOnLaunch?"startup":state.randomMode==="generated"?"generated":"fixed";
        document.querySelectorAll('[data-appearance-choice]').forEach(button=>{
            const config=settingChoices.get(button.dataset.appearanceChoice);
            const value=button.dataset.appearanceChoice==='randomMode' ? (state.randomOnLaunch?'startup':state.randomMode==='generated'?'generated':'fixed') : state[button.dataset.appearanceChoice];
            button.value=value;button.querySelector('[data-choice-label]').textContent=config.options.find(row=>row[0]===value)?.[1] || value;
        });
        renderStatus();
    }
    function renderPresets() {
        const list=document.getElementById("appearance-presets");if(!list)return;
        list.replaceChildren();
        if(!presets.length){const p=document.createElement("p");p.className="appearance-hint";p.textContent="Сохраните оформление, к которому хочется вернуться.";list.append(p);}
        for(const preset of presets){const row=document.createElement("div");row.className="appearance-preset";
            const button=document.createElement("button");button.type="button";button.textContent=preset.name;button.dataset.appearancePreset=preset.id;button.setAttribute("aria-label",`Применить оформление ${preset.name}`);
            const remove=document.createElement("button");remove.type="button";remove.textContent="Удалить";remove.dataset.appearanceDelete=preset.id;remove.setAttribute("aria-label",`Удалить оформление ${preset.name}`);row.append(button,remove);list.append(row);}
        const count=document.getElementById("appearance-preset-count");if(count)count.textContent=`${presets.length} / 20`;
    }
    const settingChoices=new Map();
    function buildSettings() {
        const target=document.getElementById("appearance-controls");if(!target)return;
        const select=(name,title,options)=>{
            settingChoices.set(name,{title,options});
            return `<div class="appearance-row"><span>${title}</span><button type="button" class="appearance-choice" ${name==='randomMode'?'id="appearance-mode"':`data-appearance-setting="${name}"`} data-appearance-choice="${name}" aria-label="${title}" aria-describedby="appearance-choice-label-${name}" aria-haspopup="dialog" aria-controls="appearance-choice-dialog" aria-expanded="false"><span data-choice-label id="appearance-choice-label-${name}"></span>${window.SolUI.icon('right')}</button></div>`;
        };
        const toggle=(name,title)=>`<label class="appearance-row"><span>${title}</span><input type="checkbox" data-appearance-setting="${name}"></label>`;
        const range=(name,title)=>`<label class="appearance-range"><span>${title}<output id="appearance-value-${name}"></output></span><input type="range" min="${ranges[name][0]}" max="${ranges[name][1]}" data-appearance-setting="${name}" aria-label="${title}"></label>`;
        const cardStyles=[["glass","Glass"],["solid","Solid"],["outline","Outline"]];
        target.innerHTML=`
            <section class="appearance-section"><h4>Тема</h4><div class="appearance-themes">${Object.entries(themes).map(([id,p])=>`<button type="button" class="appearance-theme" data-appearance-theme="${id}" aria-pressed="false"><span class="appearance-theme-swatch" style="--swatch-bg:${p.bg};--swatch-accent:${p.accent}" aria-hidden="true"></span>${p.name}</button>`).join("")}</div>
                <div class="appearance-classic" id="appearance-classic" hidden>${select("classicMode","Палитра Classic",[["dark","Dark"],["light","Light"]])}</div>
            </section>
            <details class="appearance-section" open><summary>Фон</summary>${toggle("stars","Звёзды")}${range("starIntensity","Интенсивность звёзд")}${toggle("gradients","Фоновые градиенты")}<p class="appearance-hint">Выключите звёзды для чистого фона.</p></details>
            <details class="appearance-section"><summary>Плашки</summary>${select("cardStyle","Стиль плашек",cardStyles)}${range("cardRadius","Скругление плашек")}${range("opacity","Непрозрачность плашек")}${range("shadow","Интенсивность тени")}</details>
            <details class="appearance-section"><summary>Кнопки</summary>${select("buttonStyle","Стиль кнопок",[["filled","Сплошной"],["outline","Контурный"],["neon","Неоновый"],["glass","Стеклянный"]])}${range("buttonRadius","Скругление кнопок")}${range("buttonGlow","Подсветка кнопок")}${range("response","Плавность нажатия")}</details>
            <details class="appearance-section"><summary>Свечение</summary>${toggle("glow","Включить свечение")}${range("glowIntensity","Интенсивность свечения")}</details>
            <details class="appearance-section"><summary>Анимации</summary>${toggle("animations","Включить анимации")}${select("speed","Скорость",[["slow","Медленная"],["normal","Стандартная"],["fast","Быстрая"]])}${select("transition","Смена темы",[["smooth","Smooth Blend"],["radial","Radial Wave"],["liquid","Liquid Morph"]])}<p class="appearance-hint">При уменьшении движения и на слабых устройствах эффекты упрощаются.</p></details>
            <section class="appearance-section"><h4>Случайное оформление</h4>${select('randomMode','Режим оформления',[["fixed","Постоянное"],["generated","Сгенерировать и оставить"],["startup","Случайное при запуске"]])}<button class="appearance-action" type="button" id="appearance-random">Случайное оформление</button><p class="appearance-hint">При запуске — только новая сессия Mini App. Вкладки оформление не меняют.</p></section>
            <section class="appearance-section"><h4>Мои оформления <span id="appearance-preset-count">0 / 20</span></h4><div class="appearance-save-row"><input id="appearance-preset-name" maxlength="40" aria-label="Название оформления" placeholder="Название оформления"><button class="appearance-action" type="button" id="appearance-save">Сохранить текущее</button></div><div class="appearance-presets" id="appearance-presets"></div></section>
            <button class="appearance-action" type="button" id="appearance-reset">Восстановить стандартное оформление</button>`;
        target.querySelectorAll('details').forEach(window.SolUI.enhanceDetails);
    }
    function init() {
        if(initialized)return;initialized=true;
        buildSettings();
        document.addEventListener("click",event=>{
            const choice=event.target.closest('[data-appearance-choice]');
            if(choice){
                const name=choice.dataset.appearanceChoice,config=settingChoices.get(name);
                window.SolUI.openChoice({trigger:choice,...config,value:choice.value,onChoose:value=>{
                    if(name==='randomMode'){
                        if(value==='generated'){state.randomOnLaunch=false;randomize();}
                        else update({randomOnLaunch:value==='startup',randomMode:value},choice);
                    }else update({[name]:value},choice);
                }});
                return;
            }
            const theme=event.target.closest("[data-appearance-theme]");if(theme)update({theme:theme.dataset.appearanceTheme},theme);
            const preset=event.target.closest("[data-appearance-preset]");if(preset)applyPreset(preset.dataset.appearancePreset);
            const remove=event.target.closest("[data-appearance-delete]");if(remove)deletePreset(remove.dataset.appearanceDelete);
            if(event.target.closest("#appearance-random"))randomize();
            if(event.target.closest("#appearance-reset"))reset();
            if(event.target.closest("#appearance-save")){const input=document.getElementById("appearance-preset-name");const error=savePreset(input.value);if(!error)input.value="";renderStatus(error||"Оформление сохранено.");}
        });
        document.addEventListener("input",event=>{
            const control=event.target.closest("[data-appearance-setting]");if(!control)return;
            const name=control.dataset.appearanceSetting;
            update({[name]:control.type==="checkbox"?control.checked:control.type==="range"?Number(control.value):control.value},control);
        });
        const changed=()=>commit(false);
        if(motionQuery?.addEventListener)motionQuery.addEventListener("change",changed);else motionQuery?.addListener?.(changed);
        renderControls();renderPresets();
    }
    const viewport=()=>root.style.setProperty("--sol-viewport-height",`${Math.round(Math.min(innerHeight,window.visualViewport?.height||innerHeight))}px`);
    viewport(); window.addEventListener("resize",viewport); window.visualViewport?.addEventListener("resize",viewport);
    window.SolAppearance={ setUser,update,randomize,savePreset,applyPreset,deletePreset,reset,init,
        animationsAllowed:allowed,duration,chrome:()=>({color:palette().fill,text_color:"#ffffff"}),
        snapshot:()=>({owner,settings:{...state},presets:presets.map(p=>({...p,settings:{...p.settings}})),storageAvailable,weakDevice}) };
    // Unverified ID selects cosmetic storage only; backend-confirmed identity replaces it in applyBootstrap.
    const early=safeOwner(window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
    if(early)setUser(early);else{root.dataset.appearanceReady="false";commit(false);}
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
