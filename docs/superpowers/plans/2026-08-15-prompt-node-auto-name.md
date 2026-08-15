# 筋斗云提示词节点自动命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让提示词节点在固定 LoRA 连线或实际运行取得名称后自动同步方案名，并完成节点标题与输出插槽名称调整。

**Architecture:** Python 只调整公开元数据并继续通过 UI 数据发送真实 LoRA 名称。前端纯配置模块负责确定目标方案和不可变名称更新，DOM 扩展在连接变化与执行结果两个事件中调用这些函数。

**Tech Stack:** Python 3、ComfyUI 自定义节点 API、浏览器原生 JavaScript、Node.js 测试、Python `unittest`。

## Global Constraints

- `JindouyunStringRouter` 和 `JindouyunRandomLora` 注册键不变。
- LoRA 输出顺序与类型不变，第三个输出只改显示名为 `LoRA名称`。
- 自动同步只修改方案名称，不修改关键词和文本。
- 随机模式只有运行后才能得到本次真实名称。

---

### Task 1: 纯配置自动同步

**Files:**
- Modify: `js/jindouyun_string_router_config.mjs`
- Modify: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Produces: `findTargetSchemeId(value, loraName)` 返回首个关键词命中方案 ID，否则返回当前方案 ID。
- Produces: `autoNameSchemeForLora(value, loraName)` 返回仅修改目标方案名称的新配置。

- [ ] 写失败测试：关键词命中更新命中方案，未命中更新当前方案，关键词和文本保持不变。
- [ ] 运行 `node --experimental-vm-modules --test tests/test_string_router_ui.mjs` 并确认失败。
- [ ] 实现两个纯函数并保持旧 `recordLoraForScheme` 可用。
- [ ] 重跑目标测试并确认通过。

### Task 2: 前端连接与执行事件

**Files:**
- Modify: `js/jindouyun_string_router.js`
- Modify: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Consumes: `node.onConnectionsChange` 的输入连接信息、上游 `JindouyunRandomLora` 节点控件和 `node.onExecuted` UI 数据。
- Produces: 固定模式连接即时命名、随机模式连接提示、运行后自动命名。

- [ ] 写源代码断言，要求存在连接变化处理、固定 LoRA 读取、随机等待提示和执行后 `autoNameSchemeForLora` 调用。
- [ ] 运行前端目标测试并确认失败。
- [ ] 实现上游节点解析和状态更新，保留“记录当前 LoRA”按钮。
- [ ] 运行前端目标测试并确认通过。

### Task 3: 公开名称与兼容

**Files:**
- Modify: `krea2_random_lora_model_only.py`
- Modify: `__init__.py`
- Modify: `string_router.py`
- Modify: `tests/test_logic.py`
- Modify: `tests/test_string_router.py`
- Modify: `README.md`

**Interfaces:**
- Produces: 随机 LoRA 第三个输出名 `LoRA名称`；提示词节点显示名 `筋斗云-提示词`。

- [ ] 写失败测试，锁定新输出名、新显示名和旧注册键。
- [ ] 修改公开名称、描述、搜索别名及文档。
- [ ] 运行 Python 目标测试并确认通过。

### Task 4: 回归与在线验收

**Files:**
- Verify: all `tests/test_*.py` and `tests/*.mjs`

- [ ] 运行完整 Python 与前端测试。
- [ ] 重启 ComfyUI，读取两个节点的 `/object_info` 验证新名称。
- [ ] 在浏览器加载现有连线工作流，验证固定模式即时命名、运行后状态和 400px 宽度排版。
