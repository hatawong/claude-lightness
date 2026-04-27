# 03. 上下文工程 (Context Engineering)

> 配合 [skills/](../../skills/) + [hooks/](../../hooks/) + [scripts/](../../scripts/) 阅读。
> 工具完整用法见 [session-guide.md](session-guide.md)。

## 上下文工程是什么

LLM 的 **context window** 是有限资源 (Claude Opus 1M token, Sonnet 200K)。一个长 session 跑下来, context 会被累积内容塞满: 旧对话、读过的文件、tool result、思考链。一旦塞满:

- agent 开始**遗忘**早期结论 (LRU 淘汰)
- 反复**重读**已经讨论过的文件
- 关键决策**漂移** (后期判断没了前期前提)
- 强制 `/compact` 又是**有损压缩** (大块细节丢失)

**上下文工程 = 主动管 context 寿命 / 结构, 而非被动塞**。

## 工具图谱 (本模板最简版)

本模板只收录**稳定 + 高频 + 通用**的工具, 不堆叠"看起来有用"的 nice-to-have。

| 类别 | 工具 | 何时用 |
|---|---|---|
| **Skill (轻)** | [slim-session](../../skills/slim-session/SKILL.md) | context > 70%, 想无损去冗余 (清 IDE tag / persist 大 tool_result / 清 usage) |
| **Skill (重)** | [ship-session](../../skills/ship-session/SKILL.md) | session 长 (>700K tokens), 用户口头宣布 round / 阶段边界, 想按语义边界整体打包 |
| **Hook** | [session-start](../../hooks/session-start.sh) | session 启动时, 注入当前 session id + JSONL 路径到 agent context (让 agent 知道"自己是谁") |
| **Script** | [slim-diagnose.js](../../scripts/slim-diagnose.js) | slim 前的只读诊断, 算能省多少 KB |
| **Script** | [detect-broken-chain.js](../../scripts/detect-broken-chain.js) | session 装载异常时检 parentUuid 链 |
| **Script** | [fix-broken-chain.js](../../scripts/fix-broken-chain.js) | 修复 parentUuid 链断 |
| **Script** | [register.sh](../../scripts/register.sh) / [unregister.sh](../../scripts/unregister.sh) | 把本仓库 hooks + skills 一键挂到任意目标项目 |

## 决策树

```
context 满了?
├── < 70%        → 不动
├── 70-90%       → slim-session (无损去冗余)
└── > 90%, 且想保留因果链 + 工作节奏
                 → ship-session (按 round 边界造新船)

session 装载失败 / 行为异常?
└── parentUuid 链可能断
    ├── 先 detect-broken-chain (诊断)
    └── 再 fix-broken-chain (修)

新项目想用本套工具?
└── register.sh <target-project>  (一键注册 hooks + skills)
```

## 三个核心理念

### 1. context 是有限资源, 不是无限货架

写 prompt / 调 agent 不能"反正 context 够大就塞", 累积内容会把工作带挤窄。**主动管, 不被动塞**。

### 2. 无损优先于有损

`/compact` 是有损 (LLM 摘要会丢细节), `slim-session` 是无损 (机械去冗余)。**能 slim 就先 slim, 实在不行再 ship**。

### 3. 边界 = 用户宣布, 不是 agent 自决

ship-session 按 round / 阶段切, 这个边界**只能用户口头宣布**, agent 自决会切错点 / 因果链断。设计上把人作为最终边界判官。

## Hooks 在本模板里的角色 (轻量)

不像有些框架在 SessionStart 注入大量 memory / 自动归档 / topic 管理, 本模板的 `session-start.sh` **只做一件事**: 把当前 session id + JSONL 路径输出到 stdout (CC 自动注入 agent context)。

为什么这么轻:
- 让 agent 自己知道"我在哪个 session" → slim/ship 工具调用时知道操作哪个 jsonl
- 不替 agent 做归档 / topic 切分 / memory inject — 这些是更大的设计选择, 不是每个项目都需要
- 重的 hook 容易跟用户自己的 hook 冲突, 轻的没冲突

想要更重的 hook (如 SessionStart 自动注入项目 memory / Stop 自动归档 topic), 看 [claude-recap](https://github.com/hatawong/claude-recap) — 主题级 memory 框架, 跨 session / 跨 compaction 不丢, plugin 形式安装。

## 反模式

❌ **依赖 `/compact` 一招鲜** — `/compact` 有损, 关键细节会丢。优先 slim (无损) + ship (按边界整体打包)。

❌ **每次新 session 重头讲项目** — 用 CLAUDE.md (项目根) + 项目级 memory 把上下文做成自动注入。

❌ **agent 自决 round 边界** — 切错点会丢因果链。round 边界**只能用户宣布**。

❌ **slim 后忘了 reload** — `slim-session.js --self` 会自动 pkill CLI, 用户重启 CC 后才生效。不重启等于没 slim。

❌ **不配 hooks, 全靠手动** — register.sh 一键挂, 不挂 agent 不知道自己 session id, slim/ship 调用要用户手动给路径。

## 进一步资源

- [docs/guide/session-guide.md](session-guide.md) — JSONL 基础 + 4 工具完整操作 (含协议要点 + bug 解)
- [skills/slim-session/SKILL.md](../../skills/slim-session/SKILL.md) — slim-session SKILL 全文
- [skills/ship-session/SKILL.md](../../skills/ship-session/SKILL.md) — ship-session SKILL 全文
- [Claude Code Skills 官方文档](https://code.claude.com/docs/en/skills)
- [Claude Code Hooks 官方文档](https://code.claude.com/docs/en/hooks)
- [claude-recap](https://github.com/hatawong/claude-recap) — 主题级 memory 框架 (topic-based, 跨 session / 跨 compaction 不丢, ~/.memory/ 本地存, plugin 形式安装)
