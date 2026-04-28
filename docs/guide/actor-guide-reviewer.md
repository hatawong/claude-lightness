# 指挥官给验收者写任务的指南 (R64 风格)

> 读者: **指挥官 (commander)** — 在多 Agent 协作中给验收者 (reviewer) 派 task 的角色
> 前置: 先读 [04-multi-agent.md](04-multi-agent.md) (多 Agent 协作框架) + [agents/reviewer/ACTOR.md](../../agents/reviewer/ACTOR.md) (验收者本身的角色定义) + [actor-guide-developer.md](actor-guide-developer.md) (R64 工作流总骨架)

---

## 用途

R64 工作流是**文件级异步通信** + **冷读验证** + (可选) **多 LLM 并行 review** 的验收者协作模板。

跟 [actor-guide-developer.md](actor-guide-developer.md) (R64 开发者) 的差异:

| 维度 | 开发者 | 验收者 |
|---|---|---|
| 步骤数 | 5 步 (含 step4-proposal) | 4 步 (无 proposal, 验收 → 报告) |
| 输出 | 代码 + commit + report | 仅验收报告 (问题清单 + 证据) |
| 模式 | 实施 (改东西) | 冷读 (不改任何东西) |
| 上下文 | 带历史 round context | 完全冷读 (不依赖记忆) |
| 增强 | (无) | 多 LLM 并行 review (推荐, 见 [code-review-guide.md](code-review-guide.md)) |

---

## 任务文件结构

一个验收 round 对应一个目录:

```
docs/design/round-<N>/   (复用开发者 round 目录, 验收紧跟 report 之后)
├── 开发者-<N>-plan.md           # 被验收对象的任务定义 (验收者必读)
├── 开发者-<N>-report.md         # 被验收对象的产出报告 (验收者必读)
├── 验收者-<N>-plan.md           # 指挥官手写, 验收任务定义
├── 验收者-<N>-raise.md          # 验收者写 (Step 3, 可选), 验收前的歧义 raise
├── 验收者-<N>-reply.md          # 指挥官回 (Step 3 后)
└── 验收者-<N>-report.md         # 验收者写 (Step 4), 验收报告 (问题清单 + 证据)
```

如做多 LLM 并行 review:

```
├── 开发者-<N>-code-review.md         # 指挥官写, code review prompt (供多 LLM 用)
├── 开发者-<N>-code-review-codex-X.X.md  # Codex (GPT-5.X) 输出
├── 开发者-<N>-code-review-gpt-X.X.md    # GPT-5.X 输出 (多版本)
├── 开发者-<N>-code-review-opus-X.X.md   # Claude Opus 输出
└── 开发者-<N>-code-review-report.md     # 指挥官综合, 决策 P1/P2/P3 处置
```

---

## plan.md 结构

`验收者-<N>-plan.md` 是指挥官给验收者的任务定义:

