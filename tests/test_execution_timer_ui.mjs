import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(
    new URL("../js/jindouyun_execution_timer.js", import.meta.url),
    "utf8",
);

assert.match(source, /from "\.\.\/\.\.\/scripts\/app\.js"/);
assert.match(source, /from "\.\.\/\.\.\/scripts\/api\.js"/);
assert.match(source, /from "\.\/jindouyun_execution_timer_state\.mjs"/);
assert.match(source, /comfyui-jindouyun-design\.execution-timer/);
assert.match(source, /jindouyun-execution-timer/);

for (const eventName of [
    "execution_start",
    "execution_success",
    "execution_error",
    "execution_interrupted",
    "executing",
    "execution_cached",
]) {
    assert.match(source, new RegExp(`api\\.addEventListener\\(\\"${eventName}\\"`));
}

assert.match(source, /performance\.now\(\)/);
assert.match(source, /requestAnimationFrame/);
assert.match(source, /cancelAnimationFrame/);
assert.match(source, /AudioContext|webkitAudioContext/);
assert.match(source, /\/jindouyun_design\/execution_timer_sound/);
assert.match(source, /api\.fileURL/);
assert.match(source, /fetch\(/);
assert.match(source, /decodeAudioData/);
assert.match(source, /createBufferSource/);
assert.match(source, /createOscillator/);
assert.match(source, /exponentialRampToValueAtTime/);
assert.match(source, /if \(finalStatus === "success"\)/);

assert.match(source, /jindouyun\.executionTimer\.position/);
assert.match(source, /jindouyun\.executionTimer\.soundEnabled/);
assert.match(source, /localStorage\.getItem/);
assert.match(source, /localStorage\.setItem/);
assert.match(source, /pointerdown/);
assert.match(source, /pointermove/);
assert.match(source, /pointerup/);
assert.match(source, /aria-label/);
assert.match(source, /任务计时/);
assert.match(source, /运行中/);
assert.match(source, /完成/);
assert.match(source, /失败/);
assert.match(source, /已中断/);

const soundAsset = new URL(
    "../assets/toaster-oven-ding-sethlind-cc0.mp3",
    import.meta.url,
);
const soundStat = await fs.stat(soundAsset);
assert.ok(soundStat.size > 20_000, "CC0 toaster ding asset should be bundled");

const soundCredits = await fs.readFile(
    new URL("../assets/README.md", import.meta.url),
    "utf8",
);
assert.match(soundCredits, /CC0/);
assert.match(soundCredits, /freesound\.org\/people\/sethlind\/sounds\/265012/);

await assert.rejects(
    fs.stat(new URL("../js/assets/toaster-oven-ding-sethlind-cc0.mp3", import.meta.url)),
    {code: "ENOENT"},
    "audio must not live inside the frontend extension directory",
);

console.log("execution timer UI tests passed");
