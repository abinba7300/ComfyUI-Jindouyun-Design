# 筋斗云随机 LoRA 模式状态牌 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为筋斗云随机LORA节点增加可点击、与原开关同步的彩色模式状态牌。

**Architecture:** 在现有 LoRA 文件夹前端扩展中直接把“随机”原生控件绘制成状态牌，不添加 DOM 控件或新的序列化位置。加载旧工作流时迁移历史状态牌留下的首位空占位。所有切换仍通过原控件回调进入 ComfyUI。

**Tech Stack:** ComfyUI 前端扩展、原生 DOM/CSS、Node.js `vm` 测试。

## Global Constraints

- 全中文界面，状态牌不增加节点宽度。
- 随机模式为绿色，固定模式为蓝色。
- 复用原有随机开关的数据位置，保证旧工作流兼容。

---

### Task 1: 模式状态牌与同步测试

**Files:**
- Modify: `js/krea2_random_lora_folder_picker.js`
- Modify: `tests/test_folder_picker_ui.mjs`

**Interfaces:**
- Consumes: 原生控件 `随机: BOOLEAN`、`固定: COMBO`
- Produces: `patchModeBadge(node)` 与节点属性 `__jindouyunUpdateLoraModeBadge`

- [ ] **Step 1: 写失败测试**

在 VM 测试中载入包含历史空占位的真实参数序列，断言空占位被移除、固定 LoRA 与强度数值恢复正确，并验证原生随机控件显示绿色状态牌及点击切换。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --experimental-vm-modules tests/test_folder_picker_ui.mjs`
Expected: FAIL，因为状态牌尚不存在。

- [ ] **Step 3: 实现状态牌**

在现有前端扩展中将“随机”控件绘制成 48 像素高按钮式状态牌；在 `configure` 前迁移历史空占位，避免任何额外控件参与序列化。

- [ ] **Step 4: 运行前端与完整测试**

Run: `node --experimental-vm-modules tests/test_folder_picker_ui.mjs`
Expected: PASS。

Run: `python -m unittest discover -s tests -p "test_*.py"`
Expected: 全部通过。

- [ ] **Step 5: 重启并验证加载**

确认 ComfyUI 队列为空后重启，检查服务提供的脚本包含状态牌和双向同步逻辑。
