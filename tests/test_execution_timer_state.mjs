import assert from "node:assert/strict";

import {
    createExecutionTimerState,
    formatElapsed,
} from "../js/jindouyun_execution_timer_state.mjs";

assert.equal(formatElapsed(0), "00:00.00");
assert.equal(formatElapsed(1_234), "00:01.23");
assert.equal(formatElapsed(65_432), "01:05.43");
assert.equal(formatElapsed(-500), "00:00.00");
assert.equal(formatElapsed(Number.NaN), "00:00.00");

const state = createExecutionTimerState();
assert.deepEqual(state.snapshot(0), {
    status: "idle",
    promptId: null,
    elapsedMs: 0,
});

state.start("prompt-a", 1_000);
assert.deepEqual(state.snapshot(2_250), {
    status: "running",
    promptId: "prompt-a",
    elapsedMs: 1_250,
});

assert.equal(state.finish("success", "prompt-b", 3_000), false);
assert.equal(state.snapshot(3_000).status, "running");
assert.equal(state.finish("success", "prompt-a", 3_500), true);
assert.deepEqual(state.snapshot(9_000), {
    status: "success",
    promptId: "prompt-a",
    elapsedMs: 2_500,
});

state.start("prompt-c", 10_000);
assert.equal(state.finish("error", null, 10_750), true);
assert.deepEqual(state.snapshot(20_000), {
    status: "error",
    promptId: "prompt-c",
    elapsedMs: 750,
});

state.start(null, 30_000);
assert.equal(state.finish("interrupted", "unknown", 30_125), true);
assert.equal(state.snapshot(40_000).status, "interrupted");
assert.equal(state.snapshot(40_000).elapsedMs, 125);

console.log("execution timer state tests passed");
