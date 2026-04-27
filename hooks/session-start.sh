#!/usr/bin/env bash
# session-start.sh — SessionStart hook
#
# 作用: 把当前 session id 注入到 agent context, 让 agent 知道自己是谁。
# stdout 内容自动注入 Claude context (= "首条系统提醒")。
#
# Hook 输入 (stdin JSON): { session_id, cwd, source, transcript_path, ... }
# Hook 配置: hooks/hooks.json -> SessionStart matcher startup|resume|clear|compact

set -euo pipefail

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"')

# Plugin scripts dir (绝对路径), 让 agent 在 SKILL 里能直接引用
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPTS_PATH="$PLUGIN_ROOT/scripts"

echo "[SessionStart] session=$SESSION_ID source=$SOURCE cwd=$CWD"
echo "Plugin scripts path: $SCRIPTS_PATH"
echo ""
echo "本 session 的 JSONL 文件路径 (供 slim-session / ship-session 工具用):"

# 推导 JSONL 路径: ~/.claude/projects/<cwd-encoded>/<session-id>.jsonl
PROJECT_ENCODED="${CWD//\//-}"
echo "  ~/.claude/projects/${PROJECT_ENCODED}/${SESSION_ID}.jsonl"
