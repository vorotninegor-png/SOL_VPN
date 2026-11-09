// =====================================================================
// SOL VPN Mini App — frontend v4
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
let isSubscribedUser = false;
let currentVlessUri = "";
let selectedMonths = null;
let paymentInProgress = false;
let paymentCatalog = { enabled: false, tariffs: [] };
let paymentAttempts = {};
let paymentOwner = null;
let yookassaCatalog = { enabled: false, tariffs: [] };
let yookassaAttempts = {};
let checkoutStatusText = "";
let yookassaCheckBusy = false;
let lastYookassaCheck = 0;
const paymentSheetState = { open: false, revision: 0, timer: null, initialized: false, previousFocus: null, backgroundInert: false, backgroundLocked: false };
let checkoutBotLink = null;
const checkoutBotLinks = new Map();
let paymentOrderHistory = {};
const paymentOrderChecks = new Map();
let paymentRecoveryBatch = null;
const paymentExpiryProbes = new Set();
let paymentCountdownTimer = null;
let paymentUiOrder = null;
let paymentOperation = 0;
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
let isScanAvailable = true;
let caughtCount = 0;

let adminPromoTypes = { days: false, discount: false };
let adminPickedTariffs = { 1: false, 3: false, 6: false, 12: false };
let adminLimitType = "lifetime_days";
let calcValues = { days: 7, discount: 30, limit: 13 };
let touchStartXs = { days: 0, discount: 0, limit: 0 };

let approvedUsers = [];
const vipDirectory = { users: new Map(), loading: false, complete: false, revision: 0, controller: null };
let allUsersList = [];
const adminUsersState = {
    initialized: false, query: "", offset: 0, total: null, hasMore: false,
    legacyItems: null, loading: false, error: "", revision: 0, timer: null,
    controller: null, capabilities: {}
};
const adminVipPending = new Set();
const adminVipVersions = new Map();
const adminVipValues = new Map();
let adminPanelInitialized = false;
let mainButtonInitialized = false;
let referralLink = "";

// Каталог приходит только с backend; локальных цен в бизнес-логике нет.
let tariffCatalog = {};
let activeDiscounts = { 1: 0, 3: 0, 6: 0, 12: 0 };

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
        const error = new Error(detail || `Ошибка API ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return body;
}

function applyBootstrap(data) {
    if (!data) return;
    serverOnline = true;

    if (data.user) {
        userData = { ...data.user };
        window.SolAppearance?.setUser(data.user.id ?? data.user.user_id);
        isAdmin = Boolean(data.is_admin ?? data.user.is_admin);
        const owner = String(data.user.id ?? data.user.user_id ?? "");
        if (owner !== paymentOwner) {
            if (paymentOwner !== null) { closePaymentSheet(true); selectedMonths = null; }
            paymentOwner = owner;
            paymentOperation++; paymentInProgress = false; yookassaCheckBusy = false; lastYookassaCheck = 0;
            paymentUiOrder = null;
            vipDirectory.controller?.abort(); vipDirectory.revision++; vipDirectory.users.clear(); vipDirectory.complete = false; vipDirectory.loading = false; vipDirectory.controller = null;
            approvedUsers = []; allUsersList = []; adminVipValues.clear(); adminVipVersions.clear(); adminVipPending.clear();
            adminUsersState.controller?.abort(); adminUsersState.revision++; adminUsersState.initialized = false; adminUsersState.loading = false;
            clearTimeout(adminUsersState.timer); adminUsersState.legacyItems = null; adminUsersState.query = ""; adminUsersState.offset = 0; adminUsersState.total = null;
            const adminSearch = document.getElementById("admin-search-user"); if (adminSearch) adminSearch.value = "";
            document.getElementById("all-users-container")?.replaceChildren(); document.getElementById("approved-users-drum")?.replaceChildren();
            if (!isAdmin && document.getElementById("screen-admin")?.classList.contains("active")) switchNav(0,"tunnel");
            paymentAttempts = {};
            yookassaAttempts = {};
            checkoutStatusText = "";
            checkoutBotLink = null;
            checkoutBotLinks.clear();
            paymentOrderHistory = {};
            paymentExpiryProbes.clear();
            try {
                const saved = JSON.parse(localStorage.getItem(`sol-payment-history:${owner}`) || "{}");
                for (const [id, record] of Object.entries(saved)) {
                    if (record && checkoutUuid.test(record.orderId) && ["telegram_stars", "yookassa"].includes(record.provider)
                        && [1, 3, 6, 12].includes(record.months)) paymentOrderHistory[id] = record;
                }
            } catch (_) {}
            try {
                const saved = JSON.parse(localStorage.getItem(`sol-stars:${owner}`) || "{}");
                for (const [months, attempt] of Object.entries(saved)) {
                    if ([1, 3, 6, 12].includes(Number(months)) && attempt.months === Number(months)
                        && Number.isSafeInteger(attempt.amount) && attempt.amount > 0
                        && /^[0-9a-f-]{36}$/i.test(attempt.key)) paymentAttempts[months] = attempt;
                }
            } catch (_) { /* The current tab can still retry when storage is unavailable. */ }
            try {
                const saved = JSON.parse(localStorage.getItem(`sol-checkout:${owner}:yookassa`) || "{}");
                for (const [months, attempt] of Object.entries(saved)) {
                    if (validYookassaAttempt(months, attempt)) yookassaAttempts[months] = attempt;
                }
            } catch (_) {}
        }
    }

    if (data.subscription) {
        isSubscribedUser = Boolean(data.subscription.active);
        updateSubscriptionUI(data.subscription);
    }

    paymentCatalog = data.payment?.currency === "XTR" && data.payment?.channel === "telegram_stars"
        ? data.payment : { enabled: false, tariffs: [] };
    const rubProvider = data.payment?.providers?.yookassa;
    yookassaCatalog = rubProvider?.currency === "RUB" && Array.isArray(rubProvider.tariffs)
        ? rubProvider : { enabled: false, tariffs: [] };
    restorePaymentOrders(data.payment || {});
    const selectedAttempt = yookassaAttempts[selectedMonths];
    const botUsername = String(data.referral?.bot_username || "");
    if (selectedAttempt?.deliveryState === "sent" && /^[a-zA-Z0-9_]{5,32}$/.test(botUsername)) {
        checkoutBotLink = { orderId: selectedAttempt.orderId, url: `https://t.me/${botUsername}` };
    }
    if (Array.isArray(data.tariffs)) {
        data.tariffs.forEach(t => {
            tariffCatalog[Number(t.months)] = t;
            activeDiscounts[Number(t.months)] = Number(t.discount_percent || 0);
        });
        updateTariffPricesUI();
    }
    if (selectedMonths) selectTariff(selectedMonths);
    renderPaymentMethods();
    renderPaymentCountdowns();

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
        for (const user of approvedUsers) vipDirectory.users.set(Number(user.user_id), user);
        renderAllUsersList();
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
        if (showErrors) showToast(`Backend: ${error.message}`, "error");
        if (!userData) window.SolAppearance?.setUser(null);
        console.error(error);
        return null;
    }
}

function updateSubscriptionUI(subscription) {
    const leftVal = document.getElementById("sub-days-left");
    const bar = document.getElementById("sub-progress-bar");
    if (!leftVal || !bar) return;

    if (subscription.is_vip) {
        window.SolUI.text(leftVal, "VIP · безлимит", "crown");
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
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    window.SolUI.text(toast, message, type === "error" ? "warning" : "info");

    container.appendChild(toast);

    setTimeout(() => toast.classList.add("show"), 10);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
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
    if (window.SolAppearance?.animationsAllowed() === false) return;
    const dropsBox = document.getElementById("liquid-drops-box");
    if (!dropsBox) return;

    const count = 9 + Math.floor(Math.random() * 4);
    let dropsHTML = "";

    for (let i = 0; i < count; i++) {
        dropsHTML += `<div class="edge-drop" id="e-drop-${i}"></div>`;
    }
    dropsBox.innerHTML = dropsHTML;

    setTimeout(() => {
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

                setTimeout(() => {
                    drop.style.transform = `translate(${targetX}px, ${targetY}px) scale(${0.8 + Math.random() * 0.4})`;
                    drop.style.opacity = "0.85";

                    setTimeout(() => {
                        drop.style.transform = `translate(${startX}px, ${startY}px) scale(0.2)`;
                        drop.style.opacity = "0";
                    }, 350);
                }, 30);
            }
        }
    }, 10);
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

if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
        if (!serverOnline) {
            showToast("Нет связи с backend на вашем ПК", "error");
            return;
        }
        if (!isSubscribedUser) {
            showToast("Для получения VPN активируйте подписку", "error");
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
    isConfigReady = false;
    statusText.innerText = "ПОЛУЧЕНИЕ КЛЮЧА...";
    statusBadge.className = "status-badge connecting";
    telemetryBar?.classList.add("hidden");

    try {
        const result = await apiFetch("/api/vpn/config", {
            method: "POST",
            body: "{}"
        });
        currentVlessUri = result.vless_uri || "";
        if (!currentVlessUri) throw new Error("Backend не вернул VLESS URI");
        playConnectAnimation();
    } catch (error) {
        statusText.innerText = "ОШИБКА";
        statusBadge.className = "status-badge disconnected";
        showToast(`VPN: ${error.message}`, "error");
        tg?.HapticFeedback?.notificationOccurred("error");
    }
}

