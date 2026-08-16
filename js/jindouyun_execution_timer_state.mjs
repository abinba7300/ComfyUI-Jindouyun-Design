const FINAL_STATUSES = new Set(["success", "error", "interrupted"]);

function safeNow(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function defaultNow() {
    return safeNow(globalThis.performance?.now?.() ?? Date.now());
}

function normalizePromptId(promptId) {
    if (promptId == null || promptId === "") return null;
    return String(promptId);
}

export function formatElapsed(milliseconds) {
    const totalCentiseconds = Math.floor(safeNow(milliseconds) / 10);
    const centiseconds = totalCentiseconds % 100;
    const totalSeconds = Math.floor(totalCentiseconds / 100);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function createExecutionTimerState() {
    let status = "idle";
    let promptId = null;
    let startedAt = 0;
    let elapsedMs = 0;

    function elapsed(now = defaultNow()) {
        if (status !== "running") return elapsedMs;
        return Math.max(0, safeNow(now) - startedAt);
    }

    function snapshot(now = defaultNow()) {
        return {
            status,
            promptId,
            elapsedMs: elapsed(now),
        };
    }

    function start(nextPromptId, now = defaultNow()) {
        status = "running";
        promptId = normalizePromptId(nextPromptId);
        startedAt = safeNow(now);
        elapsedMs = 0;
        return snapshot(startedAt);
    }

    function finish(finalStatus, finishedPromptId, now = defaultNow()) {
        if (!FINAL_STATUSES.has(finalStatus)) {
            throw new TypeError(`Unsupported execution status: ${finalStatus}`);
        }
        if (status !== "running") return false;

        const normalizedFinishedId = normalizePromptId(finishedPromptId);
        if (promptId !== null && normalizedFinishedId !== null && promptId !== normalizedFinishedId) {
            return false;
        }

        elapsedMs = elapsed(now);
        status = finalStatus;
        return true;
    }

    return {
        start,
        finish,
        elapsed,
        snapshot,
    };
}
