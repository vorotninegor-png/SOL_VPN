(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SolVlessActions = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const IMPORT_INSTRUCTIONS = Object.freeze([
        Object.freeze({
            id: "happ",
            title: "Happ",
            text: "Откройте приложение, нажмите «+» и выберите импорт конфигурации из буфера обмена."
        }),
        Object.freeze({
            id: "hiddify",
            title: "Hiddify",
            text: "Откройте приложение, нажмите «+» и выберите «Добавить из буфера обмена»."
        }),
        Object.freeze({
            id: "v2rayng",
            title: "v2rayNG",
            text: "Откройте приложение, нажмите «+» и выберите «Импортировать из буфера обмена»."
        })
    ]);

    function isVlessUri(value) {
        return typeof value === "string" && /^vless:\/\/[^\s]+$/iu.test(value);
    }

    function fallbackCopy(documentObject, value) {
        if (!documentObject || !documentObject.body
            || typeof documentObject.createElement !== "function"
            || typeof documentObject.execCommand !== "function") {
            return false;
        }

        const textarea = documentObject.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.setAttribute("aria-hidden", "true");
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "-9999px";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        textarea.style.fontSize = "16px";

        try {
            documentObject.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            if (typeof textarea.setSelectionRange === "function") {
                textarea.setSelectionRange(0, value.length);
            }
            return documentObject.execCommand("copy") === true;
        } catch (_) {
            return false;
        } finally {
            if (typeof textarea.remove === "function") textarea.remove();
            else if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
        }
    }

    function createVlessClipboard(options = {}) {
        const navigatorObject = options.navigatorObject
            || (typeof navigator !== "undefined" ? navigator : null);
        const documentObject = options.documentObject
            || (typeof document !== "undefined" ? document : null);
        let activeCopy = null;

        async function performCopy(value) {
            if (!isVlessUri(value)) {
                return { ok: false, method: "none", reason: "missing_key" };
            }

            const writeText = navigatorObject && navigatorObject.clipboard
                && navigatorObject.clipboard.writeText;
            if (typeof writeText === "function") {
                try {
                    await writeText.call(navigatorObject.clipboard, value);
                    return { ok: true, method: "clipboard" };
                } catch (_) {
                    // Telegram WebView and browsers may deny Clipboard API; use the local fallback.
                }
            }

            if (fallbackCopy(documentObject, value)) {
                return { ok: true, method: "exec-command" };
            }
            return { ok: false, method: "manual", reason: "copy_failed" };
        }

        function copy(value) {
            if (activeCopy) return activeCopy;
            activeCopy = performCopy(value).finally(() => {
                activeCopy = null;
            });
            return activeCopy;
        }

        return { copy };
    }

    function getImportInstructions() {
        return IMPORT_INSTRUCTIONS.map(item => ({ ...item }));
    }

    return {
        createVlessClipboard,
        fallbackCopy,
        getImportInstructions,
        isVlessUri
    };
}));
