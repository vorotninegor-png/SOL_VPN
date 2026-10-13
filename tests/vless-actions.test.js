"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createVlessClipboard,
    getImportInstructions,
    isVlessUri
} = require("../vless-actions.js");

const VLESS_URI = "vless://12345678-1234-4234-9234-123456789abc@example.test:443?security=reality#SOL";

function createFakeDocument(copyResult = true) {
    const created = [];
    const appended = [];
    const documentObject = {
        created,
        appended,
        body: {
            appendChild(element) {
                appended.push(element);
                element.parentNode = this;
            }
        },
        createElement(tagName) {
            const element = {
                tagName,
                style: {},
                attributes: {},
                focused: false,
                selected: false,
                removed: false,
                setAttribute(name, value) { this.attributes[name] = value; },
                focus() { this.focused = true; },
                select() { this.selected = true; },
                setSelectionRange(start, end) { this.selection = [start, end]; },
                remove() { this.removed = true; }
            };
            created.push(element);
            return element;
        },
        execCommand(command) {
            assert.equal(command, "copy");
            return copyResult;
        }
    };
    return documentObject;
}

test("copies a VLESS URI with Clipboard API when permission is available", async () => {
    const writes = [];
    const clipboard = createVlessClipboard({
        navigatorObject: { clipboard: { writeText: async value => writes.push(value) } },
        documentObject: createFakeDocument()
    });

    assert.deepEqual(await clipboard.copy(VLESS_URI), { ok: true, method: "clipboard" });
    assert.deepEqual(writes, [VLESS_URI]);
});

test("uses a temporary textarea fallback after Clipboard API rejection", async () => {
    const documentObject = createFakeDocument(true);
    const clipboard = createVlessClipboard({
        navigatorObject: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
        documentObject
    });

    assert.deepEqual(await clipboard.copy(VLESS_URI), { ok: true, method: "exec-command" });
    assert.equal(documentObject.created[0].value, VLESS_URI);
    assert.equal(documentObject.created[0].selected, true);
    assert.equal(documentObject.created[0].removed, true);
});

test("reports manual-copy mode when Clipboard API and fallback both fail", async () => {
    const clipboard = createVlessClipboard({
        navigatorObject: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
        documentObject: createFakeDocument(false)
    });

    assert.deepEqual(await clipboard.copy(VLESS_URI), {
        ok: false,
        method: "manual",
        reason: "copy_failed"
    });
});

test("does not attempt copying when the VLESS key is missing or invalid", async () => {
    let attempts = 0;
    const clipboard = createVlessClipboard({
        navigatorObject: { clipboard: { writeText: async () => { attempts += 1; } } },
        documentObject: createFakeDocument()
    });

    assert.deepEqual(await clipboard.copy(""), { ok: false, method: "none", reason: "missing_key" });
    assert.deepEqual(await clipboard.copy("https://example.test/key"), { ok: false, method: "none", reason: "missing_key" });
    assert.equal(attempts, 0);
    assert.equal(isVlessUri(VLESS_URI), true);
});

test("rapid repeated copy calls share one in-flight clipboard operation", async () => {
    let attempts = 0;
    let resolveWrite;
    const pendingWrite = new Promise(resolve => { resolveWrite = resolve; });
    const clipboard = createVlessClipboard({
        navigatorObject: {
            clipboard: {
                writeText: async () => {
                    attempts += 1;
                    await pendingWrite;
                }
            }
        },
        documentObject: createFakeDocument()
    });

    const first = clipboard.copy(VLESS_URI);
    const second = clipboard.copy(VLESS_URI);
    assert.strictEqual(first, second);
    assert.equal(attempts, 1);
    resolveWrite();
    assert.deepEqual(await first, { ok: true, method: "clipboard" });
});

test("import instructions cover clipboard import without unsupported direct navigation", () => {
    const instructions = getImportInstructions();
    assert.deepEqual(instructions.map(item => item.id), ["happ", "hiddify", "v2rayng"]);
    instructions.forEach(item => assert.match(item.text, /буфер/iu));

    const projectRoot = path.resolve(__dirname, "..");
    const app = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
    const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
    assert.equal(app.includes("window.location.href = currentVlessUri"), false);
    assert.equal(app.includes("localStorage.setItem"), false);
    assert.equal(app.includes("console.log(currentVlessUri"), false);
    assert.match(html, /КЛЮЧ НЕ ПОЛУЧЕН/u);
    assert.match(html, /Ключ готов/u);
    assert.match(html, /Скопировать/u);
    assert.match(app, /Ошибка копирования/u);
});
