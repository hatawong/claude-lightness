# Claude-Lightness

> Hardness Agent 工程模板库 — Iron Law、上下文工程、多 Agent 协作的工程范式, clone 即用。

`harness` 是套马具 (重 + 强约束), `lightness` 是它的对位 — **轻盈, 不硬套公式**。本仓库把 Hata 在 Claude Code 上沉淀的 agent 工程范式抽象成可复制的项目骨架, 给团队起手即用, 不再每个新项目从零踩坑。

## 4 大版块

| 版块 | 目录 | 内容 |
|---|---|---|
| **1. 装好工具链** | [docs/guide/01-install.md](docs/guide/01-install.md) | superpowers + caveman 两插件装法 + 验证 |
| **2. 写 CLAUDE.md** | [CLAUDE.md](CLAUDE.md) + [docs/guide/02-claude-md.md](docs/guide/02-claude-md.md) | Iron Law 6 条 + 设计哲学 + 写法心法 |
| **3. 上下文工程** | [skills/](skills/) + [hooks/](hooks/) + [docs/guide/03-context-engineering.md](docs/guide/03-context-engineering.md) + [docs/guide/session-guide.md](docs/guide/session-guide.md) | 2 SKILL (slim-session / ship-session) + session-start hook + 4 工具脚本 (slim-diagnose / detect-broken-chain / fix-broken-chain) + register/unregister |
| **4. 多 Agent 协作** | [agents/](agents/) + [docs/guide/04-multi-agent.md](docs/guide/04-multi-agent.md) | 5 ACTOR.md (commander / developer / researcher / reviewer / evolver) + workflow |

## Quick Start

```bash
# 1. clone
git clone https://github.com/hatawong/claude-lightness.git my-agent-project
cd my-agent-project

# 2. 装两个插件 (详见 docs/guide/01-install.md)
bash scripts/verify-plugins.sh        # 验证插件已装

# 3. 注册 hooks + skills 到本项目 (生成 .claude/settings.json + symlink)
bash scripts/register.sh .

# 4. 改根 CLAUDE.md (替换主标题 + Example 段 + 占位符)
$EDITOR CLAUDE.md

# 5. 改 agents/ 里 ACTOR.md (按你的项目调角色)

# 6. 开干
claude

# 想清理? 反向:
# bash scripts/unregister.sh .
```

## 仓库结构

```
claude-lightness/
├── CLAUDE.md               # 根: Iron Law 6 条 + 设计哲学 (clone 即用, 改 Example 段)
├── README.md               # 本文件
├── agents/                 # 5 ACTOR.md (commander / developer / researcher / reviewer / evolver)
├── skills/                 # 2 SKILL (slim-session / ship-session)
├── hooks/                  # session-start.sh + hooks.json (告知 agent 自己 session id)
├── scripts/                # 8 脚本: verify-plugins / register / unregister / slim-session / slim-diagnose / ship-session / detect-broken-chain / fix-broken-chain
└── docs/
    ├── SUMMARY.md          # 档牌讲义 (PPT 投屏 + 会后单文件)
    ├── guide/              # 4 版块讲义 (why + how)
    ├── design/             # 设计文档示例
    ├── research/           # 调研示例
    ├── tech/               # 技术细节示例
    ├── decisions/          # ADR 决策记录示例
    ├── insights/           # 洞察示例
    ├── plans/              # 实施计划示例
    ├── issues/             # 问题追踪示例
    ├── pitfalls.md         # 踩坑记录
    └── parking-lot.md      # 待办池
```

## 三个核心理念

- **Iron Law** — 规则要有"违反字面 = 违反精神"的张力。每条来自踩过的坑或反复纠偏, 不凭空假设。
- **上下文工程** — context 是有限资源, 主动管 (skills + hooks) 而非被动塞。长 session 要 slim, 复杂任务要 surgery, 跨 session 要 memory。
- **多 Agent 协作** — 单 agent 不是终点, 角色拆分 (commander / developer / reviewer / ...) 是 scale 之路。

## 进一步阅读

- [docs/SUMMARY.md](docs/SUMMARY.md) — 一文档讲完核心理念 (3000-5000 字, 适合 PPT 投屏 / 会后发送)
- [docs/guide/](docs/guide/) — 4 版块逐个讲解
- [CLAUDE.md](CLAUDE.md) — 6 条 Iron Law 完整版

## 本仓库由谁建

Hata — 技术型独立创业者/研究者, Agent 自进化赛道。本仓库源于 [claude-ultra](https://github.com/hatawong/claude-ultra) (Hata 主项目, macOS Tauri 桌面应用) 沉淀的工程范式, 抽象脱业务后供其他 agent 项目复用。

---

License: MIT
