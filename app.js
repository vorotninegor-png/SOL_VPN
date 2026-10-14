// =====================================================================
// SOL VPN Mini App — frontend v5
// ВАЖНО: укажи публичный HTTPS URL backend, который запускает server.py.
// Пример: https://api.example.com
// =====================================================================
const API_BASE_URL = String(window.SOL_API_BASE_URL || window.location.origin).replace(/\/$/, "");

const tg = window.Telegram?.WebApp ?? null;
if (tg) {
    tg.ready();
    tg.expand();
}

// Данные пользователя считаются доверенными только после проверки initData на backend.
let userData = null;
let isAdmin = false;
let isConfigReady = false;        // только UI-состояние: VLESS URI получен
let isConfigLoading = false;
let vlessCopyInProgress = false;
let isSubscribedUser = false;
let currentVlessUri = "";
let selectedMonths = null;
let paymentInProgress = false;
let currentGameSession = "";
let serverOnline = false;

let isTariffsOpen = false;
let isPromoOpen = false;
let isRefOpen = false;
let activeLaserAnim = null;
let allCitiesList = [];

let currentRefPercent = 5.0;
const maxRefPercent = 40.0;
let refBalance = 0;
const maxRefBalance = 1000;

let isGameRunning = false;
let isGameStarting = false;
let isScanAvailable = true;
let caughtCount = 0;
const activeCometAnimations = new Map();

let adminPromoTypes = { days: false, discount: false };
let adminPickedTariffs = { 1: false, 3: false, 6: false, 12: false };
let calcValues = { days: 7, discount: 30 };
let touchStartXs = { days: 0, discount: 0 };
let adminPromoPreview = null;
let adminPromoCreating = false;
let adminPromoPage = 0;
let adminPromoTotal = 0;
let adminPromoRequestId = 0;

let approvedUsers = [];
let allUsersList = [];
let adminPanelInitialized = false;
const adminUsersPageSize = 30;
let adminUsersPage = 0;
let adminUsersFilteredTotal = 0;
let adminUsersLoading = false;
let adminUsersRequestId = 0;
let adminUsersInitialized = false;
const adminStatFrames = new WeakMap();
let mainButtonInitialized = false;
let referralLink = "";
let activeScreenId = "tunnel";
let toastSequence = 0;

const uiScheduler = window.SolUiMotion?.createTaskScheduler() || {
    schedule(_key, callback, delay = 0) { return setTimeout(callback, delay); },
    frame(_key, callback) { return requestAnimationFrame(callback); },
    cancel() { return false; },
    cancelGroup() {},
    pendingCount() { return 0; }
};

function prefersReducedMotion() {
    return window.SolUiMotion?.prefersReducedMotion(window)
        ?? Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

// Каталог приходит только с backend; локальных цен в бизнес-логике нет.
let tariffCatalog = {};

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

async function apiFetch(path, options = {}) {
    if (!tg?.initData) {
        throw new Error("Открой SOL VPN именно внутри Telegram — initData отсутствует");
    }
    if (!/^https?:\/\//i.test(API_BASE_URL)) {
        throw new Error("Публичный URL backend не настроен в config.js");
    }
    if (API_BASE_URL.includes("CHANGE-ME")) {
        throw new Error("В app.js не указан API_BASE_URL");
    }

    const headers = {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData,
        ...(options.headers || {})
    };

    const response = await fetch(apiUrl(path), {
        ...options,
        headers,
        cache: "no-store"
    });

    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    if (!response.ok) {
        const detail = Array.isArray(body.detail)
            ? body.detail.map(item => item.msg || String(item)).join("; ")
            : body.detail;
        throw new Error(detail || `Ошибка API ${response.status}`);
    }
    return body;
}

function applyBootstrap(data) {
    if (!data) return;
    serverOnline = true;

    if (data.user) {
        userData = { ...data.user };
        isAdmin = Boolean(data.is_admin ?? data.user.is_admin);
    }

    if (data.subscription) {
        isSubscribedUser = Boolean(data.subscription.active);
        updateSubscriptionUI(data.subscription);
    }

    if (Array.isArray(data.tariffs)) {
        tariffCatalog = window.SolTariffDisplay?.catalogFromBootstrap(data.tariffs) || {};
        if (selectedMonths && !tariffCatalog[Number(selectedMonths)]) {
            selectedMonths = null;
            tg?.MainButton?.hide?.();
        }
        updateTariffPricesUI();
    }

    if (data.referral) {
        currentRefPercent = Number(data.referral.percent ?? 5.0);
        refBalance = Number(data.referral.balance ?? 0);
        referralLink = data.referral.link || "";
        updateRefUI();
    }

    if (data.game) {
        isScanAvailable = Boolean(data.game.available) || isAdmin;
        updateGameButtonState(data.game.next_at || null);
    }

    if (data.admin && isAdmin) {
        approvedUsers = Array.isArray(data.admin.approved_users) ? data.admin.approved_users : [];
        renderAdminStats(data.admin);
        if (!adminUsersInitialized) {
            allUsersList = Array.isArray(data.admin.users) ? data.admin.users : [];
            adminUsersFilteredTotal = Number(data.admin.filtered_users ?? data.admin.total_users ?? allUsersList.length);
            adminUsersInitialized = true;
            renderAllUsersList();
        }
        renderApprovedUsersDrum();
    }

    initAdminPanel();
    updateConnectButtonState();
    checkGameLockStatus();
}

async function loadBootstrap(showErrors = true) {
    try {
        const data = await apiFetch("/api/bootstrap", { method: "GET" });
        applyBootstrap(data);
        return data;
    } catch (error) {
        serverOnline = false;
        isSubscribedUser = false;
        updateConnectButtonState();
        checkGameLockStatus();
        if (showErrors) showToast(`⚠️ Backend: ${error.message}`, "error");
        console.error(error);
        return null;
    }
}

function updateSubscriptionUI(subscription) {
    const leftVal = document.getElementById("sub-days-left");
    const bar = document.getElementById("sub-progress-bar");
    if (!leftVal || !bar) return;

    if (subscription.is_vip) {
        leftVal.innerText = "👑 VIP · безлимит";
        bar.style.width = "100%";
        return;
    }
    if (!subscription.active) {
        leftVal.innerText = "Нет активной подписки";
        bar.style.width = "0%";
        return;
    }
    const days = Number(subscription.days_left || 1);
    leftVal.innerText = `${days} дн.`;
    bar.style.width = `${Math.max(8, Math.min(100, days / 30 * 100))}%`;
}

function updateGameButtonState(nextAt = null) {
    const btn = document.getElementById("start-radar-btn");
    if (!btn || isGameRunning) return;
    if (isScanAvailable || isAdmin) {
        btn.className = "liquid-reveal-btn radar-ready";
        btn.innerText = "ЗАПУСТИТЬ СКАНИРОВАНИЕ";
    } else {
        btn.className = "liquid-reveal-btn radar-locked";
        btn.innerText = nextAt ? "ЛИМИТ ИСЧЕРПАН (24ч)" : "ЛИМИТ ИСЧЕРПАН";
    }
}

// 📢 СИСТЕМА НЕОНОВЫХ ТОСТ-УВЕДОМЛЕНИЙ

// 📢 СИСТЕМА НЕОНОВЫХ ТОСТ-УВЕДОМЛЕНИЙ
function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.setAttribute("role", "status");
        container.setAttribute("aria-live", "polite");
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerText = message;
    const toastId = ++toastSequence;
    const scope = `toast:${toastId}:`;
    toast.dataset.motionScope = scope;

    container.appendChild(toast);

    while (container.children.length > 4) {
        const oldest = container.firstElementChild;
        if (!oldest) break;
        uiScheduler.cancelGroup(oldest.dataset.motionScope || "toast:missing:");
        oldest.remove();
    }

    uiScheduler.frame(`${scope}show`, () => toast.classList.add("show"));
    uiScheduler.schedule(`${scope}hide`, () => {
        toast.classList.remove("show");
        uiScheduler.schedule(`${scope}remove`, () => toast.remove(), prefersReducedMotion() ? 0 : 400);
    }, 3200);
}

// ==========================================
// 🌟 1. КОСМОС
// ==========================================
function initSpaceFX() {
    const starBox = document.getElementById("stardust-box");
    const meteorBox = document.getElementById("meteors-box");

    if (!starBox || !meteorBox) return;

    let starHTML = "";
    for (let i = 0; i < 38; i++) {
        const top = Math.random() * 95;
        const left = Math.random() * 95;
        const duration = 2 + Math.random() * 3.5;
        const delay = Math.random() * 3;
        const starType = Math.random();

        if (starType < 0.70) {
            const size = 1 + Math.random() * 2.2;
            starHTML += `<div class="star-dot" style="top:${top}%; left:${left}%; width:${size}px; height:${size}px; --duration:${duration}s; animation-delay:${delay}s;"></div>`;
        } else {
            starHTML += `<div class="cross-star" style="top:${top}%; left:${left}%; animation-delay:${delay}s;"></div>`;
        }
    }
    starBox.innerHTML = starHTML;

    meteorBox.innerHTML = `
        <div class="meteor-item meteor-1"></div>
        <div class="meteor-item meteor-2"></div>
    `;

    const microWavesBox = document.getElementById("micro-waves-box");
    if (microWavesBox) {
        let wavesHTML = "";
        for (let i = 0; i < 10; i++) {
            const speed = 2 + (i * 0.3);
            const delay = i * 0.25;
            wavesHTML += `<div class="micro-wave" style="--speed:${speed}s; --delay:${delay}s;"></div>`;
        }
        microWavesBox.innerHTML = wavesHTML;
    }
}

