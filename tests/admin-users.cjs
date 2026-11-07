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
        username: i % 2 === 0 ? `user_${i}` : '', hasSub: i % 3 === 0, isVip: false,
        registration_date: '2026-01-01', subscription_end: i % 3 === 0 ? '2027-01-01' : null,
        vpn_key: null, referrer_id: null
    }));
    const requests = [], errors = [];
    let legacy = false, failNext = false, privacy = false, forbidden = false;
    function json(res, body, status = 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;
        const actor = req.headers['x-telegram-init-data'];
        if (pathname.startsWith('/api/')) {
            requests.push({ method: req.method, url: req.url, actor });
            if (pathname === '/api/bootstrap') return json(res, { user: { id: 1, is_admin: actor === 'admin' }, subscription: { active: false }, admin: actor === 'admin' ? { users: [], approved_users: [] } : undefined });
            if (actor !== 'admin') return json(res, { detail: 'Требуются права администратора' }, 403);
            if (pathname === '/api/admin/users') {
                if (failNext) { failNext = false; return json(res, { detail: 'Временная ошибка API' }, 503); }
                const q = (url.searchParams.get('q') || '').toLowerCase().replace(/^@/, '');
                if (q === 'slow') await new Promise(resolve => setTimeout(resolve, 350));
                const found = users.filter(user => [user.name, user.username, user.user_id].some(v => String(v).toLowerCase().includes(q)));
                const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
                if (legacy) return json(res, { users, approved_users: [] });
                return json(res, { users: found.slice(offset, offset + limit), pagination: {
                    total: found.length, next_offset: offset + Math.min(limit, found.length - offset), has_more: offset + limit < found.length
                }, capabilities: { profile_link: true, contact_message: true } });
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
            if (pathname === '/api/admin/vip') return json(res, { ok: true, admin: { approved_users: req.method === 'POST' ? [{ user_id: 7000, name: 'Пользователь 0', username: 'user_0' }] : [], users: [] } });
            if (pathname === '/api/admin/gift-promo' || pathname === '/api/admin/promocodes') return json(res, { ok: true });
            return json(res, { detail: 'Not found' }, 404);
        }
        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!['index.html', 'style.css', 'app.js', 'config.js'].includes(filename)) return res.writeHead(404).end();
        res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(filename === 'config.js' ? '' : await fs.readFile(path.join(root, filename)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser, checks = 0;
    async function check(name, fn) { await fn(); console.log(`PASS ${name}`); checks++; }
    async function pageFor(actor = 'admin') {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
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
            await page.locator('[data-action="remove-vip-user"]').click();
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
            legacy = false;
        });
        await check('normal users have no admin entry or client access; API still rejects direct requests', async () => {
            const ordinary = await pageFor('user');
            assert.equal(await ordinary.locator('#btn-nav-4').isVisible(), false);
            const before = requests.length;
            await ordinary.evaluate(() => { loadAdminUsers(true); openAdminProfile(7001); });
            assert.equal(requests.length, before);
            const response = await ordinary.request.get(`${origin}/api/admin/users?limit=50`, { headers: { 'X-Telegram-Init-Data': 'user' } });
            assert.equal(response.status(), 403);
            await ordinary.context().close();
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
        if (process.env.SOL_FAQ_SCREENSHOT_DIR) {
            await fs.mkdir(process.env.SOL_FAQ_SCREENSHOT_DIR, { recursive: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('#admin-search-user').fill('700'); await loaded(page, 10);
            await page.evaluate(() => adminActionStatus(''));
            await page.waitForTimeout(4000);
            await page.locator('#all-users-container').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(process.env.SOL_FAQ_SCREENSHOT_DIR, 'admin-390.png') });
        }
        assert.deepEqual(errors, []);
        console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
