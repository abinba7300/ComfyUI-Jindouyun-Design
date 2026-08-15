# 筋斗云-字符串关键词路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“筋斗云-字符串”从完整 LoRA 名称等值绑定升级为用户关键词字面包含匹配，并让记录当前 LoRA 时方案名称自动同步。

**Architecture:** 保留现有 JSON 配置结构和 `bindings` 字段以兼容旧工作流，但把字段语义改为关键词列表。Python 后端负责确定性匹配和冲突状态，前端纯配置模块负责名称同步与关键词唯一归属，DOM 编辑器只负责呈现和保存。

**Tech Stack:** Python 3、ComfyUI 自定义节点 API、浏览器原生 JavaScript、DOM Widget、Node.js 内置测试运行器、Python `unittest`。

## Global Constraints

- 匹配是不区分英文大小写的字面包含判断，不进行模糊、相似度、词干、触发词或提示词推断。
- 关键词中的标点、数字和空格保持原样；`V1.1` 与 `V1.0` 必须独立匹配。
- 多方案同时命中时按方案顺序选择第一个，并输出冲突状态，不中断工作流。
- 点击“记录当前 LoRA”只同步方案名称，不自动覆盖用户关键词。
- 旧 `bindings` 完整名称配置继续有效，不增加第三方依赖。

---

### Task 1: 后端关键词路由

**Files:**
- Modify: `tests/test_string_router.py`
- Modify: `string_router.py`

**Interfaces:**
- Consumes: `normalize_router_config(value)` 返回含 `schemes[].bindings` 的配置。
- Produces: `route_string(lora_name, config_value)` 返回 `(text, match_mode, scheme_name, matched_keyword)`；`match_mode` 为 `matched`、`conflict`、`default` 或 `unmatched`。

- [x] **Step 1: 写入失败测试**

增加测试，验证 `V1.1` 与 `V1.0` 独立匹配、大小写不敏感、文本内容不参与匹配、旧完整名称仍可命中、多方案命中返回第一个方案和 `conflict`。

- [x] **Step 2: 运行目标测试确认失败**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe -m unittest discover -s tests -p 'test_string_router.py'`

Expected: 旧等值逻辑无法通过关键词包含和四值返回测试。

- [x] **Step 3: 实现最小后端逻辑**

在 `route_string` 中对标准化后的名称与每个非空关键词执行 `keyword.casefold() in signal.casefold()`，收集按方案顺序排列的命中；选择第一个，多个方案命中时返回 `conflict`，并把首个命中关键词通过节点 UI 字段 `matched_keyword` 传给前端。

- [x] **Step 4: 运行后端目标测试**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe -m unittest discover -s tests -p 'test_string_router.py'`

Expected: 全部通过。

### Task 2: 前端关键词配置与名称同步

**Files:**
- Modify: `tests/test_string_router_ui.mjs`
- Modify: `js/jindouyun_string_router_config.mjs`
- Modify: `js/jindouyun_string_router.js`

**Interfaces:**
- Consumes: 最近运行的 `lastLora`、当前 `activeSchemeId` 和配置中的 `bindings`。
- Produces: `recordLoraForScheme(value, schemeId, loraName)`，只更新方案 `name`；关键词继续由 `replaceSchemeBindings` 保存并维持跨方案唯一性。

- [x] **Step 1: 写入失败测试**

验证记录当前 LoRA 后方案名称等于不带模型后缀的完整名称、关键词列表不改变；验证界面包含“匹配关键词”“记录当前 LoRA”“每行一个关键词，例如 V1.1”，且不再出现精确绑定说明。

- [x] **Step 2: 运行前端目标测试确认失败**

Run: `node --experimental-vm-modules --test tests/test_string_router_ui.mjs`

Expected: 缺少 `recordLoraForScheme` 和新文案。

- [x] **Step 3: 实现配置函数与编辑器行为**

新增并导出 `recordLoraForScheme`；按钮点击时同步当前方案名称并重新渲染。把绑定输入区改为关键词输入区，保留每行一个值和跨方案重复关键词自动转移逻辑。读取 `matched_keyword` 和 `conflict` 状态，显示命中关键词或冲突提示。

- [x] **Step 4: 运行前端目标测试**

Run: `node --experimental-vm-modules --test tests/test_string_router_ui.mjs`

Expected: 全部通过。

### Task 3: 文档、兼容与集成验证

**Files:**
- Modify: `README.md`
- Verify: `__init__.py`
- Verify: all `tests/test_*.py` and `tests/*.mjs`

**Interfaces:**
- Consumes: 已注册的 `JindouyunStringRouter` 节点和现有 `bindings` JSON。
- Produces: 可由 ComfyUI 在线加载、保存和执行的关键词路由节点。

- [x] **Step 1: 更新用户文档**

将完整名称精确绑定说明改为关键词匹配说明，加入 `V1.1`/`V1.0` 示例、方案名称同步、默认方案和冲突优先级。

- [x] **Step 2: 运行完整自动化回归**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe -m unittest discover -s tests -p 'test_*.py'`

Run: `node --experimental-vm-modules --test tests/*.mjs`

Expected: Python 与前端测试全部通过。

- [x] **Step 3: 重启并在线验证**

重启 ComfyUI，确认 `/object_info/JindouyunStringRouter` 可用；构造 `V1.1` 与 `V1.0` 两个方案执行提示词队列，验证各自输出正确，冲突状态可见。

- [x] **Step 4: 浏览器界面验收**

在空白工作流中添加节点，检查方案名称、关键词输入区、状态牌和内部滚动，确认 400px 宽度下没有横向溢出或控件遮挡。
