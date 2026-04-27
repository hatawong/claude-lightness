# 04. 多 Agent 协作

> 配合 [agents/](../../agents/) 阅读。

## 为什么要多 Agent

单 agent 一把梭, 看起来简单, 但在复杂项目里会撞墙:

| 单 agent 痛 | 多 agent 解 |
|---|---|
| context 撑爆 (一个 session 装研究 + 决策 + 实现) | 拆角色, 各 session 只装本职 |
| 角色冲突 (写代码时还要切到验收视角) | 不同角色不同 session, 视角清晰 |
| 任务并发 (一边查资料一边写代码) | 调度者派多角色并行 |
| 自我评估 = 自己抄自己作业 | 验收者独立检查, 不为产出者背书 |
| Prompt 改了不知道有没有副作用 | 进化者一次只动一个变量, 验证后再动下一个 |

**信号**: 看到下面任一项, 就该考虑拆角色:
- 单 session token 经常用到 80%+
- agent 在"写代码 / 改设计 / 验收 / 反思" 之间反复横跳
- 同一个判断标准 (如"完成定义") 反复跟 agent 解释
- 想要"独立第二意见"但 agent 总是给你想听的

## 5 角色矩阵

每个角色一个 ACTOR.md, 含 `Who I Am` (定位一句话) + `Core Principles` (3-5 条原则) + `Boundaries` (不做什么)。

> 默认行为 (没切角色时) 走根 [CLAUDE.md](../../CLAUDE.md) — 含项目主管沟通规则 + Iron Law。不需独立 "main" 角色。

| 角色 | 中文 | 定位 | 关键 Boundary |
|---|---|---|---|
| **commander** | 指挥官 | 讨论 → 决策。把模糊问题拆成清晰结论 | 不执行 (不写代码 / 不改配置) |
| **researcher** | 研究员 | 找事实 / 做对比 / 给建议 | 不写代码, 不改配置, 不做决策 |
| **developer** | 开发者 | 写代码 / 跑测试 / 交付可运行代码 | 不做设计决策, 不顺手重构, 不猜测 |
| **reviewer** | 验收者 | 独立检查产出是否符合要求 | 不修改, 不决策, 不模拟验证 |
| **evolver** | 进化者 | 改 Prompt / 标准 / 格式, 改工作模式 | 不碰产出内容 (报告 / 代码 / 研究结论) |

**注意 Boundary 的对偶**:
- commander 决策, 不执行; developer 执行, 不决策 → 防一人当王
- researcher 找事实, 不写代码; developer 写代码, 不研究方案 → 防越位
- reviewer 找问题, 不修; developer 修, 不验收自己 → 防自我背书
- evolver 改 prompt, 不改产出; 其他角色改产出, 不改 prompt → 防套娃

## 三个核心 Workflow

### Workflow A — 决策 → 执行流 (dispatch)

**触发**: 用户给一个复杂任务 (如"建一个新 agent 项目")

```
user → commander           ← 拆问题, 形成决策 + plan
commander → developer × N  ← 派 task (各 session 一个)
         ↘ researcher × M  ← 同时派调研
developer/researcher → user ← 交付
```

**精髓**: commander 决策 + 派 task, 不写代码; developer/researcher 执行, 不议论决策。**职责单一 + 接力清晰**。

### Workflow B — 审查流 (review)

**触发**: developer 完成一个产出, 需要独立验收

```
developer → reviewer       ← 独立 session, 不带 developer 上下文
reviewer 读产出 + 对照 spec ← 找问题, 标证据, 分轻重
reviewer → commander       ← 验收报告 (问题清单)
commander 决策修不修       ← 决定优先级 + 派修复 task → developer
```

**精髓**: reviewer 必须**独立 session**, 不能在 developer 同 session 里"自检" — 那是自己抄自己作业, 必然漏。

### Workflow C — 进化流 (evolve)

**触发**: 同样的错反复犯 (如"agent 又跳过反馈两道确认了")

```
evolver 观察多轮 session log → 找模式
evolver 诊断 → "Prompt 里 Rule 4 描述模糊, 没说什么算反馈"
evolver 提改进方案 → user 确认
evolver 改 ACTOR.md / CLAUDE.md / SKILL.md 一处
evolver 等下一轮 session 验证 → 改进生效?
若生效 → 收敛; 否则 → 再迭代 (一次改一个变量)
```

