# 智能手绘规整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在筋斗云画布合成的全屏绘画中，将近似手绘直线、圆/椭圆和圆弧自动拟合为规整图形，同时保留普通自由曲线。

**Architecture:** 在 `jindouyun_canvas_geometry.mjs` 中实现无界面依赖的形状分析和点集拟合，返回识别类型、置信度和规整点。`jindouyun_canvas_drawing.js` 在笔画结束时调用该函数，并提供默认开启的“智能规整”与 0-100 灵敏度控制；保存后的规整点继续沿用现有图层、撤销、变换和后端绘制流程。

**Tech Stack:** ComfyUI 前端扩展、原生 JavaScript、Canvas 2D、Node.js 测试。

## Global Constraints

- 智能规整默认关闭，默认灵敏度 50%。
- 只处理普通画笔和铅笔笔画，不处理套索和几何工具生成的图形。
- 识别失败时必须完整保留原始自由笔画。
- 识别后仍为独立图层，可撤销、移动、缩放、旋转和输出。
- 不新增第三方依赖。

---

### Task 1: 几何识别与拟合

**Files:**
- Modify: `js/jindouyun_canvas_geometry.mjs`
- Test: `tests/test_canvas_geometry.mjs`

**Interfaces:**
- Produces: `regularizeStrokePoints(points, width, height, sensitivity)`，返回 `{kind, confidence, points}` 或 `null`。

- [x] 增加抖动直线、闭合圆、闭合椭圆、开放圆弧和普通自由曲线测试。
- [x] 实现像素坐标转换、直线偏差、闭合度、椭圆拟合误差和圆弧连续性判断。
- [x] 生成规整直线、椭圆和圆弧点集并保留原始绘制方向。
- [x] 验证灵敏度升高时阈值适度放宽，普通曲线仍不误判。

### Task 2: 全屏画布控制与落笔接入

**Files:**
- Modify: `js/jindouyun_canvas_drawing.js`
- Test: `tests/test_canvas_drawing_import_compatibility.mjs`

**Interfaces:**
- Consumes: `regularizeStrokePoints(points, width, height, sensitivity)`。

- [x] 在绘画数据中加入 `smartRegularize: true` 和 `regularizeSensitivity: 50`，兼容旧数据。
- [x] 在右侧曲线优化附近加入“智能规整”开关和灵敏度滑块。
- [x] 普通笔画完成时先进行智能规整，未识别时再执行原曲线优化。
- [x] 状态栏显示“已规整为直线/圆形/椭圆/圆弧”，并保证撤销恢复原落笔前状态。
- [x] 保存设置和规整后的点数据到节点。

### Task 3: 回归验证

**Files:**
- Test: `tests/test_canvas_geometry.mjs`
- Test: `tests/test_canvas_drawing_import_compatibility.mjs`

- [x] 运行 JavaScript 语法检查和几何测试。
- [x] 运行全部前端测试。
- [x] 运行全部 Python 测试，确认后端输出兼容。
