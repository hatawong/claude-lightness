# 指挥官给开发者写任务的指南 (R64 风格)

> 读者: **指挥官 (commander)** — 在多 Agent 协作中给开发者 (developer) 派 task 的角色
> 前置: 先读 [04-multi-agent.md](04-multi-agent.md) (多 Agent 协作框架) + [agents/developer/ACTOR.md](../../agents/developer/ACTOR.md) (开发者本身的角色定义)

---

## 用途

R64 工作流是**文件级异步通信** + **5 步流程** 的开发者协作模板。无需框架 / 无需网关, 一切走 markdown 文件 + 一段启动 prompt + (可选) ship-session 装载船。

跟 v3 actor guide (依赖 AOS 网关生成 prompt.md) 的区别:

| 维度 | v3 (网关) | R64 (文件级) |
|---|---|---|
| 任务描述 | JSON → 网关生成 prompt.md | 直接手写 plan.md |
| Raise / Reply | 网关字段 | 独立 .md 文件 |
| 启动 | 网关派 task | 一段 prompt 复制粘贴 |
| 装载 context | (无) | `ship-session` 造船 + `/resume <UUID>` |

---

## 任务文件结构

一个 round (R<N>) 对应一个目录, 含以下文件:

```
docs/design/round-<N>/
├── 开发者-<N>-plan.md            # 指挥官手写, 任务定义 + 5 步流程 + 启动指引
├── 开发者-<N>-raise.md           # 开发者写 (Step 3), 含三要素 raise
├── 开发者-<N>-reply.md           # 指挥官回 (Step 3 后), 回应 raise
├── 开发者-<N>-step4-proposal.md  # 开发者写 (Step 4), 完整代码方案
├── 开发者-<N>-reply-step4.md     # 指挥官回 (Step 4 后), 回应 proposal
└── 开发者-<N>-report.md          # 开发者写 (Step 5), 6 节交付报告
```

**核心**: 指挥官 + 开发者通过**文件**异步通信, 不在同 session 直接对话。开发者 SubSession 跑完一步, 写一个文件, 等指挥官在原 session 读 + 写 reply。

---

## plan.md 结构

`开发者-<N>-plan.md` 是指挥官给开发者的任务定义。结构:

