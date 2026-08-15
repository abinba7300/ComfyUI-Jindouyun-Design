# Interactive Crop Side Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rotation, mirror, and transform controls beside the interactive crop canvas while simplifying the settings above it.

**Architecture:** Reuse the existing control elements and event handlers, changing only their DOM containers and CSS layout. A three-column preview workspace owns the left tools, canvas, and right tools; existing canvas geometry continues to derive from `canvasShell` dimensions.

**Tech Stack:** ComfyUI custom-node JavaScript, DOM/CSS, Node.js source tests, Python unittest.

## Global Constraints

- Preserve all existing crop, rotation, mirror, transform, upload, resize, and branch behavior.
- Keep all visible controls inside the node at supported widths.
- Keep Chinese labels and existing widget values compatible with saved workflows.

---

### Task 1: Side Toolbar Layout

**Files:**
- Modify: `js/jindouyun_interactive_crop.js`
- Test: `tests/test_interactive_crop_ui.mjs`

**Interfaces:**
- Consumes: existing `rotationRow`, `mirrorRow`, `transformRow`, and `canvasShell` controls.
- Produces: `previewWorkspace`, `leftToolRail`, and `rightToolRail` DOM containers.

- [ ] Add source assertions for three-column workspace and side rail ownership.
- [ ] Convert the rotation and mirror containers to compact vertical controls.
- [ ] Convert the transform container to a compact vertical control.
- [ ] Append the three controls around `canvasShell` and leave only max-edge, branch, and ratio controls above.
- [ ] Run `node tests/test_interactive_crop_ui.mjs`.

### Task 2: Responsive Sizing and Verification

**Files:**
- Modify: `js/jindouyun_interactive_crop.js`
- Test: `tests/test_interactive_crop_ui.mjs`

**Interfaces:**
- Consumes: `syncCropPanelWidth(node, wrapper)` and `fitCanvas()`.
- Produces: stable side widths with a stretchable center canvas.

- [ ] Add responsive grid constraints and compact typography.
- [ ] Update panel sizing without changing crop coordinate calculations.
- [ ] Run every `.mjs` test with `--experimental-vm-modules`.
- [ ] Run Python `unittest` discovery.
- [ ] Inspect the node in the running ComfyUI page for clipping and overlap.
