# 筋斗云任务秒表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ComfyUI 增加可拖动、可静音、能准确记录每次任务执行耗时的悬浮数字秒表，并在成功完成时播放“叮”声。

**Architecture:** 将纯状态逻辑放在独立 `.mjs` 模块中，UI 扩展只负责绑定 ComfyUI 事件、渲染悬浮窗、持久化设置和播放 Web Audio 铃声。状态模块以 `prompt_id` 防止迟到事件结束错误任务。

**Tech Stack:** ComfyUI 前端扩展 API、原生 JavaScript、DOM/CSS、Web Audio API、Node.js 测试。

## Global Constraints

- 不增加第三方依赖或后端接口。
- 成功任务播放一次提示音；失败和中断只更新视觉状态。
- 默认声音开启，位置和声音设置持久化。
- 不改变任何节点注册 ID 或现有工作流行为。

---

### Task 1: 可测试的任务计时状态

**Files:**
- Create: `js/jindouyun_execution_timer_state.mjs`
- Create: `tests/test_execution_timer_state.mjs`

**Interfaces:**
- Produces: `formatElapsed(milliseconds)` 与 `createExecutionTimerState()`。

- [ ] **Step 1: 写失败测试**

测试 `MM:SS.cc` 格式、任务开始、匹配 ID 结束、错误 ID 忽略及成功状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/test_execution_timer_state.mjs`

Expected: FAIL，因为状态模块尚不存在。

- [ ] **Step 3: 实现最小状态模块**

实现 `start(promptId, now)`、`finish(status, promptId, now)`、`elapsed(now)` 与只读 `snapshot()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/test_execution_timer_state.mjs`

Expected: PASS。

### Task 2: 悬浮秒表界面与提示音

**Files:**
- Create: `js/jindouyun_execution_timer.js`
- Create: `tests/test_execution_timer_ui.mjs`

**Interfaces:**
- Consumes: `formatElapsed()` 与 `createExecutionTimerState()`。
- Produces: ComfyUI 扩展 `comfyui-jindouyun-design.execution-timer`。

- [ ] **Step 1: 写失败的前端源测试**

断言四类执行事件、Web Audio API、拖动事件、位置键、声音键及扩展注册名存在。

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/test_execution_timer_ui.mjs`

Expected: FAIL，因为 UI 扩展尚不存在。

- [ ] **Step 3: 实现悬浮秒表**

创建固定定位 DOM、运行状态样式、`requestAnimationFrame()` 更新、事件绑定、拖动约束、`localStorage` 和成功铃声。

- [ ] **Step 4: 运行前端测试确认通过**

Run: `node tests/test_execution_timer_ui.mjs`

Expected: PASS。

### Task 3: 文档和完整回归

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: 用户可见的网页工具说明。

- [ ] **Step 1: 更新 README**

在“网页工具”中增加悬浮任务秒表、可拖动、声音开关和成功提示音说明。

- [ ] **Step 2: 运行完整测试**

Run: `python -m unittest discover -s tests -p "test_*.py"`

Run: `node --experimental-vm-modules tests/test_execution_timer_state.mjs` 以及全部 `test_*.mjs`。

Expected: 全部通过。

- [ ] **Step 3: 检查变更范围**

确认只包含本功能文件与文档，不包含用户已有的 `js/jindouyun_load_image.js` 修改。