// ==========================================
// 🗺 2. ВЕКТОРНАЯ КАРТА
// ==========================================
function initMap3D() {
    const continentsGroup = document.getElementById("map-continents-group");
    const citiesGroup = document.getElementById("all-cities-group");

    if (!continentsGroup || !citiesGroup) return;

    continentsGroup.innerHTML = `
        <path class="continent-shape" d="M 50 120 C 60 90, 100 80, 150 70 C 200 60, 270 65, 305 85 C 325 105, 305 130, 275 145 C 250 155, 230 165, 215 215 C 195 205, 180 180, 150 170 C 120 160, 75 155, 50 120 Z" />
        <path class="continent-shape" d="M 315 50 C 340 35, 380 35, 405 60 C 395 85, 365 100, 330 90 C 310 80, 305 60, 315 50 Z" />
        <path class="continent-shape" d="M 230 225 C 265 230, 315 250, 345 280 C 360 320, 335 380, 295 430 C 275 455, 260 435, 250 385 C 235 335, 215 285, 230 225 Z" />
        <path class="continent-shape" d="M 430 145 C 450 120, 490 90, 560 80 C 640 70, 760 65, 850 85 C 910 100, 960 125, 940 160 C 910 185, 860 210, 800 225 C 740 245, 690 255, 630 230 C 570 210, 520 190, 470 180 C 430 175, 415 160, 430 145 Z" />
        <path class="continent-shape" d="M 485 80 C 500 60, 525 60, 535 85 C 520 105, 495 105, 485 80 Z" />
        <path class="continent-shape" d="M 435 110 C 450 100, 460 110, 450 127 C 435 130, 430 120, 435 110 Z" />
        <path class="continent-shape" d="M 435 185 C 480 175, 545 195, 565 235 C 580 275, 555 335, 510 370 C 475 380, 445 325, 435 275 C 420 235, 410 205, 435 185 Z" />
        <path class="continent-shape" d="M 570 295 C 585 285, 595 305, 580 335 C 565 335, 560 315, 570 295 Z" />
        <path class="continent-shape" d="M 570 175 C 605 170, 625 185, 615 220 C 590 215, 570 200, 570 175 Z" />
        <path class="continent-shape" d="M 660 195 C 690 190, 715 205, 700 245 C 675 250, 655 225, 660 195 Z" />
        <path class="continent-shape" d="M 740 240 C 770 230, 800 245, 785 265 C 760 270, 735 255, 740 240 Z" />
        <path class="continent-shape" d="M 800 250 C 830 245, 850 260, 835 275 C 810 280, 795 265, 800 250 Z" />
        <path class="continent-shape" d="M 760 315 C 810 295, 865 310, 880 340 C 890 375, 855 415, 795 410 C 755 400, 740 355, 760 315 Z" />
        <path class="continent-shape" d="M 910 390 C 920 380, 930 400, 920 420 C 905 420, 900 400, 910 390 Z" />
    `;

    allCitiesList = [];

    const clusters = [
        { minX: 450, maxX: 870, minY: 80, maxY: 140 },
        { minX: 80,  maxX: 280, minY: 75, maxY: 150 },
        { minX: 240, maxX: 330, minY: 240, maxY: 380 },
        { minX: 450, maxX: 560, minY: 190, maxY: 340 },
        { minX: 620, maxX: 850, minY: 150, maxY: 250 },
        { minX: 760, maxX: 870, minY: 310, maxY: 390 }
    ];

    for (let i = 0; i < 135; i++) {
        const cluster = clusters[i % clusters.length];
        const rx = cluster.minX + Math.random() * (cluster.maxX - cluster.minX);
        const ry = cluster.minY + Math.random() * (cluster.maxY - cluster.minY);
        
        const size = (1.1 + Math.random() * 0.8).toFixed(1);
        const opacity = (0.35 + Math.random() * 0.6).toFixed(2);

        allCitiesList.push({
            x: Math.round(rx),
            y: Math.round(ry),
            size: size,
            opacity: opacity,
            id: `node-city-${i}`
        });
    }

    let citiesHTML = "";
    allCitiesList.forEach(city => {
        citiesHTML += `<circle cx="${city.x}" cy="${city.y}" r="${city.size}" style="opacity: ${city.opacity};" class="city-point" id="city-${city.id}"/>`;
    });

    citiesGroup.innerHTML = citiesHTML;
}

// ==========================================
// 💧 3. КАПЛИ
// ==========================================
function triggerLiquidSplash() {
    const dropsBox = document.getElementById("liquid-drops-box");
    if (!dropsBox) return;

    const count = 9 + Math.floor(Math.random() * 4);
    let dropsHTML = "";

    for (let i = 0; i < count; i++) {
        dropsHTML += `<div class="edge-drop" id="e-drop-${i}"></div>`;
    }
    dropsBox.innerHTML = dropsHTML;

    uiScheduler.cancelGroup("liquid:");
    uiScheduler.schedule("liquid:prepare", () => {
        const radius = 55;
        for (let i = 0; i < count; i++) {
            const drop = document.getElementById(`e-drop-${i}`);
            if (drop) {
                const angle = (i / count) * (2 * Math.PI) + (Math.random() * 0.2);
                const startX = Math.cos(angle) * radius;
                const startY = Math.sin(angle) * radius;
                const targetX = Math.cos(angle) * (radius + 20 + Math.random() * 16);
                const targetY = Math.sin(angle) * (radius + 20 + Math.random() * 16);

                drop.style.transform = `translate(${startX}px, ${startY}px) scale(0.5)`;
                drop.style.opacity = "1";

                uiScheduler.schedule(`liquid:move:${i}`, () => {
                    drop.style.transform = `translate(${targetX}px, ${targetY}px) scale(${0.8 + Math.random() * 0.4})`;
                    drop.style.opacity = "0.85";

                    uiScheduler.schedule(`liquid:end:${i}`, () => {
                        drop.style.transform = `translate(${startX}px, ${startY}px) scale(0.2)`;
                        drop.style.opacity = "0";
                    }, prefersReducedMotion() ? 0 : 350);
                }, prefersReducedMotion() ? 0 : 30);
            }
        }
    }, prefersReducedMotion() ? 0 : 10);
}

// ==========================================
// ⚡️ 4. ПОЛУЧЕНИЕ РЕАЛЬНОГО VPN-КОНФИГА
// Mini App не включает системный VPN сам. Он получает персональный VLESS URI с backend/Xray.
// ==========================================
const connectBtn = document.getElementById("connect-btn");
const statusBadge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const copyKeyBtn = document.getElementById("copy-key-btn");
const openKeyBtn = document.getElementById("open-key-btn");
const telemetryBar = document.getElementById("telemetry-bar");
const vlessImportOverlay = document.getElementById("vless-import-overlay");
const vlessManualField = document.getElementById("vless-manual-field");
const vlessCopyStatus = document.getElementById("vless-copy-status");
const vlessClientList = document.getElementById("vless-client-list");
const vlessClipboard = window.SolVlessActions?.createVlessClipboard({
    navigatorObject: window.navigator,
    documentObject: document
}) || null;

if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
        if (isConfigLoading) return;
        if (!serverOnline) {
            showToast("⚠️ Нет связи с backend на вашем ПК", "error");
            return;
        }
        if (!isSubscribedUser) {
            showToast("🔒 Для получения VPN активируйте подписку", "error");
            tg?.HapticFeedback?.notificationOccurred("error");
            return;
        }
        if (isConfigReady) {
            showToast("Ключ уже готов: скопируйте его или откройте VPN-клиент");
            return;
        }
        triggerLiquidSplash();
        await connectVPN();
    });
}

function updateConnectButtonState() {
    if (!connectBtn) return;
    connectBtn.classList.toggle("locked-btn", !isSubscribedUser || !serverOnline);
}

async function connectVPN() {
    if (isConfigLoading) return;
    isConfigLoading = true;
    isConfigReady = false;
    currentVlessUri = "";
    if (connectBtn) connectBtn.disabled = true;
    statusText.innerText = "ПОЛУЧЕНИЕ КЛЮЧА...";
    statusBadge.className = "status-badge connecting";
    telemetryBar?.classList.add("hidden");

    try {
        const result = await apiFetch("/api/vpn/config", {
            method: "POST",
            body: "{}"
        });
        const receivedVlessUri = result.vless_uri || "";
        if (!window.SolVlessActions?.isVlessUri(receivedVlessUri)) {
            throw new Error("Backend не вернул корректный VLESS URI");
        }
        currentVlessUri = receivedVlessUri;
        playConnectAnimation();
    } catch (error) {
        isConfigLoading = false;
        if (connectBtn) connectBtn.disabled = false;
        statusText.innerText = "ОШИБКА";
        statusBadge.className = "status-badge disconnected";
        showToast(`🚨 VPN: ${error.message}`, "error");
        tg?.HapticFeedback?.notificationOccurred("error");
    }
}

function playConnectAnimation() {
    const connectionsGroup = document.getElementById("connections-group");
    if (connectionsGroup) connectionsGroup.innerHTML = "";
    document.querySelectorAll(".city-point").forEach(el => el.className.baseVal !== undefined ? el.setAttribute("class", "city-point") : el.className = "city-point");

    if (prefersReducedMotion()) {
        finishConfigReady();
        return;
    }

    const pathNodes = generateLongSmartPath();
    if (pathNodes.length < 5 || !connectionsGroup) {
        finishConfigReady();
        return;
    }

    let pathD = `M ${pathNodes[0].x} ${pathNodes[0].y}`;
    for (let i = 1; i < pathNodes.length; i++) {
        const prev = pathNodes[i - 1];
        const curr = pathNodes[i];
        const curveDirection = (i % 2 === 0) ? 1 : -1;
        const midX = (prev.x + curr.x) / 2;
        const midY = (prev.y + curr.y) / 2 + curveDirection * (20 + Math.random() * 25);
        pathD += ` Q ${midX} ${midY}, ${curr.x} ${curr.y}`;
    }

    connectionsGroup.innerHTML = `<path id="laser-path" class="laser-line" d="${pathD}" />`;
    const laserPath = document.getElementById("laser-path");
    if (!laserPath || typeof anime !== "function") {
        finishConfigReady();
        return;
    }

    const pathLength = laserPath.getTotalLength();
    laserPath.style.strokeDasharray = pathLength;
    laserPath.style.strokeDashoffset = pathLength;
    flashCity(pathNodes[0].id);
    activeLaserAnim?.pause?.();

    activeLaserAnim = anime({
        targets: "#laser-path",
        strokeDashoffset: [pathLength, 0],
        easing: "easeInOutCubic",
        duration: 1600,
        update(anim) {
            const p = anim.progress;
            if (p > 20 && p < 30) flashCity(pathNodes[1].id);
            if (p > 45 && p < 55) flashCity(pathNodes[2].id);
            if (p > 70 && p < 80) flashCity(pathNodes[3].id);
        },
        complete: finishConfigReady
    });
}