```markdown
# Round <N> — <一句话标题>

**工作量估**: ~Xh
**装载船**: <ship-session UUID> (复用 R<M-1> 装载船) 或新起
**前置 close**: R<M-1> 已 close (commits ...)

> ⚠️ 装载船含 R<X>-R<M-1> SubSession 与指挥官全过程对话历史. R<M-1> 已**完整 close**.
>
> 你是 R<N> SubSession, 实施 <任务一句话>.
> 历史 raise 不再处置, 仅作"已落地代码现状"背景.

---

## role
开发者

## why
### 起点
<问题来自哪 / 设计文档 / 前 round backlog>

### 当前状态
<后端 / 前端 / 测试 / 等模块当前实现状态, 含代码片段 + 行号>

### 为什么必须改 (R<N> 范围)
1. <原因 1>
2. <原因 2>
...

### 不相关历史排除
R<N> 不动:
- <模块 A>
- <模块 B>
...

## what
### 关键约束 (N 项)
1. **<约束 1 简称>** — <一句话展开 + 为什么>
2. ...

### 当前状态 (前置 grep 必做)
<列读必读的文件路径 + 行数 + 现状一句话>

### N 项变更清单
#### 后端 (X 项)
1. **<变更 1 简称>** in `<file>` (~N 行)
   - <细节 + 代码片段>
...

#### 前端 (Y 项)
...

#### i18n (Z 项)
...

#### 测试 + 文档 + commit (M 项)
...

## how
### 流程 5 步 (Iron Law Rule 4 + 5)

1. **读 deps 必读** (cwd ..., CLAUDE.md + 现状 N 文件)
2. **拆 N 项变更清单**. 任何遗漏 / 重复 / 概念不清 raise (重点 §a-§h N 场景)
3. **写** `docs/design/round-<N>/开发者-<N>-raise.md` (前置 grep 结果 + 三要素 raise), 等指挥官 reply
4. **写** `docs/design/round-<N>/开发者-<N>-step4-proposal.md` (完整代码方案 + commit message + 实施步骤顺序), 等指挥官 reply-step4
5. **实施 + 自查** (cargo check + cargo test ... + 不退化) + 单 commit + 写 report

### 规范
- **注释规范**: 按项目 CLAUDE.md Rule 6
- **commit + report + 与指挥官对话**: 按项目主语言
- **不动 <模块>**: 0 改动
- **复用 <已落地>**: <说明>

### Raise 三要素
每条 raise 含: **事实** (现状 grep + 行号) / **判断** (与 plan 假设差异) / **建议** (a/b/c 选项).

### Report 格式 (6 节)
1. 摘要 + 战果 (新加测试数 / N 项变更落地)
2. 决策链 (重要决策记录)
3. 实施细节 (代码改动)
4. 测试结果 (cargo test / bunx tsc / smoke)
5. commits 列
6. 风险 + raise 处置 + 后续 backlog 加项

末尾写 SubSession session_id + 装载船 UUID.

### Raise N 场景 (供 SubSession 拆问)
- §a <场景 1: 不清的现状 / 行为 / 边界>
- §b <场景 2>
...
- §h <场景 N>

---

## deps (强依赖, 必读)

| 文件 | 用途 |
|---|---|
| `<path>/CLAUDE.md` | Iron Law N 条 (Rule X / Rule Y) |
| `<path>/<design-doc>.md` | <设计来源> |
| `<path>/round-<M-1>/开发者-<M-1>-report.md` | 前 round close 状态 |
| ... 现状 N 个核心文件 | <每个一句话用途> |

## optDeps (按需读)

| 文件 | 用途 |
|---|---|
| `<path>/round-<X>/开发者-<X>-code-review-report.md` | <X round review 决策> |
| `<path>/<backlog>.md` | 后续 backlog (R<N+1>+ 用) |

---

## 装载与验收

### 装载船
复用 R<M-1> 装载船 `<UUID>`. R<N> SubSession `/resume <UUID>`. 装载船含 R<X>-R<M-1> 全过程, 设计 + 现状齐.

### 验收清单 (指挥官读 report 后跑)
- [ ] cargo check pass
- [ ] cargo test (N 不退化)
- [ ] bunx tsc clean
- [ ] commit 单 commit, 风格对齐 R<X-1>
- [ ] report 6 节齐 + 末尾 SubSession session_id + 装载船 UUID

### 主管 smoke (验收通过后跑)
1. <步骤 1>
2. <步骤 2>
...

---

## 实施步骤顺序 (cargo check 不积压)

1. **后端**: <模块 A> (cargo check)
2. **后端**: <模块 B> (cargo check + cargo test)
3. **前端**: <模块 C>
4. **前端**: <模块 D>
5. **i18n / 文档**:
6. **全量回归**:
7. **写 report + 单 commit**

---

## 启动指引 (主管复制粘贴一段贴给 SubSession)

```
读 docs/design/round-<N>/开发者-<N>-plan.md 全文, 你是 R<N> SubSession.

R<N> 范围: <一句话>. 工作量 ~Xh.

装载船 <UUID> 含 R<X>-R<M-1> 全过程. R<M-1> 已完整 close.

按 5 步流程 (Iron Law Rule 4+5):
1. 读 deps 必读 (cwd ..., CLAUDE.md + N 现状文件)
2. 拆 N 项变更清单. 任何遗漏 raise (重点 §a-§h N 场景: ...)
3. 写 docs/design/round-<N>/开发者-<N>-raise.md (前置 grep + 三要素 raise), 等指挥官 reply
4. 写 docs/design/round-<N>/开发者-<N>-step4-proposal.md (完整代码方案 + commit message + 实施 N 步), 等指挥官 reply-step4
5. 实施 + 自查 + 单 commit + 写 docs/design/round-<N>/开发者-<N>-report.md

注释规范: 按项目 CLAUDE.md.

不动 <模块>. 仅做 <模块>.

不做设计决策, 歧义 raise. 完成后 report 末尾写: SubSession session_id + 装载船 UUID <UUID>.

开始 step 1 + step 2.
```
```

---

## 5 步流程详解

### Step 1 — 读 deps

SubSession 起手第一件事: 全部读完 deps (强依赖). optDeps 按需读。

不要边读边猜结论, 先全读 → 再分析。

### Step 2 — 拆变更清单

