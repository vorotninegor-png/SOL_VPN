(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SolTariffDisplay = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function integer(value) {
        const number = Number(value);
        return Number.isInteger(number) ? number : null;
    }

    function formatKopecks(value) {
        const kopecks = integer(value);
        if (kopecks === null || kopecks < 0) return "—";
        const rubles = Math.trunc(kopecks / 100);
        const fraction = kopecks % 100;
        const groupedRubles = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
        return fraction ? `${groupedRubles},${String(fraction).padStart(2, "0")}` : groupedRubles;
    }

    function normalizeTariff(raw) {
        if (!raw || typeof raw !== "object") return null;
        const months = integer(raw.months);
        const originalPrice = integer(raw.original_price_kopecks);
        const price = integer(raw.price_kopecks);
        const discount = integer(raw.discount_percent);
        if (!months || originalPrice === null || originalPrice < 1 || price === null || price < 1) return null;
        if (discount === null || discount < 0 || discount > 95 || price > originalPrice) return null;
        return {
            ...raw,
            months,
            original_price_kopecks: originalPrice,
            price_kopecks: price,
            discount_percent: discount
        };
    }

    function catalogFromBootstrap(tariffs) {
        const catalog = {};
        if (!Array.isArray(tariffs)) return catalog;
        tariffs.forEach(raw => {
            const tariff = normalizeTariff(raw);
            if (tariff) catalog[tariff.months] = tariff;
        });
        return catalog;
    }

    function tariffDisplay(tariff) {
        const normalized = normalizeTariff(tariff);
        if (!normalized) {
            return { valid: false, finalPrice: "—", originalPrice: "", discountLabel: "", hasDiscount: false };
        }
        const hasDiscount = normalized.discount_percent > 0
            && normalized.price_kopecks < normalized.original_price_kopecks;
        return {
            valid: true,
            finalPrice: formatKopecks(normalized.price_kopecks),
            originalPrice: hasDiscount ? formatKopecks(normalized.original_price_kopecks) : "",
            discountLabel: hasDiscount ? `−${normalized.discount_percent}%` : "",
            hasDiscount
        };
    }

    function selectionSnapshot(catalog, selectedMonths) {
        const months = integer(selectedMonths);
        const tariff = months && catalog ? catalog[months] : null;
        return tariff ? { months, tariff, display: tariffDisplay(tariff) } : null;
    }

    return {
        catalogFromBootstrap,
        formatKopecks,
        normalizeTariff,
        selectionSnapshot,
        tariffDisplay
    };
}));
