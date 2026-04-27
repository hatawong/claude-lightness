# 01. 装好工具链 (superpowers + caveman)

> 配合 [scripts/verify-plugins.sh](../../scripts/verify-plugins.sh) 一键验证。

本仓库依赖两个 Claude Code 插件:

| 插件 | 仓库 | Marketplace | 作用 |
|---|---|---|---|
| **superpowers** | [obra/superpowers](https://github.com/obra/superpowers) | `claude-plugins-official` (官方, 默认已注册) | Skills 库: brainstorming / TDD / code-review 等标准工作流 |
| **caveman** | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | `caveman` (第三方, 需手动注册) | 超压缩通信模式, 节省 ~75% token, 保留全部技术精度 |

两个都装上后, agent 才会按本模板里 CLAUDE.md / agents / skills / hooks 全套约束工作。

## 前置要求

- Claude Code CLI 已装好 (`claude` 命令可用), 详见 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
- 一个本地 git 项目 (clone 本模板或你自己的)

## 装法 A: Claude Code 命令式 (推荐)

在任意 Claude Code session 里 (任何项目都行, 命令是全局), 依次输入下面的 slash command (不是 shell, 在 Claude Code 对话框里):

```
# 1. 装 superpowers (官方 marketplace 默认已注册, 直接 install)
/plugin install superpowers@claude-plugins-official

# 2. 注册 caveman 第三方 marketplace
/plugin marketplace add JuliusBrussee/caveman

# 3. 装 caveman
/plugin install caveman@caveman

# 4. 重载使生效 (不必重启)
/reload-plugins
```

完成后 Claude Code 会自动写入 `~/.claude/settings.json` 的 `enabledPlugins` + `extraKnownMarketplaces`。

## 装法 B: 手动改 settings.json

如果命令式失败 / 想精细控制, 直接改 `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "caveman@caveman": true
  },
  "extraKnownMarketplaces": {
    "caveman": {
      "source": {
        "source": "github",
        "repo": "JuliusBrussee/caveman"
      }
    }
  }
}
```

注意:
- `claude-plugins-official` 是官方 marketplace, 默认已知, 不需要 `extraKnownMarketplaces` 注册
- `caveman` 是第三方 marketplace, 需要在 `extraKnownMarketplaces` 注册
- 改完后在对话里输入 `/reload-plugins` 使生效 (不必重启 session)

## 验证装好

跑模板自带的验证脚本:

```bash
cd /path/to/your-claude-lightness-project
bash scripts/verify-plugins.sh
```

预期输出 (全 4 项通过):

```
==> 检查 Claude Code 插件 + 配置

[✓] superpowers 已装 (~/.claude/plugins/cache/claude-plugins-official/superpowers)
[✓] caveman 已装 (~/.claude/plugins/cache/caveman/caveman)
[✓] settings.json 启用 superpowers
[✓] settings.json 启用 caveman
[i] caveman defaultMode = ultra (~/.config/caveman/config.json)   # 可选项, 未配则提示用 full

==> 结果: 4 通过, 0 失败
完成. agent 可使用 superpowers + caveman 全套能力.
```

或在 Claude Code 里手动测两个 plugin 的命名空间命令:

```
/superpowers
```

应能在自动补全里看到全部 superpowers 子命令 (brainstorming / writing-plans / code-review 等)。

```
/caveman
```

应能看到 caveman 模式切换命令 (lite / full / ultra)。

如果两个命令都不出现在自动补全, 说明 plugin 没装好或没 reload, 跑 `/reload-plugins` 或重启 session。

## 用法 — superpowers

装好后 agent 会**自动**在合适时机调用 skills — superpowers 的 skill 多数是 model-invoked, 不需手动触发。你也能手动触发。

**最常用 3 个** (按工作流顺序):

| 顺 | 命令 | 何时用 |
|---|---|---|
| 1 | `/superpowers:brainstorming` | 任何创意/新功能/需求探索前, 把模糊想法变清晰需求 |
| 2 | `/superpowers:test-driven-development` | 实现新功能 / 改 bug 前, 先红 → 绿 → 重构 |
| 3 | `/superpowers:requesting-code-review` | 完成功能后, 调独立 reviewer 审产出 (不自检) |

其他常用:
- `/superpowers:writing-plans` — 复杂任务的实施计划
- `/superpowers:executing-plans` — 按 plan 跑, 含 checkpoint
- `/superpowers:systematic-debugging` — 复杂 bug 系统化排查
- `/superpowers:verification-before-completion` — 声称"完成"前的最终验证

详见 [superpowers 仓库 README](https://github.com/obra/superpowers)。

## 用法 — caveman

装好后默认**不开启**, 通过命令切换:

```
/caveman lite      # 轻度压缩 (~30% token 节省)
/caveman full      # 标准压缩 (默认, ~50% 节省)
/caveman ultra     # 极度压缩 (~75% 节省, 像 caveman 说话)
```

关闭:

```
stop caveman
```

或在对话里说"normal mode"。

### 配置默认模式

每次 session 起手希望直接用 `ultra` (而非默认 `full`), 写一份 `config.json`:

```bash
mkdir -p ~/.config/caveman
cat > ~/.config/caveman/config.json <<'EOF'
{
  "defaultMode": "ultra"
}
EOF
```

**路径** (按平台):
- macOS / Linux: `~/.config/caveman/config.json`
- Windows: `%APPDATA%\caveman\config.json`
- 通用 (若 `$XDG_CONFIG_HOME` 已设): `$XDG_CONFIG_HOME/caveman/config.json`

**可选 `defaultMode` 值**: `off` / `lite` / `full` / `ultra` / `wenyan-lite` / `wenyan` / `wenyan-full` / `wenyan-ultra` / `commit` / `review` / `compress`。

(以上均从 caveman 插件源码 `hooks/caveman-config.js` 的 `VALID_MODES` 常量与 `getConfigPath()` 实测验证。)

**验证生效**:

```bash
node -e "console.log(require('$HOME/.claude/plugins/cache/caveman/caveman/<version>/hooks/caveman-config.js').getDefaultMode())"
# 应输出: ultra
```

### Statusline (可选, 状态栏显示当前 caveman 等级)

在 `~/.claude/settings.json` 加:

```json
"statusLine": {
  "type": "command",
  "command": "bash \"${HOME}/.claude/plugins/cache/caveman/caveman/<version>/hooks/caveman-statusline.sh\""
}
```

`<version>` 替换为实际版本号 (装好后 `ls ~/.claude/plugins/cache/caveman/caveman/` 看)。

## 反模式

❌ **装一个不装另一个** — 本模板的 CLAUDE.md / agents / skills 默认两个都在。少装 caveman 不致命 (只是 token 多), 少装 superpowers 会让 agents/skills 调用失败。

❌ **装好后不重启 session** — Claude Code 启动时才扫描 plugin, 装完不重启等于没装。

❌ **复制别人 settings.json 时连他的 ANTHROPIC_BASE_URL / API_KEY 一起复制** — 那是别人的网关 / 密钥, 用了会出事。本模板的 settings.json 模板只有 `enabledPlugins` + `extraKnownMarketplaces`, 不含 env / 密钥。

## 进一步资源

- [superpowers 文档](https://github.com/obra/superpowers)
- [caveman 文档](https://github.com/JuliusBrussee/caveman)
- [Claude Code Plugin 机制官方文档](https://code.claude.com/docs/en/plugins) — 创建插件
- [Claude Code Plugin 安装文档](https://code.claude.com/docs/en/discover-plugins) — 装/管插件
- `.claude/settings.json` — register 后生成 (含本仓库 hooks 配置), 不入 git (见 `.gitignore`)
- [scripts/verify-plugins.sh](../../scripts/verify-plugins.sh) — 一键验证脚本
