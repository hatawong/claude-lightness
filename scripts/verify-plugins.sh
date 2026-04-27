#!/usr/bin/env bash
# verify-plugins.sh — 验证 superpowers + caveman 插件已装且配置就位
#
# 用法: bash scripts/verify-plugins.sh
#
# 检查项:
#   1. superpowers 插件目录存在
#   2. caveman 插件目录存在
#   3. ~/.claude/settings.json 含两个插件的 enabledPlugins
#   4. (可选) caveman defaultMode 配置 (有则提示当前值)
#
# 退出码: 0 全部通过, 1 任一失败

set -uo pipefail

PASS=0
FAIL=0

green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
gray()  { printf "\033[0;90m%s\033[0m\n" "$1"; }

check() {
  local label=$1
  local condition=$2
  if eval "$condition"; then
    green "[✓] $label"
    PASS=$((PASS + 1))
  else
    red "[✗] $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "==> 检查 Claude Code 插件 + 配置"
echo

# 1. superpowers 装好
SUPERPOWERS_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/superpowers"
check "superpowers 已装 ($SUPERPOWERS_DIR)" "[ -d '$SUPERPOWERS_DIR' ]"

# 2. caveman 装好
CAVEMAN_DIR="$HOME/.claude/plugins/cache/caveman/caveman"
check "caveman 已装 ($CAVEMAN_DIR)" "[ -d '$CAVEMAN_DIR' ]"

# 3. settings.json 含 enabledPlugins
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  if grep -q '"superpowers@claude-plugins-official"[[:space:]]*:[[:space:]]*true' "$SETTINGS" 2>/dev/null; then
    green "[✓] settings.json 启用 superpowers"
    PASS=$((PASS + 1))
  else
    red "[✗] settings.json 未启用 superpowers"
    FAIL=$((FAIL + 1))
  fi
  if grep -q '"caveman@caveman"[[:space:]]*:[[:space:]]*true' "$SETTINGS" 2>/dev/null; then
    green "[✓] settings.json 启用 caveman"
    PASS=$((PASS + 1))
  else
    red "[✗] settings.json 未启用 caveman"
    FAIL=$((FAIL + 1))
  fi
else
  red "[✗] settings.json 不存在 ($SETTINGS)"
  FAIL=$((FAIL + 2))
fi

# 4. caveman defaultMode 提示 (非强制)
CAVEMAN_CONFIG="$HOME/.config/caveman/config.json"
if [ -f "$CAVEMAN_CONFIG" ]; then
  MODE=$(grep -o '"defaultMode"[[:space:]]*:[[:space:]]*"[^"]*"' "$CAVEMAN_CONFIG" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
  if [ -n "$MODE" ]; then
    gray "[i] caveman defaultMode = $MODE ($CAVEMAN_CONFIG)"
  else
    gray "[i] caveman config.json 存在但未设 defaultMode (使用内置默认: full)"
  fi
else
  gray "[i] caveman defaultMode 未配置 (使用内置默认: full)"
fi

echo
echo "==> 结果: $PASS 通过, $FAIL 失败"

if [ $FAIL -eq 0 ]; then
  green "完成. agent 可使用 superpowers + caveman 全套能力."
  exit 0
else
  red "存在失败项. 参考 docs/guide/01-install.md 重新装."
  exit 1
fi
