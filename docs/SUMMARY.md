# Hardness Agent 工程

> **claude-lightness** — Iron Law、上下文工程、多 Agent 协作的工程范式
>
> 2026-04-27 · Hata · 给丹哥公司分享
>
> 配 [github.com/hatawong/claude-lightness](https://github.com/hatawong/claude-lightness)

---

## 开场: 为什么需要 Hardness Agent 工程

过去半年, 我连续在多个新项目里, 教 agent 同一件事: **"不要凭印象写代码, 先去读已有实现"**。

第三次教完, 我意识到, 这不是 agent 的问题, 是我没把这条规则**机制化**。它应该写进 CLAUDE.md, 而不是反复在对话里说。

这就是 Hardness Agent 工程: 把 agent 反复犯的错、踩过的坑、对齐的规则, **沉淀成机制 + 模板**, 而不是每次新项目从零开始。

`harness` 是套马具 (重 + 强约束), `lightness` 是它的对位 — **轻盈, 不硬套公式, 但有形状**。

---

## 核心理念 1: Iron Law

> **Violating the letter of these rules is violating the spirit of these rules.**

普通"最佳实践"的问题: agent 会**机械按字面执行**, 一遇边角就跑偏。Iron Law 不同 — 每条 Rule 附 Checkpoint (写之前 / 写之后停下来自检), 让 agent 在边角时**回归精神而非字面**。

**6 条 Iron Law** (claude-lightness 模板自带):

| Rule | 解决的问题 |
|---|---|
| 1 先拆后议 | 看到大话题就长篇大论, 没拆解 |
| 2 事实性信息必须有据 | 编造数据 / 编造方案存在性 |
| 3 Agent 对齐准则 | 凭印象写 / 不站主管位置 / 一次堆多问 |
| 4 反馈两道确认 | 收到反馈立刻改, 没分析根因 |
| 5 输出语言与编码分层 | 中英混杂 / 注释含 round 号 / UI 硬编码 |
| 6 禁用 `git reset` | reset --hard 把未 commit 修改全丢 |

**每条都来自踩过的坑**。没有事故案例的规则, 加进去 agent 也不会真正遵守。

→ [CLAUDE.md](../CLAUDE.md) | [docs/guide/02-claude-md.md](guide/02-claude-md.md)

---

## 核心理念 2: 上下文工程

LLM 的 context window 是**有限资源**。一个长 session 跑下来, context 会被累积内容塞满: 旧对话、读过的文件、tool result、思考链。一旦塞满:

- agent 开始**遗忘**早期结论 (LRU 淘汰)
- 反复**重读**已经讨论过的文件
- 关键决策**漂移** (后期判断没了前期前提)
- 强制 `/compact` 又是**有损压缩** (大块细节丢失)

**上下文工程 = 主动管 context 寿命 / 结构, 不是被动塞。**

工具图谱 (claude-lightness 版, 最简 2 + 1):

| 工具 | 何时用 |
|---|---|
| **slim-session** (skill) | context > 70%, 想无损去冗余 |
| **ship-session** (skill) | 长 session (>700K tokens), 按 round 边界整体造新船 |
| **session-start** (hook) | 启动时注入 session id + JSONL 路径, 让 agent 知道"自己是谁" |

加 4 工具脚本 (slim-diagnose / detect-broken-chain / fix-broken-chain / register/unregister) 配套。

**关键比喻 — 忒修斯之船**: 长 session 像一艘船, slim/ship 把老木板 (老对话) 换成 QA 摘要新木板, 但**因果链 + 决策 ref + 关键数据**留存 → 仍是延续工作实体。

→ [docs/guide/03-context-engineering.md](guide/03-context-engineering.md) | [docs/guide/session-guide.md](guide/session-guide.md)

---

## 核心理念 3: 多 Agent 协作

单 agent 一把梭, 看起来简单, 复杂项目会撞墙:

| 单 agent 痛 | 多 agent 解 |
|---|---|
| context 撑爆 (一个 session 装研究 + 决策 + 实现) | 拆角色, 各 session 只装本职 |
| 角色冲突 (写代码时还要切到验收视角) | 不同角色不同 session, 视角清晰 |
| 任务并发 (一边查资料一边写代码) | 调度多角色并行 |
| 自我评估 = 自己抄自己作业 | 验收者**独立 session**, 不为产出者背书 |
| Prompt 改了不知有无副作用 | 进化者一次只动一个变量 |

**5 角色** (claude-lightness 版):

| 角色 | 定位 | 关键 Boundary |
|---|---|---|
| **commander** | 讨论 → 决策 | 不执行 |
| **researcher** | 找事实 / 对比 / 给建议 | 不写代码, 不做决策 |
| **developer** | 写代码 / 跑测试 / 交付 | 不做设计决策, 不顺手重构 |
| **reviewer** | 独立检查产出 | 不修改, 不决策 |
| **evolver** | 改 Prompt / 标准 / 格式 | 不碰产出内容 |

**Boundary 的对偶设计**:
- commander 决策不执行; developer 执行不决策 → 防一人当王
- reviewer 找问题不修; developer 修不验收自己 → 防自我背书
- evolver 改 prompt 不改产出; 其他改产出不改 prompt → 防套娃

**3 workflow**: 决策→执行 (dispatch) / 审查 (review) / 进化 (evolve)

→ [agents/](../agents/) | [docs/guide/04-multi-agent.md](guide/04-multi-agent.md)

---

## 4 版块快速导读

claude-lightness 仓库实体, 4 大版块组成:

### 版块 1 — 装好工具链

依赖 2 个 Claude Code 插件:
- **superpowers** (官方 marketplace) — Skills 库 (brainstorming / TDD / code-review 等 30+ 标准工作流)
- **caveman** (第三方) — 超压缩通信模式, 节省 ~75% token

`bash scripts/verify-plugins.sh` 一键验证。

→ [docs/guide/01-install.md](guide/01-install.md)

### 版块 2 — 写 CLAUDE.md

模板自带 6 Iron Law + 设计哲学 ("够用就行" + "假设→实验→观察→修正")。

clone 后改:
1. 主标题
2. Example 段 (项目概述 + 项目主管)
3. 占位符 (`<your-project>` / `<core-modules>` / 等)

→ [CLAUDE.md](../CLAUDE.md) | [docs/guide/02-claude-md.md](guide/02-claude-md.md)

### 版块 3 — 上下文工程

2 SKILL (slim-session / ship-session) + 1 hook (session-start) + 4 工具脚本 + register/unregister 一键挂任意项目。

`bash scripts/register.sh <target-project>` 把本仓库 hooks + skills 注册到目标项目, 安全幂等 (只动自己写的, 不动用户其他配置)。

→ [docs/guide/03-context-engineering.md](guide/03-context-engineering.md) | [docs/guide/session-guide.md](guide/session-guide.md)

### 版块 4 — 多 Agent 协作

5 ACTOR.md + 3 workflow + 4 实战 guide:
- `actor-guide-developer.md` — 指挥官给开发者写任务的指南 (R64 风格 5 步流程)
- `actor-guide-researcher.md` — 给研究员
- `actor-guide-reviewer.md` — 给验收者 + 多 LLM 并行 review
- `handoff-writing.md` — Agent 之间 / session 之间交接文档怎么写

→ [agents/](../agents/) | [docs/guide/04-multi-agent.md](guide/04-multi-agent.md)

---

## 实战案例 1 — Rule 6 怎么诞生 (`git reset` 事故)

**事故**: 一次 `git reset --hard <commit>` 把 working tree 强拉到 commit-level, 累积在多个文件的未 commit 修改全部丢失, git 无法恢复 (只能 IDE undo / Time Machine snapshot 抢救)。

**诊断**: agent 想"清干净 working tree", 没意识到 `--hard` 会拉走未 commit 的其他文件; 多文件状态下 `--soft` vs `--hard` 容易误判。

**沉淀规则**:

> **Rule 6: 禁用 `git reset` (含 --soft / --mixed / --hard)**
>
> 需回滚 commit 一律用 `git revert` (创新 commit 撤回); 需丢弃 working tree 修改用 `git restore` 或 `git stash`。

**为什么连 `--soft` 也禁**: reset 全家会移动 HEAD ref, 破坏 reflog 之外的引用关系, 且 agent 在多文件 working tree 状态下判断 `--soft` vs `--hard` 容易误判。直接全禁, 不留模糊地带。

**Checkpoint**:
> If you are about to type `git reset` in any tool call — **STOP**. Use `git revert` / `git restore` / `git stash` 代替。

**收益**: 此 Rule 加入后, 0 次 reset 误删事故。

---

## 实战案例 2 — Rule 3 "一疑一问" 怎么诞生 (本周)

**场景**: 我写本仓库 (claude-lightness) 时, agent 反复一次塞 3-5 个问题让我决策:

> 1. 时间窗 OK?
> 2. MVP vs 全量?
> 3. spec 改不改?
> 4. 案例选哪个?

每次我答完前 2 个, 后 2 个就漏了或乱序回。

**诊断**: 多问 → 主管认知超载 + 答案乱序 + 易漏答。这不是 agent 的具体错, 是 prompt 没约束。

**沉淀规则** (Rule 3 第 4 条, 加入今天):

> **一疑一问** — 一次只问一个最关键的问题, 不堆多问。多问会让主管认知超载、答案乱序、易漏答。

**收益**: 加入后, agent 改一次问一个, 我决策速度明显加快 (单问 1 答 vs 多问漏答补问)。

---

## 总结

Hardness Agent 工程不是新框架, 是**把踩坑沉淀成机制 + 模板**:

1. **Iron Law** — 规则要有"违反字面 = 违反精神"的张力。每条来自真实事故, 不凭空想
2. **上下文工程** — context 是有限资源, 主动管 (skills + hooks + 工具脚本) 而非被动塞
3. **多 Agent 协作** — 单 agent 不是终点, 角色拆分 + 文件级异步通信 是 scale 之路

**起手最简组合** (从 claude-lightness 抽 3 件):
1. 写 CLAUDE.md (含 Iron Law 6 条) — 30min
2. 装 superpowers + caveman 插件 — 15min
3. `bash scripts/register.sh` 把 hooks + skills 挂上 — 1min

总成本 < 1h, 之后每个新项目 clone 即用。

---

## 进一步资源

- **本仓库**: [github.com/hatawong/claude-lightness](https://github.com/hatawong/claude-lightness) (clone 即用模板)
- **配套外部项目**:
  - [claude-recap](https://github.com/hatawong/claude-recap) — 主题级 memory 框架 (跨 session 不丢)
  - [superpowers](https://github.com/obra/superpowers) — Skills 库
  - [caveman](https://github.com/JuliusBrussee/caveman) — 超压缩模式
- **进一步阅读**:
  - [docs/guide/01-install.md](guide/01-install.md) — 装好工具链
  - [docs/guide/02-claude-md.md](guide/02-claude-md.md) — CLAUDE.md 写法心法
  - [docs/guide/03-context-engineering.md](guide/03-context-engineering.md) — 上下文工程总论
  - [docs/guide/04-multi-agent.md](guide/04-multi-agent.md) — 多 Agent 协作
  - [docs/guide/session-guide.md](guide/session-guide.md) — JSONL 基础 + slim/ship 工具操作
  - [docs/guide/actor-guide-developer.md](guide/actor-guide-developer.md) — R64 风格开发者任务模板
  - [docs/guide/handoff-writing.md](guide/handoff-writing.md) — 交接文档写法

---

## 联系

Hata — 技术型独立创业者/研究者, Agent 自进化赛道。

讨论 / 反馈: GitHub Issues @ [github.com/hatawong/claude-lightness/issues](https://github.com/hatawong/claude-lightness/issues)
