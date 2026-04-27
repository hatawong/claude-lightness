---
name: slim-session
description: Use when the user wants to slim the current session JSONL to free up context space, or when context is getting full. Do NOT trigger on "compact" — that is a different (lossy) mechanism. Do NOT use for slimming other sessions — call slim-session.js directly without --self.
---

# slim-session

Programmatically slim the current session's JSONL — delete redundant entries, clean IDE tags, clear usage, persist large tool_results. **无损** (vs `/compact` 的有损摘要)。

## Guard: self vs other

If the user specifies a session ID different from `[SessionStart] session=` in your context → **STOP. Do NOT read past this line.** Use only these two commands:

```bash
# Diagnose (read-only)
node "<scripts_path>/slim-diagnose.js" "<other-jsonl-path>"

# Slim (when user confirms)
node "<scripts_path>/slim-session.js" "<other-jsonl-path>" --backup
```

Do NOT add `--self` or any other flags. Do NOT pkill.

## Instructions

### Preparation

1. Get **session ID** from context: `[SessionStart] session=SESSION_ID`
   - If not found, report "session ID not injected" and stop.

2. Build JSONL path: `$HOME/.claude/projects/{project-path-encoded}/{SESSION_ID}.jsonl`
   - project-path-encoded = cwd with `/` → `-`, leading `-`

3. Locate scripts dir: `<repo-root>/scripts/`

### Diagnose

```bash
node "<scripts_path>/slim-diagnose.js" "$JSONL_PATH"
```

Parse "Estimated savings" line from output to get KB and %.

### Confirm

Use the AskUserQuestion tool:
- question: "Slim session? Saves ~{KB}KB ({%}). CLI will restart."
- options: ["Execute", "Execute (skip trim-results)", "Cancel"]
- Fill {KB} and {%} from the diagnose output's "Total estimated" line.

Do NOT ask in free text. Do NOT elaborate on options.

### Execute

Based on user choice:

```bash
# "Execute" (default includes trim-results)
node "<scripts_path>/slim-session.js" "$JSONL_PATH" --backup --self

# "Execute (skip trim-results)"
node "<scripts_path>/slim-session.js" "$JSONL_PATH" --backup --no-trim-results --self
```

`--self` = slimming own session: forks background → sleep 2s → slims → pkills CLI. Script stdout includes reload hint for VS Code users.

## When to use

- Context > 70% (token usage 显示在 statusline 或 `/context`)
- Session 跑了一阵子后, 多 tool_use/tool_result 累积冗余
- 想保留全部对话语义 (无损), 不想 `/compact` 的摘要丢细节

## When NOT to use

- 危机救援 (context > 95%, 关键决策线快丢) — 用 ship-session 整体造船更安全
- 想跨 session 持久 — slim 只清当前 session, 不跨 session
- 想自动归档 topic — slim 不分 topic, 只机械去冗余

## Related

- [`scripts/slim-session.js`](../../scripts/slim-session.js) — 实现
- [`scripts/slim-diagnose.js`](../../scripts/slim-diagnose.js) — 只读诊断
- [`docs/guide/session-guide.md`](../../docs/guide/session-guide.md) — JSONL 知识 + 工具操作完整指南
- ship-session — 比 slim-session 重的版本 (按 round 边界整体造新船)