function finishConfigReady() {
    activeLaserAnim = null;
    isConfigLoading = false;
    isConfigReady = true;
    if (connectBtn) connectBtn.disabled = false;
    statusText.innerText = "КЛЮЧ ГОТОВ";
    statusBadge.className = "status-badge connected";
    connectBtn?.classList.add("connected");
    if (telemetryBar) {
        const ping = document.getElementById("ping-val");
        if (ping) ping.innerText = "—";
        telemetryBar.classList.remove("hidden");
    }
    copyKeyBtn?.classList.remove("hidden-slide");
    openKeyBtn?.classList.remove("hidden-slide");
    tg?.HapticFeedback?.notificationOccurred("success");
}

function flashCity(cityId) {
    const node = document.getElementById(`city-${cityId}`);
    if (!node || node.classList.contains("flash-green")) return;
    node.classList.add("flash-green");
    uiScheduler.schedule(`city:${cityId}`, () => node?.classList.remove("flash-green"), 450);
}

async function copyVlessKey() {
    if (!currentVlessUri) {
        setVlessKeyStatus("missing");
        showToast("Ключ не получен. Сначала получите VPN-конфигурацию", "error");
        tg?.HapticFeedback?.notificationOccurred("error");
        return;
    }

    if (vlessCopyInProgress) return;
    vlessCopyInProgress = true;

    copyKeyBtn?.setAttribute("disabled", "");
    let result = { ok: false, method: "manual", reason: "copy_unavailable" };
    try {
        if (vlessClipboard) result = await vlessClipboard.copy(currentVlessUri);
    } catch (_) {
        result = { ok: false, method: "manual", reason: "copy_failed" };
    } finally {
        vlessCopyInProgress = false;
        copyKeyBtn?.removeAttribute("disabled");
    }

    if (result.ok) {
        setVlessKeyStatus("copied");
        setVlessSheetStatus("copied");
        showToast("🔑 VLESS-ключ скопирован");
        tg?.HapticFeedback?.notificationOccurred("success");
        uiScheduler.schedule("vless:status-reset", () => setVlessKeyStatus("ready"), 1600);
        return;
    }

    setVlessKeyStatus("copy-error");
    showVlessImport({ copyFailed: true });
    showToast("Не удалось скопировать автоматически — выделите ключ вручную", "error");
    tg?.HapticFeedback?.notificationOccurred("error");
    uiScheduler.schedule("vless:status-reset", () => setVlessKeyStatus("ready"), 2200);
}

function setVlessKeyStatus(state) {
    const states = {
        missing: { text: "КЛЮЧ НЕ ПОЛУЧЕН", className: "disconnected" },
        ready: { text: "КЛЮЧ ГОТОВ", className: "connected" },
        copied: { text: "СКОПИРОВАНО", className: "copied" },
        "copy-error": { text: "ОШИБКА КОПИРОВАНИЯ", className: "copy-error" }
    };
    const next = states[state] || states.missing;
    if (statusText) statusText.innerText = next.text;
    if (statusBadge) statusBadge.className = `status-badge ${next.className}`;
}

function setVlessSheetStatus(state) {
    if (!vlessCopyStatus) return;
    const states = {
        ready: { text: "Ключ готов", className: "ready" },
        copied: { text: "Скопировано", className: "copied" },
        error: { text: "Ошибка копирования", className: "error" }
    };
    const next = states[state] || states.ready;
    vlessCopyStatus.textContent = next.text;
    vlessCopyStatus.className = `vless-sheet-status ${next.className}`;
}

function renderVlessImportInstructions() {
    if (!vlessClientList || vlessClientList.childElementCount > 0) return;
    const instructions = window.SolVlessActions?.getImportInstructions() || [];
    instructions.forEach(item => {
        const row = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = item.title;
        row.append(title, document.createTextNode(item.text));
        vlessClientList.appendChild(row);
    });
}

function showVlessImport(options = {}) {
    if (!currentVlessUri) {
        setVlessKeyStatus("missing");
        showToast("Ключ не получен. Сначала получите VPN-конфигурацию", "error");
        tg?.HapticFeedback?.notificationOccurred("error");
        return;
    }
    renderVlessImportInstructions();
    if (vlessManualField) vlessManualField.value = currentVlessUri;
    setVlessSheetStatus(options.copyFailed ? "error" : "ready");
    vlessImportOverlay?.classList.add("visible");
    vlessImportOverlay?.setAttribute("aria-hidden", "false");
}

function closeVlessImport() {
    vlessImportOverlay?.classList.remove("visible");
    vlessImportOverlay?.setAttribute("aria-hidden", "true");
    if (vlessManualField) {
        vlessManualField.blur();
        vlessManualField.value = "";
    }
}

function selectVlessKeyManually() {
    if (!currentVlessUri || !vlessManualField) {
        showVlessImport();
        return;
    }
    if (!vlessImportOverlay?.classList.contains("visible")) showVlessImport();
    vlessManualField.focus();
    vlessManualField.select();
    vlessManualField.setSelectionRange(0, vlessManualField.value.length);
    setVlessSheetStatus("ready");
    tg?.HapticFeedback?.selectionChanged();
}

// ==========================================
// 🎁 5. ПРОМОКОДЫ

