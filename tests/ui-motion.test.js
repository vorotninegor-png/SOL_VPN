"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createTaskScheduler,
    prefersReducedMotion,
    staggerDelay
} = require("../ui-motion.js");

function createFakeClock() {
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
        flush() {
            let guard = 0;
            while ((timers.size || frames.size) && guard < 100) {
                const callbacks = [...frames.values(), ...timers.values()];
                frames.clear();
                timers.clear();
                callbacks.forEach(callback => callback(16));
                guard += 1;
            }
            assert.ok(guard < 100, "scheduled motion work must settle");
        }
    };
}

function createFixture() {
    const clock = createFakeClock();
    const scheduler = createTaskScheduler({
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        requestAnimationFrame: clock.requestAnimationFrame,
        cancelAnimationFrame: clock.cancelAnimationFrame
    });
    return { clock, scheduler };
}

test("rescheduling the same UI task cancels the stale callback", () => {
    const { clock, scheduler } = createFixture();
    const calls = [];
    scheduler.schedule("tariffs:hide", () => calls.push("stale"), 500);
    scheduler.schedule("tariffs:hide", () => calls.push("latest"), 500);
    assert.equal(scheduler.pendingCount("tariffs:"), 1);
    clock.flush();
    assert.deepEqual(calls, ["latest"]);
    assert.equal(scheduler.pendingCount(), 0);
});

test("cancelGroup removes timers and frames for one animation only", () => {
    const { clock, scheduler } = createFixture();
    const calls = [];
    scheduler.schedule("game:spawn:1", () => calls.push("game"), 100);
    scheduler.frame("game:loot", () => calls.push("loot"));
    scheduler.schedule("toast:1:hide", () => calls.push("toast"), 100);
    scheduler.cancelGroup("game:");
    clock.flush();
    assert.deepEqual(calls, ["toast"]);
});

test("staggering stays sequential while capping the total duration", () => {
    const delays = Array.from({ length: 200 }, (_, index) => staggerDelay(index, 200, 45, 360));
    assert.equal(delays[0], 0);
    assert.equal(delays.at(-1), 360);
    assert.ok(delays.at(-2) < delays.at(-1));
    assert.ok(delays.every((delay, index) => index === 0 || delay >= delays[index - 1]));
});

test("reduced-motion preference is read safely", () => {
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
    assert.equal(prefersReducedMotion(null), false);
});