```markdown
# Round <N> 验收 — <被验收对象一句话>

**工作量估**: ~Xh
**装载船**: <ship-session UUID> 或 fresh (推荐 fresh, 避免上下文污染冷读)

> 你是 R<N> 验收者 SubSession, 冷读 R<N> 开发者产出, 输出验收报告.
> 只验收 / 不改 / 不决策, 发现问题写在 report.

---

## role
验收者

## why
### 起点
开发者 R<N> 完成了 <一句话> (X/Y 测试通过). 涉及 <模块> 改动, 影响面 <大/中/小>. 需要冷读验证:
- 代码是否对齐 plan / 设计文档
- 测试覆盖是否充分
- raise 项处置是否合理
- 流程遵守 (commit / 注释规范 / report 6 节)

### 不相关历史排除
不验收:
- 历史 round 的代码 (R<N> 不改的)
- 已 close 的 backlog

## what
### 验收点列表 (N 项)
1. <验收点 1: 后端 IPC 是否按 plan 改> — 检查 `<file>:<line>` 是否实现 <预期>
2. <验收点 2: 前端组件 props 是否对齐 plan>
...
**最后一条永远是 "流程遵守"**: commit 单 commit / report 6 节齐 / 注释规范 / raise 三要素 / SubSession session_id 写了

### 通过判定
- **通过**: 全部验收点 ✓ + 0 P1/P2 问题
- **需修改**: P1/P2 问题数 > 0
- **需 raise**: 验收范围之外的问题 (架构缺陷 / 安全漏洞)

## how
### 流程 4 步 (Iron Law Rule 4 + 5)

1. **读 deps 必读** (开发者 plan + report + 设计文档 + CLAUDE.md)
2. **拆验收点列表**. 不清的 raise (推荐, 但简单验收可跳直接 Step 4)
3. **写** `验收者-<N>-raise.md` (前置浏览 + 三要素 raise: 验收点边界 / 通过标准), 等指挥官 reply
4. **冷读验证 + 写** `验收者-<N>-report.md` (每验收点结论 + 证据 + 总体判断), 末尾 SubSession session_id

### 规范
- **冷读**: 不依赖自己的记忆 / 上下文, 一切以**文件当前内容**为准
- **基于事实**: 引用具体 `文件路径:行号` + 代码片段作为证据
- **不模拟**: 不凭印象 "应该是这样" 生成结论, 必须 Read 文件确认
- **不改任何东西**: 验收者只写 report, 不改代码 / 不改文档 / 不修任何文件
- **compact 摘要识别**: 冷读 session JSONL 时, 检 `isCompactSummary: true` 防把摘要当原话 (见 [session-guide.md](session-guide.md) Part A)

### Raise 三要素
每条 raise 含: **事实** (现状 / 验收点定义模糊在哪) / **判断** (验收范围处理不了 / 标准不清) / **建议** (a/b/c 选项).

### Report 格式
每个验收点:
- 结论: ✓ 通过 / ⚠️ 有问题 / ❌ 失败
- 证据: `<文件:行号>` + 实际代码片段 + (如有问题) 期望 vs 实际差异
- 严重级 (有问题时): P1 / P2 / P3

总体判断: 接受 / 需修改 / 需 raise

末尾写 SubSession session_id + 装载船 UUID (如有).

### Raise N 场景 (供 SubSession 拆问)
- §a 验收点边界模糊 (如 "测试覆盖充分" 怎么界定)
- §b 通过标准不清 (如 P1/P2 严重级判定)
- §c 验收点列表跟实际产出对不上 (开发者改了别的)
...

---

## deps (强依赖, 必读)

| 文件 | 用途 |
|---|---|
| `<path>/CLAUDE.md` | Iron Law (Rule 2 事实必有据) |
| `<path>/round-<N>/开发者-<N>-plan.md` | 知道开发者被要求做什么 |
| `<path>/round-<N>/开发者-<N>-report.md` | 知道开发者实际做了什么 (声明) |
| `<path>/<design-doc>.md` | 判断实现是否对齐设计 |
| `<path>/<related-source-files>` | 用事实验证 report 中的声明 |

## optDeps (按需读)

| 文件 | 用途 |
|---|---|
| `<path>/round-<N>/开发者-<N>-raise.md` + reply | 知道有哪些 raise 处置 |
| `<path>/round-<N>/开发者-<N>-step4-proposal.md` + reply-step4 | 知道方案细节 |
| 开发者 SubSession JSONL | report 信息不足时补充 (用 jsonl-guide 冷读) |

---

## 装载与验收

### 装载船
**推荐 fresh session, 不复用装载船**. 验收者本应不带 round 上下文, 只看文件。复用装载船 = 带历史认知 = 不是冷读。

特殊情况: 单纯需要快速验收上一 round, 复用装载船但显式声明 "本次验收基于冷读, 不依赖船上记忆"。

### 验收完成判定 (指挥官读 report 后)
- [ ] 每验收点有结论 + 证据
- [ ] 严重级标了 (有问题时 P1/P2/P3)
- [ ] 总体判断 (接受 / 需修改 / 需 raise)
- [ ] 末尾 SubSession session_id

---

## 启动指引 (主管复制粘贴一段贴给 SubSession)

```
读 docs/design/round-<N>/验收者-<N>-plan.md 全文, 你是 R<N> 验收者 SubSession.

冷读 R<N> 开发者产出 (代码 + report), 输出验收报告.

你不带历史 round 上下文 (fresh session), 一切以文件当前内容为准.

按 4 步流程:
1. 读 deps 必读 (CLAUDE.md + 开发者-<N>-plan.md + 开发者-<N>-report.md + 设计文档 + 相关源码)
2. 拆验收点列表. 简单验收可直接 Step 4. 不清场景 raise (§a 边界 / §b 标准 / §c 范围)
3. (可选) 写 docs/design/round-<N>/验收者-<N>-raise.md, 等指挥官 reply
4. 冷读验证每个验收点 (Read 文件确认, 不凭印象), 写 docs/design/round-<N>/验收者-<N>-report.md (每点结论 + 证据 + 严重级 + 总体判断), 末尾写 SubSession session_id

规范:
- 引用证据: 文件路径:行号 + 代码片段
- 不改任何文件 (验收者只写 report)
- compact 摘要识别 (检 isCompactSummary: true)
- 不模拟验证 (必须 Read 文件)

