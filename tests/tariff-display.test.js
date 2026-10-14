"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    catalogFromBootstrap,
    formatKopecks,
    paymentCatalogFromBootstrap,
    selectionSnapshot,
    tariffDisplay
} = require("../tariff-display.js");

function tariff(months, original, price, discount) {
    return {
        months,
        title: `${months} мес.`,
        original_price_kopecks: original,
        price_kopecks: price,
        discount_percent: discount
    };
}

test("formats integer kopecks without floating-point rounding", () => {
    assert.equal(formatKopecks(19_900), "199");
    assert.equal(formatKopecks(179_900), "1 799");
    assert.equal(formatKopecks(82_917), "829,17");
    assert.equal(formatKopecks(13_333), "133,33");
});

test("does not invent an old crossed-out price without a discount", () => {
    const display = tariffDisplay(tariff(1, 19_900, 19_900, 0));
    assert.equal(display.hasDiscount, false);
    assert.equal(display.originalPrice, "");
    assert.equal(display.discountLabel, "");
    assert.equal(display.finalPrice, "199");
});

test("shows server-provided old price, final price and discount", () => {
    const display = tariffDisplay(tariff(6, 99_900, 82_917, 17));
    assert.equal(display.hasDiscount, true);
    assert.equal(display.originalPrice, "999");
    assert.equal(display.finalPrice, "829,17");
    assert.equal(display.discountLabel, "−17%");
});

test("a refreshed bootstrap replaces an older discount even when it is lower", () => {
    const first = catalogFromBootstrap([tariff(3, 54_900, 38_430, 30)]);
    const replacement = catalogFromBootstrap([tariff(3, 54_900, 49_410, 10)]);
    assert.equal(first[3].discount_percent, 30);
    assert.equal(replacement[3].discount_percent, 10);
    assert.equal(replacement[3].price_kopecks, 49_410);
});

test("rapid tariff selection always resolves to the latest card", () => {
    const catalog = catalogFromBootstrap([
        tariff(1, 19_900, 19_900, 0),
        tariff(3, 54_900, 54_900, 0),
        tariff(6, 99_900, 99_900, 0),
        tariff(12, 179_900, 179_900, 0)
    ]);
    const clicks = [1, 12, 3, 6];
    let selected = null;
    clicks.forEach(months => { selected = selectionSnapshot(catalog, months); });
    assert.equal(selected.months, 6);
    assert.equal(selected.display.finalPrice, "999");
});

test("Telegram Stars catalog uses only enabled server-provided XTR values", () => {
    const disabled = paymentCatalogFromBootstrap({enabled:false, currency:"XTR", tariffs:[{months:1, original_amount:100, amount:80, discount_percent:20}]});
    assert.equal(disabled.enabled, false);
    assert.deepEqual(disabled.catalog, {});
    const stars = paymentCatalogFromBootstrap({enabled:true, currency:"XTR", tariffs:[{months:1, original_amount:100, amount:80, discount_percent:20}]});
    assert.equal(stars.enabled, true);
    assert.equal(stars.currency, "XTR");
    assert.equal(stars.catalog[1].price_kopecks, 80);
    assert.equal(tariffDisplay(stars.catalog[1]).finalPrice, "80");
});

test("payment catalog rejects an unexpected currency instead of relabeling RUB", () => {
    const result = paymentCatalogFromBootstrap({enabled:true, currency:"RUB", tariffs:[{months:1, original_amount:19900, amount:19900, discount_percent:0}]});
    assert.equal(result.enabled, false);
    assert.deepEqual(result.catalog, {});
});

test("frontend contains no fallback tariff prices and loads tariff helper before app", () => {
    const projectRoot = path.resolve(__dirname, "..");
    const app = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
    const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
    assert.equal(/(?:199|549|999|1799)\s*[₽р]/u.test(app), false);
    assert.equal(/(?:199|549|999|1799)\s*[₽р]/u.test(html), false);
    assert.ok(html.indexOf("tariff-display.js?v=5006") < html.indexOf("app.js?v=5006"));
    assert.match(app, /apiFetch\("\/api\/payments\/invoice"/u);
    assert.match(app, /expected_currency: paymentConfig\.currency/u);
    assert.match(app, /expected_amount: selection\.tariff\.price_kopecks/u);
    assert.match(app, /paymentConfig\.currency === "XTR"/u);
    assert.match(app, /Оплата временно недоступна/u);
    assert.doesNotMatch(app, /ЮKassa/u);
});
