# 筋斗云-字符串 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个按 LoRA 完整名称精确绑定文本方案、支持动态增删方案与文本段的 `筋斗云-字符串` 节点。

**Architecture:** Python 后端负责配置标准化、精确匹配、文本拼接和运行反馈；前端 DOM 控件只负责编辑同一份隐藏 JSON 配置及展示最近一次匹配状态。LoRA 名称和文本内容完全分离，不做触发词、前缀或提示词内容猜测。

**Tech Stack:** Python 3、ComfyUI 节点 API、原生 JavaScript DOM Widget、Node.js `assert`、Python `unittest`。

## Global Constraints

- 节点显示名称必须为 `筋斗云-字符串`，分类为 `筋斗云设计/文本`。
- 输入只接收随机 LoRA 节点的 `LoRA` 字符串输出；输出仅有一个 `字符串`。
- 每个方案默认三个文本段，可在 1 到 12 段之间动态增删。
- 匹配只比较标准化后的完整 LoRA 名称；不得搜索触发词、文件名前缀或文本内容。
- 未命中时使用唯一默认方案；没有默认方案则输出空字符串。
- 配置必须随工作流稳定保存，动态增删不得改变 ComfyUI 原生参数顺序。

---

### Task 1: 后端精确匹配与节点接口

**Files:**
- Create: `string_router.py`
- Create: `tests/test_string_router.py`

**Interfaces:**
- Produces: `normalize_lora_signal(value: Any) -> str`
- Produces: `normalize_router_config(value: Any) -> dict`
- Produces: `route_string(lora_name: Any, config_value: Any) -> tuple[str, str, str]`
- Produces: `JindouyunStringRouter.route(LoRA名称, 配置数据)` returning one `STRING` plus `ui` status data.

- [ ] **Step 1: Write failing backend tests**

```python
def test_exact_names_with_same_trigger_route_to_different_text():
    config = make_config([
        scheme("A", ["DEMO-STYLE-LORA-v1"], ["first", "prompt"]),
        scheme("B", ["DEMO-STYLE-LORA-v2"], ["second", "prompt"]),
    ])
    assert route_string("DEMO-STYLE-LORA-v2", config)[0] == "second, prompt"

def test_prompt_content_is_never_used_for_matching():
    config = make_config([scheme("A", ["bound-lora"], ["another name appears here"])])
    assert route_string("another name appears here", config)[0] == ""
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe tests\test_string_router.py`

Expected: FAIL because `string_router.py` does not exist.

- [ ] **Step 3: Implement normalization, routing, and node class**

```python
DEFAULT_CONFIG = {
    "version": 1,
    "schemes": [{
        "id": "scheme-1", "name": "方案 1", "bindings": [],
        "segments": [
            {"id": "segment-1", "text": ""},
            {"id": "segment-2", "text": ""},
            {"id": "segment-3", "text": ""},
        ],
        "delimiter": ", ", "isDefault": True,
    }],
}

def route_string(lora_name, config_value):
    signal = normalize_lora_signal(lora_name)
    config = normalize_router_config(config_value)
    selected = next((item for item in config["schemes"] if signal in item["bindings"]), None)
    mode = "matched"
    if selected is None:
        selected = next((item for item in config["schemes"] if item["isDefault"]), None)
        mode = "default" if selected else "unmatched"
    text = selected["delimiter"].join(part["text"].strip() for part in selected["segments"] if part["text"].strip()) if selected else ""
    return text, mode, selected["name"] if selected else ""
```

- [ ] **Step 4: Run backend tests**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe tests\test_string_router.py`

Expected: all tests pass for exact matching, suffix normalization, duplicate binding resolution, default routing, empty segments, custom delimiter and 损坏 JSON.

### Task 2: 动态方案编辑器

**Files:**
- Create: `js/jindouyun_string_router.js`
- Create: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Consumes: hidden native widget `配置数据` containing normalized JSON.
- Consumes: backend UI fields `lora_name`, `match_mode`, and `scheme_name`.
- Produces: one DOM widget `字符串方案编辑器` with stable serialization through `配置数据`.

- [ ] **Step 1: Write failing frontend source tests**

```javascript
assert.match(source, /新增方案/);
assert.match(source, /删除方案/);
assert.match(source, /新增文本段/);
assert.match(source, /绑定当前 LoRA/);
assert.match(source, /最多保留 12 个文本段/);
assert.match(source, /serialize:\s*false/);
```

- [ ] **Step 2: Run frontend test and verify failure**

Run: `node tests/test_string_router_ui.mjs`

Expected: FAIL because the frontend module does not exist.

- [ ] **Step 3: Implement compact DOM editor**

```javascript
const NODE_TYPE = "JindouyunStringRouter";
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 12;

function persist(node, configWidget, config) {
    configWidget.value = JSON.stringify(config);
    configWidget.callback?.(configWidget.value, app.canvas, node, configWidget);
    app.graph?.setDirtyCanvas?.(true, true);
}
```

The editor renders a scheme selector, add/delete scheme icon buttons, scheme name, exact binding list, `绑定当前 LoRA`, current scheme textareas, add/delete segment controls, delimiter, default toggle, and a match status strip. Only the active scheme is rendered so node width remains compact.

- [ ] **Step 4: Run frontend tests and syntax check**

Run: `node tests/test_string_router_ui.mjs`

Run: `node --check js/jindouyun_string_router.js`

Expected: both commands pass.

### Task 3: 注册、回归与在线验证

**Files:**
- Modify: `__init__.py`
- Modify: `README.md`
- Test: `tests/test_string_router.py`
- Test: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Consumes: `JindouyunStringRouter` from `string_router.py`.
- Produces: mapping key `JindouyunStringRouter` and display name `筋斗云-字符串`.

- [ ] **Step 1: Register the node and document it**

```python
from .string_router import JindouyunStringRouter

NODE_CLASS_MAPPINGS["JindouyunStringRouter"] = JindouyunStringRouter
NODE_DISPLAY_NAME_MAPPINGS["JindouyunStringRouter"] = "筋斗云-字符串"
```

- [ ] **Step 2: Run all Python tests**

Run: `D:\ComfyUI_windows_portable\python_embeded\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: zero failures.

- [ ] **Step 3: Run all frontend tests**

Run each `tests/*.mjs` with `node --experimental-vm-modules`.

Expected: zero failures.

- [ ] **Step 4: Restart ComfyUI and verify object metadata**

POST `http://127.0.0.1:8188/jindouyun_design/restart_comfyui`, wait for `/object_info/JindouyunStringRouter`, then verify one `LoRA名称` input and one `字符串` output.

- [ ] **Step 5: Review only feature-related changes**

Run: `git diff --check -- string_router.py js/jindouyun_string_router.js tests/test_string_router.py tests/test_string_router_ui.mjs __init__.py README.md`

Expected: no whitespace errors and no unrelated files modified by this feature.