**精髓**: 进化者**只改 prompt/标准/格式**, 不碰具体产出。一次只改一个变量, 改完等数据验证再动下一个。

## 何时拆 / 不拆

**该拆** (建立独立 ACTOR.md + session):
- 任务跨"决策 / 执行 / 验收"边界
- 需要独立第二意见 (review / 进化诊断)
- 任务可并发 (多个调研 / 多个模块开发)

**不拆** (走 CLAUDE.md 默认行为, 不切角色):
- 简单一次性任务 (改个文案 / 修个错别字)
- 探索性 brainstorm (拆角色反而打断 flow)
- 紧急修复 (拆角色的开销 > 修 bug 本身)

## 角色文件结构

每角色一个目录, 含 `ACTOR.md`:

```
agents/
├── commander/
│   └── ACTOR.md       # Who I Am + Core Principles + Boundaries
├── developer/
│   └── ACTOR.md
├── researcher/
│   └── ACTOR.md
├── reviewer/
│   └── ACTOR.md
└── evolver/
    └── ACTOR.md
```

**ACTOR.md 三段式**:

```markdown
# <角色名> WHO v<version>

## Who I Am

<一句话定位, 含"我是 X — <动词> <宾语>。<反例: 不做 Y>">

## Core Principles

1. **<准则 1>** — <一句话展开>
2. **<准则 2>** — <展开>
...

## Boundaries

- 不<做什么 1>
- 不<做什么 2>
...
```

**写好 ACTOR.md 三个要点**:
1. **定位一句话** — 能在 1 秒内让人记住"我跟其他角色的区别在哪"
2. **Boundaries 写"不做什么"** — 比"做什么"更重要, 防止角色蔓延
3. **Principles 来自踩过的坑** — 跟 Iron Law 同样标准: 没有事故案例的原则不要加

## Session 级激活

调起一个角色 session (在 Claude Code 里):

```
# 方法 A: prompt 引用
"【进化者】你的角色是 <repo-path>/agents/evolver/ACTOR.md"

# 方法 B: 通过 subagent (用 Agent 工具或 Task 工具)
Agent({
  description: "Run evolver review",
  prompt: "你是进化者, 角色见 agents/evolver/ACTOR.md。审视..."
})
```

**实战经验** — 把激活 prompt 做成 hook 自动注入 (在 SessionStart 等 event 里附带角色 ACTOR), 不用每次手动拼。

## 反模式

❌ **5 角色全开, session 满地跑** — 角色多 ≠ 协作好。从 commander + developer + reviewer **三角色起步**, 用熟了再加 researcher / evolver。

❌ **同 session 里切角色** — "现在你是 reviewer, 评一下你刚才写的代码" — 这是单 agent 自检, 不是多 agent 协作。reviewer 必须独立 session。

❌ **角色定义大而全** — 一个角色 100 条原则, 等于没原则。每角色 3-5 条 Core Principles, 5 条 Boundaries 上限。

❌ **没有进化者** — 只有执行没有反思的 agent 体系会**熵增**: prompt 越来越长, 规则越来越多, 没人定期清理。evolver 是体系自我修复机制。

❌ **角色当 LARP 玩** — 给角色起花哨名字 ("the Architect", "the Sage"), 但 Boundaries 不清。角色不是 cosplay, 是**职责切片**, 名字其次, Boundary 才是核心。

## 进一步资源

- [agents/](../../agents/) — 5 个 ACTOR.md 完整模板
- **指挥官给 Actor 写任务的指南** (按角色拆 3 份):
  - [actor-guide-developer.md](actor-guide-developer.md) — 给开发者派 task 怎么写 (WHY / WHAT / HOW / DEPS)
  - [actor-guide-researcher.md](actor-guide-researcher.md) — 给研究员派 task 怎么写
  - [actor-guide-reviewer.md](actor-guide-reviewer.md) — 给验收者派 task 怎么写
- [handoff-writing.md](handoff-writing.md) — Agent 之间 / session 之间交接文档怎么写 (源自一次实践复盘)
- [docs/guide/02-claude-md.md](02-claude-md.md) — CLAUDE.md 写法 (与 ACTOR.md 是同源思路: 用 Iron Law 约束行为)
- [Claude Code Subagents 官方文档](https://code.claude.com/docs/en/sub-agents)
