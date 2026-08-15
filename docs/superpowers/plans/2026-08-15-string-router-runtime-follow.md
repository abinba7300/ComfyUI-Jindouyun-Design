# String Router Runtime Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full prompt-scheme editor automatically display the scheme actually selected by each LoRA execution.

**Architecture:** Add a pure resolver that maps backend execution metadata back to a configured scheme ID, then update only the editor's in-memory active selection before rendering. Runtime following must not persist or rewrite scheme data.

**Tech Stack:** JavaScript ES modules, ComfyUI frontend extension API, Node.js assertion tests.

## Global Constraints

- The backend configuration schema and saved workflow format stay unchanged.
- Automatic runtime switching changes display selection only and must not call the persistence path.
- Matched, conflicting, and default routes follow the actual executed scheme; unmatched routes without a fallback keep the current editor selection.

---

### Task 1: Resolve The Executed Scheme

**Files:**
- Modify: `js/jindouyun_string_router_config.mjs`
- Test: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Consumes: normalized router configuration plus `loraName`, `schemeName`, `matchedKeyword`, and `matchMode` execution metadata.
- Produces: `resolveExecutedSchemeId(value, execution)` returning a configured scheme ID or an empty string.

- [x] **Step 1: Write failing resolver tests**

Cover consecutive LoRA matches, default fallback, duplicate scheme names, and unmatched-without-default behavior.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `node tests/test_string_router_ui.mjs`

- [x] **Step 3: Implement the pure resolver**

Prefer the backend matched keyword, verify it against the LoRA signal, then fall back to the existing deterministic matcher and finally the backend scheme name when unambiguous.

- [x] **Step 4: Run the focused test and confirm success**

Run: `node tests/test_string_router_ui.mjs`

### Task 2: Follow Runtime Results In The Editor

**Files:**
- Modify: `js/jindouyun_string_router.js`
- Test: `tests/test_string_router_ui.mjs`

**Interfaces:**
- Consumes: `resolveExecutedSchemeId` and ComfyUI `onExecuted` UI metadata.
- Produces: editor selection that follows the current executed route without saving configuration.

- [x] **Step 1: Add a failing source-level regression assertion**

Assert that the execution callback resolves and applies `activeSchemeId` before `renderEditor()`, with no `persist()` call in that callback.

- [x] **Step 2: Implement runtime editor following**

Resolve the executed scheme, replace the in-memory `activeSchemeId` when a valid ID exists, then render the status and full editor.

- [x] **Step 3: Run frontend and backend regression suites**

Run all `.mjs` tests, JavaScript syntax checks, and the Python test suite.

- [x] **Step 4: Review the final diff**

Confirm only runtime display selection changed and no existing user-authored scheme content is rewritten.
