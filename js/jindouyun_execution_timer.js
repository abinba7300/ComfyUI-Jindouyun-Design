import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

import {
    createExecutionTimerState,
    formatElapsed,
} from "./jindouyun_execution_timer_state.mjs";

const EXTENSION_NAME = "comfyui-jindouyun-design.execution-timer";
const TIMER_ID = "jindouyun-execution-timer";
const STYLE_ID = "jindouyun-execution-timer-style";
const POSITION_KEY = "jindouyun.executionTimer.position";
const SOUND_KEY = "jindouyun.executionTimer.soundEnabled";
const VIEWPORT_GAP = 12;
const COMPLETION_SOUND_ROUTE = "/jindouyun_design/execution_timer_sound";
const COMPLETION_SOUND_URL = api.fileURL(COMPLETION_SOUND_ROUTE);

const timerState = createExecutionTimerState();
let timerElement = null;
let timeElement = null;
let statusElement = null;
let soundButton = null;
let animationFrame = null;
let audioContext = null;
let completionSoundBuffer = null;
let completionSoundPromise = null;
let executionEventsBound = false;
let soundEnabled = readStoredBoolean(SOUND_KEY, true);

const STATUS_TEXT = {
    idle: "等待运行",
    running: "运行中",
    success: "完成",
    error: "失败",
    interrupted: "已中断",
};

function readStoredBoolean(key, fallback) {
    try {
        const stored = localStorage.getItem(key);
        if (stored === "true") return true;
        if (stored === "false") return false;
    } catch {
        // Storage can be disabled by browser privacy settings.
    }
    return fallback;
}

function storeValue(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Timer operation should not depend on storage availability.
    }
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${TIMER_ID} {
            position: fixed;
            top: 78px;
            right: 18px;
            z-index: 10020;
            width: 184px;
            box-sizing: border-box;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            background: #20242a;
            color: #f5f7fa;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
            font-family: Inter, "Microsoft YaHei", sans-serif;
            user-select: none;
            transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
        }
        #${TIMER_ID}.is-dragging {
            cursor: grabbing;
            opacity: 0.94;
            transition: none;
        }
        #${TIMER_ID} .jdy-timer-header {
            display: grid;
            grid-template-columns: 9px minmax(0, 1fr) 28px;
            align-items: center;
            gap: 8px;
            min-height: 34px;
            padding: 0 7px 0 11px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.09);
            cursor: grab;
        }
        #${TIMER_ID} .jdy-timer-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #828995;
            box-shadow: 0 0 0 3px rgba(130, 137, 149, 0.12);
        }
        #${TIMER_ID} .jdy-timer-title {
            overflow: hidden;
            color: #dce1e7;
            font-size: 12px;
            font-weight: 700;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #${TIMER_ID} .jdy-timer-sound {
            display: grid;
            width: 26px;
            height: 26px;
            place-items: center;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 5px;
            padding: 0;
            background: #30363f;
            color: #f1f3f5;
            font: 700 15px/1 Georgia, serif;
            cursor: pointer;
        }
        #${TIMER_ID} .jdy-timer-sound:hover { background: #414954; }
        #${TIMER_ID} .jdy-timer-sound.is-muted {
            color: #8f97a3;
            text-decoration: line-through;
        }
        #${TIMER_ID} .jdy-timer-time {
            min-height: 40px;
            padding: 8px 10px 0;
            font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
            font-size: 25px;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
            line-height: 1;
            letter-spacing: 0;
            text-align: center;
            white-space: nowrap;
        }
        #${TIMER_ID} .jdy-timer-status {
            min-height: 25px;
            padding: 3px 10px 7px;
            color: #9ca4af;
            font-size: 11px;
            line-height: 15px;
            text-align: center;
        }
        #${TIMER_ID}[data-status="running"] {
            border-color: #ed8b3a;
            background: #2a251f;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(237, 139, 58, 0.13);
        }
        #${TIMER_ID}[data-status="running"] .jdy-timer-indicator {
            background: #ff982f;
            box-shadow: 0 0 0 4px rgba(255, 152, 47, 0.16);
            animation: jdy-timer-pulse 1s ease-in-out infinite;
        }
        #${TIMER_ID}[data-status="success"] {
            border-color: #42a96b;
            background: #202a24;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(66, 169, 107, 0.13);
        }
        #${TIMER_ID}[data-status="success"] .jdy-timer-indicator { background: #53c77d; }
        #${TIMER_ID}[data-status="error"],
        #${TIMER_ID}[data-status="interrupted"] {
            border-color: #cf5d68;
            background: #2c2023;
        }
        #${TIMER_ID}[data-status="error"] .jdy-timer-indicator,
        #${TIMER_ID}[data-status="interrupted"] .jdy-timer-indicator { background: #eb6976; }
        @keyframes jdy-timer-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(0.72); opacity: 0.58; }
        }
        @media (max-width: 520px) {
            #${TIMER_ID} { width: 166px; }
            #${TIMER_ID} .jdy-timer-time { font-size: 22px; }
        }
    `;
    document.head.appendChild(style);
}

function promptIdFromDetail(detail) {
    return detail?.prompt_id ?? detail?.promptId ?? null;
}

function renderTimer(now = performance.now()) {
    if (!timerElement) return;
    const snapshot = timerState.snapshot(now);
    timerElement.dataset.status = snapshot.status;
    timeElement.textContent = formatElapsed(snapshot.elapsedMs);
    statusElement.textContent = STATUS_TEXT[snapshot.status] || STATUS_TEXT.idle;
    timerElement.title = snapshot.promptId
        ? `任务 ${snapshot.promptId}`
        : "显示当前任务从开始到结束的运行时间";
}

function stopAnimation() {
    if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

function animateTimer() {
    stopAnimation();
    const tick = () => {
        renderTimer(performance.now());
        if (timerState.snapshot().status === "running") {
            animationFrame = requestAnimationFrame(tick);
        } else {
            animationFrame = null;
        }
    };
    animationFrame = requestAnimationFrame(tick);
}

function ensureAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
    return audioContext;
}

function loadCompletionSound(context) {
    if (completionSoundBuffer) return Promise.resolve(completionSoundBuffer);
    if (completionSoundPromise) return completionSoundPromise;

    completionSoundPromise = fetch(COMPLETION_SOUND_URL)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Completion sound request failed: ${response.status}`);
            }
            return response.arrayBuffer();
        })
        .then((audioData) => context.decodeAudioData(audioData))
        .then((buffer) => {
            completionSoundBuffer = buffer;
            return buffer;
        })
        .catch((error) => {
            completionSoundPromise = null;
            throw error;
        });

    return completionSoundPromise;
}

