// Run with Node.js and Playwright available: node tests/info-faq.cjs
// Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, SOL_FAQ_SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const expectedAnswers = [
    "Перейдите во вкладку «Туннель», нажмите фиолетовую кнопку и дождитесь подключения. Затем скопируйте ваш VLESS-ключ и вставьте его в приложение-клиент, например v2RayTun, HAPP или другое совместимое приложение.",
    "После подключения во вкладке «Туннель» нажмите кнопку «Скопировать». Полученный ключ вставьте в приложение-клиент.",
    "Наши серверы имеют пропускную способность до 1 Гбит/с. В будущем планируется увеличение скорости. Фактическая скорость подключения зависит от сети и устройства.",
    "К одному ключу можно подключить до 10 устройств. Каждое дополнительное устройство оплачивается отдельно. Стоимость одинакова для всех тарифов.",
    "Перейдите в раздел «Игры», ловите кометы и получайте увеличение реферального процента и другие бонусы.",
    "Охота на кометы доступна только пользователям с активной подпиской SOL VPN. Приобрести подписку можно во вкладке «Кабинет».",
    "Дождитесь появления кометы в зоне действия радара. Нажмите мышкой или кликните пальцем по комете, чтобы поймать её.",
    "Да! VLESS-ключ совместим с компьютерами, смартфонами, роутерами и другими устройствами, поддерживающими соответствующий протокол и настройки подключения.",
    "Мы подобрали сервис для покупки Telegram Stars. Перед покупкой сравните условия."
];
const expectedQuestions = [
    "Как подключить VPN?",
    "Где взять VLESS-ключ?",
    "Где купить Telegram Stars?",
    "Работает ли VPN на ПК?",
    "Какая максимальная скорость?",
    "Сколько устройств можно подключить?",
    "Почему заблокированы игры?",
    "Как ловить кометы?",
    "Как повысить процент по реферальной системе?"
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
        } else if (['/', '/index.html', '/app.js', '/appearance.js', '/miniapp-ui.js', '/style.css', '/appearance.css', '/miniapp-ui.css', '/support.css', '/support.js'].includes(name)) {
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
            window.openedFaqLinks = [];
            window.Telegram = { WebApp: { initData: 'local-test', ready() {}, expand() {}, openTelegramLink(url) { openedFaqLinks.push(url); }, HapticFeedback: { selectionChanged() {}, impactOccurred() {} } } };
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
        await page.waitForFunction(id => faqState.animations.length === 0 && faqState.actionAnimations.length === 0 && !faqState.heightAnimation && document.querySelector('#terminal-text').textContent === faqAnswers[id], id);
        await page.waitForTimeout(60);
    }
    async function assertLayout(page) {
        const geometry = await page.evaluate(() => {
            const content = document.querySelector('#terminal-text');
            const box = document.querySelector('#terminal-answer-viewport');
            const actions = document.querySelector('#faq-answer-actions');
            const screen = document.querySelector('#screen-info');
            const scroll = document.querySelector('.info-scroll-area');
            return {
                content: content.getBoundingClientRect().height + (actions.hidden ? 0 : actions.getBoundingClientRect().height),
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
        await check('all 9 answers, requested question order and single selection', async () => {
            assert.equal(await page.locator('.faq-btn').count(), 9);
            assert.deepEqual(await page.locator('.faq-btn > span').allTextContents(), expectedQuestions);
            for (let id = 1; id <= 9; id++) {
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
        await check('9 white inline SVGs including handshake and no emoji in Info', async () => {
            assert.equal(await page.locator('#screen-info svg.faq-icon').count(), 9);
            assert.equal(/\p{Extended_Pictographic}/u.test(await page.locator('#screen-info').textContent()), false);
        });
        await check('only Helper Stars link remains even when obsolete configuration is enabled', async () => {
            assert.equal(await page.locator('#faq-answer-actions .faq-star-row').count(), 1);
            assert.equal(await page.locator('#faq-answer-actions a').getAttribute('href'), 'https://t.me/HelperStars_Robot?start=8544752152');
            assert.equal(await page.locator('#faq-answer-actions a').textContent(), 'Перейти');
            assert.equal(await page.locator('#faq-answer-actions').textContent(), 'Перейти');
            await page.getByRole('link', { name: 'Перейти', exact: true }).click();
            assert.deepEqual(await page.evaluate(() => openedFaqLinks), ['https://t.me/HelperStars_Robot?start=8544752152']);
            await page.evaluate(() => { window.SOL_FAQ_STARS_SECOND_ENABLED = true; faqState.selectedId = null; answerFAQ(9); });
            await settled(page,9); assert.equal(await page.locator('#faq-answer-actions a').count(),1);
            assert.equal(await page.locator('#faq-answer-actions [href*="x10"]').count(),0);
            await page.evaluate(() => answerFAQ(8)); await settled(page,8);
        });
        await check('Liquid Rise follows the text and grows the terminal smoothly for one button', async () => {
            await page.evaluate(() => answerFAQ(9));
            await page.waitForFunction(() => !document.querySelector('#faq-answer-actions').hidden && faqState.actionAnimations.length === 1);
            const evidence = await page.evaluate(async () => {
                const timings = faqState.actionAnimations.map(animation => ({ duration: animation.effect.getTiming().duration, delay: animation.effect.getTiming().delay, easing: animation.effect.getTiming().easing,
                    transform: animation.effect.getKeyframes()[0].transform, filter: animation.effect.getKeyframes()[0].filter }));
                const rows = [...document.querySelectorAll('#faq-answer-actions .faq-star-row')];
                const samples = [];
                for (let i = 0; i < 55; i++) {
                    const bounds = document.querySelector('#terminal-answer-viewport').getBoundingClientRect();
                    samples.push({ height: bounds.height, opacity: rows.map(row => Number(getComputedStyle(row).opacity)),
                        clipped: rows.some(row => Number(getComputedStyle(row).opacity) > .25 && row.getBoundingClientRect().bottom > bounds.bottom + 1) });
                    await new Promise(resolve => setTimeout(resolve, 16));
                }
                return { timings, samples, textAnimationDone: faqState.animations.length === 0 };
            });
            assert.deepEqual(evidence.timings.map(t => t.duration), [400]);
            assert.ok(evidence.timings[0].delay >= 0 && evidence.timings[0].delay <= 400);
            assert.ok(evidence.timings.every(t => t.transform === 'translateY(18px)' && t.filter === 'blur(2px)' && t.easing === 'cubic-bezier(0.22, 1, 0.36, 1)'));
            assert.ok(evidence.samples.some(s => s.opacity[0] > .25 && s.opacity[0] < .95));
            assert.ok(new Set(evidence.samples.map(s => Math.round(s.height))).size > 3);
            assert.ok(evidence.samples.every((s, index, all) => !index || s.height >= all[index-1].height - .6));
            assert.equal(evidence.samples.some(s => s.clipped), false);
            assert.equal(evidence.textAnimationDone, true);
            await settled(page, 9); await assertLayout(page);
        });
        await check('switching and re-entering Info remove action rows and cannot restore a stale answer', async () => {
            const linksBefore = await page.evaluate(() => openedFaqLinks.length);
            await page.evaluate(() => { const stale = document.querySelector('#faq-answer-actions a'); answerFAQ(1); stale.click(); });
            assert.equal(await page.evaluate(() => openedFaqLinks.length), linksBefore);
            assert.equal(await page.locator('#faq-answer-actions').evaluate(el => el.hidden), true);
            assert.equal(await page.locator('.faq-actions-outgoing a[href]').count(), 0);
            await settled(page, 1);
            assert.equal(await page.locator('#screen-info .faq-star-row').count(), 0);
            await page.evaluate(() => answerFAQ(9));
            await page.waitForTimeout(160);
            await page.locator('#btn-nav-1').click(); await page.locator('#btn-nav-3').click();
            await page.waitForFunction(() => !faqState.animations.length && !faqState.heightAnimation && faqState.targetText === defaultInfoText);
            await page.waitForTimeout(1000);
            assert.equal(await page.locator('#terminal-text').textContent(), await page.evaluate(() => defaultInfoText));
            assert.equal(await page.locator('#screen-info .faq-star-row').count(), 0);
            assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').count(), 0);
            await assertLayout(page);
        });
        await check('selection glow crossfades for 380 ms and stays steady afterwards', async () => {
            await page.evaluate(() => answerFAQ(8)); await settled(page, 8);
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
        await check('old and new letters overlap as a continuous wave with no empty frame', async () => {
            await page.evaluate(() => answerFAQ(5)); await settled(page, 5);
            const evidence = await page.evaluate(async () => {
                answerFAQ(1);
                const samples = [];
                for (let i = 0; i < 100; i++) {
                    const outgoing = Array.from(document.querySelectorAll('.faq-outgoing-layer .faq-glyph'));
                    const incoming = Array.from(document.querySelectorAll('.faq-current-layer .faq-glyph'));
                    const visible = list => list.filter(g => Number(getComputedStyle(g).opacity) > 0.04).length;
                    samples.push({ old: visible(outgoing), next: visible(incoming),
                        oldTail: outgoing.length ? Number(getComputedStyle(outgoing.at(-1)).opacity) : 0,
                        newHead: incoming.length ? Number(getComputedStyle(incoming[0]).opacity) : 0,
                        oldHeadScale: outgoing.length ? getComputedStyle(outgoing[0]).transform : '',
                        oldHeadBlur: outgoing.length ? getComputedStyle(outgoing[0]).filter : '',
                        newTail: incoming.length ? Number(getComputedStyle(incoming.at(-1)).opacity) : 0 });
                    await new Promise(resolve => setTimeout(resolve, 16));
                }
                return samples;
            });
            assert.ok(evidence.every(frame => frame.old + frame.next > 0), 'terminal must never be empty');
            assert.ok(evidence.some(frame => frame.newHead > 0.1 && frame.oldTail > 0.9), 'new prefix must appear before old tail disappears');
            assert.ok(evidence.some(frame => frame.newHead > 0.8 && frame.newTail < 0.1), 'wave must travel left to right');
            assert.ok(evidence.some(frame => frame.oldHeadScale.includes('matrix(') && frame.oldHeadBlur !== 'blur(0px)'));
            await settled(page, 1);
        });
        await check('short/long height changes preserve word layout and never clip readable glyphs', async () => {
            for (const id of [5, 1]) {
                const samples = await page.evaluate(async id => {
                    answerFAQ(id);
                    const box = document.querySelector('#terminal-answer-viewport');
                    const incoming = document.querySelector('.faq-current-layer');
                    const positions = () => Array.from(incoming.querySelectorAll('.faq-glyph'), glyph => `${glyph.offsetTop}:${glyph.offsetLeft}`).join('|');
                    const startPositions = positions(), heights = [];
                    let clipped = 0;
                    for (let i = 0; i < 65; i++) {
                        heights.push(box.getBoundingClientRect().height);
                        const bounds = box.getBoundingClientRect();
                        for (const glyph of document.querySelectorAll('#terminal-text .faq-glyph')) {
                            if (Number(getComputedStyle(glyph).opacity) > 0.25 && glyph.getBoundingClientRect().bottom > bounds.bottom + 1) clipped++;
                        }
                        await new Promise(resolve => setTimeout(resolve, 35));
                    }
                    return { heights, stableLines: startPositions === positions(), clipped };
                }, id);
                assert.ok(new Set(samples.heights.map(h => Math.round(h))).size > 3, JSON.stringify(samples));
                assert.ok(id === 5 ? samples.heights.at(-1) < samples.heights[0] : samples.heights.at(-1) > samples.heights[0]);
                assert.equal(samples.stableLines, true);
                assert.equal(samples.clipped, 0);
                await settled(page, id); await assertLayout(page);
            }
        });
        await check('interruption freezes the current frame and keeps only two visual layers', async () => {
            const evidence = await page.evaluate(async () => {
                answerFAQ(5);
                await new Promise(resolve => setTimeout(resolve, 330));
                const before = Array.from(document.querySelectorAll('#terminal-text .faq-glyph'))
                    .filter(g => Number(getComputedStyle(g).opacity) > 0.02)
                    .map(g => ({ node: g, rect: g.getBoundingClientRect(), opacity: Number(getComputedStyle(g).opacity) }));
                answerFAQ(2);
                const drift = Math.max(0, ...before.map(frame => {
                    const box = frame.node.getBoundingClientRect();
                    return Math.max(Math.abs(box.left-frame.rect.left), Math.abs(box.top-frame.rect.top), Math.abs(Number(getComputedStyle(frame.node).opacity)-frame.opacity));
                }));
                let maxLayers = 0, maxGlyphs = 0;
                for (let round=0; round<3; round++) for (let id=1; id<=8; id++) {
                    answerFAQ(id);
                    maxLayers = Math.max(maxLayers, document.querySelector('#terminal-text').children.length);
                    maxGlyphs = Math.max(maxGlyphs, document.querySelectorAll('#terminal-text .faq-glyph').length);
                    await new Promise(resolve => setTimeout(resolve, 40));
                }
                return { drift, maxLayers, maxGlyphs };
            });
            assert.ok(evidence.drift < 0.6, JSON.stringify(evidence));
            assert.equal(evidence.maxLayers, 2);
            assert.ok(evidence.maxGlyphs < 3 * Math.max(...expectedAnswers.map(text => text.length)), JSON.stringify(evidence));
            await settled(page, 8);
            assert.equal(await page.locator('.faq-outgoing-layer').count(), 0);
            assert.equal(await page.locator('#terminal-text > div').count(), 1);
        });
        await check('repeated taps on the same question do not restart the wave', async () => {
            const result = await page.evaluate(() => {
                answerFAQ(7);
                const revision = faqState.revision, animations = faqState.animations;
                for(let i=0;i<30;i++) answerFAQ(7);
                return { sameRevision: faqState.revision === revision, sameAnimations: faqState.animations === animations };
            });
            assert.deepEqual(result, { sameRevision: true, sameAnimations: true });
            await settled(page, 7);
        });
        await check('rapid switches during exit and entry cannot restore a stale answer', async () => {
            await page.evaluate(async () => {
                for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
                    answerFAQ(id);
                    await new Promise(resolve => setTimeout(resolve, 35));
                }
            });
            await page.waitForTimeout(400);
            await page.evaluate(() => answerFAQ(8));
            await settled(page, 8);
            await page.waitForTimeout(1800);
            assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[7]);
            assert.equal(await page.evaluate(() => document.querySelector('#terminal-text').getAnimations({ subtree: true }).length), 0);
            assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.faq-glyph')).every(g => getComputedStyle(g).opacity === '1')), true);
        });
        await check('returning to Info resets selection, answer and previous animations', async () => {
            await page.locator('#btn-nav-1').click();
            await page.locator('#btn-nav-3').click();
            await page.waitForFunction(() => !faqState.animations.length && !faqState.heightAnimation && faqState.targetText === defaultInfoText);
            assert.equal(await page.locator('#terminal-text').textContent(), 'Нажмите на любой вопрос ниже. Ваш ответ появится здесь. Если нужной темы нет — напишите в нашу техподдержку.');
            assert.equal(await page.locator('.faq-btn[aria-pressed="true"]').count(), 0);
            assert.equal(await page.evaluate(() => faqState.selectedId), null);
            assert.equal(await page.locator('#faq-answer-actions').evaluate(el => el.hidden), true);
            await assertLayout(page);
        });
        await check('mobile, narrow, landscape and desktop layouts; last question clears fixed fade', async () => {
            for (const viewport of [{ width: 280, height: 568 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 640, height: 360 }, { width: 768, height: 1024 }]) {
                await page.setViewportSize(viewport);
                const selected = await page.evaluate(() => { const id = faqState.selectedId === 1 ? 5 : 1; answerFAQ(id); return id; });
                await settled(page, selected);
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
            await page.locator('.faq-btn[data-faq-id="9"]').click();
            assert.equal(await page.locator('#terminal-text').textContent(), expectedAnswers[8]);
            assert.equal(await page.locator('#faq-answer-actions .faq-star-row').count(), 1);
            assert.equal(await page.evaluate(() => faqState.actionAnimations.length), 0);
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
        await check('verified disclosure configuration stays plain text and its expansion updates height', async () => {
            await page.evaluate(() => {
                window.SOL_FAQ_STARS_AD_INFO = { advertiser: 'Тестовый рекламодатель <b>пример</b>', erid: 'test-only', detailsUrl: 'javascript:alert(1)' };
                answerFAQ(9);
            });
            await settled(page, 9);
            assert.equal(await page.locator('.faq-ad-info summary').textContent(), 'Реклама · сведения');
            await page.locator('.faq-ad-info summary').click();
            await page.waitForTimeout(80);
            assert.equal(await page.locator('.faq-ad-info b').count(), 0);
            assert.match(await page.locator('.faq-ad-info').textContent(), /Тестовый рекламодатель <b>пример<\/b>/);
            assert.equal(await page.locator('.faq-ad-info a').count(), 0);
            await assertLayout(page);
            await page.evaluate(() => { window.SOL_FAQ_STARS_AD_INFO = undefined; answerFAQ(1); });
        });
        await check('older WebView fallbacks work without animation, ResizeObserver or Intl.Segmenter', async () => {
            const fallbackPage = await newPage({}, true);
            await fallbackPage.locator('.faq-btn[data-faq-id="1"]').click();
            assert.equal(await fallbackPage.locator('#terminal-text').textContent(), expectedAnswers[0]);
            await fallbackPage.setViewportSize({ width: 320, height: 568 });
            await fallbackPage.waitForTimeout(500);
            await assertLayout(fallbackPage);
            await fallbackPage.locator('.faq-btn[data-faq-id="9"]').click();
            assert.equal(await fallbackPage.locator('#faq-answer-actions .faq-star-row').count(), 1);
            await assertLayout(fallbackPage);
            await fallbackPage.context().close();
        });
        await check('touch input at Android mobile dimensions runs the same continuous wave', async () => {
            const mobile = await newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
            await mobile.locator('.faq-btn[data-faq-id="1"]').tap(); await settled(mobile, 1);
            await mobile.locator('.faq-btn[data-faq-id="5"]').tap(); await settled(mobile, 5);
            await assertLayout(mobile);
            await mobile.context().close();
        });
        await check('spaces, newlines, numbers, punctuation and grapheme clusters remain intact', async () => {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            const text = 'А  12, e\u0301 — тест.\n\nСледующая строка!';
            await page.evaluate(text => animateDipText(text), text);
            await page.waitForFunction(text => faqState.animations.length === 0 && !faqState.heightAnimation && document.querySelector('#terminal-text').textContent === text, text);
            assert.equal(await page.locator('#terminal-text').textContent(), text);
            assert.equal(await page.locator('.faq-glyph').count(), Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text)).filter(item => !/^\s+$/u.test(item.segment)).length);
            await assertLayout(page);
            await page.evaluate(() => { faqState.selectedId = null; answerFAQ(1); }); await settled(page, 1);
        });
        if (process.env.SOL_FAQ_SCREENSHOT_DIR) {
            await fs.mkdir(process.env.SOL_FAQ_SCREENSHOT_DIR, { recursive: true });
            for (const width of [320, 390]) {
                await page.setViewportSize({ width, height: 844 });
                await page.evaluate(() => { document.activeElement.blur(); answerFAQ(1); document.querySelector('#screen-info').scrollTop = 0; document.querySelector('.info-scroll-area').scrollTop = 0; });
                await settled(page, 1);
                await page.screenshot({ path: path.join(process.env.SOL_FAQ_SCREENSHOT_DIR, `info-${width}.png`) });
                await page.evaluate(() => answerFAQ(9)); await settled(page, 9);
                await page.screenshot({ path: path.join(process.env.SOL_FAQ_SCREENSHOT_DIR, `info-stars-${width}.png`) });
            }
        }
        if (process.env.SOL_FAQ_PREVIEW_DIR) {
            const directory = process.env.SOL_FAQ_PREVIEW_DIR;
            await fs.mkdir(directory, { recursive: true });
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.setViewportSize({ width: 390, height: 740 });
            await page.evaluate(() => { document.activeElement.blur(); document.querySelector('#screen-info').scrollTop = 0; answerFAQ(5); });
            await settled(page, 5);
            const frames = [], start = Date.now();
            let long = false, short = false;
            while (Date.now() - start < 6000) {
                const elapsed = Date.now() - start;
                if (!long && elapsed > 450) { await page.evaluate(() => answerFAQ(1)); long = true; }
                if (!short && elapsed > 3300) { await page.evaluate(() => answerFAQ(5)); short = true; }
                const filename = path.join(directory, `frame-${String(frames.length).padStart(3, '0')}.png`);
                frames.push({ path: filename, time: Date.now() - start });
                await page.screenshot({ path: filename });
                await page.waitForTimeout(65);
            }
            await fs.writeFile(path.join(directory, 'frames.json'), JSON.stringify(frames));
        }
        assert.deepEqual(errors, [], 'browser JavaScript errors');
        console.log(`${checks} checks passed; no browser JavaScript errors.`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
