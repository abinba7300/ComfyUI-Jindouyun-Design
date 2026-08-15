# 工作流命名版本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有工作流历史中加入保存新版本、版本名称、备注及后续编辑能力，同时保留普通 Ctrl+S 自动备份。

**Architecture:** 后端继续用时间编号保存 JSON 快照，在相邻元数据文件中保存名称和备注，并提供元数据更新接口。前端调用 ComfyUI 原生保存命令，临时抑制旧版自动备份，保存完成后创建命名快照，避免重复版本。

**Tech Stack:** Python、aiohttp、ComfyUI 前端扩展 JavaScript、Node.js 测试、unittest。

## Global Constraints

- 每个工作流的普通备份和命名版本共同保留最近 20 个。
- 版本重命名不得修改当前工作流文件名或备份 JSON 文件名。
- 普通 Ctrl+S 保存行为及保存前自动备份保持不变。
- 命名版本必须对应原生保存成功后的最新工作流内容。

---

### Task 1: 后端版本元数据

**Files:**
- Modify: `workflow_backup.py`
- Test: `tests/test_workflow_backup.py`

- [x] 测试名称、备注创建和更新行为。
- [x] 为创建接口增加 `name`、`note`，为列表接口返回这两个字段。
- [x] 增加安全的元数据更新接口，只更新对应时间编号的元数据文件。
- [x] 运行 Python 测试。

### Task 2: 保存与编辑界面

**Files:**
- Modify: `js/jindouyun_workflow_backup.js`
- Test: `tests/test_workflow_backup_ui.mjs`

- [x] 测试顶部保存按钮、保存抑制、名称备注编辑入口。
- [x] 增加“保存新版本”表单，调用原生保存后创建命名快照。
- [x] 每行展示版本名称和备注，并提供“重命名/备注”编辑表单。
- [x] 保留历史加载与普通 Ctrl+S 自动备份。
- [x] 运行全部前端测试和差异检查。