async function unlockAudio() {
    const context = ensureAudioContext();
    if (context?.state === "suspended") {
        await context.resume().catch(() => {});
    }
}

function playFallbackChime(context) {
    const startAt = context.currentTime + 0.015;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, startAt);
    master.gain.exponentialRampToValueAtTime(0.18, startAt + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.15);
    master.connect(context.destination);

    for (const [frequency, level, duration] of [
        [1046.5, 0.72, 1.15],
        [2093.0, 0.24, 0.82],
        [3139.5, 0.08, 0.52],
    ]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(level, startAt);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.03);
    }
}

async function playCompletionChime() {
    if (!soundEnabled) return;
    const context = ensureAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
        await context.resume().catch(() => {});
    }
    if (context.state !== "running") return;

    try {
        const buffer = await loadCompletionSound(context);
        const source = context.createBufferSource();
        const output = context.createGain();
        source.buffer = buffer;
        output.gain.setValueAtTime(1, context.currentTime);
        source.connect(output);
        output.connect(context.destination);
        source.start(context.currentTime + 0.01);
    } catch {
        playFallbackChime(context);
    }
}

function updateSoundButton() {
    if (!soundButton) return;
    soundButton.classList.toggle("is-muted", !soundEnabled);
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", soundEnabled ? "关闭完成提示音" : "开启完成提示音");
    soundButton.title = soundEnabled ? "完成提示音：开启" : "完成提示音：关闭";
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    storeValue(SOUND_KEY, String(soundEnabled));
    updateSoundButton();
    if (soundEnabled) unlockAudio();
}

function readStoredPosition() {
    try {
        const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
        if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) return parsed;
    } catch {
        // Ignore invalid or unavailable storage.
    }
    return null;
}

function clampPosition(left, top) {
    const width = timerElement?.offsetWidth || 184;
    const height = timerElement?.offsetHeight || 100;
    return {
        left: Math.min(Math.max(VIEWPORT_GAP, left), Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP)),
        top: Math.min(Math.max(VIEWPORT_GAP, top), Math.max(VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP)),
    };
}

