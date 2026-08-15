# 筋斗云-加载图像 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个兼容 ComfyUI 原生加载图像的节点，并可在节点内循环切换当前图片同目录的上一张和下一张。

**Architecture:** Python 节点继承原生 `LoadImage`，继续输出 `IMAGE` 与 `MASK`。安全接口只列出当前图片所在的 ComfyUI 允许目录；前端 DOM 控件负责自然排序翻页、位置显示和触发原生图片预览刷新。

**Tech Stack:** Python、aiohttp、ComfyUI 节点 API、JavaScript DOM 扩展、Node.js 与 unittest。

## Global Constraints

- 节点显示名称为“筋斗云-加载图像”。
- 保留 ComfyUI 原生上传、解码、遮罩和变更检测能力。
- 只切换当前图片所在目录的图片，首尾循环。
- 不允许接口访问 input、output、temp 之外的路径。

---

### Task 1: 后端节点与目录接口

**Files:**
- Create: `load_image.py`
- Modify: `__init__.py`
- Test: `tests/test_load_image.py`

- [ ] 编写失败测试，覆盖注册、自然排序、目录隔离和原生输出接口。
- [ ] 实现 `JindouyunLoadImage` 与 `list_sibling_images()`。
- [ ] 注册 `/jindouyun_design/image_siblings` 路由和节点映射。
- [ ] 运行 Python 测试并确认通过。

### Task 2: 节点内上一张/下一张控件

**Files:**
- Create: `js/jindouyun_load_image.js`
- Test: `tests/test_load_image_ui.mjs`

- [ ] 编写失败测试，覆盖两个按钮、序号、循环切换和原生回调。
- [ ] 实现紧凑 DOM 控件及请求去重。
- [ ] 运行 JavaScript 测试并确认通过。

### Task 3: 完整验证

**Files:**
- Verify: `tests/`

- [ ] 检查 JavaScript 语法。
- [ ] 运行全部 MJS 测试。
- [ ] 使用 ComfyUI 自带 Python 运行全部 unittest。

