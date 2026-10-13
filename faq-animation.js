(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SolFaqAnimation = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const EXIT_BASE_MS = 150;
    const CHARACTER_STEP_MS = 5;
    const MAX_STAGGERED_CHARACTERS = 50;
    const HEIGHT_TRANSITION_MS = 320;

    function splitGraphemes(value) {
        const text = String(value || "");
        if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
            const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
            return Array.from(segmenter.segment(text), item => item.segment);
        }
        return Array.from(text);
    }

    function tokenizeFaqText(value) {
        return String(value || "")
            .split(/(\s+)/u)
            .filter(Boolean)
            .map(token => (/^\s+$/u.test(token)
                ? { type: "space", value: token }
                : { type: "word", characters: splitGraphemes(token) }));
    }

    function createFaqAnimator(options) {
        const container = options && options.container;
        const box = options && options.box;
        if (!container || !box) {
            throw new Error("FAQ animation requires container and box elements");
        }

        const hostWindow = options.windowObject || (typeof window !== "undefined" ? window : null);
        const setTimer = options.setTimeout || (hostWindow && hostWindow.setTimeout.bind(hostWindow)) || setTimeout;
        const clearTimer = options.clearTimeout || (hostWindow && hostWindow.clearTimeout.bind(hostWindow)) || clearTimeout;
        const requestFrame = options.requestAnimationFrame
            || (hostWindow && hostWindow.requestAnimationFrame && hostWindow.requestAnimationFrame.bind(hostWindow))
            || (callback => setTimer(callback, 0));
        const cancelFrame = options.cancelAnimationFrame
            || (hostWindow && hostWindow.cancelAnimationFrame && hostWindow.cancelAnimationFrame.bind(hostWindow))
            || clearTimer;
        const motionQuery = options.motionQuery
            || (hostWindow && hostWindow.matchMedia ? hostWindow.matchMedia("(prefers-reduced-motion: reduce)") : null);
        const pendingTimers = new Set();
        const pendingFrames = new Set();
        let revision = 0;
        let destroyed = false;

        function isReducedMotion() {
            return Boolean(motionQuery && motionQuery.matches);
        }

        function later(callback, delay) {
            const timerId = setTimer(() => {
                pendingTimers.delete(timerId);
                callback();
            }, delay);
            pendingTimers.add(timerId);
            return timerId;
        }

        function nextFrame(callback) {
            const frameId = requestFrame(() => {
                pendingFrames.delete(frameId);
                callback();
            });
            pendingFrames.add(frameId);
            return frameId;
        }

        function clearScheduledWork() {
            pendingTimers.forEach(timerId => clearTimer(timerId));
            pendingFrames.forEach(frameId => cancelFrame(frameId));
            pendingTimers.clear();
            pendingFrames.clear();
        }

        function resetHeight() {
            box.classList.remove("faq-height-transition");
            box.style.height = "";
            box.style.overflow = "";
        }

        function phaseDuration(characterCount, baseDuration) {
            return baseDuration + Math.min(characterCount, MAX_STAGGERED_CHARACTERS) * CHARACTER_STEP_MS;
        }

        function setCharacterDelay(element, index) {
            element.style.setProperty(
                "--faq-char-delay",
                `${Math.min(index, MAX_STAGGERED_CHARACTERS) * CHARACTER_STEP_MS}ms`
            );
        }

        function renderAnimatedText(text) {
            const documentObject = container.ownerDocument;
            const fragment = documentObject.createDocumentFragment();
            let characterIndex = 0;

            tokenizeFaqText(text).forEach(token => {
                if (token.type === "space") {
                    const whitespace = documentObject.createElement("span");
                    whitespace.className = "faq-space";
                    whitespace.textContent = token.value;
                    fragment.appendChild(whitespace);
                    return;
                }

                const word = documentObject.createElement("span");
                word.className = "faq-word";
                token.characters.forEach(character => {
                    const glyph = documentObject.createElement("span");
                    glyph.className = "faq-char faq-char-enter";
                    glyph.textContent = character;
                    setCharacterDelay(glyph, characterIndex);
                    characterIndex += 1;
                    word.appendChild(glyph);
                });
                fragment.appendChild(word);
            });

            container.replaceChildren(fragment);
            return Array.from(container.querySelectorAll(".faq-char"));
        }

        function animateHeight(render, activeRevision) {
            const currentHeight = box.getBoundingClientRect().height;
            box.classList.add("faq-height-transition");
            box.style.overflow = "hidden";
            render();
            box.style.height = "";
            const targetHeight = box.getBoundingClientRect().height;
            box.style.height = `${currentHeight}px`;
            void box.offsetHeight;

            nextFrame(() => {
                if (activeRevision !== revision || destroyed) return;
                box.style.height = `${targetHeight}px`;
            });
            later(() => {
                if (activeRevision !== revision || destroyed) return;
                resetHeight();
            }, HEIGHT_TRANSITION_MS);
        }

        function renderAndEnter(text, activeRevision) {
            let characters = [];
            animateHeight(() => {
                characters = renderAnimatedText(text);
            }, activeRevision);

            nextFrame(() => {
                if (activeRevision !== revision || destroyed) return;
                characters.forEach(character => character.classList.remove("faq-char-enter"));
            });
        }

        function show(text) {
            if (destroyed) return;
            clearScheduledWork();
            revision += 1;
            const activeRevision = revision;
            const safeText = String(text || "");

            if (isReducedMotion()) {
                resetHeight();
                container.textContent = safeText;
                return;
            }

            const currentCharacters = Array.from(container.querySelectorAll(".faq-char"));
            if (currentCharacters.length === 0) {
                renderAndEnter(safeText, activeRevision);
                return;
            }

            currentCharacters.forEach((character, index) => {
                character.classList.remove("faq-char-enter");
                setCharacterDelay(character, index);
                character.classList.add("faq-char-exit");
            });

            later(() => {
                if (activeRevision !== revision || destroyed) return;
                renderAndEnter(safeText, activeRevision);
            }, phaseDuration(currentCharacters.length, EXIT_BASE_MS));
        }

        function destroy() {
            destroyed = true;
            revision += 1;
            clearScheduledWork();
            resetHeight();
        }

        return {
            show,
            destroy,
            pendingCount: () => pendingTimers.size + pendingFrames.size
        };
    }

    return {
        createFaqAnimator,
        splitGraphemes,
        tokenizeFaqText
    };
}));
