// Run with Node.js and Playwright available: node tests/info-faq.cjs
// Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, SOL_FAQ_SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const expectedAnswers = [
    "На вкладке «Тоннель» нажмите кнопку, чтобы получить персональный VLESS-ключ. Сам системный VPN затем включается в Happ, Hiddify, v2rayNG или другом клиенте.",
    "После получения конфига нажмите «Копировать» и импортируйте его в Happ, Hiddify, v2rayNG или другой VLESS-клиент.",
    "Скорость и задержка зависят от VPS, маршрута, нагрузки и провайдера. Mini App не измеряет пропускную способность туннеля.",
    "VLESS-ключ персональный. Ограничение числа одновременных устройств пока не контролируется backend, поэтому не передавайте ключ другим.",
    "Чтобы увеличить процент реферальной программы перейдите во вкладку 'Игры', запускайте сканирование радара и ловите скоростные кометы!",
    "Доступ к Охоте на кометы заблокирован, если у вас нет активной подписки VPN. Приобретите любой тариф на вкладке Кабинет.",
    "Кометы пролетают через зону действия космического радара. Успейте кликнуть по комете, чтобы выбить бонус!",
    "Да, VLESS работает на смартфонах, ПК (Windows/macOS/Linux) и роутерах Keenetic!"
];