function playConnectAnimation() {
    const connectionsGroup = document.getElementById("connections-group");
    if (connectionsGroup) connectionsGroup.innerHTML = "";
    document.querySelectorAll(".city-point").forEach(el => el.className.baseVal !== undefined ? el.setAttribute("class", "city-point") : el.className = "city-point");

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
    if (!laserPath || typeof anime !== "function" || window.SolAppearance?.animationsAllowed() === false) {
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
    isConfigReady = true;
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
    setTimeout(() => node?.classList.remove("flash-green"), 450);
}

async function copyVlessKey() {
    if (!currentVlessUri) {
        showToast("Сначала нажмите кнопку получения VPN", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(currentVlessUri);
        showToast("VLESS-ключ скопирован");
        tg?.HapticFeedback?.notificationOccurred("success");
    } catch (_) {
        // В некоторых WebView clipboard запрещён — показываем стандартный Telegram popup.
        window.prompt("Скопируйте VLESS-ключ:", currentVlessUri);
    }
}

function openVlessKey() {
    if (!currentVlessUri) {
        showToast("Сначала получите VPN-конфигурацию", "error");
        return;
    }
    window.location.href = currentVlessUri;
}

// ==========================================
// 🎁 5. ПРОМОКОДЫ

// ==========================================
// 🎁 5. ПРОМОКОДЫ И РЕФЕРАЛКА С ЮЗЕРНЕЙМОМ БОТА
// ==========================================
function togglePromoCard(forceState = null) {
    const drawer = document.getElementById("promo-drawer");
    const promoCardTrigger = document.getElementById("promo-trigger-card");

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
    window.SolUI.disclosure(promoCardTrigger, isPromoOpen);
    if (!isPromoOpen && drawer?.contains(document.activeElement)) promoCardTrigger?.focus();
    if (drawer) drawer.inert = !isPromoOpen;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
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
        window.SolUI.text(headerText, "ВВЕДИТЕ ПРОМОКОД", "gift");
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
        setTimeout(() => card?.classList.remove("error-glow"), 350);
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
            window.SolUI.text(headerText, "УСПЕШНО!", "check");
            headerText.style.color = "#10b981";
        }
        if (statusMsg) {
            statusMsg.innerText = "АКТИВИРОВАН!";
            statusMsg.className = "promo-status-msg show-msg success-txt";
        }
        applyBootstrap(result.bootstrap);
        showToast(result.message || `Промокод ${code} активирован`);
        tg?.HapticFeedback?.notificationOccurred("success");
        setTimeout(() => {
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
        showToast(`${error.message}`, "error");
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
    window.SolUI.disclosure(refCardTrigger, isRefOpen);
    if (!isRefOpen && drawer?.contains(document.activeElement)) refCardTrigger?.focus();
    if (drawer) drawer.inert = !isRefOpen;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
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
        showToast("Реферальная ссылка скопирована!");
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
        window.SolUI.text(payBtn, "ОПЛАТА БАЛАНСОМ ПОКА НЕДОСТУПНА", "card");
    }
}

function checkGameLockStatus() {
    const lockScreen = document.getElementById("game-lock-screen");
    if (isSubscribedUser) {
        if (lockScreen) lockScreen.classList.add("hidden");
    } else {
        if (lockScreen) lockScreen.classList.remove("hidden");
    }
}

// ==========================================
// 🎮 6. ИГРЫ
// ==========================================
async function startCatchGame() {
    if (isGameRunning) return;
    if (!isSubscribedUser) {
        showToast("Нужна активная подписка", "error");
        return;
    }
    if (!isScanAvailable && !isAdmin) {
        showToast("Лимит сканирования исчерпан (24ч)", "error");
        return;
    }

    let session;
    try {
        session = await apiFetch("/api/game/start", { method: "POST", body: "{}" });
        currentGameSession = session.session_id;
    } catch (error) {
        showToast(`Игра: ${error.message}`, "error");
        return;
    }

    isGameRunning = true;
    isScanAvailable = isAdmin;
    caughtCount = 0;

    const stage = document.getElementById("radar-stage");
    const startBtn = document.getElementById("start-radar-btn");
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
        setTimeout(() => crystalArea.classList.add("show-row"), 50);
    }

    for (let i = 0; i < 5; i++) {
        setTimeout(() => {
            if (isGameRunning) spawnComet(i, 1800 + Math.random() * 1600);
        }, i * 1100);
    }

    setTimeout(() => {
        isGameRunning = false;
        updateGameButtonState();
    }, 7000);
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
            if (comet && comet.parentNode) {
                comet.remove();
            }
        }
    });

    const onHit = (e) => {
        e.stopPropagation();
        animMove.pause();

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
            createFloatingText(x, y, `-${reward.value}%!`, "green-text");
            prizeHTML = `<span style="color:${randColor};font-weight:bold">-${reward.value}%</span>`;
            setTimeout(() => spinSpaceSlot(reward.value, Number(reward.months)), 200);
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
        showToast(`Награда: ${error.message}`, "error");
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

    reel.style.transition = "none";
    reel.style.transform = "translateY(0)";
    setTimeout(() => {
        reel.style.transition = "transform 3.6s cubic-bezier(0.15,0.85,0.15,1)";
        reel.style.transform = `translateY(${finalTranslateY}px)`;
    }, 50);
    setTimeout(() => {
        const color = neons[targetSegment] || "#a855f7";
        slotContainer.style.borderColor = color;
        slotContainer.style.boxShadow = `0 0 35px ${color}, inset 0 0 15px ${color}`;
        showToast(`Скидка ${discountValue}% на тариф ${targetSegment} мес.`);
        setTimeout(() => {
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
    window.SolUI.text(el, text);
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1200);
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

function persistPaymentAttempts() {
    try { localStorage.setItem(`sol-stars:${paymentOwner}`, JSON.stringify(paymentAttempts)); } catch (_) {}
}

function paymentQuote(months) {
    const current = paymentCatalog.tariffs?.find(item => Number(item.months) === Number(months));
    const attempt = paymentAttempts[months];
    return current && attempt && !paymentOrderTerminal(attempt) && attempt.status !== "expired" ? { ...current, amount: attempt.amount, discount_percent: attempt.discountPercent ?? 0 } : current;
}

function newPaymentKey() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const checkoutUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validYookassaAttempt(months, attempt) {
    return attempt && [1, 3, 6, 12].includes(Number(months)) && attempt.months === Number(months)
        && Number.isSafeInteger(attempt.amountKopecks) && attempt.amountKopecks > 0
        && checkoutUuid.test(attempt.key) && (!attempt.orderId || checkoutUuid.test(attempt.orderId));
}

function persistYookassaAttempts() {
    try { localStorage.setItem(`sol-checkout:${paymentOwner}:yookassa`, JSON.stringify(yookassaAttempts)); } catch (_) {}
}

function paymentOrderKey(provider, orderId) { return `${provider}:${orderId}`; }
function paymentProviderAttempts(provider) { return provider === "yookassa" ? yookassaAttempts : paymentAttempts; }
function paymentOrderTerminal(attempt) { return ["paid", "refunded", "canceled", "error"].includes(attempt?.status); }
function persistPaymentHistory() {
    try { localStorage.setItem(`sol-payment-history:${paymentOwner}`, JSON.stringify(paymentOrderHistory)); } catch (_) {}
}
function syncPaymentExpiry(attempt, result) {
    const expiry = Date.parse(result.expires_at || "");
    const server = Date.parse(result.server_time || "");
    if (Number.isFinite(expiry)) attempt.expiresAt = new Date(expiry).toISOString();
    if (Number.isFinite(server)) attempt.serverOffsetMs = server - Date.now();
    const nextStatus = ["paid", "refunded"].includes(result.payment_status) ? result.payment_status : result.status || attempt.status;
    if (attempt.status !== "refunded" && !(attempt.status === "paid" && nextStatus !== "refunded")) attempt.status = nextStatus;
    if (result.created_at) attempt.createdAt = result.created_at;
    if (attempt.status !== "expired" && paymentSecondsLeft(attempt) > 0) {
        for (const provider of ["telegram_stars", "yookassa"]) paymentExpiryProbes.delete(paymentOrderKey(provider, attempt.orderId));
    }
}
function paymentSecondsLeft(attempt) {
    const expiry = Date.parse(attempt?.expiresAt || "");
    return attempt?.orderId && Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - Date.now() - Number(attempt.serverOffsetMs || 0)) / 1000)) : null;
}
function paymentOrderExpired(attempt) { return !paymentOrderTerminal(attempt) && (attempt?.status === "expired" || paymentSecondsLeft(attempt) === 0); }
function rememberPaymentOrder(attempt, provider, archived = false) {
    if (!attempt?.orderId || !checkoutUuid.test(attempt.orderId)) return;
    const id = paymentOrderKey(provider, attempt.orderId);
    const previous = paymentOrderHistory[id];
    paymentOrderHistory[id] = { provider, orderId: attempt.orderId, months: attempt.months,
        amount: attempt.amount, amountKopecks: attempt.amountKopecks, expiresAt: attempt.expiresAt,
        serverOffsetMs: attempt.serverOffsetMs, status: attempt.status, createdAt: attempt.createdAt,
        archived: archived || previous?.archived || false,
        uiHidden: attempt.uiHidden ?? previous?.uiHidden ?? archived,
        notices: { ...previous?.notices, ...attempt.notices } };
    persistPaymentHistory();
}
function clearPaymentSelection() {
    selectedMonths = null; checkoutStatusText = ""; checkoutBotLink = null; paymentUiOrder = null;
    tg?.MainButton?.hideProgress?.();
    updateTariffPricesUI(); renderPaymentMethods();
}
function activatePaymentUi(attempt, provider) {
    attempt.uiHidden = false;
    paymentUiOrder = { provider, key: attempt.key, orderId: attempt.orderId, months: attempt.months };
    const record = paymentOrderHistory[paymentOrderKey(provider,attempt.orderId)];
    if (record) { record.uiHidden = false; record.archived = false; }
}
function resolvePaymentUi(attempt, provider, { notify = true, cancelled = false, releaseBusy = false } = {}) {
    const reason = cancelled ? "cancelled" : attempt.status;
    if (!["paid","expired","refunded","canceled","error","cancelled"].includes(reason)) return false;
    const id = paymentOrderKey(provider,attempt.orderId), old = paymentOrderHistory[id];
    const alreadyHidden = Boolean(attempt.uiHidden || old?.uiHidden);
    const current = paymentProviderAttempts(provider)[attempt.months];
    const ownsUi = paymentUiOrder ? paymentUiOrder.provider === provider &&
        (paymentUiOrder.orderId === attempt.orderId || paymentUiOrder.key === attempt.key)
        : current?.orderId === attempt.orderId && !alreadyHidden;
    attempt.uiHidden = true;
    attempt.notices = { ...old?.notices, ...attempt.notices };
    if (!attempt.notices[reason]) {
        attempt.notices[reason] = true;
        if (notify && (reason === "paid" || !alreadyHidden)) {
            if (reason === "paid") showToast("Оплата подтверждена сервером. Подписка обновлена.");
            if (reason === "expired") showToast("Время оплаты истекло");
            if (reason === "cancelled") showToast("Оплата отменена");
            if (reason === "refunded") showToast("Возврат подтверждён. По подписке обратитесь в /paysupport.");
        }
    }
    rememberPaymentOrder(attempt,provider);
    if (paymentOrderTerminal(attempt) && current?.orderId === attempt.orderId) delete paymentProviderAttempts(provider)[attempt.months];
    if (ownsUi && selectedMonths === attempt.months) {
        if (releaseBusy) { paymentInProgress = false; yookassaCheckBusy = false; paymentOperation++; }
        closePaymentSheet(true); clearPaymentSelection();
    }
    persistPaymentAttempts(); persistYookassaAttempts();
    return true;
}
function restorePaymentOrders(payment) {
    const seen = new Set();
    const rows = [...(Array.isArray(payment.pending_orders) ? payment.pending_orders : [])]
        .sort((a, b) => Number(a.status === "expired") - Number(b.status === "expired"));
    for (const order of rows) {
        if (!["telegram_stars", "yookassa"].includes(order.provider) || !checkoutUuid.test(order.order_id)
            || ![1, 3, 6, 12].includes(Number(order.months))) continue;
        const provider = order.provider, months = Number(order.months), map = paymentProviderAttempts(provider);
        const previous = map[months];
        const knownStatus = paymentOrderHistory[paymentOrderKey(provider,order.order_id)]?.status;
        const attempt = { months, key: order.request_id, orderId: order.order_id, status: ["paid","refunded"].includes(knownStatus) ? knownStatus : order.status,
            discountPercent: order.discount_percent, ...(provider === "yookassa" ? { amountKopecks: order.amount_kopecks } : { amount: order.amount }),
            deliveryState: order.checkout_delivery?.state || (previous?.orderId === order.order_id ? previous.deliveryState : undefined) };
        syncPaymentExpiry(attempt, { ...order, server_time: order.server_time || payment.server_time });
        if (provider === "yookassa" && safeCheckoutBotLink(order.checkout_delivery?.bot_url)) checkoutBotLinks.set(order.order_id,order.checkout_delivery.bot_url);
        if (attempt.status === "expired" || paymentOrderTerminal(attempt)) {
            const visibleBefore = Boolean(document.querySelector(`[data-payment-order="${paymentOrderKey(provider,order.order_id)}"]:not(.is-leaving)`));
            rememberPaymentOrder(attempt,provider,true);
            resolvePaymentUi(attempt,provider,{notify:visibleBefore,releaseBusy:visibleBefore});
            if (previous?.orderId === attempt.orderId) Object.assign(previous,attempt);
            continue;
        }
        const id = paymentOrderKey(provider, order.order_id), group = `${provider}:${months}`;
        const archived = paymentOrderHistory[id]?.archived;
        if (seen.has(group) || (archived && attempt.status === "expired")
            || (previous?.orderId !== attempt.orderId && previous && !paymentOrderExpired(previous) && !paymentOrderTerminal(previous) && attempt.status === "expired")) {
            rememberPaymentOrder(attempt, provider, true); continue;
        }
        const amount = provider === "yookassa" ? attempt.amountKopecks : attempt.amount;
        if (!checkoutUuid.test(attempt.key) || !Number.isSafeInteger(amount) || amount < 1) { rememberPaymentOrder(attempt, provider, true); continue; }
        if (previous?.orderId && previous.orderId !== attempt.orderId) rememberPaymentOrder(previous, provider, true);
        map[months] = { ...(previous?.orderId === attempt.orderId ? previous : {}), ...attempt };
        seen.add(group);
        if (provider === "yookassa" && selectedMonths === months && safeCheckoutBotLink(order.checkout_delivery?.bot_url)) {
            checkoutBotLink = { orderId: order.order_id, url: order.checkout_delivery.bot_url };
        }
    }
    persistPaymentAttempts(); persistYookassaAttempts(); persistPaymentHistory();
}
function trackedPaymentOrders() {
    const records = new Map(Object.entries(paymentOrderHistory));
    for (const provider of ["telegram_stars", "yookassa"]) for (const attempt of Object.values(paymentProviderAttempts(provider))) {
        if (attempt.orderId) { const id = paymentOrderKey(provider,attempt.orderId); records.set(id, { ...records.get(id), ...attempt, provider }); }
    }
    return [...records.values()].filter(record => checkoutUuid.test(record.orderId) && Number.isFinite(Date.parse(record.expiresAt || "")) && !paymentOrderTerminal(record))
        .sort((a, b) => Number(paymentOrderExpired(a)) - Number(paymentOrderExpired(b)) || (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
}
function renderPaymentCountdowns() {
    const tracked = trackedPaymentOrders();
    const orders = tracked.filter(order => !order.uiHidden && !order.archived && order.status !== "expired");
    const render = (container, rows, controls) => {
        if (!container) return;
        if (rows.length) container.hidden = false;
        const ids = new Set(rows.map(row => paymentOrderKey(row.provider, row.orderId)));
        for (const node of [...container.children]) if (!ids.has(node.dataset.paymentOrder) && !node.classList.contains("is-leaving")) {
            const finish = () => { node.remove(); if (!container.children.length) container.hidden = true; };
            node.classList.add("is-leaving");
            if (!paymentSheetReducedMotion() && typeof node.animate === "function") {
                const animation = node.animate([{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(-5px)"}],{duration:180,easing:"ease-out"});
                animation.finished.then(finish,finish);
            } else finish();
        }
        if (!rows.length && !container.children.length) container.hidden = true;
        for (const order of rows) {
            const id = paymentOrderKey(order.provider, order.orderId);
            let row = [...container.children].find(node => node.dataset.paymentOrder === id);
            if (!row) {
                row = document.createElement("div"); row.className = "payment-deadline"; row.dataset.paymentOrder = id;
                const label = document.createElement("span"); label.className = "payment-deadline-label";
                const value = document.createElement("span"); value.className = "payment-deadline-value"; value.setAttribute("role", "timer"); value.setAttribute("aria-live", "off");
                row.append(label, value);
                if (controls) { const button = document.createElement("button"); button.type = "button"; button.className = "payment-deadline-check";
                    button.dataset.action = "check-payment-order"; button.dataset.provider = order.provider; button.dataset.orderId = order.orderId;
                    button.textContent = "Проверить оплату"; row.append(button); }
                container.append(row);
            }
            const seconds = paymentSecondsLeft(order), expired = paymentOrderExpired(order);
            row.classList.toggle("payment-deadline-warning", !expired && seconds !== null && seconds <= 60);
            row.classList.toggle("payment-deadline-expired", expired);
            row.querySelector(".payment-deadline-label").textContent = `${order.provider === "yookassa" ? "ЮKassa" : "Telegram Stars"} · ${order.months} мес.`;
            row.querySelector(".payment-deadline-value").textContent = seconds === 0 ? "00:00 · Проверяем оплату" : `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
            const button = row.querySelector("button"); if (button) button.disabled = paymentOrderChecks.has(id);
        }
    };
    render(document.getElementById("profile-payment-deadlines"), orders, true);
    render(document.getElementById("sheet-payment-deadlines"), orders.filter(row => row.months === selectedMonths), false);
    for (const [provider, noteId] of [["telegram_stars", "stars-expired-note"], ["yookassa", "yookassa-expired-note"]]) {
        const note = document.getElementById(noteId); if (note) note.hidden = true;
    }
    const held = document.getElementById("payment-discount-pending");
    if (held) held.hidden = Number(tariffCatalog[selectedMonths]?.discount_percent || 0) > 0
        || !(Array.isArray(paymentCatalog.discount_pending) ? paymentCatalog.discount_pending : []).some(row => Number(row.months) === selectedMonths);
    if (orders.some(order => paymentSecondsLeft(order) > 0) && !paymentCountdownTimer) {
        paymentCountdownTimer = setInterval(renderPaymentCountdowns, 1000);
    } else if (!orders.some(order => paymentSecondsLeft(order) > 0) && paymentCountdownTimer) { clearInterval(paymentCountdownTimer); paymentCountdownTimer = null; }
    for (const order of tracked) if (paymentOrderExpired(order) && order.status !== "expired") {
        const id = paymentOrderKey(order.provider, order.orderId);
        if (!paymentExpiryProbes.has(id)) { paymentExpiryProbes.add(id); void checkPaymentOrder(order.provider, order.orderId, true); }
    }
}
async function checkPaymentOrder(provider, orderId, quiet = false) {
    if (!["telegram_stars", "yookassa"].includes(provider)) return null;
    const id = paymentOrderKey(provider, orderId);
    if (paymentOrderChecks.has(id)) return paymentOrderChecks.get(id);
    const owner = paymentOwner;
    const current = Object.values(paymentProviderAttempts(provider)).find(row => row.orderId === orderId);
    const attempt = current || paymentOrderHistory[id];
    if (!attempt || !checkoutUuid.test(orderId)) return null;
    const pending = (async () => {
        try {
            const result = await apiFetch(`/api/payments/orders/${encodeURIComponent(orderId)}`);
            if (paymentOwner !== owner || result.order_id !== orderId || (result.provider || result.channel) !== provider) return null;
            const amount = provider === "yookassa" ? result.amount_kopecks : result.amount;
            if (result.currency !== (provider === "yookassa" ? "RUB" : "XTR")
                || amount !== (provider === "yookassa" ? attempt.amountKopecks : attempt.amount)) throw new Error("Параметры заказа требуют сверки");
            syncPaymentExpiry(attempt, result);
            if (provider === "yookassa" && current) syncCheckoutDelivery(attempt, result);
            rememberPaymentOrder(attempt, provider, !current);
            resolvePaymentUi(attempt,provider,{releaseBusy:true});
            if (attempt.status === "paid") await loadBootstrap(false);
            persistPaymentAttempts(); persistYookassaAttempts();
            return result;
        } catch (_) { if (!quiet) showToast("Не удалось проверить оплату. Повторите позже или напишите в /paysupport", "error"); return null; }
        finally { paymentOrderChecks.delete(id); renderPaymentCountdowns(); renderPaymentMethods(); }
    })();
    paymentOrderChecks.set(id, pending); renderPaymentCountdowns(); return pending;
}
async function preparePaymentAttempt(provider, months) {
    const map = paymentProviderAttempts(provider), attempt = map[months];
    if (!attempt?.orderId || !paymentOrderExpired(attempt)) return true;
    const displayed = provider === "yookassa" ? yookassaQuote(months)?.amount_kopecks : paymentQuote(months)?.amount;
    const result = await checkPaymentOrder(provider, attempt.orderId, true);
    if (!result) { setCheckoutStatus(months, "Сначала проверьте прежний счёт. Новый счёт не создан."); return false; }
    if (["paid", "refunded"].includes(result.status) || ["paid", "refunded"].includes(result.payment_status)) return false;
    if (result.status !== "expired") return !paymentOrderExpired(map[months]);
    rememberPaymentOrder(attempt, provider, true);
    if (map[months]?.orderId === attempt.orderId) delete map[months];
    persistPaymentAttempts(); persistYookassaAttempts();
    await loadBootstrap(false);
    const quote = provider === "yookassa" ? yookassaQuote(months) : paymentQuote(months);
    const currentAmount = provider === "yookassa" ? quote?.amount_kopecks : quote?.amount;
    if (selectedMonths !== months) return false;
    if (currentAmount !== displayed) {
        setCheckoutStatus(months, "Прежний счёт истёк. Проверьте актуальную цену и нажмите способ оплаты для нового счёта.");
        return false;
    }
    return true;
}
async function checkPendingPaymentOrders() {
    const owner = paymentOwner;
    if (paymentRecoveryBatch?.owner === owner) return paymentRecoveryBatch.promise;
    const orders = trackedPaymentOrders();
    const batch = { owner, promise: null };
    let next = 0;
    paymentRecoveryBatch = batch;
    batch.promise = (async () => {
        const worker = async () => {
            while (next < orders.length && paymentOwner === owner) {
                const order = orders[next++];
                await checkPaymentOrder(order.provider, order.orderId, true);
            }
        };
        try { await Promise.all(Array.from({ length: Math.min(3, orders.length) }, worker)); }
        finally { if (paymentRecoveryBatch === batch) paymentRecoveryBatch = null; }
    })();
    return batch.promise;
}

function yookassaQuote(months) {
    const current = yookassaCatalog.tariffs?.find(item => Number(item.months) === Number(months));
    const attempt = yookassaAttempts[months];
    return current && attempt && !paymentOrderTerminal(attempt) && attempt.status !== "expired" ? { ...current, amount_kopecks: attempt.amountKopecks, discount_percent: attempt.discountPercent } : current;
}

function rublePrice(kopecks) {
    if (!Number.isSafeInteger(kopecks) || kopecks < 1) return "—";
    return `${Math.trunc(kopecks / 100).toLocaleString("ru-RU")},${String(kopecks % 100).padStart(2, "0")} ₽`;
}

function safeCheckoutLink(value) {
    if (typeof value !== "string" || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && (!url.port || url.port === "443");
    } catch (_) { return false; }
}

function setCheckoutStatus(months, text) {
    if (selectedMonths === months) checkoutStatusText = text;
}

function paymentSheetReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) || window.SolAppearance?.animationsAllowed() === false;
}

function updatePaymentCta() {
    const selected = Boolean(selectedMonths && tariffCatalog[selectedMonths]);
    const active = selected && !paymentInProgress && !yookassaCheckBusy;
    if (tg?.MainButton) {
        tg.MainButton.setText("Оплатить");
        tg.MainButton.setParams?.({ ...(window.SolAppearance?.chrome() || {color:"#6435a6",text_color:"#ffffff"}), is_active: active, is_visible: selected && !paymentSheetState.open });
        if (active) tg.MainButton.enable?.(); else tg.MainButton.disable?.();
        if (selected && !paymentSheetState.open) tg.MainButton.show(); else tg.MainButton.hide();
    }
    const fallback = document.getElementById("payment-open-button");
    if (fallback) { fallback.hidden = Boolean(tg?.MainButton) || !selected || paymentSheetState.open; fallback.disabled = !active; }
}

function openPaymentSheet() {
    if (!selectedMonths || paymentInProgress || yookassaCheckBusy) return;
    initPaymentSheet();
    const backdrop = document.getElementById("payment-sheet-backdrop");
    const panel = document.getElementById("payment-methods");
    if (!backdrop || !panel) return;
    const wasOpen = paymentSheetState.open;
    if (!wasOpen && !backdrop.contains(document.activeElement)) paymentSheetState.previousFocus = document.activeElement;
    paymentSheetState.revision++;
    clearTimeout(paymentSheetState.timer);
    paymentSheetState.open = true;
    renderPaymentMethods();
    backdrop.hidden = false;
    panel.style.transform = "";
    const background = document.querySelector(".app-container");
    if (background) {
        if (!paymentSheetState.backgroundLocked) paymentSheetState.backgroundInert = background.inert;
        paymentSheetState.backgroundLocked = true;
        background.inert = true;
    }
    void backdrop.offsetHeight;
    backdrop.classList.add("is-open");
    document.getElementById("payment-sheet-close")?.focus({ preventScroll: true });
    tg?.BackButton?.show?.();
    updatePaymentCta();
}

function closePaymentSheet(preserveSelection = false) {
    if (!paymentSheetState.open) return;
    if (preserveSelection !== true) {
        for (const provider of ["telegram_stars","yookassa"]) {
            const attempt = paymentProviderAttempts(provider)[selectedMonths];
            if (attempt) { attempt.uiHidden = true; rememberPaymentOrder(attempt,provider); }
        }
        clearPaymentSelection();
    }
    const backdrop = document.getElementById("payment-sheet-backdrop");
    const panel = document.getElementById("payment-methods");
    paymentSheetState.open = false;
    const revision = ++paymentSheetState.revision;
    backdrop?.classList.remove("is-open");
    if (panel) { panel.style.transition = ""; panel.style.transform = ""; }
    tg?.BackButton?.hide?.();
    const finish = () => {
        if (revision !== paymentSheetState.revision || paymentSheetState.open) return;
        if (backdrop) backdrop.hidden = true;
        const background = document.querySelector(".app-container");
        if (background) background.inert = paymentSheetState.backgroundInert;
        paymentSheetState.backgroundLocked = false;
        const previous = paymentSheetState.previousFocus;
        if (previous?.isConnected) previous.focus?.({ preventScroll: true });
        updatePaymentCta();
    };
    clearTimeout(paymentSheetState.timer);
    if (paymentSheetReducedMotion()) finish(); else paymentSheetState.timer = setTimeout(finish, 350);
}

function initPaymentSheet() {
    if (paymentSheetState.initialized) return;
    paymentSheetState.initialized = true;
    tg?.BackButton?.onClick?.(() => closePaymentSheet());
    document.addEventListener("keydown", event => {
        if (!paymentSheetState.open) return;
        if (event.key === "Escape") { event.preventDefault(); closePaymentSheet(); return; }
        if (event.key !== "Tab") return;
        const panel = document.getElementById("payment-methods");
        const nodes = [...panel.querySelectorAll("button:not(:disabled), a[href], [tabindex='0']")].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    const grip = document.getElementById("payment-sheet-swipe");
    const panel = document.getElementById("payment-methods");
    let drag = null;
    grip?.addEventListener("pointerdown", event => {
        if (!paymentSheetState.open || event.button !== 0 || event.target.closest("button")) return;
        drag = { id: event.pointerId, y: event.clientY, distance: 0 };
        grip.setPointerCapture?.(event.pointerId);
    });
    grip?.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return;
        drag.distance = Math.max(0, event.clientY - drag.y);
        panel.style.transition = "none";
        panel.style.transform = `translateY(${drag.distance}px)`;
    });
    const endDrag = event => {
        if (!drag || drag.id !== event.pointerId) return;
        const close = drag.distance >= 70;
        drag = null;
        panel.style.transition = "";
        panel.style.transform = "";
        if (close) closePaymentSheet();
    };
    grip?.addEventListener("pointerup", endDrag);
    grip?.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) { drag = null; panel.style.transition = ""; panel.style.transform = ""; } });
}

function safeCheckoutBotLink(value) {
    if (!safeCheckoutLink(value)) return false;
    const url = new URL(value);
    return url.hostname === "t.me" && /^\/[a-zA-Z0-9_]{5,32}$/.test(url.pathname) && !url.search && !url.hash;
}

function syncCheckoutDelivery(attempt, result, missingState = null) {
    const delivery = result.checkout_delivery || {};
    if (["sent", "failed", "unknown", "pending", "unavailable"].includes(delivery.state)) attempt.deliveryState = delivery.state;
    else if (missingState) attempt.deliveryState = missingState;
    if (safeCheckoutBotLink(delivery.bot_url)) { checkoutBotLinks.set(result.order_id,delivery.bot_url); checkoutBotLink = { orderId: result.order_id, url: delivery.bot_url }; }
}

function renderPaymentMethods() {
    const panel = document.getElementById("payment-methods");
    if (!panel) return;
    const rub = yookassaQuote(selectedMonths);
    const stars = paymentQuote(selectedMonths);
    const attempt = yookassaAttempts[selectedMonths];
    if (attempt?.orderId && checkoutBotLinks.has(attempt.orderId)) checkoutBotLink = { orderId:attempt.orderId,url:checkoutBotLinks.get(attempt.orderId) };
    const pending = Boolean(attempt?.orderId && !attempt.uiHidden && attempt.status !== "expired" && !paymentOrderTerminal(attempt));
    const rubAvailable = Boolean(yookassaCatalog.enabled && Number.isSafeInteger(rub?.amount_kopecks) && rub.amount_kopecks > 0 && rub.quote_token);
    const starsAvailable = Boolean(paymentCatalog.enabled && Number.isSafeInteger(stars?.amount) && stars.amount > 0);
    const currentRub = yookassaCatalog.tariffs?.find(item => Number(item.months) === Number(selectedMonths));
    const currentStars = paymentCatalog.tariffs?.find(item => Number(item.months) === Number(selectedMonths));
    const rubSaved = Boolean(attempt && currentRub && attempt.amountKopecks !== currentRub.amount_kopecks);
    const starsSaved = Boolean(paymentAttempts[selectedMonths] && currentStars && paymentAttempts[selectedMonths].amount !== currentStars.amount);
    document.getElementById("yookassa-saved-note").hidden = !rubSaved;
    document.getElementById("stars-saved-note").hidden = !starsSaved;
    document.getElementById("payment-snapshot-note").hidden = !rubSaved && !starsSaved;
    const monthTitle = ({ 1: "1 месяц", 3: "3 месяца", 6: "6 месяцев", 12: "12 месяцев" })[selectedMonths] || "";
    document.getElementById("payment-tariff-title").textContent = `SOL VPN — ${monthTitle}`;
    const tariff = tariffCatalog[selectedMonths];
    document.getElementById("payment-cost-label").textContent = Number(tariff?.discount_percent) > 0 ? "Стоимость со скидкой:" : "Стоимость:";
    document.getElementById("payment-cost").textContent = tariffPriceText(tariff);
    const rubButton = document.getElementById("pay-yookassa");
    rubButton.disabled = !rubAvailable || paymentInProgress || yookassaCheckBusy;
    rubButton.dataset.available = String(rubAvailable);
    document.getElementById("yookassa-price").textContent = rubAvailable ? rublePrice(rub.amount_kopecks) : "Сейчас недоступна";
    const starsButton = document.getElementById("pay-stars");
    starsButton.disabled = !starsAvailable || paymentInProgress || yookassaCheckBusy;
    starsButton.dataset.available = String(starsAvailable);
    document.getElementById("stars-price").textContent = starsAvailable ? `${stars.amount} ⭐` : "Сейчас недоступны";
    const checkButton = document.getElementById("check-yookassa");
    checkButton.hidden = !pending;
    checkButton.disabled = paymentInProgress || yookassaCheckBusy;
    const fallback = document.getElementById("checkout-open-link");
    fallback.hidden = !pending || !yookassaCatalog.enabled || attempt.deliveryState === "sent";
    fallback.disabled = paymentInProgress || yookassaCheckBusy || typeof tg?.openLink !== "function";
    const botButton = document.getElementById("checkout-open-bot");
    botButton.hidden = !pending || attempt.deliveryState !== "sent" || checkoutBotLink?.orderId !== attempt.orderId || !safeCheckoutBotLink(checkoutBotLink.url);
    botButton.disabled = paymentInProgress || yookassaCheckBusy;
    window.SolUI.text(document.getElementById("checkout-status"), checkoutStatusText
        || (pending ? "Ожидание подтверждения ЮKassa. Перед новой покупкой проверьте оплату." : ""));
    updatePaymentCta();
    renderPaymentCountdowns();
}

async function payWithYookassa() {
    if (!selectedMonths || paymentInProgress) return;
    const months = selectedMonths, owner = paymentOwner, operation = ++paymentOperation;
    let quote = yookassaQuote(months);
    if (!yookassaCatalog.enabled || !Number.isSafeInteger(quote?.amount_kopecks) || !quote?.quote_token) return showToast("ЮKassa сейчас недоступна", "error");
    paymentInProgress = true; setCheckoutStatus(months, "Подготавливаю счёт ЮKassa…"); renderPaymentMethods();
    try {
        if (!await preparePaymentAttempt("yookassa", months)) return;
        if (owner !== paymentOwner || selectedMonths !== months) return;
        quote = yookassaQuote(months);
        if (!yookassaCatalog.enabled || !quote?.quote_token) return;
        let attempt = yookassaAttempts[months];
        if (!attempt || paymentOrderTerminal(attempt)) {
            attempt = { months, amountKopecks: quote.amount_kopecks, discountPercent: Number(quote.discount_percent || 0), key: newPaymentKey(), orderId: null, status: "pending" };
            yookassaAttempts[months] = attempt; persistYookassaAttempts();
        }
        activatePaymentUi(attempt, "yookassa");
        const result = await apiFetch("/api/payments/yookassa/order", { method: "POST", headers: { "Idempotency-Key": attempt.key },
            body: JSON.stringify({ months, expected_currency: "RUB", expected_amount: attempt.amountKopecks, quote_token: quote.quote_token }) });
        if (owner !== paymentOwner) return;
        if (result.provider !== "yookassa" || result.currency !== "RUB" || result.amount_kopecks !== attempt.amountKopecks || !checkoutUuid.test(result.order_id)) throw new Error("Счёт не совпал с выбранной ценой");
        attempt.orderId = result.order_id;
        if (paymentUiOrder?.key === attempt.key) paymentUiOrder.orderId = result.order_id;
        syncPaymentExpiry(attempt, result); rememberPaymentOrder(attempt, "yookassa"); syncCheckoutDelivery(attempt, result, "unavailable"); persistYookassaAttempts();
        if (resolvePaymentUi(attempt, "yookassa")) { if (attempt.status === "paid") await loadBootstrap(false); }
        else if (!attempt.uiHidden) setCheckoutStatus(months, result.status === "review" ? "Платёж требует проверки. Напишите в /paysupport." : attempt.deliveryState === "sent"
            ? "Бот отправил кнопку «Перейти к оплате». После оплаты проверьте подтверждение." : "Доставка сообщения бота не подтверждена. Можно открыть страницу уже созданного заказа ниже.");
    } catch (error) {
        if (owner !== paymentOwner) return;
        if (error.status === 409 && !yookassaAttempts[months]?.orderId && /Стоимость|Повторный запрос/.test(error.message)) { delete yookassaAttempts[months]; persistYookassaAttempts(); }
        setCheckoutStatus(months, "Не удалось подтвердить создание счёта. Проверьте оплату или повторите тот же запрос.");
        await loadBootstrap(false); showToast(`Оплата: ${error.message}`, "error");
    } finally {
        if (owner === paymentOwner && operation === paymentOperation) { paymentInProgress = false; renderPaymentMethods(); }
    }
}

async function openExistingCheckout() {
    const months = selectedMonths;
    const attempt = yookassaAttempts[months];
    if (!attempt?.orderId || paymentInProgress || yookassaCheckBusy || typeof tg?.openLink !== "function") return;
    const owner = paymentOwner, operation = ++paymentOperation;
    const sheetRevision = paymentSheetState.open ? paymentSheetState.revision : null;
    paymentInProgress = true;
    renderPaymentMethods();
    try {
        const result = await apiFetch(`/api/payments/orders/${encodeURIComponent(attempt.orderId)}`);
        if (owner !== paymentOwner) return;
        await reconcileYookassaResult(months, result);
        if (sheetRevision !== null && (!paymentSheetState.open || paymentSheetState.revision !== sheetRevision)) return;
        if (["pending", "confirming"].includes(result.status) && safeCheckoutLink(result.confirmation_url)) tg.openLink(result.confirmation_url);
        else if (["pending", "confirming"].includes(result.status)) setCheckoutStatus(months, "Ссылка ещё проверяется. Повторите проверку позже.");
    } catch (_) {
        setCheckoutStatus(months, "Не удалось проверить страницу оплаты. Повторите позже или напишите в /paysupport.");
    } finally { if (owner === paymentOwner && operation === paymentOperation) { paymentInProgress = false; renderPaymentMethods(); } }
}

function openCheckoutBot() {
    const attempt = yookassaAttempts[selectedMonths];
    if (!attempt || checkoutBotLink?.orderId !== attempt.orderId || !safeCheckoutBotLink(checkoutBotLink.url)) return;
    if (typeof tg?.openTelegramLink === "function") tg.openTelegramLink(checkoutBotLink.url);
    else tg?.openLink?.(checkoutBotLink.url);
}

async function reconcileYookassaResult(months, result) {
    const attempt = yookassaAttempts[months];
    if (!attempt || result.provider !== "yookassa" || result.currency !== "RUB" || result.amount_kopecks !== attempt.amountKopecks || result.order_id !== attempt.orderId)
        throw new Error("Статус платежа требует сверки");
    syncPaymentExpiry(attempt, result); rememberPaymentOrder(attempt, "yookassa"); syncCheckoutDelivery(attempt, result);
    if (resolvePaymentUi(attempt, "yookassa")) { if (attempt.status === "paid") await loadBootstrap(false); }
    else setCheckoutStatus(months, result.status === "review" ? "Платёж требует проверки в /paysupport." : "Ожидание подтверждения оплаты.");
    persistYookassaAttempts(); renderPaymentMethods();
}

async function checkYookassaPayment(quiet = false) {
    const months = selectedMonths;
    const attempt = yookassaAttempts[months];
    if (!attempt?.orderId || paymentInProgress || yookassaCheckBusy || (quiet && Date.now() - lastYookassaCheck < 2000)) return;
    yookassaCheckBusy = true;
    lastYookassaCheck = Date.now();
    setCheckoutStatus(months, "Проверяю оплату на сервере…");
    renderPaymentMethods();
    try {
        const result = await apiFetch(`/api/payments/orders/${encodeURIComponent(attempt.orderId)}`);
        await reconcileYookassaResult(months, result);
    } catch (_) {
        setCheckoutStatus(months, "Статус временно недоступен. Повторите проверку или напишите в /paysupport.");
    } finally {
        yookassaCheckBusy = false;
        renderPaymentMethods();
    }
}

function tariffPriceText(tariff) {
    if (!tariff) return "—";
    const kopecks = Number(tariff.price_kopecks);
    return rublePrice(kopecks);
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
        const cardEl = document.getElementById(`tariff-${months}m`);
        const tagEl = document.getElementById(`discount-tag-${months}m`);
        if (!tariff || !priceEl || !cardEl) return;

        const discount = Number(tariff.discount_percent || 0);
        const shown = cardEl.classList.contains("show-card");
        const selected = Number(selectedMonths) === months;
        const price = tariffPriceText(tariff);
        priceEl.innerText = price;

        cardEl.className = `${baseClasses[months]}${discount > 0 ? ` discounted-neon-${months}m` : ""}${shown ? " show-card" : ""}${selected ? " selected-tariff" : ""}`;
        if (tagEl) {
            if (discount > 0) {
                window.SolUI.text(tagEl, `-${discount}%`, "tag");
                tagEl.style.color = neons[months];
                tagEl.style.textShadow = `0 0 8px ${neons[months]}`;
                tagEl.className = "tariff-discount-tag show-tag";
            } else {
                tagEl.innerText = "";
                tagEl.className = "tariff-discount-tag";
            }
        }
    });
}

// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ
// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ

// ==========================================
// 👑 7. АДМИН-ПАНЕЛЬ
// ==========================================
function adminIcon(name) {
    return window.SolUI.icon(name, "admin-neon-icon");
}

function initAdminIcons() {
    document.querySelectorAll('[data-admin-icon]').forEach(slot => {
        if (!slot.firstElementChild) slot.innerHTML = adminIcon(slot.dataset.adminIcon);
    });
}

function showAdminToast(message, type = "info") {
    showToast(message, type);
    const toast = document.querySelector('#toast-container .toast:last-child');
    if (!toast) return;
    toast.classList.add("admin-toast");
    const icon = document.createElement("span");
    icon.innerHTML = adminIcon(type === "error" ? "warning" : "check");
    const text = document.createElement("span");
    window.SolUI.text(text, message);
    toast.replaceChildren(icon, text);
}

function initAdminPanel() {
    initAdminIcons();
    const nav = document.getElementById("app-bottom-nav");
    const adminBtn = document.getElementById("btn-nav-4");
    if (!isAdmin) {
        adminUsersState.controller?.abort();
        adminUsersState.revision++;
        adminUsersState.initialized = false;
        adminUsersState.loading = false;
        adminUsersState.hasMore = false;
        adminUsersState.legacyItems = null;
        adminUsersState.capabilities = {};
        allUsersList = [];
        approvedUsers = [];
        renderAllUsersList();
        renderApprovedUsersDrum();
        nav?.classList.remove("nav-5-items");
        adminBtn?.classList.add("hidden");
        return;
    }

    nav?.classList.add("nav-5-items");
    adminBtn?.classList.remove("hidden");

    if (!adminPanelInitialized) {
        initCalcControls("days");
        initCalcControls("discount");
        initCalcControls("limit");
        adminPanelInitialized = true;
    }

    renderApprovedUsersDrum();
    renderAllUsersList();
    updateCalcDisplays();
}

function toggleAdminPromoType(type) {
    adminPromoTypes[type] = !adminPromoTypes[type];
    
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
    const btn = document.getElementById(`p-tariff-${m}m`);
    if (btn) {
        if (adminPickedTariffs[m]) btn.classList.add("selected");
        else btn.classList.remove("selected");
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function setAdminLimitType(type) {
    adminLimitType = type;
    const btnDays = document.getElementById("btn-limit-days");
    const btnCount = document.getElementById("btn-limit-count");
    const limitTitle = document.getElementById("limit-calc-title");

    if (type === 'lifetime_days') {
        if (btnDays) btnDays.className = "admin-type-btn sub-mode active-green";
        if (btnCount) btnCount.className = "admin-type-btn sub-mode";
        if (limitTitle) limitTitle.innerText = "ВЫБЕРИТЕ СРОК ЖИЗНИ (ДНИ)";
    } else {
        if (btnDays) btnDays.className = "admin-type-btn sub-mode";
        if (btnCount) btnCount.className = "admin-type-btn sub-mode active-green";
        if (limitTitle) limitTitle.innerText = "ВЫБЕРИТЕ КОЛИЧЕСТВО АКТИВАЦИЙ";
    }
    updateCalcDisplays();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function updateCalcDisplays() {
    let maxDays = 365;
    calcValues.days = Math.max(1, Math.min(maxDays, calcValues.days));
    renderSingleSpinner('days', calcValues.days, maxDays);

    let maxDiscount = 95;
    calcValues.discount = Math.max(1, Math.min(maxDiscount, calcValues.discount));
    renderSingleSpinner('discount', calcValues.discount, maxDiscount);

    let maxLimit = (adminLimitType === 'lifetime_days') ? 31 : 1000;
    calcValues.limit = Math.max(1, Math.min(maxLimit, calcValues.limit));
    renderSingleSpinner('limit', calcValues.limit, maxLimit);
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

async function createAdminPromo() {
    const input = document.getElementById("admin-promo-name");
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (!code) return showAdminToast("Введите название промокода", "error");
    if (!adminPromoTypes.days && !adminPromoTypes.discount) return showAdminToast("Выберите дни и/или скидку", "error");

    const tariffs = Object.entries(adminPickedTariffs)
        .filter(([, picked]) => picked)
        .map(([months]) => Number(months));

    try {
        const result = await apiFetch("/api/admin/promocodes", {
            method: "POST",
            body: JSON.stringify({
                code,
                has_days: adminPromoTypes.days,
                days_val: calcValues.days,
                has_discount: adminPromoTypes.discount,
                discount_val: calcValues.discount,
                tariffs,
                limit_type: adminLimitType,
                limit_val: calcValues.limit
            })
        });
        input.value = "";
        showAdminToast(`Промокод ${result.code} сохранён`);
        tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
        showAdminToast(error.message, "error");
    }
}

function renderApprovedUsersDrum() {
    const drum = document.getElementById("approved-users-drum");
    if (!drum) return;
    const scrollTop = drum.parentElement.scrollTop;
    const merged = new Map();
    const candidates = vipDirectory.complete ? [...vipDirectory.users.values()] : [...allUsersList,...approvedUsers,...vipDirectory.users.values()];
    for (const user of candidates) {
        const id = Number(user.user_id), latest = { ...user, ...adminVipValues.get(id) };
        if (Number.isSafeInteger(id)) merged.set(id,latest);
    }
    const active = [...merged.values()].filter(user => user.isVip);
    if (!active.length) {
        drum.innerHTML = `<div class="empty-list-msg">${vipDirectory.loading ? "Загружаем VIP…" : "Действующих VIP пока нет"}</div>`;
        return;
    }
    drum.innerHTML = active.map(user => `
        <div class="drum-item">
            <span>${escapeHtml(user.username || user.name || String(user.user_id))}<small>${user.vip_admin_granted ? "Назначен администратором" : "Действующее защищённое VIP-право"}</small></span>
            <button class="remove-user-btn" type="button" data-action="remove-vip-user" data-user-id="${Number(user.user_id)}" aria-label="Снять назначенный VIP у пользователя ${Number(user.user_id)}" ${adminVipPending.has(Number(user.user_id)) || !adminVipSupported(user) || !user.vip_admin_granted ? 'disabled title="Защищённое VIP-право нельзя снять этой кнопкой"' : ""}>${adminIcon("close")}</button>
        </div>
    `).join("");
    drum.parentElement.scrollTop = scrollTop;
}

async function loadVipDirectory(force = false) {
    if (!isAdmin || (vipDirectory.loading && !force)) return;
    vipDirectory.controller?.abort();
    const controller = new AbortController(), revision = ++vipDirectory.revision, owner = paymentOwner;
    vipDirectory.controller = controller; vipDirectory.loading = true; vipDirectory.complete = false;
    const status = document.getElementById("admin-vip-list-status"), found = new Map();
    const versions = new Map(adminVipVersions);
    if (status) status.textContent = "Загружаем всех действующих VIP…";
    let offset = 0;
    try {
        for (;;) {
            const page = await apiFetch(`/api/admin/users?limit=100&offset=${offset}&q=`, {signal:controller.signal});
            if (!isAdmin || paymentOwner !== owner || revision !== vipDirectory.revision) return;
            if (!Array.isArray(page.users)) throw new Error("Не удалось получить полный список VIP.");
            for (const user of page.users) {
                const id = Number(user.user_id);
                const changed = adminVipPending.has(id) || (adminVipVersions.get(id)||0) !== (versions.get(id)||0);
                const current = changed ? {...user,...adminVipValues.get(id)} : user;
                if (adminVipSupported(current)) {
                    adminVipValues.set(id,Object.fromEntries(["isVip","hasSub","vip_admin_granted","vip_protected"].map(key=>[key,current[key]])));
                    allUsersList = allUsersList.map(row=>Number(row.user_id)===id?{...row,...current}:row);
                    updateAdminVipCard(id);
                }
                if (Number.isSafeInteger(id) && id>0 && current.isVip) found.set(id,current);
            }
            const pagination = page.pagination;
            if (!pagination || !pagination.has_more) {
                vipDirectory.complete = Boolean(pagination) || (typeof page.has_more === "boolean" && !page.has_more);
                break;
            }
            const next = Number(pagination.next_offset);
            if (!Number.isSafeInteger(next) || next <= offset || !page.users.length) throw new Error("Постраничная загрузка VIP требует повторной проверки.");
            offset = next;
        }
        for (const [id,value] of adminVipValues) if (adminVipPending.has(id) || (adminVipVersions.get(id)||0)!==(versions.get(id)||0)) {
            const current = {...found.get(id),...vipDirectory.users.get(id),...allUsersList.find(row=>Number(row.user_id)===id),...value,user_id:id};
            if (current.isVip) found.set(id,current); else found.delete(id);
        }
        vipDirectory.users = found;
        if(status) status.textContent = vipDirectory.complete ? `Действующих VIP: ${found.size}` : "Полнота VIP-списка не подтверждена старым API.";
    } catch(error) {
        if(error.name!=="AbortError" && revision===vipDirectory.revision && status) window.SolUI.text(status, `${error.message} Нажмите «Обновить VIP-список».`);
    } finally {
        if(revision===vipDirectory.revision) { vipDirectory.loading=false; renderApprovedUsersDrum(); }
    }
}

async function addApprovedUser() {
    if (!isAdmin) return;
    const input = document.getElementById("admin-approved-input");
    const username = input?.value.trim();
    if (!username) return;
    try {
        const result = await apiFetch("/api/admin/vip", {
            method: "POST",
            body: JSON.stringify({ username })
        });
        applyAdminVipResult(result);
        if (!adminVipSupported(result.target_user)) await loadAdminUsers(true);
        input.value = "";
        showAdminToast("Пользователь добавлен в VIP");
    } catch (error) {
        showAdminToast(error.message, "error");
    }
}

async function removeApprovedUser(userId) {
    userId = Number(userId);
    if (!isAdmin || adminVipPending.has(userId)) return;
    const assigned = approvedUsers.find(user => Number(user.user_id) === userId) || vipDirectory.users.get(userId);
    if (!adminVipSupported(assigned) || !assigned.vip_admin_granted) return adminActionStatus("Для безопасного снятия назначенного VIP требуется обновление backend.");
    adminVipPending.add(userId);
    adminVipVersions.set(userId, (adminVipVersions.get(userId) || 0) + 1);
    updateAdminVipCard(userId);
    try {
        const result = await apiFetch("/api/admin/vip", {
            method: "DELETE",
            body: JSON.stringify({ user_id: Number(userId) })
        });
        if (!isAdmin) return;
        applyAdminVipResult(result);
        if (!adminVipSupported(result.target_user)) await loadAdminUsers(true);
    } catch (error) {
        showAdminToast(error.message, "error");
    } finally {
        adminVipPending.delete(userId);
        adminVipVersions.set(userId, (adminVipVersions.get(userId) || 0) + 1);
        updateAdminVipCard(userId);
        renderApprovedUsersDrum();
    }
}

function adminVipSupported(user) {
    return typeof user?.vip_admin_granted === "boolean" && typeof user?.vip_protected === "boolean";
}

function adminVipSummary(user) {
    return user.isVip ? `да${user.vip_admin_granted ? " · назначен администратором" : ""}` : "нет";
}

function updateAdminVipCard(userId) {
    const user = allUsersList.find(item => Number(item.user_id) === userId);
    const card = document.querySelector(`#all-users-container .user-row-card[data-user-id="${userId}"]`);
    if (!user || !card || !isAdmin) return;
    const button = card.querySelector('[data-action="toggle-admin-vip"]');
    if (!button) return;
    const pending = adminVipPending.has(userId);
    button.disabled = pending || !adminVipSupported(user);
    if (adminVipSupported(user)) button.removeAttribute("title");
    button.setAttribute("aria-busy", String(pending));
    button.setAttribute("aria-pressed", String(Boolean(user.isVip)));
    button.setAttribute("aria-label", `${user.vip_admin_granted ? "Снять назначенный" : "Назначить"} VIP пользователю ${userId}`);
    button.classList.toggle("admin-vip-active", Boolean(user.isVip));
    const summary = card.querySelector('[data-admin-vip-summary]');
    if (summary) summary.textContent = `VIP: ${adminVipSummary(user)}`;
    const note = card.querySelector('.admin-vip-source-note');
    if (note) note.hidden = !user.vip_protected;
    const status = card.querySelector('.user-row-status');
    if (status) {
        status.textContent = user.hasSub ? "ПОДПИСКА АКТИВНА" : "НЕТ ПОДПИСКИ";
        status.className = `user-row-status ${user.hasSub ? "sub-on" : "sub-off"}`;
    }
    card.classList.toggle("active-sub", Boolean(user.hasSub));
}

function applyAdminVipResult(result) {
    if (!isAdmin) return;
    if (Array.isArray(result.admin?.approved_users)) approvedUsers = result.admin.approved_users;
    const target = result.target_user;
    if (target && Number.isSafeInteger(Number(target.user_id)) && adminVipSupported(target)) {
        const id = Number(target.user_id);
        if (target.isVip) vipDirectory.users.set(id,target); else vipDirectory.users.delete(id);
        adminVipVersions.set(id, (adminVipVersions.get(id) || 0) + 1);
        adminVipValues.set(id, Object.fromEntries(["isVip", "hasSub", "vip_admin_granted", "vip_protected"].map(key => [key, target[key]])));
        allUsersList = allUsersList.map(user => Number(user.user_id) === id ? { ...user, ...target } : user);
        if (adminUsersState.legacyItems) adminUsersState.legacyItems = adminUsersState.legacyItems.map(user => Number(user.user_id) === id ? { ...user, ...target } : user);
        updateAdminVipCard(id);
    }
    renderApprovedUsersDrum();
}

async function toggleAdminVip(userId) {
    userId = Number(userId);
    if (!isAdmin || !Number.isSafeInteger(userId) || userId <= 0 || userId >= 2**52 || adminVipPending.has(userId)) return;
    const user = allUsersList.find(item => Number(item.user_id) === userId);
    if (!adminVipSupported(user)) return adminActionStatus("Для управления VIP по ID требуется обновление backend.");
    const enabled = !user.vip_admin_granted;
    adminVipValues.set(userId, Object.fromEntries(["isVip", "hasSub", "vip_admin_granted", "vip_protected"].map(key => [key, user[key]])));
    adminVipPending.add(userId);
    adminVipVersions.set(userId, (adminVipVersions.get(userId) || 0) + 1);
    updateAdminVipCard(userId);
    try {
        const result = await apiFetch("/api/admin/vip", { method: "POST", body: JSON.stringify({ user_id: userId, enabled }) });
        if (!isAdmin) return;
        if (Number(result.target_user?.user_id) !== userId || !adminVipSupported(result.target_user)) throw new Error("Состояние VIP не подтверждено. Обновите список пользователей.");
        applyAdminVipResult(result);
        const protectedAccess = !enabled && result.target_user.vip_protected;
        showAdminToast(enabled ? "VIP назначен" : protectedAccess ? "Назначенный VIP снят. Другое право VIP сохранено." : "Назначенный VIP снят");
        if (result.sync_pending) adminActionStatus("VIP сохранён. Синхронизация VPN ещё выполняется.");
    } catch (error) {
        showAdminToast(error.message, "error");
    } finally {
        adminVipPending.delete(userId);
        adminVipVersions.set(userId, (adminVipVersions.get(userId) || 0) + 1);
        updateAdminVipCard(userId);
        renderApprovedUsersDrum();
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
    }[ch]));
}

function filterAllUsersList() {
    clearTimeout(adminUsersState.timer);
    adminUsersState.revision++;
    adminUsersState.controller?.abort();
    adminUsersState.timer = setTimeout(() => loadAdminUsers(true), 250);
}

function adminUserMatches(user, query) {
    return [user.name, user.first_name, user.username, user.user_id]
        .some(value => String(value ?? "").toLocaleLowerCase("ru").includes(query.replace(/^@/, "")));
}

async function loadAdminUsers(reset = false) {
    if (!isAdmin || (!reset && adminUsersState.loading)) return;
    clearTimeout(adminUsersState.timer);
    const query = (document.getElementById("admin-search-user")?.value || "").trim().toLocaleLowerCase("ru");
    const revision = ++adminUsersState.revision;
    const vipVersions = new Map(adminVipVersions);
    adminUsersState.controller?.abort();
    adminUsersState.controller = new AbortController();
    if (reset) {
        allUsersList = [];
        adminUsersState.offset = 0;
        adminUsersState.total = null;
        adminUsersState.hasMore = false;
        adminUsersState.capabilities = {};
        adminUsersState.legacyItems = null;
        adminUsersState.query = query;
    }
    adminUsersState.loading = true;
    adminUsersState.error = "";
    renderAllUsersList();
    try {
        let rows, pagination;
        if (adminUsersState.legacyItems) {
            rows = adminUsersState.legacyItems.slice(adminUsersState.offset, adminUsersState.offset + 50);
            pagination = { total: adminUsersState.legacyItems.length, next_offset: adminUsersState.offset + rows.length };
        } else {
            const params = new URLSearchParams({ limit: "50", offset: String(adminUsersState.offset), q: query });
            const result = await apiFetch(`/api/admin/users?${params}`, { signal: adminUsersState.controller.signal });
            if (revision !== adminUsersState.revision || !isAdmin) return;
            rows = Array.isArray(result.users) ? result.users : [];
            pagination = result.pagination || (Number.isSafeInteger(result.total) ? result : null);
            adminUsersState.capabilities = result.capabilities || {};
            if (!pagination) {
                // Older APIs ignore query parameters. Never call their snapshot a full list.
                adminUsersState.legacyItems = rows.filter(user => adminUserMatches(user, query));
                rows = adminUsersState.legacyItems.slice(0, 50);
                pagination = { total: adminUsersState.legacyItems.length, next_offset: rows.length };
            }
        }
        if (revision !== adminUsersState.revision || !isAdmin) return;
        const users = new Map(allUsersList.map(user => [String(user.user_id), user]));
        rows.forEach(user => {
            const id = Number(user.user_id);
            const current = adminVipValues.get(id) || users.get(String(user.user_id));
            if (current && (vipVersions.get(id) || 0) !== (adminVipVersions.get(id) || 0)) {
                const vip = Object.fromEntries(["isVip", "hasSub", "vip_admin_granted", "vip_protected"].map(key => [key, current[key]]));
                users.set(String(user.user_id), { ...user, ...vip });
            } else users.set(String(user.user_id), user);
        });
        allUsersList = Array.from(users.values());
        adminUsersState.total = Number.isSafeInteger(pagination.total) ? pagination.total : null;
        const nextOffset = Number(pagination.next_offset ?? adminUsersState.offset + rows.length);
        adminUsersState.hasMore = nextOffset > adminUsersState.offset && (
            typeof pagination.has_more === "boolean" ? pagination.has_more : nextOffset < adminUsersState.total
        );
        adminUsersState.offset = nextOffset;
        adminUsersState.initialized = true;
    } catch (error) {
        if (revision === adminUsersState.revision && error.name !== "AbortError") adminUsersState.error = error.message;
    } finally {
        if (revision === adminUsersState.revision) {
            adminUsersState.loading = false;
            renderAllUsersList();
        }
    }
}

function renderAllUsersList() {
    const container = document.getElementById("all-users-container");
    if (!container) return;
    const scrollTop = container.scrollTop;
    const openDrawers = new Set(Array.from(container.querySelectorAll(".open-gift"), card => card.dataset.userId));
    const drafts = new Map(Array.from(container.querySelectorAll(".user-row-card"), card => [card.dataset.userId, {
        text: card.querySelector("textarea")?.value || "",
        open: !card.querySelector(".admin-user-composer")?.hidden
    }]));
    container.innerHTML = (isAdmin ? allUsersList : []).map(u => {
        const statusTxt = u.hasSub ? "ПОДПИСКА АКТИВНА" : "НЕТ ПОДПИСКИ";
        const statusColor = u.hasSub ? "sub-on" : "sub-off";
        const subscriptionEnd = u.subscription_end || "—";
        const registered = u.registration_date || "—";
        const vpnKey = u.vpn_key || "ещё не выдан";
        const referrer = u.referrer_id ?? "—";
        return `
            <div class="user-row-card ${u.hasSub ? "active-sub" : ""} ${openDrawers.has(String(u.user_id)) ? "open-gift" : ""}" data-user-id="${Number(u.user_id)}" data-action="toggle-gift-drawer">
                <div class="user-row-main">
                    <div class="user-row-name">${escapeHtml(u.name || u.first_name || "Без имени")}${u.username ? ` <span>@${escapeHtml(String(u.username).replace(/^@/, ""))}</span>` : ""}</div>
                    <div class="user-row-status ${statusColor}">${statusTxt}</div>
                </div>
                <div class="user-profile-actions">
                    <button type="button" class="user-profile-btn" data-action="open-admin-profile" data-user-id="${Number(u.user_id)}">${adminIcon("profile")}<span>Открыть профиль</span></button>
                    <button type="button" class="user-profile-btn" data-action="contact-admin-user" data-user-id="${Number(u.user_id)}" aria-expanded="false">${adminIcon("message")}<span>Связаться через бота</span></button>
                    <button type="button" class="admin-vip-toggle ${u.isVip ? "admin-vip-active" : ""}" data-action="toggle-admin-vip" data-user-id="${Number(u.user_id)}" aria-pressed="${Boolean(u.isVip)}" aria-busy="${adminVipPending.has(Number(u.user_id))}" aria-label="${u.vip_admin_granted ? "Снять назначенный" : "Назначить"} VIP пользователю ${Number(u.user_id)}" aria-describedby="admin-vip-note-${Number(u.user_id)}" ${adminVipPending.has(Number(u.user_id)) || !adminVipSupported(u) ? "disabled" : ""} ${!adminVipSupported(u) ? 'title="Обновите backend для управления VIP по ID"' : ""}>${adminIcon("crown")}<span>VIP</span></button>
                </div>
                <p class="admin-vip-source-note" id="admin-vip-note-${Number(u.user_id)}" ${u.vip_protected ? "" : "hidden"}>Другое право VIP сохранится при снятии назначения администратора.</p>
                <div class="admin-user-composer" hidden>
                    <label for="admin-message-${Number(u.user_id)}">Сообщение от поддержки SOL VPN</label>
                    <textarea id="admin-message-${Number(u.user_id)}" maxlength="3500" rows="3" placeholder="Текст сообщения"></textarea>
                    <p>Отправка возможна, если пользователь разрешил сообщения бота.</p>
                    <button type="button" class="user-profile-btn" data-action="send-admin-message" data-user-id="${Number(u.user_id)}">${adminIcon("send")}<span>Отправить сообщение</span></button>
                </div>
                <div class="user-row-meta">
                    <span>ID: ${Number(u.user_id)}</span>
                    <span>Регистрация: ${escapeHtml(registered)}</span>
                    <span>Окончание: ${escapeHtml(subscriptionEnd)}</span>
                    <span data-admin-vip-summary>VIP: ${adminVipSummary(u)}</span>
                    <span>VPN UUID: ${escapeHtml(vpnKey)}</span>
                    <span>Реферер: ${escapeHtml(referrer)}</span>
                </div>
                <div class="user-gift-drawer">
                    <button class="gift-btn" type="button" data-action="gift-promo" data-user-id="${Number(u.user_id)}" data-username="${escapeHtml(u.username)}">${adminIcon("gift")}<span>ПОДАРИТЬ ПРОМОКОД</span></button>
                </div>
            </div>`;
    }).join("");
    container.querySelectorAll(".user-row-card").forEach(card => {
        const draft = drafts.get(card.dataset.userId);
        if (!draft) return;
        card.querySelector("textarea").value = draft.text;
        card.querySelector(".admin-user-composer").hidden = !draft.open;
        card.querySelector('[data-action="contact-admin-user"]').setAttribute("aria-expanded", String(draft.open));
    });
    if (!allUsersList.length && isAdmin) container.innerHTML = `<div class="empty-list-msg">${adminUsersState.loading ? "Загрузка пользователей…" : "Пользователи не найдены"}</div>`;
    container.scrollTop = scrollTop;
    const status = document.getElementById("admin-users-status");
    if (status) window.SolUI.text(status, !isAdmin ? "" : adminUsersState.error || (adminUsersState.loading ? "Загрузка…" :
        `Показано ${allUsersList.length}${adminUsersState.total === null ? "" : ` из ${adminUsersState.total}`}${adminUsersState.legacyItems ? ". API без пагинации: полнота списка не подтверждена." : ""}`));
    const more = document.getElementById("admin-users-more");
    if (more) {
        more.hidden = !isAdmin || (!adminUsersState.hasMore && !adminUsersState.error);
        more.disabled = adminUsersState.loading;
        more.innerHTML = `${adminIcon(adminUsersState.error ? "refresh" : "users")}<span>${adminUsersState.error ? "Повторить загрузку" : "Показать ещё"}</span>`;
    }
}

function adminActionStatus(text) {
    const status = document.getElementById("admin-action-status");
    if (status) {
        status.replaceChildren();
        if (text) {
            const icon = document.createElement("span");
            icon.innerHTML = adminIcon("message");
            const label = document.createElement("span");
            window.SolUI.text(label, text);
            status.append(icon, label);
        }
        status.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
}

async function openAdminProfile(userId) {
    if (!isAdmin) return;
    const user = allUsersList.find(item => Number(item.user_id) === userId);
    if (!user || !Number.isSafeInteger(userId) || userId <= 0 || userId >= 2**52) return adminActionStatus("Некорректный Telegram ID.");
    const username = String(user.username || "").replace(/^@/, "");
    try {
        if (/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(username)) {
            if (!tg?.openTelegramLink) throw new Error("Откройте Mini App внутри Telegram для перехода к профилю.");
            tg.openTelegramLink(`https://t.me/${encodeURIComponent(username)}?profile`);
            adminActionStatus("Переход запрошен. Telegram не подтверждает открытие профиля. Если переход недоступен, используйте «Связаться через бота».");
        } else {
            if (!adminUsersState.capabilities.profile_link) throw new Error("Кнопка профиля без username сейчас недоступна. Для неё нужна ссылка в личном чате SOL VPN. Если переход не удаётся, используйте «Связаться через бота».");
            const result = await apiFetch(`/api/admin/users/${userId}/profile-link`, { method: "POST" });
            adminActionStatus(result.message || "Кнопка профиля подготовлена в личном чате SOL VPN. Открытие профиля зависит от настроек Telegram.");
            if (result.bot_url && /^https:\/\/t\.me\/[a-zA-Z0-9_]+$/.test(result.bot_url)) tg?.openTelegramLink?.(result.bot_url);
        }
    } catch (error) { adminActionStatus(error.message); }
}

function toggleAdminContact(button) {
    if (!isAdmin) return;
    const composer = button.closest(".user-row-card").querySelector(".admin-user-composer");
    composer.hidden = !composer.hidden;
    button.setAttribute("aria-expanded", String(!composer.hidden));
    if (!composer.hidden) composer.querySelector("textarea").focus();
}

async function sendAdminMessage(button) {
    if (!isAdmin || button.disabled) return;
    const card = button.closest(".user-row-card");
    const input = card.querySelector("textarea");
    const text = input.value.trim();
    if (!text) return adminActionStatus("Введите сообщение.");
    if (!adminUsersState.capabilities.contact_message) return adminActionStatus("Отправка сообщений через SOL VPN сейчас недоступна. Попробуйте позже.");
    button.disabled = true;
    try {
        const result = await apiFetch(`/api/admin/users/${Number(card.dataset.userId)}/message`, {
            method: "POST", body: JSON.stringify({ text })
        });
        input.value = "";
        adminActionStatus(result.message || "Telegram принял сообщение. Прочтение не подтверждено.");
    } catch (error) { adminActionStatus(error.message); }
    finally { button.disabled = false; }
}

function toggleGiftDrawer(cardEl) {
    cardEl.classList.toggle("open-gift");
}

async function giftPromoToUser(userId, username) {
    const promoCode = prompt(`Введите промокод для ${username || userId}:`);
    if (!promoCode) return;
    try {
        await apiFetch("/api/admin/gift-promo", {
            method: "POST",
            body: JSON.stringify({ user_id: Number(userId), code: promoCode.trim().toUpperCase() })
        });
        showAdminToast(`Промокод отправлен ${username || userId}`);
    } catch (error) {
        showAdminToast(error.message, "error");
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
    1: "Перейдите во вкладку «Туннель», нажмите фиолетовую кнопку и дождитесь подключения. Затем скопируйте ваш VLESS-ключ и вставьте его в приложение-клиент, например v2RayTun, HAPP или другое совместимое приложение.",
    2: "После подключения во вкладке «Туннель» нажмите кнопку «Скопировать». Полученный ключ вставьте в приложение-клиент.",
    3: "Наши серверы имеют пропускную способность до 1 Гбит/с. В будущем планируется увеличение скорости. Фактическая скорость подключения зависит от сети и устройства.",
    4: "К одному ключу можно подключить до 10 устройств. Каждое дополнительное устройство оплачивается отдельно. Стоимость одинакова для всех тарифов.",
    5: "Перейдите в раздел «Игры», ловите кометы и получайте увеличение реферального процента и другие бонусы.",
    6: "Охота на кометы доступна только пользователям с активной подпиской SOL VPN. Приобрести подписку можно во вкладке «Кабинет».",
    7: "Дождитесь появления кометы в зоне действия радара. Нажмите мышкой или кликните пальцем по комете, чтобы поймать её.",
    8: "Да! VLESS-ключ совместим с компьютерами, смартфонами, роутерами и другими устройствами, поддерживающими соответствующий протокол и настройки подключения.",
    9: "Мы подобрали сервис для покупки Telegram Stars. Перед покупкой сравните условия."
};

// Tune the local replacement and the bounded left-to-right wave here.
const FAQ_ANIMATION = Object.freeze({
    swapDurationMs: 280,
    staggerMs: 12,
    maxWaveMs: 1200,
    overlapMs: 40,
    heightDurationMs: 420,
    blurPx: 1.4,
    actionRiseMs: 400,
    actionStaggerMs: 120,
    actionLeadMs: 300,
    actionOffsetPx: 18
});

const faqState = {
    initialized: false,
    selectedId: null,
    targetText: defaultInfoText,
    revision: 0,
    animations: [],
    actionAnimations: [],
    targetActions: false,
    heightAnimation: null,
    heightTarget: 0,
    currentLayer: null,
    motionQuery: null,
    resizeObserver: null
};

const faqSegmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ru", { granularity: "grapheme" })
    : null;

function updateFaqHeight() {
    const viewport = document.getElementById("terminal-answer-viewport");
    const content = document.getElementById("terminal-text");
    if (!viewport || !content) return;
    const actions = document.getElementById("faq-answer-actions");
    const height = Math.ceil((faqState.currentLayer || content).getBoundingClientRect().height + (actions?.hidden ? 0 : actions?.getBoundingClientRect().height || 0));
    if (height <= 0) return;
    if (faqState.heightAnimation) {
        if (height !== faqState.heightTarget) {
            const animation = faqState.heightAnimation;
            const remainingDelay = Math.max(0, animation.effect.getTiming().delay - (animation.currentTime || 0));
            animateFaqHeight(height, remainingDelay);
        }
    } else {
        faqState.heightTarget = height;
        viewport.style.height = `${height}px`;
    }
}

function createFaqLayer(text, hidden = false) {
    const layer = document.createElement("div");
    layer.className = "faq-current-layer";
    const fragment = document.createDocumentFragment();
    let position = 0;

    // Word wrappers keep natural line breaks; actual spaces stay as text nodes.
    for (const token of text.split(/(\s+)/u)) {
        if (!token) continue;
        if (/^\s+$/u.test(token)) {
            fragment.appendChild(document.createTextNode(token));
            position += Array.from(token).length;
            continue;
        }
        const word = document.createElement("span");
        word.className = "faq-word";
        const characters = faqSegmenter
            ? Array.from(faqSegmenter.segment(token), item => item.segment)
            : Array.from(token);
        for (const character of characters) {
            const glyph = document.createElement("span");
            glyph.className = "faq-glyph";
            glyph.textContent = character;
            glyph.dataset.faqPosition = position++;
            if (hidden) {
                glyph.style.opacity = "0";
                glyph.style.transform = "scale(0.7)";
                glyph.style.filter = `blur(${FAQ_ANIMATION.blurPx}px)`;
            }
            word.appendChild(glyph);
        }
        fragment.appendChild(word);
    }
    layer.appendChild(fragment);
    return layer;
}

function renderFaqCharacters(text) {
    const layer = createFaqLayer(text);
    document.getElementById("terminal-text").replaceChildren(layer);
    faqState.currentLayer = layer;
    updateFaqHeight();
}

function cancelFaqAnimations() {
    // Preserve the current frame before cancelling so rapid taps never flash.
    const frames = faqState.animations.map(animation => {
        const glyph = animation.effect.target;
        const style = getComputedStyle(glyph);
        return { animation, glyph, opacity: style.opacity, transform: style.transform, filter: style.filter };
    });
    for (const { animation, glyph, opacity, transform, filter } of frames) {
        glyph.style.opacity = opacity;
        glyph.style.transform = transform;
        glyph.style.filter = filter;
        animation.cancel();
    }
    faqState.animations = [];
    for (const animation of faqState.actionAnimations) {
        const row = animation.effect.target;
        const style = getComputedStyle(row);
        Object.assign(row.style, { opacity: style.opacity, transform: style.transform, filter: style.filter });
        animation.cancel();
    }
    faqState.actionAnimations = [];
    const viewport = document.getElementById("terminal-answer-viewport");
    if (faqState.heightAnimation) {
        const height = viewport.getBoundingClientRect().height;
        faqState.heightAnimation.cancel();
        faqState.heightAnimation = null;
        viewport.style.height = `${height}px`;
    }
}

function snapshotFaqView() {
    const container = document.getElementById("terminal-text");
    const origin = container.getBoundingClientRect();
    const frames = Array.from(container.querySelectorAll(".faq-glyph"), glyph => {
        const style = getComputedStyle(glyph);
        return { glyph, opacity: style.opacity, transform: style.transform, filter: style.filter };
    }).filter(frame => Number(frame.opacity) > 0.01);
    // Measure untransformed boxes in one batch, then preserve each visible glyph
    // at exactly its current position. Repeated interruptions still use only two layers.
    frames.forEach(({ glyph }) => { glyph.style.transform = "none"; });
    const boxes = frames.map(({ glyph }) => glyph.getBoundingClientRect());
    const outgoing = document.createElement("div");
    outgoing.className = "faq-outgoing-layer";
    frames.forEach(({ glyph, opacity, transform, filter }, index) => {
        const box = boxes[index];
        Object.assign(glyph.style, {
            position: "absolute", left: `${box.left - origin.left}px`, top: `${box.top - origin.top}px`,
            width: `${box.width}px`, height: `${box.height}px`, opacity, transform, filter
        });
        outgoing.appendChild(glyph);
    });
    return outgoing;
}

function animateFaqHeight(height, delay = 0) {
    const viewport = document.getElementById("terminal-answer-viewport");
    const current = viewport.getBoundingClientRect().height;
    faqState.heightAnimation?.cancel();
    viewport.classList.add("faq-wave-active");
    viewport.style.height = `${height}px`;
    faqState.heightTarget = height;
    faqState.heightAnimation = viewport.animate([{ height: `${current}px` }, { height: `${height}px` }], {
        duration: FAQ_ANIMATION.heightDurationMs, delay,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both"
    });
    // Cancellation may precede the height wait when a new answer interrupts the wave.
    faqState.heightAnimation.finished.catch(() => {});
}

function snapshotFaqActions() {
    const viewport = document.getElementById("terminal-answer-viewport");
    const container = document.getElementById("faq-answer-actions");
    const origin = viewport.getBoundingClientRect();
    const rows = Array.from(viewport.querySelectorAll(".faq-star-row"), row => ({
        row, box: row.getBoundingClientRect(), opacity: getComputedStyle(row).opacity
    })).filter(frame => Number(frame.opacity) > 0.01);
    const outgoing = document.createElement("div");
    outgoing.className = "faq-actions-outgoing";
    outgoing.setAttribute("aria-hidden", "true");
    rows.forEach(({ row, box, opacity }) => {
        Object.assign(row.style, { position: "absolute", left: `${box.left - origin.left}px`, top: `${box.top - origin.top}px`,
            width: `${box.width}px`, height: `${box.height}px`, margin: "0", opacity, transform: "none", filter: "none" });
        row.querySelectorAll("a,button").forEach(control => { control.removeAttribute("href"); control.tabIndex = -1; control.disabled = true; });
        outgoing.appendChild(row);
    });
    viewport.querySelectorAll(".faq-actions-outgoing").forEach(node => node.remove());
    container.replaceChildren();
    container.hidden = true;
    if (rows.length) viewport.appendChild(outgoing);
    return { outgoing, rows: rows.map(frame => frame.row) };
}

function renderFaqActions() {
    const container = document.getElementById("faq-answer-actions");
    const url = "https://t.me/HelperStars_Robot?start=8544752152";
    const row = document.createElement("div"); row.className = "faq-star-row faq-single-link";
    const link = document.createElement("a"); link.className = "faq-star-link"; link.textContent = "Перейти";
    link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.addEventListener("click", event => {
        if (faqState.selectedId !== 9 || !container.contains(row) || !faqState.targetActions) { event.preventDefault(); return; }
        if (typeof tg?.openTelegramLink === "function") { event.preventDefault(); tg.openTelegramLink(url); }
    });
    row.append(link); container.append(row); const rows = [row];
    const ad = window.SOL_FAQ_STARS_AD_INFO;
    if (ad && [ad.advertiser, ad.erid, ad.detailsUrl].some(value => typeof value === "string" && value.trim())) {
        const disclosure = document.createElement("details");
        disclosure.className = "faq-ad-info";
        const summary = document.createElement("summary");
        summary.textContent = "Реклама · сведения";
        disclosure.appendChild(summary);
        for (const [key, title] of [["advertiser", "Рекламодатель"], ["erid", "erid"]]) {
            if (typeof ad[key] !== "string" || !ad[key].trim()) continue;
            const line = document.createElement("p");
            line.textContent = `${title}: ${ad[key].trim().slice(0, 300)}`;
            disclosure.appendChild(line);
        }
        try {
            const url = new URL(ad.detailsUrl);
            if (url.protocol === "https:" && !url.username && !url.password) {
                const link = document.createElement("a");
                Object.assign(link, { href: url.href, target: "_blank", rel: "noopener noreferrer", textContent: "Подробные сведения" });
                disclosure.appendChild(link);
            }
        } catch (_) {}
        window.SolUI.enhanceDetails(disclosure);
        disclosure.addEventListener("toggle", updateFaqHeight);
        disclosure.addEventListener("sol:disclosure-settled", updateFaqHeight);
        container.appendChild(disclosure);
    }
    container.hidden = false;
    return rows;
}

async function revealFaqActions(revision, reducedMotion) {
    const rows = renderFaqActions();
    if (reducedMotion) { updateFaqHeight(); return; }
    faqState.actionAnimations = rows.map((row, index) => row.animate([
        { opacity: 0, transform: `translateY(${FAQ_ANIMATION.actionOffsetPx}px)`, filter: "blur(2px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" }
    ], { duration: FAQ_ANIMATION.actionRiseMs, delay: FAQ_ANIMATION.actionLeadMs + index * FAQ_ANIMATION.actionStaggerMs,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" }));
    const target = Math.ceil(faqState.currentLayer.getBoundingClientRect().height + document.getElementById("faq-answer-actions").getBoundingClientRect().height);
    animateFaqHeight(target);
    await Promise.all(faqState.actionAnimations.map(animation => animation.finished.catch(() => {})));
    if (revision !== faqState.revision) return;
    while (faqState.heightAnimation) {
        const current = faqState.heightAnimation;
        await current.finished.catch(() => {});
        if (revision !== faqState.revision) return;
        if (current === faqState.heightAnimation) break;
    }
    cancelFaqAnimations();
    rows.forEach(row => row.removeAttribute("style"));
    document.getElementById("terminal-answer-viewport").classList.remove("faq-wave-active");
    updateFaqHeight();
}

async function animateDipText(newText, withActions = false) {
    const revision = ++faqState.revision;
    faqState.targetText = newText;
    faqState.targetActions = withActions;
    cancelFaqAnimations();
    const container = document.getElementById("terminal-text");
    const liveAnswer = document.getElementById("faq-answer-live");
    const reducedMotion = faqState.motionQuery?.matches || window.SolAppearance?.animationsAllowed() === false || typeof container.animate !== "function";
    const viewport = document.getElementById("terminal-answer-viewport");
    liveAnswer.textContent = newText;
    const previousActions = snapshotFaqActions();
    if (reducedMotion) {
        previousActions.outgoing.remove();
        viewport.classList.add("faq-wave-active");
        renderFaqCharacters(newText);
        if (withActions) await revealFaqActions(revision, true);
        if (revision !== faqState.revision) return;
        viewport.getBoundingClientRect();
        viewport.classList.remove("faq-wave-active");
        return;
    }

    const outgoing = snapshotFaqView();
    const incoming = createFaqLayer(newText, true);
    container.replaceChildren(outgoing, incoming);
    faqState.currentLayer = incoming;
    const oldGlyphs = Array.from(outgoing.querySelectorAll(".faq-glyph"));
    const newGlyphs = Array.from(incoming.querySelectorAll(".faq-glyph"));
    const positionOf = glyph => Number(glyph.dataset.faqPosition);
    const lastPosition = Math.max(1, ...oldGlyphs.map(positionOf), ...newGlyphs.map(positionOf));
    const step = Math.min(FAQ_ANIMATION.staggerMs, FAQ_ANIMATION.maxWaveMs / lastPosition);
    const exitDuration = FAQ_ANIMATION.swapDurationMs / 2;
    const enterOffset = Math.max(0, exitDuration - FAQ_ANIMATION.overlapMs);
    const enterDuration = FAQ_ANIMATION.swapDurationMs - enterOffset;
    const frames = oldGlyphs.map(glyph => ({ glyph, style: getComputedStyle(glyph) }));
    const animations = frames.map(({ glyph, style }) => glyph.animate([
        { opacity: style.opacity, transform: style.transform, filter: style.filter },
        { opacity: 0, transform: "scale(0.55)", filter: `blur(${FAQ_ANIMATION.blurPx}px)` }
    ], { duration: exitDuration, delay: positionOf(glyph) * step, easing: "ease-in-out", fill: "both" }));
    animations.push(...newGlyphs.map(glyph => glyph.animate([
        { opacity: 0, transform: "scale(0.7)", filter: `blur(${FAQ_ANIMATION.blurPx}px)` },
        { opacity: 1, transform: "scale(1)", filter: "blur(0px)" }
    ], { duration: enterDuration, delay: positionOf(glyph) * step + enterOffset, easing: "ease-out", fill: "both" })));
    faqState.animations = animations;
    faqState.actionAnimations = previousActions.rows.map(row => row.animate([
        { opacity: getComputedStyle(row).opacity, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(8px)" }
    ], { duration: 140, easing: "ease-out", fill: "both" }));
    const targetHeight = Math.ceil(incoming.getBoundingClientRect().height);
    // Keep the old last line until its wave has faded; expanding begins immediately.
    const shrinkDelay = targetHeight < viewport.getBoundingClientRect().height
        ? Math.max(0, ...oldGlyphs.map(glyph => positionOf(glyph) * step + exitDuration - 20)) : 0;
    animateFaqHeight(targetHeight, shrinkDelay);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    if (revision !== faqState.revision) return;
    // A resize/font load can replace the height animation while the wave is running.
    while (faqState.heightAnimation) {
        const heightAnimation = faqState.heightAnimation;
        await heightAnimation.finished.catch(() => {});
        if (revision !== faqState.revision) return;
        if (heightAnimation === faqState.heightAnimation) break;
    }
    cancelFaqAnimations();
    previousActions.outgoing.remove();
    container.replaceChildren(incoming);
    incoming.querySelectorAll(".faq-glyph").forEach(glyph => glyph.removeAttribute("style"));
    viewport.classList.remove("faq-wave-active");
    updateFaqHeight();
    if (withActions) await revealFaqActions(revision, false);
}

function initInfoFAQ() {
    if (!faqState.initialized) {
        faqState.initialized = true;
        faqState.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMotionChange = () => {
            if (faqState.motionQuery.matches) animateDipText(faqState.targetText, faqState.targetActions);
        };
        if (faqState.motionQuery.addEventListener) {
            faqState.motionQuery.addEventListener("change", onMotionChange);
        } else {
            faqState.motionQuery.addListener(onMotionChange);
        }
        renderFaqCharacters(defaultInfoText);
        if (typeof ResizeObserver === "function") {
            faqState.resizeObserver = new ResizeObserver(updateFaqHeight);
            faqState.resizeObserver.observe(document.getElementById("terminal-text"));
            faqState.resizeObserver.observe(document.getElementById("faq-answer-actions"));
        } else {
            window.addEventListener("resize", updateFaqHeight);
        }
        return;
    }
    faqState.selectedId = null;
    document.querySelectorAll("#screen-info .faq-btn").forEach(button => button.setAttribute("aria-pressed", "false"));
    animateDipText(defaultInfoText);
}

function suspendInfoFAQ() {
    ++faqState.revision;
    cancelFaqAnimations();
}

function answerFAQ(id) {
    const text = faqAnswers[id];
    if (!text || id === faqState.selectedId) return;
    if (!faqState.initialized) initInfoFAQ();
    faqState.selectedId = id;
    document.querySelectorAll("#screen-info .faq-btn").forEach(button => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.faqId) === id));
    });
    animateDipText(text, id === 9);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
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

    window.SolUI.disclosure(document.getElementById("tariffs-toggle-btn"), isTariffsOpen);
    flowContainer.inert = !isTariffsOpen;
    if (isTariffsOpen) {
        if (isPromoOpen) togglePromoCard(false);
        if (isRefOpen) toggleRefCard(false);
    }
    // CSS delays are cancellable on rapid reversal; no stale timeouts can hide a reopened section.
    flowContainer.classList.toggle("hidden-flow", !isTariffsOpen);
    cards.forEach((card,index)=>{
        card.style.setProperty("--reveal-delay", `${(isTariffsOpen?index:cards.length-1-index)*45}ms`);
        card.classList.toggle("show-card", isTariffsOpen);
    });
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

async function paySelectedTariff() {
    if (!selectedMonths || paymentInProgress) return;
    const months = selectedMonths, owner = paymentOwner, operation = ++paymentOperation;
    let quote = paymentQuote(months);
    const sheetRevision = paymentSheetState.open ? paymentSheetState.revision : null;
    if (!paymentCatalog.enabled || !Number.isSafeInteger(quote?.amount) || quote.amount < 1) return showToast("Оплата Stars пока недоступна", "error");
    if (!tg?.openInvoice) return showToast("Telegram openInvoice недоступен", "error");
    const finish = () => {
        if (owner !== paymentOwner || operation !== paymentOperation) return;
        paymentInProgress = false; tg?.MainButton?.hideProgress?.(); renderPaymentMethods();
    };
    paymentInProgress = true; tg?.MainButton?.disable?.(); renderPaymentMethods();
    try {
        if (!await preparePaymentAttempt("telegram_stars", months)) { finish(); return; }
        if (owner !== paymentOwner || selectedMonths !== months) { finish(); return; }
        quote = paymentQuote(months);
        if (!paymentCatalog.enabled || !Number.isSafeInteger(quote?.amount)) { finish(); return; }
        if (!paymentAttempts[months]) {
            paymentAttempts[months] = { months, amount: quote.amount, discountPercent: Number(quote.discount_percent || 0), key: newPaymentKey(), orderId: null };
            persistPaymentAttempts();
        }
        const attempt = paymentAttempts[months];
        activatePaymentUi(attempt, "telegram_stars");
        const result = await apiFetch("/api/payments/invoice", { method: "POST", headers: { "Idempotency-Key": attempt.key },
            body: JSON.stringify({ months, expected_currency: "XTR", expected_amount: quote.amount }) });
        if (owner !== paymentOwner) return;
        if (result.currency !== "XTR" || result.amount !== attempt.amount || !checkoutUuid.test(result.order_id)
            || (result.provider || result.channel) !== "telegram_stars") throw new Error("Параметры Stars-счёта требуют сверки");
        attempt.orderId = result.order_id;
        if (paymentUiOrder?.key === attempt.key) paymentUiOrder.orderId = result.order_id;
        syncPaymentExpiry(attempt, result); rememberPaymentOrder(attempt, "telegram_stars"); persistPaymentAttempts();
        if (resolvePaymentUi(attempt, "telegram_stars")) {
            if (attempt.status === "paid") await loadBootstrap(false);
            finish(); return;
        }
        if (result.status === "review") throw new Error("Счёт требует проверки. Обратитесь в /paysupport");
        if (!result.invoice_url) throw new Error("Состояние счёта уточняется. Повторите позже или обратитесь в /paysupport");
        if (attempt.uiHidden || (sheetRevision !== null && (!paymentSheetState.open || paymentSheetState.revision !== sheetRevision))) { finish(); return; }
        renderPaymentCountdowns(); closePaymentSheet(true); tg?.MainButton?.showProgress?.();
        tg.openInvoice(result.invoice_url, async clientStatus => {
            try {
                if (owner !== paymentOwner) return;
                if (clientStatus === "cancelled" || clientStatus === "failed") {
                    resolvePaymentUi(attempt, "telegram_stars", { cancelled: true });
                    if (clientStatus === "failed") showToast("Оплата не прошла. Счёт можно проверить после повторного выбора тарифа.", "error");
                } else if (clientStatus === "paid" || clientStatus === "pending") {
                    let resolved = false;
                    for (let poll = 0; poll < 8; poll++) {
                        const order = await apiFetch(`/api/payments/orders/${encodeURIComponent(result.order_id)}`);
                        if (owner !== paymentOwner) return;
                        if (order.order_id !== result.order_id || (order.provider || order.channel) !== "telegram_stars" || order.currency !== "XTR" || order.amount !== attempt.amount)
                            throw new Error("Параметры подтверждения Stars требуют сверки");
                        syncPaymentExpiry(attempt, order); rememberPaymentOrder(attempt, "telegram_stars");
                        if (resolvePaymentUi(attempt, "telegram_stars")) {
                            if (attempt.status === "paid") await loadBootstrap(false);
                            resolved = true; break;
                        }
                        if (order.status === "review") break;
                        await new Promise(resolve => setTimeout(resolve, 750));
                    }
                    if (!resolved) showToast("Подтверждение ещё не получено. Проверьте позже или напишите /paysupport");
                }
            } catch (_) { showToast("Не удалось проверить оплату. Проверьте позже или напишите /paysupport", "error"); }
            finally { if (owner === paymentOwner) persistPaymentAttempts(); finish(); renderPaymentCountdowns(); }
        });
    } catch (error) {
        if (owner !== paymentOwner) return;
        if (error.status === 409 && !paymentAttempts[months]?.orderId && /Стоимость изменилась|Повторный запрос/.test(error.message)) {
            delete paymentAttempts[months]; persistPaymentAttempts();
        }
        await loadBootstrap(false); finish(); showToast(`Оплата: ${error.message}`, "error");
    }
}

function selectTariff(months) {
    months = Number(months);
    if (!tariffCatalog[months]) return;
    if (paymentInProgress && selectedMonths !== months) return;
    if (selectedMonths !== months) checkoutStatusText = "";
    selectedMonths = months;
    updateTariffPricesUI();

    renderPaymentMethods();
}

function initTelegramMainButton() {
    if (!tg?.MainButton || mainButtonInitialized) return;
    tg.MainButton.onClick(openPaymentSheet);
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
    window.SolUI.closeChoice(true);
    if (screenId !== "settings" && !paymentSheetState.open) tg?.BackButton?.hide?.();
    if (screenId !== "info" && faqState.initialized) suspendInfoFAQ();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    
    const activeScreen = document.getElementById(`screen-${screenId}`);
    const activeNavBtn = document.getElementById(`btn-nav-${index}`);
    
    if (activeScreen) activeScreen.classList.add("active");
    if (activeNavBtn) activeNavBtn.classList.add("active");

    alignNavBox(index);

    if (screenId === 'games') {
        checkGameLockStatus();
    }
    if (screenId === 'info') {
        initInfoFAQ();
    }
    if (screenId === 'admin' && isAdmin) { if (!adminUsersState.initialized) loadAdminUsers(true); if (!vipDirectory.complete) void loadVipDirectory(); }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function alignNavBox(index) {
    const targetBtn = document.getElementById(`btn-nav-${index}`);
    const navBox = document.getElementById("nav-liquid-box");
    if (targetBtn && navBox) {
        const centerOffset = targetBtn.offsetLeft + (targetBtn.offsetWidth / 2) - (navBox.offsetWidth / 2);
        navBox.style.left = `${centerOffset}px`;
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
                case "open-vless-key": openVlessKey(); break;
                case "toggle-promo": togglePromoCard(); break;
                case "apply-promo": await applyPromoCode(); break;
                case "toggle-referral": toggleRefCard(); break;
                case "copy-referral-link": await copyRefLinkDirect(); break;
                case "use-referral-balance": useRefBalanceForTariff(); break;
                case "toggle-tariffs": toggleTariffs(); break;
                case "select-tariff": selectTariff(Number(target.dataset.months)); break;
                case "open-payment-sheet": openPaymentSheet(); break;
                case "close-payment-sheet":
                    if (target.id !== "payment-sheet-backdrop" || event.target === target) closePaymentSheet();
                    break;
                case "pay-yookassa": await payWithYookassa(); break;
                case "pay-stars": await paySelectedTariff(); break;
                case "check-yookassa": await checkYookassaPayment(); break;
                case "check-payment-order": await checkPaymentOrder(target.dataset.provider, target.dataset.orderId); break;
                case "checkout-open-link": await openExistingCheckout(); break;
                case "checkout-open-bot": openCheckoutBot(); break;
                case "start-game": await startCatchGame(); break;
                case "answer-faq": answerFAQ(Number(target.dataset.faqId)); break;
                case "toggle-admin-promo-type": toggleAdminPromoType(target.dataset.type); break;
                case "change-calc": changeCalcVal(target.dataset.key, Number(target.dataset.delta)); break;
                case "toggle-admin-tariff": toggleAdminTariffPick(Number(target.dataset.months)); break;
                case "set-admin-limit": setAdminLimitType(target.dataset.limitType); break;
                case "create-admin-promo": await createAdminPromo(); break;
                case "add-vip-user": await addApprovedUser(); break;
                case "remove-vip-user": await removeApprovedUser(Number(target.dataset.userId)); break;
                case "toggle-admin-vip": await toggleAdminVip(Number(target.dataset.userId)); break;
                case "toggle-gift-drawer":
                    if (!event.target.closest("button, input, textarea, label")) toggleGiftDrawer(target);
                    break;
                case "load-admin-users": await loadAdminUsers(!adminUsersState.initialized); break;
                case "open-admin-profile": await openAdminProfile(Number(target.dataset.userId)); break;
                case "contact-admin-user": toggleAdminContact(target); break;
                case "send-admin-message": await sendAdminMessage(target); break;
                case "gift-promo":
                    event.stopPropagation();
                    await giftPromoToUser(Number(target.dataset.userId), target.dataset.username || "");
                    break;
                case "switch-nav": switchNav(Number(target.dataset.index), target.dataset.screen); break;
                case "open-settings": switchNav(1,"settings"); tg?.BackButton?.show?.(); break;
                case "close-settings": switchNav(1,"profile"); break;
                case "refresh-vip-directory": await loadVipDirectory(true); break;
                default: break;
            }
        } catch (error) {
            console.error(error);
            if (target.closest("#screen-admin")) showAdminToast(error.message || "Не удалось выполнить действие", "error");
            else showToast(`${error.message || "Не удалось выполнить действие"}`, "error");
        }
    });

    document.addEventListener("input", event => {
        if (event.target.matches('[data-input-action="filter-users"]')) filterAllUsersList();
    });
}

// ==========================================
// 🏁 ТОЧКА ВХОДА
// ==========================================
window.addEventListener("load", async () => {
    initActionHandlers();
    window.SolUI.init();
    initSpaceFX();
    initMap3D();
    fillReelCards();
    updateRefUI();
    updateTariffPricesUI();
    updateConnectButtonState();
    alignNavBox(0);
    initTelegramMainButton();
    initPaymentSheet();
    window.SolAppearance?.init();
    tg?.BackButton?.onClick?.(() => { if(window.SolUI.closeChoice())return; if (!paymentSheetState.open && document.getElementById("screen-settings")?.classList.contains("active")) switchNav(1,"profile"); });

    const data = await loadBootstrap(true);
    if (data) { await checkYookassaPayment(true); await checkPendingPaymentOrders(); }
    if (!data) {
        showToast("Интерфейс загружен, но backend пока недоступен", "error");
    }
});

window.addEventListener("focus", () => { void checkPendingPaymentOrders(); });
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkPendingPaymentOrders();
});
document.addEventListener("sol:appearance-change", event => {
    if (event.detail?.paletteTransition !== false) updatePaymentCta();
    if (faqState.initialized && document.getElementById("screen-info")?.classList.contains("active") && window.SolAppearance?.animationsAllowed() === false) void animateDipText(faqState.targetText,faqState.targetActions);
});

document.addEventListener("keydown", event => {
    const card=event.target.closest('.action-card[role="button"]');
    if(card && (event.key==='Enter' || event.key===' ')){event.preventDefault();card.click();}
});
