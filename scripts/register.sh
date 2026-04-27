#!/usr/bin/env bash
# register.sh — Register claude-lightness hooks + skills into a target project
#
# Writes hook entries into the project's .claude/settings.json and symlinks
# all skills from this repo into .claude/skills/. Hooks point to SOURCE repo,
# so changes to hook scripts take effect immediately (no plugin cache copy).
#
# Usage:
#   bash scripts/register.sh [target_project_dir]
#
# Examples:
#   bash scripts/register.sh              # register into current dir
#   bash scripts/register.sh ~/my-app     # register into ~/my-app
#
# Undo: bash scripts/unregister.sh [target_project_dir]

set -euo pipefail

PROJECT_DIR="${1:-.}"
PROJECT_DIR=$(cd "$PROJECT_DIR" && pwd)

# Resolve this script's repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SETTINGS_DIR="$PROJECT_DIR/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

mkdir -p "$SETTINGS_DIR"

echo "==> 注册 claude-lightness 到 $PROJECT_DIR"
echo "    源仓库: $REPO_ROOT"
echo

# 1. Register hooks
if [ -f "$SETTINGS_FILE" ]; then
  EXISTING_HOOKS=$(jq '.hooks // empty' "$SETTINGS_FILE" 2>/dev/null || echo "")
  if [ -n "$EXISTING_HOOKS" ] && [ "$EXISTING_HOOKS" != "null" ]; then
    echo "WARNING: $SETTINGS_FILE 已含 hooks:" >&2
    echo "$EXISTING_HOOKS" | jq '.' >&2
    echo >&2
    read -r -p "覆盖? [y/N] " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
      echo "已取消."
      exit 0
    fi
  fi
  # Merge: 保留其他 key, 覆盖 hooks
  jq --arg ss "$REPO_ROOT/hooks/session-start.sh" \
     '.hooks = {
        "SessionStart": [{"matcher": "startup|resume|clear|compact", "hooks": [{"type": "command", "command": $ss}]}]
      }' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
else
  cat > "$SETTINGS_FILE" <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "$REPO_ROOT/hooks/session-start.sh" }]
      }
    ]
  }
}
EOF
fi

echo "[✓] hooks 注册到 $SETTINGS_FILE"
echo "    SessionStart → $REPO_ROOT/hooks/session-start.sh"
echo

# 2. Symlink skills
SKILLS_DIR="$SETTINGS_DIR/skills"
mkdir -p "$SKILLS_DIR"
SKILL_COUNT=0
for skill_dir in "$REPO_ROOT"/skills/*/; do
  [ ! -d "$skill_dir" ] && continue
  skill_name=$(basename "$skill_dir")
  target="$SKILLS_DIR/$skill_name"
  if [ -L "$target" ] || [ -d "$target" ]; then
    echo "    skill: $skill_name (已存在, 跳过)"
  else
    ln -sf "$skill_dir" "$target"
    echo "[✓] skill: $skill_name → $skill_dir"
    SKILL_COUNT=$((SKILL_COUNT + 1))
  fi
done

echo
echo "==> 完成. 在 $PROJECT_DIR 跑 \`claude\` 即可使用 claude-lightness."
echo "    注销: bash $REPO_ROOT/scripts/unregister.sh $PROJECT_DIR"
