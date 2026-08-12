import assert from "node:assert/strict";
import fs from "node:fs/promises";

const path = new URL("../js/jindouyun_show_anything.js", import.meta.url);
const source = await fs.readFile(path, "utf8");

const helper = source.match(/function resolveFontSize\(enabled, scale\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, "resolveFontSize must be defined");
const {resolveFontSize} = Function(`const BASE_FONT_SIZE = 12;\n${helper}\nreturn {resolveFontSize};`)();

assert.equal(resolveFontSize(false, 3), 12);
assert.equal(resolveFontSize(true, 3), 36);
assert.equal(resolveFontSize(true, 20), 120);
assert.equal(resolveFontSize(true, 0), 12);

const widthHelper = source.match(/function syncDisplayWidth\(node, shell\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(widthHelper, "syncDisplayWidth must be defined");
const {syncDisplayWidth} = Function(`${widthHelper}\nreturn {syncDisplayWidth};`)();
const host = {style: {}};
const shell = {style: {}, parentElement: host};
assert.equal(syncDisplayWidth({size: [900, 280]}, shell), 872);
assert.equal(shell.style.width, "872px");
assert.equal(host.style.width, "872px");
assert.equal(syncDisplayWidth({size: [120, 280]}, shell), 160);

const heightHelper = source.match(/function syncDisplayHeight\(node, shell\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(heightHelper, "syncDisplayHeight must be defined");
const {syncDisplayHeight} = Function(`const DISPLAY_TOP_OFFSET = 146;\nconst MIN_DISPLAY_HEIGHT = 120;\n${heightHelper}\nreturn {syncDisplayHeight};`)();
const heightHost = {style: {}};
const heightShell = {style: {}, parentElement: heightHost};
assert.equal(syncDisplayHeight({size: [320, 570]}, heightShell), 424);
assert.equal(heightShell.style.height, "424px");
assert.equal(heightHost.style.height, "424px");
assert.equal(syncDisplayHeight({size: [320, 180]}, heightShell), 120);

assert.match(source, /const NODE_TYPE = "JindouyunShowAnything"/);
assert.match(source, /findWidget\(node, "放大文字"\)/);
assert.match(source, /findWidget\(node, "放大倍数"\)/);
assert.match(source, /whiteSpace: "pre-wrap"/);
assert.match(source, /overflowWrap: "anywhere"/);
assert.match(source, /node\.properties\.jindouyunShowAnythingText/);
assert.match(source, /nodeType\.prototype\.onExecuted/);
assert.match(source, /message\?\.text/);
assert.match(source, /node\.addDOMWidget\("显示内容"/);
assert.match(source, /domWidget\.computeSize = \(\) => \[syncDisplayWidth\(node, shell\), syncDisplayHeight\(node, shell\)\]/);
assert.match(source, /node\.onResize = function\(\)/);
assert.match(source, /syncDisplayHeight\(node, shell\)/);

console.log("show anything UI test passed");