按 plan.md 的 "N 项变更清单" 逐条核对:
- 现状 (grep 行号) 是否如 plan 描述?
- 变更范围有没有遗漏?
- 变更之间有依赖吗 (实施顺序)?
- 有歧义 / 多解 / 反直觉的点 → 列 raise

### Step 3 — 写 raise.md

`开发者-<N>-raise.md` 含:
1. **前置 grep 结果** — 确认现状跟 plan 一致 (列出 grep 命令 + 关键输出 + 行号)
2. **N 项 raise** — 每项三要素:
   - **事实** (现状 grep + 行号 / 文件中实际代码)
   - **判断** (跟 plan 假设的差异 / 不清的边界)
   - **建议** (a / b / c 多方案, **不直接做决策**, 让指挥官选)

写完 raise.md, **停**. 等指挥官在原 session 读 raise + 写 `开发者-<N>-reply.md` 回应。

### Step 4 — 写 step4-proposal.md

收到 reply 后, 按指挥官选定的方案, 写完整代码方案:
- 每个变更点的具体实现 (新代码 / 改动 diff)
- commit message 草案
- 实施 N 步顺序 (cargo check 不积压, 一步一验)
- 不确定的边界细节再 raise (这次允许小 raise)

写完 proposal.md, **停**. 等指挥官写 `开发者-<N>-reply-step4.md` 回应。

### Step 5 — 实施 + report

按 reply-step4 确认的方案实施:
1. 按实施步骤顺序逐步改代码
2. 每步 cargo check / 测试不积压
3. 全量自查 (cargo test --lib + e2e + tsc + i18n JSON valid + 等)
4. 单 commit (commit message 按 proposal 草案)
5. 写 `开发者-<N>-report.md` (6 节: 摘要+战果 / 决策链 / 实施细节 / 测试结果 / commits / 风险+raise处置+backlog)
6. report 末尾必写: SubSession session_id + 装载船 UUID

---

## 5 步对应 Iron Law

R64 5 步流程跟 [CLAUDE.md](../../CLAUDE.md) Iron Law 直接对应:

- **Rule 3 Agent 对齐准则** "先看再写" → Step 1 (读 deps 必做)
- **Rule 3** "一疑一问" → Step 2 (拆清单时单点 raise) + Step 3 (raise.md 多 §a-§h 场景)
- **Rule 4 反馈两道确认** → Step 3 (raise → reply 第 1 道) + Step 4 (proposal → reply-step4 第 2 道)
- **Rule 3** "自我审计" → Step 5 (写 report 时反思)

---

## 反模式

❌ **跳 Step 3 raise, 直接进 Step 4 proposal** — plan 总有不清的地方, 跳 raise → proposal 全是猜测 → 指挥官 reply-step4 全推翻 → 浪费一轮

❌ **raise 含决策** — raise 三要素是 "事实 / 判断 / 建议", 建议是 a/b/c 选项, **不是结论**。开发者出建议, 指挥官出决策

❌ **proposal 含未确认的边界** — Step 4 已收 reply, 边界应已定。proposal 内还有大歧义 = 没把 Step 3 拆透, 回 Step 3

❌ **report 缺 6 节** — 后续 round 读 report 决定接续/不接续, 缺节 → 信息丢

❌ **不写 SubSession session_id** — 指挥官没法 /resume 到该 SubSession 看历史, 也没法做 ship-session 造船

❌ **单 commit 拆多个** — round 内 commit 多 → 跨 round diff 难看 → review 难

❌ **不用装载船** — 每 round 重新装 context → 重复浪费 token. 用 ship-session 造船 + /resume 复用

---

## 进一步资源

- [04-multi-agent.md](04-multi-agent.md) — 多 Agent 协作总览 (5 角色 + 3 workflow)
- [agents/developer/ACTOR.md](../../agents/developer/ACTOR.md) — 开发者角色定义
- [session-guide.md](session-guide.md) — ship-session 造船工具 (装载船配套)
- [actor-guide-researcher.md](actor-guide-researcher.md) — 同结构, 适配研究员
- [actor-guide-reviewer.md](actor-guide-reviewer.md) — 同结构, 适配验收者 + 多 LLM code review
- [code-review-guide.md](code-review-guide.md) — 多 LLM 并行 code review 实践
