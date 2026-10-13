(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SolUiMotion = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function createTaskScheduler(options = {}) {
        const setTimer = options.setTimeout || setTimeout;
        const clearTimer = options.clearTimeout || clearTimeout;
        const requestFrame = options.requestAnimationFrame || (callback => setTimer(callback, 0));
        const cancelFrame = options.cancelAnimationFrame || clearTimer;
        const tasks = new Map();

        function cancel(key) {
            const task = tasks.get(key);
            if (!task) return false;
            if (task.type === "frame") cancelFrame(task.id);
            else clearTimer(task.id);
            tasks.delete(key);
            return true;
        }

        function schedule(key, callback, delay = 0) {
            cancel(key);
            const id = setTimer(() => {
                tasks.delete(key);
                callback();
            }, Math.max(0, Number(delay) || 0));
            tasks.set(key, { id, type: "timer" });
            return id;
        }

        function frame(key, callback) {
            cancel(key);
            const id = requestFrame(timestamp => {
                tasks.delete(key);
                callback(timestamp);
            });
            tasks.set(key, { id, type: "frame" });
            return id;
        }

        function cancelGroup(prefix) {
            Array.from(tasks.keys()).forEach(key => {
                if (String(key).startsWith(prefix)) cancel(key);
            });
        }

        function destroy() {
            Array.from(tasks.keys()).forEach(cancel);
        }

        return {
            schedule,
            frame,
            cancel,
            cancelGroup,
            destroy,
            pendingCount: prefix => Array.from(tasks.keys())
                .filter(key => prefix === undefined || String(key).startsWith(prefix)).length
        };
    }

    function prefersReducedMotion(windowObject) {
        return Boolean(windowObject && windowObject.matchMedia
            && windowObject.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function staggerDelay(index, count, stepMs = 45, maxTotalMs = 360) {
        const safeCount = Math.max(1, Number(count) || 1);
        const safeIndex = Math.max(0, Math.min(safeCount - 1, Number(index) || 0));
        if (safeCount === 1) return 0;
        const total = Math.min((safeCount - 1) * Math.max(0, stepMs), Math.max(0, maxTotalMs));
        return Math.round((safeIndex / (safeCount - 1)) * total);
    }

    return {
        createTaskScheduler,
        prefersReducedMotion,
        staggerDelay
    };
}));
