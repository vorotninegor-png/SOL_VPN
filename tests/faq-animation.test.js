"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    characterDelay,
    createFaqAnimator,
    splitGraphemes,
    tokenizeFaqText
} = require("../faq-animation.js");

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.values = new Set();
    }

    setFromString(value) {
        this.values = new Set(String(value || "").split(/\s+/).filter(Boolean));
    }

    add(...values) {
        values.forEach(value => this.values.add(value));
    }

    remove(...values) {
        values.forEach(value => this.values.delete(value));
    }

    contains(value) {
        return this.values.has(value);
    }

    toString() {
        return Array.from(this.values).join(" ");
    }
}

class FakeElement {
    constructor(ownerDocument, tagName = "div", isFragment = false) {
        this.ownerDocument = ownerDocument;
        this.tagName = tagName;
        this.isFragment = isFragment;
        this.children = [];
        this.parentNode = null;
        this._textContent = "";
        this.classList = new FakeClassList(this);
        this.style = {
            height: "",
            overflow: "",
            values: new Map(),
            setProperty(name, value) {
                this.values.set(name, value);
            }
        };
    }

    set className(value) {
        this.classList.setFromString(value);
    }

    get className() {
        return this.classList.toString();
    }

    set textContent(value) {
        this.children = [];
        this._textContent = String(value || "");
    }

    get textContent() {
        return this._textContent + this.children.map(child => child.textContent).join("");
    }

    appendChild(child) {
        if (child.isFragment) {
            child.children.slice().forEach(item => this.appendChild(item));
            child.children = [];
            return child;
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children = [];
        this._textContent = "";
        children.forEach(child => this.appendChild(child));
    }

    querySelectorAll(selector) {
        const className = selector.startsWith(".") ? selector.slice(1) : "";
        const matches = [];
        const visit = element => {
            element.children.forEach(child => {
                if (child.classList.contains(className)) matches.push(child);
                visit(child);
            });
        };
        visit(this);
        return matches;
    }

    getBoundingClientRect() {
        const explicitHeight = Number.parseFloat(this.style.height);
        const naturalHeight = 80 + Math.ceil(this.textContent.length / 42) * 22;
        return { height: Number.isFinite(explicitHeight) ? explicitHeight : naturalHeight };
    }

    get scrollHeight() {
        return 80 + Math.ceil(this.textContent.length / 42) * 22;
    }

    get offsetHeight() {
        return this.getBoundingClientRect().height;
    }
}

class FakeDocument {
    createElement(tagName) {
        return new FakeElement(this, tagName);
    }

    createDocumentFragment() {
        return new FakeElement(this, "fragment", true);
    }
}

function createScheduler() {
    let nextId = 1;
    const timers = new Map();
    const frames = new Map();
    return {
        setTimeout(callback) {
            const id = nextId++;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        requestAnimationFrame(callback) {
            const id = nextId++;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            frames.delete(id);
        },
        runAll() {
            let guard = 0;
            while ((timers.size || frames.size) && guard < 100) {
                const callbacks = [...frames.values(), ...timers.values()];
                frames.clear();
                timers.clear();
                callbacks.forEach(callback => callback());
                guard += 1;
            }
            assert.ok(guard < 100, "scheduler must settle without timer accumulation");
        }
    };
}

function createFixture(reducedMotion = false) {
    const documentObject = new FakeDocument();
    const box = documentObject.createElement("section");
    const container = documentObject.createElement("div");
    box.appendChild(container);
    const scheduler = createScheduler();
    const animator = createFaqAnimator({
        container,
        box,
        motionQuery: { matches: reducedMotion },
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        requestAnimationFrame: scheduler.requestAnimationFrame,
        cancelAnimationFrame: scheduler.cancelAnimationFrame
    });
    return { animator, box, container, scheduler };
}

test("tokenizer preserves spaces and keeps words grouped for mobile wrapping", () => {
    const tokens = tokenizeFaqText("SOL VPN\nработает");
    assert.deepEqual(tokens.map(token => token.type), ["word", "space", "word", "space", "word"]);
    assert.equal(tokens.map(token => token.value || token.characters.join("")).join(""), "SOL VPN\nработает");
    assert.equal(splitGraphemes("☄️").length, 1);
});

test("long answers keep staggered delays through their final characters", () => {
    const count = 220;
    const penultimateDelay = characterDelay(count - 2, count);
    const finalDelay = characterDelay(count - 1, count);
    assert.ok(penultimateDelay < finalDelay);
    assert.equal(finalDelay, 360);
});

test("animation renders individual characters and settles its height", () => {
    const { animator, box, container, scheduler } = createFixture();
    animator.show("Ключ готов");
    assert.equal(container.querySelectorAll(".faq-char").length, 9);
    assert.equal(box.classList.contains("faq-height-transition"), true);
    scheduler.runAll();
    assert.equal(container.textContent, "Ключ готов");
    assert.equal(box.style.height, "");
    assert.equal(animator.pendingCount(), 0);
});

test("rapid question switching cancels stale work and shows only the latest answer", () => {
    const { animator, container, scheduler } = createFixture();
    animator.show("Первый ответ");
    animator.show("Второй ответ длиннее");
    animator.show("Третий и окончательный ответ");
    assert.ok(animator.pendingCount() <= 2, "only the latest animation may keep scheduled work");
    scheduler.runAll();

    assert.equal(container.textContent, "Третий и окончательный ответ");
    assert.equal(container.querySelectorAll(".faq-char-exit").length, 0);
    assert.equal(animator.pendingCount(), 0);
});

test("reduced motion replaces text immediately without animation work", () => {
    const { animator, container } = createFixture(true);
    animator.show("Ответ без движения");
    assert.equal(container.textContent, "Ответ без движения");
    assert.equal(container.querySelectorAll(".faq-char").length, 0);
    assert.equal(animator.pendingCount(), 0);
});

test("page loads motion helpers before the cache-busted application bundle", () => {
    const projectRoot = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
    const motionPosition = html.indexOf("ui-motion.js?v=5003");
    const animatorPosition = html.indexOf("faq-animation.js?v=5003");
    const appPosition = html.indexOf("app.js?v=5003");

    assert.ok(html.includes("style.css?v=5003"));
    assert.ok(motionPosition >= 0 && motionPosition < animatorPosition && animatorPosition < appPosition);
    assert.equal(app.includes("word-glyph"), false);
    assert.equal(app.includes("dip-shrink"), false);
    assert.equal(app.includes("Не заявлять ограничение"), false);
});
