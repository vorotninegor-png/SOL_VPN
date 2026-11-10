// Offline browser checks. Requires Playwright; no real bot or backend is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
    const users = Array.from({ length: 125 }, (_, i) => ({
        user_id: 7000 + i, name: i === 120 ? 'Егор дальний' : `Пользователь ${i}`,
        username: i % 2 === 0 ? `user_${i}` : '', hasSub: i % 3 === 0 || i === 2, isVip: i === 2,
        vip_admin_granted: false, vip_protected: i === 2,
        registration_date: '2026-01-01', subscription_end: i % 3 === 0 ? '2027-01-01' : null,
        vpn_key: null, referrer_id: null
    }));
    const requests = [], errors = [];
    let legacy = false, failNext = false, privacy = false, forbidden = false, failVip = false, vipDelay = 0;
    const approved = () => users.filter(user => user.vip_admin_granted);
    function json(res, body, status = 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;
        const actor = req.headers['x-telegram-init-data'];
        if (pathname.startsWith('/api/')) {
            requests.push({ method: req.method, url: req.url, actor });
            if (pathname === '/api/bootstrap') return json(res, { user: { id: 1, is_admin: actor === 'admin' }, subscription: { active: false }, admin: actor === 'admin' ? { users: [], approved_users: approved() } : undefined });
            if (actor !== 'admin') return json(res, { detail: 'Требуются права администратора' }, 403);
            if (pathname === '/api/admin/users') {
                if (failNext) { failNext = false; return json(res, { detail: 'Временная ошибка API' }, 503); }
                const q = (url.searchParams.get('q') || '').toLowerCase().replace(/^@/, '');
                if (q === 'slow') await new Promise(resolve => setTimeout(resolve, 350));
                const found = users.filter(user => [user.name, user.username, user.user_id].some(v => String(v).toLowerCase().includes(q)));
                const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
                if (legacy) return json(res, { users: users.map(({vip_admin_granted, vip_protected, ...user}) => user), approved_users: approved() });
                return json(res, { users: found.slice(offset, offset + limit), pagination: {
                    total: found.length, next_offset: offset + Math.min(limit, found.length - offset), has_more: offset + limit < found.length
                }, approved_users: approved(), capabilities: { profile_link: true, contact_message: true } });
            }
            if (pathname.endsWith('/profile-link')) return privacy
                ? json(res, { detail: 'Telegram ограничил профиль из-за приватности' }, 409)
                : json(res, { ok: true, bot_url: 'https://t.me/SOLTestBot', message: 'Кнопка профиля отправлена в чат. Открытие не подтверждено.' });
            if (pathname.endsWith('/message')) {
                const chunks = []; for await (const chunk of req) chunks.push(chunk);
                requests.at(-1).body = JSON.parse(Buffer.concat(chunks).toString());
                return forbidden ? json(res, { detail: 'Пользователь должен открыть бота SOL VPN' }, 409)
                    : json(res, { ok: true, message: 'Telegram принял сообщение. Прочтение не подтверждено.' });
            }
            if (pathname === '/api/admin/vip') {
                const chunks = []; for await (const chunk of req) chunks.push(chunk);
                const body = JSON.parse(Buffer.concat(chunks).toString());
                requests.at(-1).body = body;
                if (vipDelay) await new Promise(resolve => setTimeout(resolve, vipDelay));
                if (failVip) return json(res, { detail: 'Не удалось изменить VIP' }, 503);
                const target = users.find(user => body.user_id ? user.user_id === body.user_id : user.username === String(body.username || '').replace(/^@/, ''));
                if (!target) return json(res, { detail: 'Пользователь не найден' }, 404);
                target.vip_admin_granted = req.method === 'DELETE' ? false : body.enabled ?? true;
                target.isVip = target.vip_admin_granted || target.vip_protected;
                target.hasSub = target.isVip || (target.user_id - 7000) % 3 === 0;
                return json(res, { ok: true, target_user: target, admin: { approved_users: approved(), users: [] } });
            }
            if (pathname === '/api/admin/gift-promo' || pathname === '/api/admin/promocodes') return json(res, { ok: true });
            return json(res, { detail: 'Not found' }, 404);
        }
        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!['index.html', 'style.css', 'appearance.css','miniapp-ui.css', 'appearance.js','miniapp-ui.js', 'app.js', 'support.css','support.js','config.js'].includes(filename)) return res.writeHead(404).end();
        res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(filename === 'config.js' ? '' : await fs.readFile(path.join(root, filename)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser, checks = 0;
    async function check(name, fn) { await fn(); console.log(`PASS ${name}`); checks++; }
    async function pageFor(actor = 'admin', reducedMotion = 'reduce') {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
        await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        await context.addInitScript(actor => {
            window.telegramLinks = [];
            window.Telegram = { WebApp: {
                initData: actor, ready() {}, expand() {},
                HapticFeedback: { selectionChanged() {}, impactOccurred() {} },
                openTelegramLink(url) { if (window.rejectLinks) throw Error('Клиент Telegram не поддержал переход'); window.telegramLinks.push(url); }
            } };
        }, actor);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        await page.waitForFunction(() => serverOnline);
        return page;
    }
    async function loaded(page, count) {
        await page.waitForFunction(count => !adminUsersState.loading && document.querySelectorAll('.user-row-card').length === count, count);
    }
    try {
        browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
        const page = await pageFor();
        await check('server pagination loads every user without duplicates', async () => {
            await page.locator('#btn-nav-4').click();
            await loaded(page, 50);
            await page.locator('#admin-users-more').click(); await loaded(page, 100);
            await page.locator('#admin-users-more').click(); await loaded(page, 125);
            assert.equal(await page.locator('#admin-users-more').isHidden(), true);
            const ids = await page.locator('.user-row-card').evaluateAll(cards => cards.map(card => card.dataset.userId));
            assert.equal(new Set(ids).size, 125);
            assert.match(await page.locator('#admin-users-status').textContent(), /125 из 125/);
        });
        await check('each user has required fields, profile and contact buttons with or without username', async () => {
            assert.equal(await page.locator('[data-action="open-admin-profile"]').count(), 125);
            assert.equal(await page.locator('[data-action="contact-admin-user"]').count(), 125);
            for (const id of [7000, 7001]) {
                const card = page.locator(`.user-row-card[data-user-id="${id}"]`);
                const text = await card.textContent();
                for (const field of ['ID:', 'Регистрация:', 'Окончание:', 'VIP:', 'ПОДПИСК']) assert.ok(text.includes(field));
            }
        });
        await check('VIP toggles by numeric ID without username and updates in place without losing pagination', async () => {
            const button = page.locator('[data-action="toggle-admin-vip"][data-user-id="7001"]');
            await button.scrollIntoViewIfNeeded();
            const element = await button.elementHandle();
            const beforeUsers = requests.filter(req => req.url.startsWith('/api/admin/users?')).length;
            const scroll = await page.locator('#all-users-container').evaluate(el => el.scrollTop);
            await button.click();
            await page.waitForFunction(() => !adminVipPending.size && document.querySelector('[data-action="toggle-admin-vip"][data-user-id="7001"]').getAttribute('aria-pressed') === 'true');
            assert.equal(await element.evaluate(el => el === document.querySelector('[data-action="toggle-admin-vip"][data-user-id="7001"]')), true);
            assert.deepEqual(requests.filter(req => req.url === '/api/admin/vip').at(-1).body, { user_id: 7001, enabled: true });
            assert.equal(await page.locator('#all-users-container').evaluate(el => el.scrollTop), scroll);
            assert.equal(await page.locator('.user-row-card').count(), 125);
            assert.equal(requests.filter(req => req.url.startsWith('/api/admin/users?')).length, beforeUsers);
            assert.ok((await page.locator('#approved-users-drum').textContent()).includes('Пользователь 1'));
            assert.equal(await button.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
        });
        await check('VIP persists after reload and removing only the admin grant updates the assigned list', async () => {
            await page.reload(); await page.waitForFunction(() => serverOnline); await page.locator('#btn-nav-4').click(); await loaded(page, 50);
            const button = page.locator('[data-action="toggle-admin-vip"][data-user-id="7001"]');
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            await button.click(); await page.waitForFunction(() => !adminVipPending.size);
            assert.equal(await button.getAttribute('aria-pressed'), 'false');
            assert.equal(users.find(user => user.user_id === 7001).isVip, false);
            assert.equal((await page.locator('#approved-users-drum').textContent()).includes('Пользователь 1'), false);
            await page.locator('#admin-users-more').click(); await loaded(page, 100);
            await page.locator('#admin-users-more').click(); await loaded(page, 125);
        });
        await check('protected VIP remains effective after the administrator grant is removed', async () => {
            const button = page.locator('[data-action="toggle-admin-vip"][data-user-id="7002"]');
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#admin-vip-note-7002').isHidden(), false);
            await button.click(); await page.waitForFunction(() => !adminVipPending.size);
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            await button.click(); await page.waitForFunction(() => !adminVipPending.size);
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            assert.equal(users.find(user => user.user_id === 7002).isVip, true);
            assert.match(await page.locator('.user-row-card[data-user-id="7002"] [data-admin-vip-summary]').textContent(), /VIP: да/);
            assert.equal(await page.locator('.user-row-card[data-user-id="7002"]').evaluate(el => el.classList.contains('active-sub')), true);
        });
        await check('VIP requests are guarded against double taps and failures retain the prior state', async () => {
            const before = requests.filter(req => req.url === '/api/admin/vip').length;
            vipDelay = 200;
            await page.evaluate(() => { void toggleAdminVip(7001); void toggleAdminVip(7001); });
            const button = page.locator('[data-action="toggle-admin-vip"][data-user-id="7001"]');
            assert.equal(await button.isDisabled(), true);
            assert.equal(await button.getAttribute('aria-busy'), 'true');
            assert.equal(await button.getAttribute('aria-pressed'), 'false');
            await page.waitForFunction(() => !adminVipPending.size);
            assert.equal(requests.filter(req => req.url === '/api/admin/vip').length - before, 1);
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            failVip = true;
            await page.evaluate(() => toggleAdminVip(7001));
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            assert.equal(await button.isDisabled(), false);
            assert.match(await page.locator('.toast').last().textContent(), /Не удалось изменить VIP/);
            failVip = false; vipDelay = 0;
            await page.evaluate(() => toggleAdminVip(7001));
        });
        await check('admin decorations use consistent white inline SVGs and gold is reserved for granted VIP', async () => {
            const decorations = await page.evaluate(() => {
                const nodes = [...document.querySelectorAll('#screen-admin button, #screen-admin h2, #screen-admin .admin-card-title, #btn-nav-4')];
                return { texts: nodes.map(el => el.textContent), placeholders: [...document.querySelectorAll('#screen-admin input')].map(el => el.placeholder),
                    icons: [...document.querySelectorAll('#screen-admin svg, #btn-nav-4 svg')].map(svg => ({ box: svg.getAttribute('viewBox'), stroke: svg.getAttribute('stroke-width'), color: getComputedStyle(svg).color, vip: Boolean(svg.closest('.admin-vip-active')) })) };
            });
            assert.ok(decorations.icons.length > 100);
            assert.ok(decorations.icons.every(svg => svg.box === '0 0 24 24' && svg.stroke === '1.4' && svg.color === (svg.vip ? 'rgb(255, 228, 157)' : 'rgb(255, 255, 255)')));
            assert.ok([...decorations.texts, ...decorations.placeholders].every(text => !/\p{Extended_Pictographic}/u.test(text)));
            assert.equal(await page.locator('.toast.admin-toast svg').count() > 0, true);
        });
        await check('username opens the official Telegram profile URL without claiming success', async () => {
            await page.locator('[data-action="open-admin-profile"][data-user-id="7000"]').click();
            assert.deepEqual(await page.evaluate(() => window.telegramLinks), ['https://t.me/user_0?profile']);
            assert.match(await page.locator('#admin-action-status').textContent(), /не подтверждает/);
        });
        await check('ID-only profile is issued via Bot API, privacy errors never claim success', async () => {
            await page.locator('[data-action="open-admin-profile"][data-user-id="7001"]').click();
            await page.waitForFunction(() => window.telegramLinks.at(-1) === 'https://t.me/SOLTestBot');
            assert.match(await page.locator('#admin-action-status').textContent(), /не подтверждено/);
            privacy = true;
            await page.locator('[data-action="open-admin-profile"][data-user-id="7001"]').click();
            await page.waitForFunction(() => document.querySelector('#admin-action-status').textContent.includes('приватности'));
            privacy = false;
            await page.evaluate(() => { window.rejectLinks = true; });
            await page.locator('[data-action="open-admin-profile"][data-user-id="7000"]').click();
            assert.match(await page.locator('#admin-action-status').textContent(), /не поддержал/);
            await page.evaluate(() => { window.rejectLinks = false; });
        });
        await check('server search finds names and IDs beyond the first page and survives card actions', async () => {
            for (const q of ['ЕГОР', '@user_120', '7120']) {
                await page.locator('#admin-search-user').fill(q); await loaded(page, 1);
                assert.equal(await page.locator('.user-row-card').getAttribute('data-user-id'), '7120');
                await page.locator('.user-row-main').click();
                assert.equal(await page.locator('#admin-search-user').inputValue(), q);
            }
            await page.locator('#btn-nav-3').click(); await page.locator('#btn-nav-4').click();
            assert.equal(await page.locator('#admin-search-user').inputValue(), '7120');
        });
        await check('stale search responses cannot replace newer results', async () => {
            await page.locator('#admin-search-user').fill('slow');
            await page.waitForTimeout(280);
            await page.locator('#admin-search-user').fill('Егор');
            await loaded(page, 1); await page.waitForTimeout(500);
            assert.equal(await page.locator('.user-row-card').getAttribute('data-user-id'), '7120');
        });
        await check('gift promo and VIP management still use existing routes and preserve search', async () => {
            await page.locator('.user-row-main').click();
            page.once('dialog', dialog => dialog.accept('TESTGIFT'));
            await page.locator('[data-action="gift-promo"]').click();
            await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Промокод отправлен'));
            assert.ok(requests.some(req => req.url === '/api/admin/gift-promo'));
            await page.locator('#admin-approved-input').fill('@user_0');
            await page.locator('[data-action="add-vip-user"]').click();
            await loaded(page, 1);
            assert.equal(await page.locator('#admin-search-user').inputValue(), 'Егор');
            await page.locator('[data-action="remove-vip-user"][data-user-id="7000"]').click();
            await loaded(page, 1);
            assert.ok(requests.some(req => req.url === '/api/admin/vip' && req.method === 'DELETE'));
        });
        await check('contact sends only explicit text; refusal retains the draft', async () => {
            await page.locator('[data-action="contact-admin-user"]').click();
            const input = page.locator('.admin-user-composer textarea');
            await input.fill('Test support message');
            forbidden = true;
            await page.locator('[data-action="send-admin-message"]').click();
            await page.waitForFunction(() => document.querySelector('#admin-action-status').textContent.includes('должен открыть'));
            assert.equal(await input.inputValue(), 'Test support message');
            forbidden = false;
            await page.locator('[data-action="send-admin-message"]').click();
            await page.waitForFunction(() => document.querySelector('#admin-action-status').textContent.includes('Прочтение'));
            assert.equal(await input.inputValue(), '');
            assert.deepEqual(requests.filter(req => req.url.endsWith('/message')).at(-1).body, { text: 'Test support message' });
        });
        await check('pagination preserves open drawers, message drafts and scroll position', async () => {
            await page.locator('#admin-search-user').fill(''); await loaded(page, 50);
            await page.locator('[data-action="contact-admin-user"]').first().click();
            await page.locator('textarea').first().fill('Keep this draft');
            await page.locator('#all-users-container').evaluate(el => { el.scrollTop = 200; });
            const scroll = await page.locator('#all-users-container').evaluate(el => el.scrollTop);
            await page.locator('#admin-users-more').click(); await loaded(page, 100);
            assert.equal(await page.locator('textarea').first().inputValue(), 'Keep this draft');
            assert.equal(await page.locator('.admin-user-composer').first().isVisible(), true);
            assert.equal(await page.locator('#all-users-container').evaluate(el => el.scrollTop), scroll);
        });
        await check('failed page load can be retried without losing the search', async () => {
            failNext = true;
            await page.locator('#admin-search-user').fill('7120');
            await page.waitForFunction(() => adminUsersState.error !== '');
            assert.match(await page.locator('#admin-users-status').textContent(), /Временная ошибка/);
            await page.locator('#admin-users-more').click(); await loaded(page, 1);
            assert.equal(await page.locator('#admin-search-user').inputValue(), '7120');
        });
        await check('legacy API fallback is explicit and never invents full pagination or messaging', async () => {
            legacy = true;
            await page.locator('#admin-search-user').fill(''); await loaded(page, 50);
            assert.match(await page.locator('#admin-users-status').textContent(), /полнота списка не подтверждена/);
            await page.locator('#admin-users-more').click(); await loaded(page, 100);
            await page.locator('[data-action="open-admin-profile"][data-user-id="7001"]').click();
            assert.match(await page.locator('#admin-action-status').textContent(), /Кнопка профиля без username сейчас недоступна/);
            assert.equal(await page.locator('[data-action="toggle-admin-vip"]').first().isDisabled(), true);
            const beforeVip = requests.filter(req => req.url === '/api/admin/vip').length;
            await page.evaluate(() => toggleAdminVip(7001));
            await page.evaluate(() => { approvedUsers = [{ user_id: 7001, name: 'Legacy VIP' }]; renderApprovedUsersDrum(); });
            assert.equal(await page.locator('[data-action="remove-vip-user"]').isDisabled(), true);
            await page.evaluate(() => removeApprovedUser(7001));
            assert.equal(requests.filter(req => req.url === '/api/admin/vip').length, beforeVip);
            legacy = false;
        });
        await check('normal users have no admin entry or client access; API still rejects direct requests', async () => {
            const ordinary = await pageFor('user');
            assert.equal(await ordinary.locator('#btn-nav-4').isVisible(), false);
            const before = requests.length;
            await ordinary.evaluate(() => { loadAdminUsers(true); openAdminProfile(7001); toggleAdminVip(7001); removeApprovedUser(7001); });
            assert.equal(requests.length, before);
            const response = await ordinary.request.get(`${origin}/api/admin/users?limit=50`, { headers: { 'X-Telegram-Init-Data': 'user' } });
            assert.equal(response.status(), 403);
            await ordinary.context().close();
        });
        await check('VIP uses a 300 ms purple-to-gold transition and source-safe state on ordinary motion', async () => {
            const motion = await pageFor('admin', 'no-preference');
            await motion.locator('#btn-nav-4').click(); await loaded(motion, 50);
            const button = motion.locator('[data-action="toggle-admin-vip"][data-user-id="7001"]');
            const before = await button.evaluate(el => ({ color: getComputedStyle(el).backgroundColor, duration: getComputedStyle(el).transitionDuration, shadow: getComputedStyle(el).boxShadow }));
            assert.match(before.duration, /0\.3s/);
            assert.equal(before.shadow, 'none');
            await button.click(); await motion.waitForFunction(() => !adminVipPending.size);
            await motion.waitForTimeout(380);
            const active = await button.evaluate(el => ({ color: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, icon: getComputedStyle(el.querySelector('svg')).color }));
            assert.notEqual(active.color, before.color); assert.notEqual(active.shadow, 'none'); assert.notEqual(active.icon, 'rgb(255, 255, 255)');
            await button.click(); await motion.waitForFunction(() => !adminVipPending.size); await motion.waitForTimeout(380);
            assert.equal(await button.evaluate(el => getComputedStyle(el).backgroundColor), before.color);
            assert.equal(await button.evaluate(el => getComputedStyle(el).boxShadow), 'none');
            await motion.context().close();
        });
        await check('mobile layouts have no new horizontal overflow', async () => {
            for (const viewport of [{ width: 280, height: 568 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 640, height: 360 }]) {
                await page.setViewportSize(viewport);
                const layout = await page.evaluate(() => {
                    const screen = document.querySelector('#screen-admin');
                    return { overflow: screen.scrollWidth > screen.clientWidth,
                        outside: Array.from(screen.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > screen.getBoundingClientRect().right).slice(0, 8).map(el => ({ tag: el.tagName, cls: el.className, id: el.id, right: el.getBoundingClientRect().right })) };
                });
                assert.equal(layout.overflow, false, JSON.stringify({ viewport, layout }));
            }
        });
        const screenshotDir = process.env.SOL_ADMIN_SCREENSHOT_DIR || process.env.SOL_FAQ_SCREENSHOT_DIR;
        if (screenshotDir) {
            await fs.mkdir(screenshotDir, { recursive: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('#admin-search-user').fill('700'); await loaded(page, 10);
            const vip = page.locator('[data-action="toggle-admin-vip"][data-user-id="7001"]');
            if (await vip.getAttribute('aria-pressed') !== 'true') {
                await vip.click(); await page.waitForFunction(() => !adminVipPending.size);
            }
            await page.evaluate(() => adminActionStatus(''));
            await page.waitForTimeout(4000);
            await page.locator('.user-row-card[data-user-id="7001"]').scrollIntoViewIfNeeded();
            const screenshot = path.join(screenshotDir, process.env.SOL_ADMIN_SCREENSHOT_DIR ? 'admin-vip-390.png' : 'admin-390.png');
            await page.screenshot({ path: screenshot });
            console.log(`Screenshot: ${screenshot}`);
        }
        assert.deepEqual(errors, []);
        console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