function setPosition(left, top, persist = false) {
    if (!timerElement) return;
    const clamped = clampPosition(left, top);
    timerElement.style.right = "auto";
    timerElement.style.left = `${clamped.left}px`;
    timerElement.style.top = `${clamped.top}px`;
    if (persist) storeValue(POSITION_KEY, JSON.stringify(clamped));
}

function restorePosition() {
    if (!timerElement) return;
    const stored = readStoredPosition();
    const rect = timerElement.getBoundingClientRect();
    setPosition(stored?.left ?? rect.left, stored?.top ?? rect.top);
}

function bindDragging(handle) {
    let drag = null;

    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        const rect = timerElement.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };
        handle.setPointerCapture?.(event.pointerId);
        timerElement.classList.add("is-dragging");
        event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });

    const finishDrag = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        timerElement.classList.remove("is-dragging");
        const rect = timerElement.getBoundingClientRect();
        setPosition(rect.left, rect.top, true);
    };
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
}

function createTimerElement() {
    if (document.getElementById(TIMER_ID)) {
        timerElement = document.getElementById(TIMER_ID);
        return timerElement;
    }
    if (!document.body) return null;

    ensureStyle();
    const root = document.createElement("section");
    root.id = TIMER_ID;
    root.dataset.status = "idle";
    root.setAttribute("aria-label", "任务计时");

    const header = document.createElement("div");
    header.className = "jdy-timer-header";
    header.title = "拖动计时器";

    const indicator = document.createElement("span");
    indicator.className = "jdy-timer-indicator";
    indicator.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "jdy-timer-title";
    title.textContent = "任务计时";

    soundButton = document.createElement("button");
    soundButton.type = "button";
    soundButton.className = "jdy-timer-sound";
    soundButton.textContent = "♪";
    soundButton.addEventListener("click", toggleSound);
    header.append(indicator, title, soundButton);

    timeElement = document.createElement("div");
    timeElement.className = "jdy-timer-time";
    timeElement.textContent = "00:00.00";

    statusElement = document.createElement("div");
    statusElement.className = "jdy-timer-status";
    statusElement.setAttribute("aria-live", "polite");
    statusElement.textContent = STATUS_TEXT.idle;

    root.append(header, timeElement, statusElement);
    document.body.appendChild(root);
    timerElement = root;
    updateSoundButton();
    bindDragging(header);
    requestAnimationFrame(restorePosition);
    return root;
}

function handleExecutionStart({detail} = {}) {
    timerState.start(promptIdFromDetail(detail), performance.now());
    renderTimer();
    animateTimer();
}

function ensureExecutionStarted(detail) {
    if (timerState.snapshot().status !== "running") {
        handleExecutionStart({detail});
    }
}

function handleExecuting({detail} = {}) {
    if (detail == null) {
        handleExecutionEnd("success", null);
        return;
    }
    ensureExecutionStarted(detail);
}

function handleExecutionActivity({detail} = {}) {
    ensureExecutionStarted(detail);
}

function handleExecutionEnd(finalStatus, detail) {
    if (!timerState.finish(finalStatus, promptIdFromDetail(detail), performance.now())) return;
    stopAnimation();
    renderTimer();
    if (finalStatus === "success") {
        playCompletionChime().catch(() => {});
    }
}

function bindExecutionEvents() {
    if (executionEventsBound) return;
    executionEventsBound = true;
    api.addEventListener("execution_start", handleExecutionStart);
    api.addEventListener("execution_success", ({detail} = {}) => handleExecutionEnd("success", detail));
    api.addEventListener("execution_error", ({detail} = {}) => handleExecutionEnd("error", detail));
    api.addEventListener("execution_interrupted", ({detail} = {}) => handleExecutionEnd("interrupted", detail));
    api.addEventListener("executing", handleExecuting);
    api.addEventListener("execution_cached", handleExecutionActivity);
}

function setupTimer() {
    if (!createTimerElement()) {
        document.addEventListener("DOMContentLoaded", setupTimer, {once: true});
        return;
    }
    bindExecutionEvents();
    document.addEventListener("pointerdown", unlockAudio, {once: true, capture: true});
    document.addEventListener("keydown", unlockAudio, {once: true, capture: true});
    window.addEventListener("resize", () => {
        const rect = timerElement.getBoundingClientRect();
        setPosition(rect.left, rect.top, true);
    });
    document.addEventListener("visibilitychange", () => renderTimer());
    renderTimer();
}

app.registerExtension({
    name: EXTENSION_NAME,
    setup: setupTimer,
});