只验收 / 不改 / 不决策. 歧义 raise.

开始 step 1 + step 2.
```
```

---

## 4 步流程详解

### Step 1 — 读 deps

验收者起手必读:
- 开发者 plan.md (知道被要求做什么)
- 开发者 report.md (知道开发者声称做了什么)
- 设计文档 (判断实现是否对齐设计)
- 相关源码 (用事实验证 report 声明)
- (可选) 开发者 raise + reply (了解 raise 处置)

**冷读特别要求**: 不带历史 round 认知, 一切看文件。

### Step 2 — 拆验收点列表

按 plan.md 的 "验收点列表" 逐条:
- 每点的边界清吗? (如"测试覆盖充分"具体啥意思?)
- 通过判定明吗? (如 P1/P2/P3 怎么分?)
- 验收点跟开发者实际产出对得上吗?

### Step 3 — 写 raise.md (可选)

简单验收 (验收点清晰 + 标准明确) 可跳过, 直接 Step 4。

复杂验收写 raise.md, 三要素 (事实 / 判断 / 建议), 等指挥官 reply 后再 Step 4。

### Step 4 — 冷读验证 + 写 report

按验收点列表逐项:
1. **Read 文件**, 确认开发者声明的代码改动是否真存在 (引用 `文件:行号`)
2. **对比 plan**, 改的内容是否对齐 plan 要求
3. **判定**: ✓ / ⚠️ / ❌
4. **严重级** (问题时): P1 (安全 / 正确性) / P2 (代码质量 / UX) / P3 (风格 / 极端边界)

最后写总体判断:
- **接受**: 全 ✓ + 0 P1/P2
- **需修改**: P1/P2 数 > 0
- **需 raise**: 范围之外问题 (架构缺陷 / 安全漏洞)

末尾写 SubSession session_id + 装载船 UUID (如有)。

---

## 多 LLM 并行 code review (R64 增强)

`reviewer` 角色 (lightness 内部) 是**单 LLM 冷读** 验收。

R64 推广**多 LLM 并行 review** — 同一 prompt 给多个 LLM (Codex / GPT-5.X / Opus / Sonnet), 各独立 review, 指挥官综合。

**何时用**:
- 完成大 round (多文件 / 跨模块改动)
- 关键合并前 (master / production branch)
- 想要多角度独立第二意见 (避免单 LLM bias)

**实战**: 一次大 round 用 5 LLM 并行 (codex-5.3 / gpt-5.2 / gpt-5.4 / gpt-5.5 / opus-4.7), 综合得到 30 个 P1/P2/P3 问题, 18 修 / 7 记 / 5 拒。

完整流程见 [code-review-guide.md](code-review-guide.md)。

---

## 反模式

❌ **带历史 round 上下文做"冷读"** — 复用装载船 + 不声明 → 不是真冷读, 容易漏 (因为已经"觉得这样合理")

❌ **不 Read 文件, 凭 report 声明判定** — report 说"99/99 测试通过", 不实际跑 / 不实际看, 直接 ✓ → 漏掉 report 跟实际不一致的 case

❌ **结论无证据** — "代码质量好" 没引用 → 没法验证 → 验收报告失去价值

❌ **改文件** — 验收者只**指出问题**, 不**修问题**。修是开发者下一 round 的事

❌ **跳过 "流程遵守" 检查** — 只看代码功能, 没检 commit 单 / report 6 节齐 / 注释规范 → 流程退化

❌ **把 compact 摘要当开发者原话** — 检 `isCompactSummary: true` 字段, 见 [session-guide.md](session-guide.md) Part A

❌ **单 LLM 大 round review** — 大 round 用单 LLM 漏率高, 推荐多 LLM 并行 + 综合

---

## 进一步资源

- [04-multi-agent.md](04-multi-agent.md) — 多 Agent 协作总览
- [agents/reviewer/ACTOR.md](../../agents/reviewer/ACTOR.md) — 验收者角色定义
- [actor-guide-developer.md](actor-guide-developer.md) — R64 工作流总骨架 (开发者版, 5 步)
- [actor-guide-researcher.md](actor-guide-researcher.md) — 研究员版 (4 步)
- [code-review-guide.md](code-review-guide.md) — 多 LLM 并行 code review 实战 (Codex / GPT-5.X / Opus 等)
- [session-guide.md](session-guide.md) — JSONL 冷读 (Part A: compact 摘要识别)
- [handoff-writing.md](handoff-writing.md) — 跨 round / 跨 SubSession 交接