async function main() {
    // No real Telegram, API, VPN or external scripts are contacted.
    const server = http.createServer(async (req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        if (name === '/api/bootstrap') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ user: { user_id: 1 }, subscription: { active: false } }));
        } else if (name === '/config.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end('');
        } else if (['/', '/index.html', '/app.js', '/style.css'].includes(name)) {
            res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
            res.end(await fs.readFile(path.join(root, name === '/' ? 'index.html' : name.slice(1))));
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    const errors = [];
    let checks = 0;
    async function check(name, fn) {
        await fn();
        checks++;
        console.log(`PASS ${name}`);
    }
    async function newPage(options = {}, fallback = false) {
        const context = await browser.newContext({ viewport: { width: 360, height: 740 }, ...options });
        await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        await context.addInitScript(() => {
            window.Telegram = { WebApp: { initData: 'local-test', ready() {}, expand() {}, HapticFeedback: { selectionChanged() {}, impactOccurred() {} } } };
        });
        if (fallback) await context.addInitScript(() => {
            window.ResizeObserver = undefined;
            Intl.Segmenter = undefined;
            Element.prototype.animate = undefined;
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        await page.locator('#btn-nav-3').click();
        await page.waitForFunction(() => faqState.initialized);
        return page;
    }
    async function settled(page, id) {
        await page.waitForFunction(id => faqState.animations.length === 0 && document.querySelector('#terminal-text').textContent === faqAnswers[id], id);
        await page.waitForTimeout(60);
    }
    async function assertLayout(page) {
        const geometry = await page.evaluate(() => {
            const content = document.querySelector('#terminal-text');
            const box = document.querySelector('#terminal-answer-viewport');
            const screen = document.querySelector('#screen-info');
            const scroll = document.querySelector('.info-scroll-area');
            return {
                content: content.getBoundingClientRect().height,
                box: box.getBoundingClientRect().height,
                bodyOverflow: document.documentElement.scrollWidth > innerWidth,
                screenOverflow: screen.scrollWidth > screen.clientWidth,
                textOverflow: content.scrollWidth > content.clientWidth,
                questionsOverflow: scroll.scrollWidth > scroll.clientWidth
            };
        });
        assert.ok(Math.abs(geometry.box - geometry.content) <= 1, JSON.stringify(geometry));
        for (const key of ['bodyOverflow', 'screenOverflow', 'textOverflow', 'questionsOverflow']) assert.equal(geometry[key], false, key);
    }
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
        const page = await newPage();
        await check('all 8 answers, preserved whitespace and single persistent selection', async () => {
            assert.equal(await page.locator('.faq-btn').count(), 8);
            for (let id = 1; id <= 8; id++) {
                await page.locator(`.faq-btn[data-faq-id="${id}"]`).click();
                await settled(page, id);
                assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[id - 1]);
                assert.equal(await page.locator('#faq-answer-live').textContent(), expectedAnswers[id - 1]);
                assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').count(), 1);
                assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').getAttribute('data-faq-id'), String(id));
                assert.equal(await page.locator('.faq-glyph').count(), Array.from(expectedAnswers[id - 1].replace(/\s/gu, '')).length);
                await assertLayout(page);
            }
        });
        await check('8 original inline SVGs and no emoji in the Info section', async () => {
            assert.equal(await page.locator('#screen-info svg.faq-icon').count(), 8);
            assert.equal(/\p{Extended_Pictographic}/u.test(await page.locator('#screen-info').textContent()), false);
        });
        await check('selection glow crossfades for 380 ms and stays steady afterwards', async () => {
            const styles = () => page.evaluate(() => [1, 8].map(id => {
                const style = getComputedStyle(document.querySelector(`.faq-btn[data-faq-id="${id}"]`));
                return { background: style.backgroundColor, shadow: style.boxShadow };
            }));
            const before = await styles();
            await page.evaluate(() => answerFAQ(1));
            await page.waitForTimeout(170);
            const during = await styles();
            await settled(page, 1);
            const after = await styles();
            for (let i = 0; i < 2; i++) {
                assert.notEqual(during[i].background, before[i].background);
                assert.notEqual(during[i].background, after[i].background);
            }
            assert.notEqual(after[0].shadow, 'none');
            assert.equal(after[1].shadow, 'none');
            await page.waitForTimeout(450);
            assert.deepEqual(await styles(), after);
        });
        await check('outgoing characters shrink and fade independently; selection updates immediately', async () => {
            await page.evaluate(() => answerFAQ(8));
            await settled(page, 8);
            await page.evaluate(() => answerFAQ(1));
            await page.waitForTimeout(80);
            const state = await page.evaluate(() => ({
                text: document.querySelector('#terminal-text').textContent,
                opacities: Array.from(document.querySelectorAll('.faq-glyph'), glyph => Number(getComputedStyle(glyph).opacity)),
                transform: getComputedStyle(document.querySelector('.faq-glyph')).transform,
                selected: document.querySelector('.faq-btn[aria-pressed="true"]').dataset.faqId
            }));
            assert.equal(state.text, expectedAnswers[7]);
            assert.equal(state.selected, '1');
            assert.ok(state.opacities[0] < state.opacities.at(-1));
            assert.notEqual(state.transform, 'matrix(1, 0, 0, 1, 0, 0)');
            await settled(page, 1);
        });
        await check('answer height grows and shrinks through intermediate frames without reflowing words', async () => {
            for (const id of [8, 1]) {
                await page.evaluate(id => answerFAQ(id), id);
                await page.waitForFunction(id => document.querySelector('#terminal-text').textContent === faqAnswers[id], id);
                const samples = await page.evaluate(async () => {
                    const box = document.querySelector('#terminal-answer-viewport');
                    const glyphs = Array.from(document.querySelectorAll('.faq-glyph'));
                    const positions = () => glyphs.map(glyph => `${glyph.offsetTop}:${glyph.offsetLeft}`).join('|');
                    const startPositions = positions();
                    const heights = [];
                    for (let i = 0; i < 12; i++) {
                        heights.push(box.getBoundingClientRect().height);
                        await new Promise(resolve => setTimeout(resolve, 40));
                    }
                    return { heights, stableLines: startPositions === positions() };
                });
                assert.ok(new Set(samples.heights.map(h => Math.round(h))).size > 3, JSON.stringify(samples));
                const first = samples.heights[0], last = samples.heights.at(-1);
                assert.ok(id === 8 ? last < first : last > first, JSON.stringify(samples));
                assert.equal(samples.stableLines, true);
                await settled(page, id);
                await assertLayout(page);
            }
        });
        await check('rapid switches during exit and entry cannot restore a stale answer', async () => {
            await page.evaluate(async () => {
                for (const id of [2, 7, 3, 4, 6]) {
                    answerFAQ(id);
                    await new Promise(resolve => setTimeout(resolve, 35));
                }
            });
            await page.waitForTimeout(400);
            await page.evaluate(() => answerFAQ(8));
            await settled(page, 8);
            await page.waitForTimeout(900);
            assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[7]);
            assert.equal(await page.evaluate(() => document.querySelector('#terminal-text').getAnimations({ subtree: true }).length), 0);
            assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.faq-glyph')).every(g => getComputedStyle(g).opacity === '1')), true);
        });
        await check('selection and answer survive leaving and re-entering Info', async () => {
            await page.locator('#btn-nav-1').click();
            await page.locator('#btn-nav-3').click();
            await page.waitForTimeout(500);
            assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[7]);
            assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').getAttribute('data-faq-id'), '8');
        });
        await check('mobile, narrow, landscape and desktop layouts; last question clears fixed fade', async () => {
            for (const viewport of [{ width: 280, height: 568 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 640, height: 360 }, { width: 768, height: 1024 }]) {
                await page.setViewportSize(viewport);
                await page.evaluate(() => answerFAQ(faqState.selectedId === 1 ? 8 : 1));
                await page.waitForTimeout(1000);
                await assertLayout(page);
                const geometry = await page.evaluate(() => {
                    const scroll = document.querySelector('.info-scroll-area');
                    scroll.scrollTop = scroll.scrollHeight;
                    const viewport = document.querySelector('.info-scroll-viewport');
                    return {
                        buttonBottom: document.querySelector('.faq-btn:last-child').getBoundingClientRect().bottom,
                        fadeTop: viewport.getBoundingClientRect().bottom - 32,
                        pointerEvents: getComputedStyle(viewport, '::after').pointerEvents
                    };
                });
                assert.ok(geometry.buttonBottom <= geometry.fadeTop + 1, JSON.stringify({ viewport, geometry }));
                assert.equal(geometry.pointerEvents, 'none');
            }
        });
        await check('live viewport resize during a transition measures the new text height', async () => {
            await page.setViewportSize({ width: 430, height: 800 });
            await page.evaluate(() => answerFAQ(8));
            await settled(page, 8);
            await page.evaluate(() => answerFAQ(1));
            await page.waitForTimeout(450);
            await page.setViewportSize({ width: 320, height: 568 });
            await settled(page, 1);
            await page.waitForTimeout(450);
            await assertLayout(page);
        });
        await check('reduced motion settles immediately, including when changed during animation', async () => {
            await page.evaluate(() => answerFAQ(3));
            await page.waitForTimeout(80);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await settled(page, 3);
            await page.locator('.faq-btn[data-faq-id="5"]').click();
            assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[4]);
            assert.equal(await page.evaluate(() => faqState.animations.length), 0);
            assert.equal(await page.locator('#terminal-answer-viewport').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
            await assertLayout(page);
        });
        await check('keyboard activation and accessible full-answer status', async () => {
            const question = page.locator('.faq-btn[data-faq-id="7"]');
            await question.focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('#faq-answer-live').textContent(), expectedAnswers[6]);
            assert.equal(await page.locator('#terminal-text').getAttribute('aria-hidden'), 'true');
            assert.equal(await question.getAttribute('aria-pressed'), 'true');
        });
        await check('older WebView fallbacks work without animation, ResizeObserver or Intl.Segmenter', async () => {
            const fallbackPage = await newPage({}, true);
            await fallbackPage.locator('.faq-btn[data-faq-id="1"]').click();
            assert.equal(await fallbackPage.locator('#terminal-text').textContent(), expectedAnswers[0]);
            await fallbackPage.setViewportSize({ width: 320, height: 568 });
            await fallbackPage.waitForTimeout(500);
            await assertLayout(fallbackPage);
            await fallbackPage.context().close();
        });
        if (process.env.SOL_FAQ_SCREENSHOT_DIR) {
            await fs.mkdir(process.env.SOL_FAQ_SCREENSHOT_DIR, { recursive: true });
            for (const width of [320, 390]) {
                await page.setViewportSize({ width, height: 844 });
                await page.evaluate(() => { document.activeElement.blur(); answerFAQ(1); document.querySelector('#screen-info').scrollTop = 0; document.querySelector('.info-scroll-area').scrollTop = 0; });
                await page.waitForTimeout(500);
                await page.screenshot({ path: path.join(process.env.SOL_FAQ_SCREENSHOT_DIR, `info-${width}.png`) });
            }
        }
        assert.deepEqual(errors, [], 'browser JavaScript errors');
        console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
