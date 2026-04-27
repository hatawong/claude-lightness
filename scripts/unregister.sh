#!/usr/bin/env bash
# unregister.sh — Remove claude-lightness hooks + skill symlinks (undo register.sh)
#
# 安全保证: 只删本仓库写入的部分, 不动用户自己的其他 hooks / settings 字段。
#
# 具体策略:
#   1. hooks — 仅删 SessionStart 中 command 路径以本 repo 为前缀的 hook entry
#      - 空的 matcher 项 (hooks 数组为空) → 删
#      - 空的 SessionStart 数组 → 删 SessionStart key
#      - 空的 hooks 对象 → 删 hooks key
#      - 用户的其他 hook event (PreToolUse/Stop/Notification 等) 完全不动
#   2. settings.json — 不删整文件 (即使删完 hooks 后变 {}, 也保留, 让用户决定)
#   3. skills — 仅删 symlink 指向本 repo 的, 不动用户其他 skill
#
# Usage:
#   bash scripts/unregister.sh [target_project_dir]

set -euo pipefail

PROJECT_DIR="${1:-.}"
PROJECT_DIR=$(cd "$PROJECT_DIR" && pwd)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SETTINGS_FILE="$PROJECT_DIR/.claude/settings.json"

echo "==> 注销 claude-lightness 从 $PROJECT_DIR"
echo

# 1. 精细删 hooks: 只动 command 指向本 repo 的 entry
if [ -f "$SETTINGS_FILE" ]; then
  HAS_HOOKS=$(jq 'has("hooks")' "$SETTINGS_FILE" 2>/dev/null || echo "false")
  if [ "$HAS_HOOKS" != "true" ]; then
    echo "    $SETTINGS_FILE 无 hooks key, 跳过 hook 清理."
  else
    # jq 程序: 滤掉 SessionStart 中 command 以 REPO_ROOT 开头的 entry, 清空的 matcher / 数组 / 对象
    UPDATED=$(jq --arg repo "$REPO_ROOT/" '
      if .hooks.SessionStart then
        .hooks.SessionStart |= [
          .[] |
          (.hooks |= map(select((.command // "") | startswith($repo) | not))) |
          select(.hooks | length > 0)
        ] |
        if (.hooks.SessionStart | length) == 0 then del(.hooks.SessionStart) else . end |
        if (.hooks | length) == 0 then del(.hooks) else . end
      else
        .
      end
    ' "$SETTINGS_FILE")

    # 比较是否变化 (用 jq normalize 两端, 排除纯格式差异)
    ORIGINAL=$(jq . "$SETTINGS_FILE")
    if [ "$UPDATED" = "$ORIGINAL" ]; then
      echo "    settings.json 中无本仓库 hook entry, 跳过."
    else
      echo "$UPDATED" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
      echo "[✓] 删 settings.json 中本仓库的 SessionStart hook entry (其他 hooks / settings 字段全保留)"
    fi
  fi
else
  echo "    $SETTINGS_FILE 不存在, 无 hooks 可删."
fi

# 2. 删 skill symlinks (仅指向本 repo 的)
SKILLS_DIR="$PROJECT_DIR/.claude/skills"
if [ -d "$SKILLS_DIR" ]; then
  REMOVED=0
  for target in "$SKILLS_DIR"/*; do
    [ ! -L "$target" ] && continue
    link_dest=$(readlink "$target" 2>/dev/null || true)
    if [[ "$link_dest" == "$REPO_ROOT/"* ]]; then
      rm "$target"
      echo "[✓] 删 skill symlink: $(basename "$target")"
      REMOVED=$((REMOVED + 1))
    fi
  done
  if [ -d "$SKILLS_DIR" ] && [ -z "$(ls -A "$SKILLS_DIR" 2>/dev/null)" ]; then
    rmdir "$SKILLS_DIR"
    echo "    $SKILLS_DIR 空, 已删."
  fi
  if [ "$REMOVED" -gt 0 ]; then
    echo "    共删 $REMOVED 个 skill symlink (用户其他 skill 不动)"
  fi
fi

# 3. 不删 settings.json 整文件 + 不删 .claude 目录 (用户可能还要用)
echo
echo "==> 完成. claude-lightness 已从 $PROJECT_DIR 注销."
echo "    保留: settings.json (即使变空) / .claude/ 目录 / 用户其他 hooks / skills"