// ==========================================
// 🎁 5. ПРОМОКОДЫ И РЕФЕРАЛКА С ЮЗЕРНЕЙМОМ БОТА
// ==========================================
function togglePromoCard(forceState = null) {
    const drawer = document.getElementById("promo-drawer");
    const promoCardTrigger = document.getElementById("promo-trigger-card");

    uiScheduler.cancel("promo:auto-close");
    if (forceState !== null) {
        isPromoOpen = forceState;
    } else {
        isPromoOpen = !isPromoOpen;
    }

    if (isPromoOpen) {
        if (isRefOpen) toggleRefCard(false);
        if (drawer) drawer.classList.remove("hidden-drawer");
        if (promoCardTrigger) promoCardTrigger.classList.add("active-card");
    } else {
        if (drawer) drawer.classList.add("hidden-drawer");
        if (promoCardTrigger) promoCardTrigger.classList.remove("active-card");
        resetPromoStyles();
    }
    promoCardTrigger?.setAttribute("aria-expanded", String(isPromoOpen));
    drawer?.setAttribute("aria-hidden", String(!isPromoOpen));
    if (forceState === null && tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function resetPromoStyles() {
    const card = document.getElementById("promo-card-element");
    const statusMsg = document.getElementById("promo-status-msg");
    const input = document.getElementById("promo-input-field");
    const btn = document.getElementById("promo-apply-btn");
    const headerText = document.getElementById("promo-header-text");

    if (card) card.className = "promo-card-box";
    if (statusMsg) {
        statusMsg.className = "promo-status-msg";
        statusMsg.innerText = "";
    }
    if (input) input.className = "";
    if (btn) btn.className = "apply-promo-btn";
    if (headerText) {
        headerText.style.color = "#c084fc";
        headerText.innerText = "🎁 ВВЕДИТЕ ПРОМОКОД";
    }
}

async function applyPromoCode() {
    const inputField = document.getElementById("promo-input-field");
    const card = document.getElementById("promo-card-element");
    const statusMsg = document.getElementById("promo-status-msg");
    const btn = document.getElementById("promo-apply-btn");
    const headerText = document.getElementById("promo-header-text");
    if (!inputField) return;

    const code = inputField.value.trim().toUpperCase();
    if (!code) {
        card?.classList.add("error-glow");
        uiScheduler.schedule("promo:error", () => card?.classList.remove("error-glow"), 350);
        return;
    }

    btn?.setAttribute("disabled", "disabled");
    try {
        const result = await apiFetch("/api/promo/activate", {
            method: "POST",
            body: JSON.stringify({ code })
        });
        if (card) card.className = "promo-card-box success-glow";
        if (inputField) inputField.className = "success-border";
        if (headerText) {
            headerText.innerText = "🎉 УСПЕШНО!";
            headerText.style.color = "#10b981";
        }
        if (statusMsg) {
            statusMsg.innerText = "АКТИВИРОВАН!";
            statusMsg.className = "promo-status-msg show-msg success-txt";
        }
        applyBootstrap(result.bootstrap);
        showToast(result.message || `🎉 Промокод ${code} активирован`);
        tg?.HapticFeedback?.notificationOccurred("success");
        uiScheduler.schedule("promo:auto-close", () => {
            inputField.value = "";
            togglePromoCard(false);
        }, 1200);
    } catch (error) {
        if (card) card.className = "promo-card-box error-glow";
        if (inputField) inputField.className = "error-border";
        if (statusMsg) {
            statusMsg.innerText = "ОШИБКА";
            statusMsg.className = "promo-status-msg show-msg error-txt";
        }
        showToast(`🚨 ${error.message}`, "error");
        tg?.HapticFeedback?.notificationOccurred("error");
    } finally {
        btn?.removeAttribute("disabled");
    }
}

function toggleRefCard(forceState = null) {
    const drawer = document.getElementById("ref-drawer");
    const refCardTrigger = document.getElementById("ref-trigger-card");

    if (forceState !== null) {
        isRefOpen = forceState;
    } else {
        isRefOpen = !isRefOpen;
    }

    if (isRefOpen) {
        if (isPromoOpen) togglePromoCard(false);
        if (drawer) drawer.classList.remove("hidden-drawer");
        if (refCardTrigger) refCardTrigger.classList.add("active-card");
    } else {
        if (drawer) drawer.classList.add("hidden-drawer");
        if (refCardTrigger) refCardTrigger.classList.remove("active-card");
    }
    refCardTrigger?.setAttribute("aria-expanded", String(isRefOpen));
    drawer?.setAttribute("aria-hidden", String(!isRefOpen));
    if (forceState === null && tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function useRefBalanceForTariff() {
    showToast("Оплата с реферального баланса ещё не подключена на backend", "error");
    tg?.HapticFeedback?.notificationOccurred("error");
}

async function copyRefLinkDirect() {
    const field = document.getElementById("ref-link-field");
    if (!field || !field.value) {
        showToast("Реферальная ссылка пока недоступна", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(field.value);
        showToast("🚀 Реферальная ссылка скопирована!");
        tg?.HapticFeedback?.notificationOccurred("success");
    } catch (_) {
        window.prompt("Скопируйте реферальную ссылку:", field.value);
    }
}

// 🎯 ССЫЛКА С УКАЗАННЫМ ЮЗЕРНЕЙМОМ БОТА
function updateRefUI() {
    const label = document.getElementById("ref-percent-val");
    const gameLabel = document.getElementById("game-ref-percent");
    const balanceLabel = document.getElementById("ref-balance-val");
    const payBtn = document.getElementById("ref-pay-btn");
    const linkField = document.getElementById("ref-link-field");

    if (label) label.innerText = `${currentRefPercent.toFixed(1)}%`;
    if (gameLabel) gameLabel.innerText = `${currentRefPercent.toFixed(1)}% / 40%`;
    if (balanceLabel) balanceLabel.innerText = `${refBalance} / ${maxRefBalance} ₽`;

    if (linkField) linkField.value = referralLink;

    if (payBtn) {
        payBtn.classList.add("disabled-btn");
        payBtn.disabled = true;
        payBtn.innerText = "💳 ОПЛАТА БАЛАНСОМ ПОКА НЕДОСТУПНА";
    }
}

function checkGameLockStatus() {
    const lockScreen = document.getElementById("game-lock-screen");
    if (isSubscribedUser) {
        if (lockScreen) {
            lockScreen.classList.add("hidden");
            lockScreen.setAttribute("aria-hidden", "true");
        }
    } else {
        if (lockScreen) {
            lockScreen.classList.remove("hidden");
            lockScreen.setAttribute("aria-hidden", "false");
        }
    }
}

// ==========================================
// 🎮 6. ИГРЫ
// ==========================================
async function startCatchGame() {
    if (isGameRunning || isGameStarting) return;
    if (!isSubscribedUser) {
        showToast("🔒 Нужна активная подписка", "error");
        return;
    }
    if (!isScanAvailable && !isAdmin) {
        showToast("🚨 Лимит сканирования исчерпан (24ч)", "error");
        return;
    }

    let session;
    const startBtn = document.getElementById("start-radar-btn");
    isGameStarting = true;
    if (startBtn) startBtn.disabled = true;
    try {
        session = await apiFetch("/api/game/start", { method: "POST", body: "{}" });
        currentGameSession = session.session_id;
    } catch (error) {
        showToast(`🚨 Игра: ${error.message}`, "error");
        return;
    } finally {
        isGameStarting = false;
        if (startBtn && !session) startBtn.disabled = false;
    }

    isGameRunning = true;
    uiScheduler.cancelGroup("game:");
    clearActiveComets();
    isScanAvailable = isAdmin;
    caughtCount = 0;

    const stage = document.getElementById("radar-stage");
    if (stage) stage.innerHTML = `<div class="radar-circle-glow"><div class="radar-line-scanner"></div></div>`;
    if (startBtn) {
        startBtn.className = "liquid-reveal-btn radar-active";
        startBtn.innerText = "ИДЕТ СКАНИРОВАНИЕ...";
    }
    tg?.HapticFeedback?.impactOccurred("medium");

    const middleContainer = document.getElementById("game-loot-middle-row");
    if (middleContainer) {
        middleContainer.innerHTML = "";
        const crystalArea = document.createElement("div");
        crystalArea.id = "crystal-loot-under-btn";
        crystalArea.className = "crystal-container-row";
        middleContainer.appendChild(crystalArea);
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement("div");
            slot.className = "crystal-loot-slot";
            slot.id = `loot-slot-${i}`;
            crystalArea.appendChild(slot);
        }
        uiScheduler.frame("game:loot-row", () => crystalArea.classList.add("show-row"));
    }

    for (let i = 0; i < 5; i++) {
        uiScheduler.schedule(`game:spawn:${i}`, () => {
            if (isGameRunning) spawnComet(i, 1800 + Math.random() * 1600);
        }, i * 1100);
    }

    uiScheduler.schedule("game:finish", () => {
        isGameRunning = false;
        clearActiveComets();
        if (startBtn) startBtn.disabled = false;
        updateGameButtonState();
    }, 7000);
}

function clearActiveComets() {
    activeCometAnimations.forEach((animation, comet) => {
        animation?.pause?.();
        comet?.remove?.();
    });
    activeCometAnimations.clear();
}

function spawnComet(index, speed) {
    const stage = document.getElementById("radar-stage");
    if (!stage) return;

    const comet = document.createElement("div");
    comet.className = "comet";
    
    const colors = ["#3b82f6", "#10b981", "#ffffff", "#c084fc"];
    const randColor = colors[Math.floor(Math.random() * colors.length)];
    comet.style.boxShadow = `0 0 15px ${randColor}`;

    const stageW = stage.offsetWidth || 340;
    const stageH = stage.offsetHeight || 220;

    const startFromLeft = Math.random() > 0.5;
    const startX = startFromLeft ? -30 : stageW + 30;
    const startY = Math.random() * (stageH - 60) + 30; 
    
    const targetX = startFromLeft ? stageW + 30 : -30;
    const targetY = Math.random() * (stageH - 60) + 30;

    comet.style.left = `${startX}px`;
    comet.style.top = `${startY}px`;

    const angle = Math.atan2(targetY - startY, targetX - startX) * (180 / Math.PI);
    comet.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

    stage.appendChild(comet);

    const animMove = anime({
        targets: comet,
        left: targetX,
        top: targetY,
        easing: 'linear',
        duration: speed,
        complete: function() {
            activeCometAnimations.delete(comet);
            if (comet && comet.parentNode) {
                comet.remove();
            }
        }
    });
    activeCometAnimations.set(comet, animMove);

    const onHit = (e) => {
        e.stopPropagation();
        animMove.pause();
        activeCometAnimations.delete(comet);

        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("heavy");
        
        const slot = document.getElementById(`loot-slot-${caughtCount}`);
        if (slot) {
            caughtCount++;
            
            const cometRect = comet.getBoundingClientRect();
            const stageRect = stage.getBoundingClientRect();
            const hitX = cometRect.left - stageRect.left + cometRect.width / 2;
            const hitY = cometRect.top - stageRect.top + cometRect.height / 2;
            
            triggerBigCometExplosion(hitX, hitY, randColor);
            comet.remove();

            slot.innerHTML = `<div class="crystal-core" style="background: ${randColor}; box-shadow: 0 0 12px ${randColor}; opacity: 0; transform: scale(0.2) rotate(45deg);"></div>`;
            
            const core = slot.querySelector(".crystal-core");
            if (core) {
                anime({
                    targets: core,
                    opacity: 1,
                    scale: 1,
                    duration: 400,
                    easing: 'easeOutBack'
                });
            }

            slot.addEventListener("click", () => breakCrystal(slot, randColor));
        }
    };

    comet.addEventListener("pointerdown", onHit, { once: true });
}

function triggerBigCometExplosion(x, y, color) {
    const stage = document.getElementById("radar-stage");
    if (!stage) return;

    if (prefersReducedMotion()) return;

    const particleCount = 18;
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement("div");
        p.className = "shatter-dust";
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.background = color;
        p.style.boxShadow = `0 0 12px ${color}`;
        
        stage.appendChild(p);

        const angle = (i / particleCount) * (Math.PI * 2) + Math.random() * 0.5;
        const distance = 35 + Math.random() * 55; 

        anime({
            targets: p,
            left: x + Math.cos(angle) * distance,
            top: y + Math.sin(angle) * distance,
            opacity: [1, 0],
            scale: [1.5, 0],
            duration: 550,
            easing: 'easeOutQuart',
            complete: () => p.remove()
        });
    }
}

function breakCrystal(slot, randColor) {
    if (slot.classList.contains("broken")) return;
    slot.classList.add("broken");
    slot.innerHTML = ""; 

    const rect = slot.getBoundingClientRect();
    const stage = document.getElementById("radar-stage");
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const x = rect.left - stageRect.left + rect.width / 2;
    const y = rect.top - stageRect.top + rect.height / 2;

    triggerBigCometExplosion(x, y, randColor);

    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("heavy");
    determineLoot(x, y, slot, randColor);
}

async function determineLoot(x, y, slot, randColor) {
    if (!currentGameSession) {
        slot.innerHTML = `<div class="loot-surprise-node"><span style="color:#ef4444">ERR</span></div>`;
        return;
    }
    try {
        const result = await apiFetch("/api/game/reward", {
            method: "POST",
            body: JSON.stringify({ session_id: currentGameSession })
        });
        const reward = result.reward;
        let prizeHTML = "";

        if (reward.type === "discount") {
            createFloatingText(x, y, `🔥 -${reward.value}%!`, "green-text");
            prizeHTML = `<span style="color:${randColor};font-weight:bold">-${reward.value}%</span>`;
            uiScheduler.schedule("reel:pending", () => spinSpaceSlot(reward.value, Number(reward.months)), 200);
        } else if (reward.type === "ref_plus") {
            createFloatingText(x, y, `+${reward.value}%`, "green-text");
            prizeHTML = `<span style="color:#10b981;font-weight:700">+${reward.value}%</span>`;
        } else if (reward.type === "ref_minus") {
            createFloatingText(x, y, `-${reward.value}%`, "red-text");
            prizeHTML = `<span style="color:#ef4444;font-weight:700">-${reward.value}%</span>`;
        } else {
            createFloatingText(x, y, "0%", "yellow-text");
            prizeHTML = `<span style="color:#eab308;font-weight:700">0.0%</span>`;
        }

        slot.innerHTML = `<div class="loot-surprise-node">${prizeHTML}</div>`;
        applyBootstrap(result.bootstrap);
    } catch (error) {
        slot.innerHTML = `<div class="loot-surprise-node"><span style="color:#ef4444">ERR</span></div>`;
        showToast(`🚨 Награда: ${error.message}`, "error");
    }
}

function spinSpaceSlot(discountValue, targetSegment) {
    const slotContainer = document.getElementById("wheel-container");
    const reel = document.getElementById("roulette-wheel");
    if (!reel || !slotContainer) return;

    const segments = [1, 3, 6, 12];
    const targetIndex = Math.max(0, segments.indexOf(Number(targetSegment)));
    const cardHeight = 40;
    const cycleOffset = 3;
    const targetGlobalIndex = cycleOffset * 4 + targetIndex;
    const finalTranslateY = -(targetGlobalIndex * cardHeight);
    const neons = { 1: "#3b82f6", 3: "#a855f7", 6: "#10b981", 12: "#f59e0b" };

    uiScheduler.cancelGroup("reel:");
    reel.style.transition = "none";
    reel.style.transform = "translateY(0)";
    if (prefersReducedMotion()) {
        reel.style.transform = `translateY(${finalTranslateY}px)`;
        showToast(`🔥 Скидка ${discountValue}% на тариф ${targetSegment} мес.`);
        return;
    }
    uiScheduler.frame("reel:start", () => {
        reel.style.transition = "transform 3.6s cubic-bezier(0.15,0.85,0.15,1)";
        reel.style.transform = `translateY(${finalTranslateY}px)`;
    });
    uiScheduler.schedule("reel:result", () => {
        const color = neons[targetSegment] || "#a855f7";
        slotContainer.style.borderColor = color;
        slotContainer.style.boxShadow = `0 0 35px ${color}, inset 0 0 15px ${color}`;
        showToast(`🔥 Скидка ${discountValue}% на тариф ${targetSegment} мес.`);
        uiScheduler.schedule("reel:reset", () => {
            slotContainer.style.borderColor = "rgba(255,255,255,0.2)";
            slotContainer.style.boxShadow = "0 8px 25px rgba(0,0,0,0.5), inset 0 0 12px rgba(255,255,255,0.08)";
        }, 2500);
    }, 3800);
}

function createFloatingText(x, y, text, cssClass) {
    const stage = document.getElementById("radar-stage");
    if (!stage) return;
    const el = document.createElement("div");
    el.className = `floating-drop-text ${cssClass}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerText = text;
    stage.appendChild(el);
    const floatingId = ++toastSequence;
    uiScheduler.schedule(`floating:${floatingId}`, () => el.remove(), prefersReducedMotion() ? 100 : 1200);
}

function fillReelCards() {
    const reel = document.getElementById("roulette-wheel");
    if (!reel) return;

    const segments = [
        { class: 'card-1m', text: '1 МЕСЯЦ' },
        { class: 'card-3m', text: '3 МЕСЯЦА' },
        { class: 'card-6m', text: '6 МЕСЯЦЕВ' },
        { class: 'card-12m', text: 'VIP ДОСТУП' }
    ];

    let itemsHTML = "";
    for (let i = 0; i < 5; i++) {
        segments.forEach(seg => {
            itemsHTML += `<div class="slot-card ${seg.class}">${seg.text}</div>`;
        });
    }
    reel.innerHTML = itemsHTML;

    const randomIndex = Math.floor(Math.random() * 4);
    reel.style.transform = `translateY(-${randomIndex * 40}px)`;
}

function updateTariffPricesUI() {
    const baseClasses = {
        1: "tariff-card",
        3: "tariff-card recommended",
        6: "tariff-card",
        12: "tariff-card vip"
    };
    const neons = { 1: "#3b82f6", 3: "#a855f7", 6: "#10b981", 12: "#f59e0b" };

    [1, 3, 6, 12].forEach(months => {
        const tariff = tariffCatalog[months];
        const priceEl = document.getElementById(`price-${months}m`);
        const oldPriceEl = document.getElementById(`old-price-${months}m`);
        const cardEl = document.getElementById(`tariff-${months}m`);
        const tagEl = document.getElementById(`discount-tag-${months}m`);
        if (!priceEl || !cardEl) return;

        const shown = cardEl.classList.contains("show-card");
        const selected = Number(selectedMonths) === months;
        const display = window.SolTariffDisplay?.tariffDisplay(tariff)
            || { valid: false, finalPrice: "—", originalPrice: "", discountLabel: "", hasDiscount: false };
        priceEl.textContent = `${display.finalPrice}${display.valid ? " ₽" : ""}`;
        if (oldPriceEl) {
            oldPriceEl.textContent = display.hasDiscount ? `${display.originalPrice} ₽` : "";
            oldPriceEl.hidden = !display.hasDiscount;
        }

        cardEl.className = `${baseClasses[months]}${display.hasDiscount ? ` discounted-neon-${months}m` : ""}${shown ? " show-card" : ""}${selected ? " selected-tariff" : ""}`;
        cardEl.setAttribute("aria-pressed", String(selected));
        cardEl.setAttribute("aria-disabled", String(!display.valid));
        if (tagEl) {
            if (display.hasDiscount) {
                tagEl.textContent = `🔥 ${display.discountLabel}`;
                tagEl.style.color = neons[months];
                tagEl.style.textShadow = `0 0 8px ${neons[months]}`;
                tagEl.className = "tariff-discount-tag show-tag";
            } else {
                tagEl.textContent = "";
                tagEl.style.color = "";
                tagEl.style.textShadow = "";
                tagEl.className = "tariff-discount-tag";
            }
        }
    });
    syncSelectedTariffMainButton();
}

// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ
// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ

// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ
// ==========================================
function initAdminPanel() {
    const nav = document.getElementById("app-bottom-nav");
    const adminBtn = document.getElementById("btn-nav-4");
    if (!isAdmin) {
        nav?.classList.remove("nav-5-items");
        adminBtn?.classList.add("hidden");
        return;
    }

    nav?.classList.add("nav-5-items");
    adminBtn?.classList.remove("hidden");

    if (!adminPanelInitialized) {
        initCalcControls("days");
        initCalcControls("discount");
        initAdminUsersScroll();
        adminPanelInitialized = true;
        loadAdminPromos();
    }

    renderApprovedUsersDrum();
    renderAllUsersList();
    updateCalcDisplays();
}

function toggleAdminPromoType(type) {
    adminPromoTypes[type] = !adminPromoTypes[type];
    invalidateAdminPromoPreview();
    
    const btnDays = document.getElementById("btn-mode-days");
    const btnDiscount = document.getElementById("btn-mode-discount");
    
    const blockDays = document.getElementById("block-days");
    const blockDiscount = document.getElementById("block-discount");
    const blockTariffs = document.getElementById("block-tariffs");

    if (adminPromoTypes.days) {
        if (btnDays) btnDays.classList.add("active-green");
        if (blockDays) blockDays.className = "calc-widget-container active-green-block";
    } else {
        if (btnDays) btnDays.classList.remove("active-green");
        if (blockDays) blockDays.className = "calc-widget-container disabled-block";
    }

    if (adminPromoTypes.discount) {
        if (btnDiscount) btnDiscount.classList.add("active-green");
        if (blockDiscount) blockDiscount.className = "calc-widget-container active-green-block";
        if (blockTariffs) blockTariffs.className = "admin-tariffs-row-sketch active-green-block";
    } else {
        if (btnDiscount) btnDiscount.classList.remove("active-green");
        if (blockDiscount) blockDiscount.className = "calc-widget-container disabled-block";
        if (blockTariffs) blockTariffs.className = "admin-tariffs-row-sketch disabled-block";
    }

    updateCalcDisplays();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function toggleAdminTariffPick(m) {
    if (!adminPromoTypes.discount) return;
    adminPickedTariffs[m] = !adminPickedTariffs[m];
    invalidateAdminPromoPreview();
    const btn = document.getElementById(`p-tariff-${m}m`);
    if (btn) {
        if (adminPickedTariffs[m]) btn.classList.add("selected");
        else btn.classList.remove("selected");
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function updateCalcDisplays() {
    let maxDays = 365;
    calcValues.days = Math.max(1, Math.min(maxDays, calcValues.days));
    renderSingleSpinner('days', calcValues.days, maxDays);

    let maxDiscount = 95;
    calcValues.discount = Math.max(1, Math.min(maxDiscount, calcValues.discount));
    renderSingleSpinner('discount', calcValues.discount, maxDiscount);

}

function renderSingleSpinner(key, val, maxVal) {
    const numPrev = document.getElementById(`${key}-prev`);
    const numCenter = document.getElementById(`${key}-center`);
    const numNext = document.getElementById(`${key}-next`);

    if (numCenter) numCenter.innerText = val;
    if (numPrev) numPrev.innerText = (val > 1) ? val - 1 : "";
    if (numNext) numNext.innerText = (val < maxVal) ? val + 1 : "";
}

function changeCalcVal(key, delta) {
    if (key === 'days' && !adminPromoTypes.days) return;
    if (key === 'discount' && !adminPromoTypes.discount) return;

    calcValues[key] += delta;
    invalidateAdminPromoPreview();
    updateCalcDisplays();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function initCalcControls(key) {
    const area = document.getElementById(`touch-area-${key}`);
    if (!area) return;

    area.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (e.deltaY < 0) changeCalcVal(key, 1);
        else changeCalcVal(key, -1);
    }, { passive: false });

    area.addEventListener("touchstart", (e) => {
        touchStartXs[key] = e.touches[0].clientX;
    }, { passive: true });

    area.addEventListener("touchmove", (e) => {
        const currentX = e.touches[0].clientX;
        const diff = touchStartXs[key] - currentX;

        if (Math.abs(diff) > 15) {
            if (diff > 0) changeCalcVal(key, 1);
            else changeCalcVal(key, -1);
            touchStartXs[key] = currentX;
        }
    }, { passive: true });
}

function invalidateAdminPromoPreview() {
    adminPromoPreview = null;
    const preview = document.getElementById("admin-promo-preview");
    const confirmButton = document.getElementById("admin-promo-confirm");
    if (preview) preview.hidden = true;
    if (confirmButton) confirmButton.hidden = true;
}

function buildAdminPromoDraft() {
    const code = document.getElementById("admin-promo-name")?.value.trim().toUpperCase() || "";
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error("Код: 3–32 символа A–Z, 0–9, _ или -");
    if (!adminPromoTypes.days && !adminPromoTypes.discount) throw new Error("Выберите дни и/или скидку");
    const days = adminPromoTypes.days ? calcValues.days : 0;
    const discount = adminPromoTypes.discount ? calcValues.discount : 0;
    if (adminPromoTypes.days && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new Error("Дни: от 1 до 3650");
    if (adminPromoTypes.discount && (!Number.isInteger(discount) || discount < 1 || discount > 95)) throw new Error("Скидка: от 1 до 95%");
    const tariffs = Object.entries(adminPickedTariffs).filter(([, picked]) => picked).map(([months]) => Number(months));
    const maxText = document.getElementById("admin-promo-max")?.value.trim() || "";
    if (maxText && !/^\d+$/.test(maxText)) throw new Error("Лимит активаций должен быть целым числом");
    const maxActivations = maxText ? Number(maxText) : null;
    if (maxActivations !== null && (!Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 10000)) {
        throw new Error("Лимит активаций: от 1 до 10000");
    }
    const expiryText = document.getElementById("admin-promo-expires")?.value || "";
    const expiry = expiryText ? new Date(expiryText) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) throw new Error("Выберите будущую дату окончания");
    if (!maxActivations && !expiry) throw new Error("Укажите срок действия и/или лимит активаций");
    return {
        code, has_days: adminPromoTypes.days, days_val: days,
        has_discount: adminPromoTypes.discount, discount_val: discount,
        tariffs, max_activations: maxActivations,
        expires_at: expiry ? expiry.toISOString() : null
    };
}

function previewAdminPromo() {
    try {
        const draft = buildAdminPromoDraft();
        adminPromoPreview = JSON.stringify(draft);
        const preview = document.getElementById("admin-promo-preview");
        const confirmButton = document.getElementById("admin-promo-confirm");
        if (preview) {
            const bonus = [draft.has_days ? `${draft.days_val} дней` : "", draft.has_discount ? `${draft.discount_val}% скидки` : ""].filter(Boolean).join(" + ");
            preview.textContent = `Промокод: ${draft.code}\nБонус: ${bonus}\nТарифы: ${draft.has_discount ? (draft.tariffs.length ? draft.tariffs.map(m => `${m} мес.`).join(", ") : "все тарифы") : "не применяются"}\nЛимит: ${draft.max_activations ?? "без ограничения"}\nДействует до: ${draft.expires_at ? new Date(draft.expires_at).toLocaleString("ru-RU") : "без срока"}\nСтатус: готов к созданию`;
            preview.hidden = false;
        }
        if (confirmButton) confirmButton.hidden = false;
    } catch (error) {
        invalidateAdminPromoPreview();
        showToast(`🚨 ${error.message}`, "error");
    }
}

async function createAdminPromo() {
    if (adminPromoCreating || !adminPromoPreview) return;
    let draft;
    try {
        draft = buildAdminPromoDraft();
        if (JSON.stringify(draft) !== adminPromoPreview) throw new Error("Параметры изменились — проверьте промокод ещё раз");
    } catch (error) {
        invalidateAdminPromoPreview();
        showToast(`🚨 ${error.message}`, "error");
        return;
    }
    adminPromoCreating = true;
    const button = document.getElementById("admin-promo-confirm");
    if (button) { button.disabled = true; button.textContent = "СОЗДАЁМ…"; }
    try {
        const result = await apiFetch("/api/admin/promocodes", { method: "POST", body: JSON.stringify(draft) });
        document.getElementById("admin-promo-name").value = "";
        invalidateAdminPromoPreview();
        await loadAdminPromos(0);
        showToast(`🎉 Промокод ${result.code} сохранён`);
        tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    } finally {
        adminPromoCreating = false;
        if (button) { button.disabled = false; button.textContent = "ПОДТВЕРДИТЬ СОЗДАНИЕ"; }
    }
}

function filterAdminPromos() {
    uiScheduler.schedule("admin-promos:search", () => loadAdminPromos(0), 250);
}

async function loadAdminPromos(page = 0) {
    if (!isAdmin) return;
    const requestId = ++adminPromoRequestId;
    const query = document.getElementById("admin-promo-search")?.value.trim() || "";
    const list = document.getElementById("admin-promos-list");
    list?.classList.add("is-loading");
    list?.setAttribute("aria-busy", "true");
    const state = document.getElementById("admin-promos-state");
    if (state) state.textContent = "Загрузка промокодов…";
    try {
        const params = new URLSearchParams({ limit: "30", offset: String(Math.max(0, page) * 30), q: query });
        const result = await apiFetch(`/api/admin/promocodes?${params}`, { method: "GET" });
        if (requestId !== adminPromoRequestId) return;
        const promos = Array.isArray(result.promocodes) ? result.promocodes : [];
        if (page > 0 && !promos.length && result.total > 0) return loadAdminPromos(page - 1);
        adminPromoPage = Math.max(0, page);
        adminPromoTotal = Number(result.total) || 0;
        if (list) list.innerHTML = promos.length ? promos.map(p => {
            const bonus = [p.days ? `${p.days} дн.` : "", p.discount_percent ? `${p.discount_percent}%` : ""].filter(Boolean).join(" + ");
            const selectedTariffs = Array.isArray(p.tariffs) ? p.tariffs : [];
            const tariffs = p.discount_percent ? (selectedTariffs.length ? selectedTariffs.join(", ") + " мес." : "все тарифы") : "—";
            const labels = { active: "Активен", expired: "Истёк", exhausted: "Лимит исчерпан", disabled: "Отключён", invalid: "Некорректен" };
            return `<div class="admin-promo-item"><div><strong>${escapeHtml(p.code)}</strong> <span class="admin-promo-status ${escapeHtml(p.status)}">${labels[p.status] || "Неизвестно"}</span></div>
                <div>Бонус: ${escapeHtml(bonus || "—")} · Тарифы: ${escapeHtml(tariffs)}</div>
                <div>Активации: ${Number(p.used_count)}/${p.max_activations ?? "∞"}</div>
                <div>Создан: ${escapeHtml(p.created_at || "—")} · До: ${escapeHtml(p.expires_at || "—")} UTC</div>
                ${p.status !== "disabled" ? `<button type="button" data-action="disable-admin-promo" data-code="${escapeHtml(p.code)}">Отключить</button>` : ""}</div>`;
        }).join("") : `<div class="empty-list-msg">Промокоды не найдены</div>`;
        if (state) state.textContent = `Показано ${adminPromoTotal ? adminPromoPage * 30 + 1 : 0}–${adminPromoPage * 30 + promos.length} из ${adminPromoTotal}`;
        const pageLabel = document.getElementById("admin-promos-page");
        if (pageLabel) pageLabel.textContent = `Страница ${adminPromoPage + 1}`;
        const prev = document.getElementById("admin-promos-prev");
        const next = document.getElementById("admin-promos-next");
        if (prev) prev.disabled = adminPromoPage === 0;
        if (next) next.disabled = (adminPromoPage + 1) * 30 >= adminPromoTotal;
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    } finally {
        if (requestId === adminPromoRequestId) {
            uiScheduler.frame("admin-promos:ready", () => {
                list?.classList.remove("is-loading");
                list?.setAttribute("aria-busy", "false");
            });
        }
    }
}

async function disableAdminPromo(code) {
    if (!window.confirm(`Отключить промокод ${code}? История активаций сохранится.`)) return;
    try {
        await apiFetch(`/api/admin/promocodes/${encodeURIComponent(code)}/disable`, { method: "POST" });
        await loadAdminPromos(adminPromoPage);
        showToast(`Промокод ${code} отключён`);
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    }
}

function renderApprovedUsersDrum() {
    const drum = document.getElementById("approved-users-drum");
    if (!drum) return;
    if (!approvedUsers.length) {
        drum.innerHTML = `<div class="empty-list-msg">Список одобренных пользователей пуст</div>`;
        return;
    }
    drum.innerHTML = approvedUsers.map(user => `
        <div class="drum-item">
            <span>${escapeHtml(user.username || user.name || String(user.user_id))}</span>
            <button class="remove-user-btn" type="button" data-action="remove-vip-user" data-user-id="${Number(user.user_id)}">✕</button>
        </div>
    `).join("");
}

async function addApprovedUser() {
    const input = document.getElementById("admin-approved-input");
    const username = input?.value.trim();
    if (!username) return;
    try {
        const result = await apiFetch("/api/admin/vip", {
            method: "POST",
            body: JSON.stringify({ username })
        });
        approvedUsers = result.admin.approved_users || [];
        renderApprovedUsersDrum();
        renderAdminStats(result.admin);
        await loadAdminUsers(adminUsersPage);
        input.value = "";
        showToast("⭐️ Пользователь добавлен в VIP");
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    }
}

async function removeApprovedUser(userId) {
    try {
        const result = await apiFetch("/api/admin/vip", {
            method: "DELETE",
            body: JSON.stringify({ user_id: Number(userId) })
        });
        approvedUsers = result.admin.approved_users || [];
        renderApprovedUsersDrum();
        renderAdminStats(result.admin);
        await loadAdminUsers(adminUsersPage);
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
    }[ch]));
}

function animateAdminStat(element, value) {
    if (!element) return;
    const previousFrame = adminStatFrames.get(element);
    if (previousFrame) cancelAnimationFrame(previousFrame);
    const target = Math.max(0, Number(value) || 0);
    const previous = Number(element.dataset.value ?? target);
    element.dataset.value = String(target);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || previous === target) {
        element.textContent = target.toLocaleString("ru-RU");
        return;
    }
    const started = performance.now();
    const step = now => {
        const progress = Math.min(1, (now - started) / 380);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.round(previous + (target - previous) * eased).toLocaleString("ru-RU");
        if (progress < 1) adminStatFrames.set(element, requestAnimationFrame(step));
        else adminStatFrames.delete(element);
    };
    adminStatFrames.set(element, requestAnimationFrame(step));
}

function renderAdminStats(data) {
    animateAdminStat(document.getElementById("admin-total-users"), data.total_users);
    animateAdminStat(document.getElementById("admin-active-users"), data.active_users);
    const percent = document.getElementById("admin-active-percent");
    if (percent) percent.textContent = `${(Number(data.active_percent) || 0).toFixed(1)}% от всех`;
    document.querySelector(".admin-users-stats")?.classList.add("ready");
}

function filterAllUsersList() {
    uiScheduler.schedule("admin-users:search", () => loadAdminUsers(0), 250);
}

async function loadAdminUsers(page = 0) {
    if (!isAdmin) return;
    const query = document.getElementById("admin-search-user")?.value.trim() || "";
    const requestId = ++adminUsersRequestId;
    adminUsersLoading = true;
    const usersContainer = document.getElementById("all-users-container");
    usersContainer?.classList.add("is-loading");
    usersContainer?.setAttribute("aria-busy", "true");
    renderAdminUsersState();
    try {
        const params = new URLSearchParams({
            limit: String(adminUsersPageSize),
            offset: String(Math.max(0, page) * adminUsersPageSize),
            q: query
        });
        const result = await apiFetch(`/api/admin/users?${params}`, { method: "GET" });
        if (requestId !== adminUsersRequestId) return;
        const users = Array.isArray(result.users) ? result.users : [];
        const filtered = Number(result.filtered_users) || 0;
        if (page > 0 && !users.length && filtered > 0) {
            await loadAdminUsers(page - 1);
            return;
        }
        allUsersList = users;
        adminUsersPage = Math.max(0, page);
        adminUsersFilteredTotal = filtered;
        adminUsersInitialized = true;
        approvedUsers = Array.isArray(result.approved_users) ? result.approved_users : approvedUsers;
        renderAdminStats(result);
        renderApprovedUsersDrum();
        renderAllUsersList();
        const container = document.getElementById("all-users-container");
        if (container) {
            container.scrollTop = 0;
            container.classList.remove("expanded");
        }
    } catch (error) {
        if (requestId === adminUsersRequestId) showToast(`🚨 ${error.message}`, "error");
    } finally {
        if (requestId === adminUsersRequestId) {
            adminUsersLoading = false;
            renderAdminUsersState();
            uiScheduler.frame("admin-users:ready", () => {
                usersContainer?.classList.remove("is-loading");
                usersContainer?.setAttribute("aria-busy", "false");
            });
        }
    }
}

function renderAdminUsersState() {
    const status = document.getElementById("admin-users-state");
    const pageLabel = document.getElementById("admin-users-page");
    const previous = document.getElementById("admin-users-prev");
    const next = document.getElementById("admin-users-next");
    const shownFrom = adminUsersFilteredTotal ? adminUsersPage * adminUsersPageSize + 1 : 0;
    const shownTo = adminUsersPage * adminUsersPageSize + allUsersList.length;
    if (status) status.textContent = adminUsersLoading
        ? "Загрузка пользователей…"
        : `Показано ${shownFrom}–${shownTo} из ${adminUsersFilteredTotal}`;
    if (pageLabel) pageLabel.textContent = `Страница ${adminUsersPage + 1}`;
    if (previous) previous.disabled = adminUsersLoading || adminUsersPage === 0;
    if (next) next.disabled = adminUsersLoading || shownTo >= adminUsersFilteredTotal;
}

function renderAllUsersList() {
    const container = document.getElementById("all-users-container");
    if (!container) return;
    if (!allUsersList.length) {
        container.innerHTML = `<div class="empty-list-msg">Пользователи не найдены</div>`;
        renderAdminUsersState();
        return;
    }
    container.innerHTML = allUsersList.map(u => {
        const statusTxt = u.hasSub ? "ПОДПИСКА АКТИВНА" : "НЕТ ПОДПИСКИ";
        const statusColor = u.hasSub ? "sub-on" : "sub-off";
        const subscriptionEnd = u.subscription_end || "—";
        const registered = u.registration_date || "—";
        const vpnKey = u.vpn_key || "Нет ключа";
        const referrer = u.referrer_id ?? "—";
        const userId = Number(u.user_id);
        return `
            <div class="user-row-card ${u.hasSub ? "active-sub" : ""}" role="listitem">
                <button class="user-row-toggle" type="button" data-action="toggle-user-details"
                        aria-expanded="false" aria-controls="admin-user-details-${userId}">
                    <div class="user-row-main">
                        <div class="user-row-name">${escapeHtml(u.name)} ${u.username ? `· @${escapeHtml(u.username)}` : ""}</div>
                        <div class="user-row-status ${statusColor}">${statusTxt}</div>
                    </div>
                    <div class="user-row-summary">ID: ${userId} · ${u.isVip ? "VIP · " : ""}${u.vpn_key ? "Ключ создан" : "Нет ключа"}</div>
                </button>
                <div class="user-row-details" id="admin-user-details-${userId}" aria-hidden="true" inert>
                    <div class="user-row-details-inner">
                        <div class="user-row-meta">
                            <span>Регистрация: ${escapeHtml(registered)}</span>
                            <span>Подписка до: ${escapeHtml(subscriptionEnd)}</span>
                            <span>VIP: ${u.isVip ? "да" : "нет"}</span>
                            <span>VPN UUID: ${escapeHtml(vpnKey)}</span>
                            <span>Реферер: ${escapeHtml(referrer)}</span>
                        </div>
                        <div class="user-gift-drawer">
                            <button class="gift-btn" type="button" data-action="gift-promo" data-user-id="${userId}" data-username="${escapeHtml(u.username)}">🎁 ПОДАРИТЬ ПРОМОКОД</button>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join("");
    renderAdminUsersState();
}

function toggleUserDetails(button) {
    const card = button.closest(".user-row-card");
    const details = card?.querySelector(".user-row-details");
    if (!card || !details) return;
    const open = !card.classList.contains("expanded");
    card.classList.toggle("expanded", open);
    button.setAttribute("aria-expanded", String(open));
    details.setAttribute("aria-hidden", String(!open));
    details.toggleAttribute("inert", !open);
}

function initAdminUsersScroll() {
    const container = document.getElementById("all-users-container");
    if (!container) return;
    let touchStartY = 0;
    let lastScrollTop = 0;
    let wheelIntent = 0;
    const canExpand = () => container.scrollHeight > 212;
    const expand = () => { if (canExpand()) container.classList.add("expanded"); };
    const collapse = () => { if (container.scrollTop <= 2) container.classList.remove("expanded"); };

    container.addEventListener("wheel", event => {
        wheelIntent = Math.sign(event.deltaY) === Math.sign(wheelIntent)
            ? wheelIntent + event.deltaY : event.deltaY;
        if (wheelIntent > 18) { expand(); wheelIntent = 0; }
        if (wheelIntent < -28 && container.scrollTop <= 2) { collapse(); wheelIntent = 0; }
    }, { passive: true });
    container.addEventListener("touchstart", event => {
        touchStartY = event.touches[0].clientY;
    }, { passive: true });
    container.addEventListener("touchmove", event => {
        const movement = event.touches[0].clientY - touchStartY;
        if (movement < -28 && !container.classList.contains("expanded")) expand();
        if (movement > 42 && container.scrollTop <= 2) collapse();
    }, { passive: true });
    container.addEventListener("scroll", () => {
        if (container.classList.contains("expanded") && container.scrollTop <= 2 && lastScrollTop > 18) collapse();
        lastScrollTop = container.scrollTop;
    }, { passive: true });
    window.addEventListener("resize", () => { if (!canExpand()) collapse(); });
}

async function giftPromoToUser(userId, username) {
    const promoCode = prompt(`Введите промокод для ${username || userId}:`);
    if (!promoCode) return;
    try {
        await apiFetch("/api/admin/gift-promo", {
            method: "POST",
            body: JSON.stringify({ user_id: Number(userId), code: promoCode.trim().toUpperCase() })
        });
        showToast(`🎁 Промокод отправлен ${username || userId}`);
    } catch (error) {
        showToast(`🚨 ${error.message}`, "error");
    }
}

// ==========================================
// 💡 БАЗА ЗНАНИЙ
// ==========================================
// 💡 БАЗА ЗНАНИЙ

// ==========================================
// 💡 БАЗА ЗНАНИЙ
// ==========================================
const defaultInfoText = "Нажмите на любой вопрос ниже. Ваш ответ появится здесь. Если нужной темы нет — напишите в нашу техподдержку.";

const faqAnswers = {
    1: "Откройте вкладку «Тоннель», нажмите на основную кнопку и дождитесь статуса «Ключ готов». Затем скопируйте персональный VLESS-ключ и импортируйте его в совместимое VPN-приложение.",
    2: "После получения конфигурации во вкладке «Тоннель» нажмите кнопку «Копировать». Ключ будет доступен для импорта в VPN-клиент.",
    3: "Скорость и задержка зависят от сервера, его нагрузки, маршрута подключения, оператора связи и других сетевых факторов. Конкретная скорость не гарантируется.",
    4: "Сейчас один VLESS-ключ технически может использоваться на нескольких устройствах. Строгое серверное ограничение количества устройств пока не реализовано.",
    5: "Откройте вкладку «Игры», запускайте космический радар и ловите кометы. За определённые награды можно увеличивать реферальный процент. Максимальное значение — 40%.",
    6: "Для доступа к играм требуется активная подписка SOL VPN. Выберите подходящий тариф во вкладке «Кабинет».",
    7: "Запустите сканирование космического радара и нажимайте на пролетающие кометы, пока они находятся на экране.",
    8: "VLESS поддерживается совместимыми клиентскими приложениями на разных операционных системах. На роутерах работа зависит от модели, прошивки и доступных компонентов."
};

const faqAnimator = window.SolFaqAnimation
    ? window.SolFaqAnimation.createFaqAnimator({
        container: document.getElementById("terminal-text"),
        box: document.getElementById("terminal-box-element")
    })
    : null;

function animateDipText(newText) {
    const container = document.getElementById("terminal-text");
    if (!container) return;
    if (faqAnimator) {
        faqAnimator.show(newText);
        return;
    }
    container.textContent = newText;
}

function answerFAQ(id) {
    const text = faqAnswers[id];
    if (text) {
        animateDipText(text);
        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
    }
}

// ==========================================
// 📂 ТАРИФЫ (С НОВЫМИ ЦЕНАМИ)
// ==========================================
function toggleTariffs(forceOpen = false) {
    const flowContainer = document.getElementById("tariffs-flow");
    const cards = document.querySelectorAll(".tariff-card");
    if (!flowContainer || cards.length === 0) return;

    if (forceOpen) {
        isTariffsOpen = true;
    } else {
        isTariffsOpen = !isTariffsOpen;
    }

    uiScheduler.cancelGroup("tariffs:");
    const reducedMotion = prefersReducedMotion();
    const orderedCards = Array.from(cards);
    const toggleButton = document.getElementById("tariffs-toggle-btn");

    if (isTariffsOpen) {
        if (isPromoOpen) togglePromoCard(false);
        if (isRefOpen) toggleRefCard(false);

        flowContainer.classList.remove("hidden-flow", "is-closing");
        orderedCards.forEach((card, index) => {
            const delay = reducedMotion ? 0 : window.SolUiMotion?.staggerDelay(index, orderedCards.length, 70, 210) || 0;
            card.style.setProperty("--tariff-delay", `${delay}ms`);
        });
        uiScheduler.frame("tariffs:show", () => orderedCards.forEach(card => card.classList.add("show-card")));
    } else {
        flowContainer.classList.add("is-closing");
        const reversedCards = orderedCards.reverse();
        reversedCards.forEach((card, index) => {
            const delay = reducedMotion ? 0 : window.SolUiMotion?.staggerDelay(index, reversedCards.length, 55, 165) || 0;
            card.style.setProperty("--tariff-delay", `${delay}ms`);
            card.classList.remove("show-card");
        });
        uiScheduler.schedule("tariffs:hide", () => flowContainer.classList.add("hidden-flow"), reducedMotion ? 0 : 520);
    }
    toggleButton?.setAttribute("aria-expanded", String(isTariffsOpen));
    flowContainer.setAttribute("aria-hidden", String(!isTariffsOpen));
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

async function paySelectedTariff() {
    if (!selectedMonths || paymentInProgress) return;
    paymentInProgress = true;
    tg?.MainButton?.disable?.();
    try {
        const result = await apiFetch("/api/payments/invoice", {
            method: "POST",
            body: JSON.stringify({ months: Number(selectedMonths) })
        });
        if (!tg?.openInvoice) throw new Error("Telegram openInvoice недоступен");
        tg.MainButton?.showProgress?.();
        tg.openInvoice(result.invoice_url, async status => {
            paymentInProgress = false;
            tg.MainButton?.enable?.();
            tg.MainButton?.hideProgress?.();
            if (status === "paid") {
                showToast("✅ Оплата прошла. Обновляю подписку...");
                await new Promise(resolve => setTimeout(resolve, 900));
                await loadBootstrap(false);
            } else if (status === "failed") {
                showToast("🚨 Оплата не прошла", "error");
            }
        });
    } catch (error) {
        paymentInProgress = false;
        tg?.MainButton?.enable?.();
        tg?.MainButton?.hideProgress?.();
        showToast(`🚨 Оплата: ${error.message}`, "error");
    }
}

function selectTariff(months) {
    months = Number(months);
    if (!tariffCatalog[months]) return;
    selectedMonths = months;
    updateTariffPricesUI();

    tg?.HapticFeedback?.selectionChanged?.();
}

function syncSelectedTariffMainButton() {
    const selection = window.SolTariffDisplay?.selectionSnapshot(tariffCatalog, selectedMonths);
    if (!selection || !tg?.MainButton) return;
    const price = selection.display.finalPrice;
    if (tg?.MainButton) {
        tg.MainButton.setText(`💳 Оплатить ${selection.months} мес. — ${price} ₽`);
        tg.MainButton.setParams?.({ color: "#8b5cf6", text_color: "#ffffff", is_active: !paymentInProgress, is_visible: true });
        tg.MainButton.show();
    }
}

function initTelegramMainButton() {
    if (!tg?.MainButton || mainButtonInitialized) return;
    tg.MainButton.onClick(paySelectedTariff);
    mainButtonInitialized = true;
}

// ==========================================
// 🧭 НАВИГАЦИЯ
// ==========================================
// 🧭 НАВИГАЦИЯ

// ==========================================
// 🧭 НАВИГАЦИЯ
// ==========================================
function switchNav(index, screenId) {
    if (!screenId || screenId === activeScreenId) {
        alignNavBox(index);
        return;
    }
    activeScreenId = screenId;
    uiScheduler.cancel("navigation:activate");
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    
    const activeScreen = document.getElementById(`screen-${screenId}`);
    const activeNavBtn = document.getElementById(`btn-nav-${index}`);
    
    document.querySelectorAll(".screen").forEach(screen => {
        screen.setAttribute("aria-hidden", String(screen !== activeScreen));
    });
    if (activeScreen) {
        uiScheduler.frame("navigation:activate", () => activeScreen.classList.add("active"));
    }
    if (activeNavBtn) activeNavBtn.classList.add("active");

    alignNavBox(index);

    if (screenId === 'games') {
        checkGameLockStatus();
    }
    if (screenId === 'info') {
        animateDipText(defaultInfoText);
    }
    if (screenId === 'admin' && isAdmin) {
        loadAdminUsers(adminUsersPage);
        loadAdminPromos(adminPromoPage);
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function alignNavBox(index) {
    const targetBtn = document.getElementById(`btn-nav-${index}`);
    const navBox = document.getElementById("nav-liquid-box");
    if (targetBtn && navBox) {
        const centerOffset = targetBtn.offsetLeft + (targetBtn.offsetWidth / 2) - (navBox.offsetWidth / 2);
        navBox.style.transform = `translate3d(${centerOffset}px, 0, 0)`;
    }
}

function generateLongSmartPath() {
    let selectedNodes = [];
    let attempts = 0;

    while (selectedNodes.length < 5 && attempts < 200) {
        attempts++;
        const candidate = allCitiesList[Math.floor(Math.random() * allCitiesList.length)];

        if (selectedNodes.length === 0) {
            selectedNodes.push(candidate);
        } else {
            const lastNode = selectedNodes[selectedNodes.length - 1];
            const dist = Math.hypot(candidate.x - lastNode.x, candidate.y - lastNode.y);
            if (dist >= 120 && !selectedNodes.includes(candidate)) {
                selectedNodes.push(candidate);
            }
        }
    }

    if (selectedNodes.length < 5) {
        const shuffled = [...allCitiesList].sort(() => 0.5 - Math.random());
        selectedNodes = shuffled.slice(0, 5);
    }

    return selectedNodes;
}

let actionHandlersInitialized = false;

function initActionHandlers() {
    if (actionHandlersInitialized) return;
    actionHandlersInitialized = true;

    document.addEventListener("click", async event => {
        const target = event.target.closest("[data-action]");
        if (!target) return;

        const action = target.dataset.action;
        try {
            switch (action) {
                case "copy-vless-key": await copyVlessKey(); break;
                case "show-vless-import": showVlessImport(); break;
                case "close-vless-import": closeVlessImport(); break;
                case "select-vless-key": selectVlessKeyManually(); break;
                case "toggle-promo": togglePromoCard(); break;
                case "apply-promo": await applyPromoCode(); break;
                case "toggle-referral": toggleRefCard(); break;
                case "copy-referral-link": await copyRefLinkDirect(); break;
                case "use-referral-balance": useRefBalanceForTariff(); break;
                case "toggle-tariffs": toggleTariffs(); break;
                case "select-tariff": selectTariff(Number(target.dataset.months)); break;
                case "start-game": await startCatchGame(); break;
                case "answer-faq": answerFAQ(Number(target.dataset.faqId)); break;
                case "toggle-admin-promo-type": toggleAdminPromoType(target.dataset.type); break;
                case "change-calc": changeCalcVal(target.dataset.key, Number(target.dataset.delta)); break;
                case "toggle-admin-tariff": toggleAdminTariffPick(Number(target.dataset.months)); break;
                case "preview-admin-promo": previewAdminPromo(); break;
                case "create-admin-promo": await createAdminPromo(); break;
                case "admin-promos-prev": await loadAdminPromos(adminPromoPage - 1); break;
                case "admin-promos-next": await loadAdminPromos(adminPromoPage + 1); break;
                case "disable-admin-promo": await disableAdminPromo(target.dataset.code || ""); break;
                case "add-vip-user": await addApprovedUser(); break;
                case "remove-vip-user": await removeApprovedUser(Number(target.dataset.userId)); break;
                case "toggle-user-details": toggleUserDetails(target); break;
                case "admin-users-prev": await loadAdminUsers(adminUsersPage - 1); break;
                case "admin-users-next": await loadAdminUsers(adminUsersPage + 1); break;
                case "gift-promo":
                    event.stopPropagation();
                    await giftPromoToUser(Number(target.dataset.userId), target.dataset.username || "");
                    break;
                case "switch-nav": switchNav(Number(target.dataset.index), target.dataset.screen); break;
                default: break;
            }
        } catch (error) {
            console.error(error);
            showToast(`🚨 ${error.message || "Не удалось выполнить действие"}`, "error");
        }
    });

    document.addEventListener("input", event => {
        if (event.target.matches('[data-input-action="filter-users"]')) filterAllUsersList();
        if (event.target.matches('[data-input-action="filter-promos"]')) filterAdminPromos();
        if (event.target.matches('#admin-promo-name, #admin-promo-max, #admin-promo-expires')) invalidateAdminPromoPreview();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && vlessImportOverlay?.classList.contains("visible")) {
            closeVlessImport();
            return;
        }
        const target = event.target.closest('[role="button"][data-action]');
        if (!target || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        target.click();
    });
}

// ==========================================
// 🏁 ТОЧКА ВХОДА
// ==========================================
window.addEventListener("load", async () => {
    initActionHandlers();
    initSpaceFX();
    initMap3D();
    fillReelCards();
    updateRefUI();
    updateTariffPricesUI();
    updateConnectButtonState();
    alignNavBox(0);
    initTelegramMainButton();

    const data = await loadBootstrap(true);
    if (!data) {
        showToast("Интерфейс загружен, но backend пока недоступен", "error");
    }
});

window.addEventListener("resize", () => {
    const activeNav = document.querySelector(".nav-item.active");
    if (!activeNav) return;
    uiScheduler.frame("navigation:resize", () => alignNavBox(Number(activeNav.dataset.index || 0)));
}, { passive: true });

window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    closeVlessImport();
    currentVlessUri = "";
    activeLaserAnim?.pause?.();
    clearActiveComets();
    faqAnimator?.destroy?.();
    uiScheduler.destroy?.();
});
