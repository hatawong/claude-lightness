# 指挥官给研究员写任务的指南 (R64 风格)

> 读者: **指挥官 (commander)** — 在多 Agent 协作中给研究员 (researcher) 派 task 的角色
> 前置: 先读 [04-multi-agent.md](04-multi-agent.md) (多 Agent 协作框架) + [agents/researcher/ACTOR.md](../../agents/researcher/ACTOR.md) (研究员本身的角色定义) + [actor-guide-developer.md](actor-guide-developer.md) (R64 工作流总骨架, 本文档复用其结构)

---

## 用途

R64 工作流是**文件级异步通信** + **4 步流程** 的研究员协作模板。无需框架 / 无需网关, 一切走 markdown 文件 + 一段启动 prompt + (可选) ship-session 装载船。

跟 [actor-guide-developer.md](actor-guide-developer.md) (R64 开发者) 的差异:

| 维度 | 开发者 | 研究员 |
|---|---|---|
| 步骤数 | 5 步 (含 step4-proposal) | 4 步 (无 proposal, 调研 → report) |
| 输出 | 代码 + 单 commit + report | 仅 report (含源码引用 + 建议) |
| Raise 重点 | 实施边界 / 接口契约 | 范围边界 / 切入点 |
| 验收 | cargo test / tsc / smoke | report 章节齐 / 引用精确 / raise 三要素 |

---

## 任务文件结构

一个研究 round (R<N>) 对应一个目录:

```
docs/research/round-<N>/   (或自定义路径)
├── 研究员-<N>-plan.md      # 指挥官手写, 任务定义 + 4 步流程 + 启动指引
├── 研究员-<N>-raise.md     # 研究员写 (Step 3), 三要素 raise (范围 / 切入点)
├── 研究员-<N>-reply.md     # 指挥官回, 回应 raise
└── 研究员-<N>-report.md    # 研究员写 (Step 4), 6 节研究报告
```

**核心**: 跟开发者 R64 同样**文件级异步**, 但去 step4-proposal (研究员产出是分析, 不是代码方案)。

---

## plan.md 结构

`研究员-<N>-plan.md` 是指挥官给研究员的任务定义:

```markdown
# Round <N> — <一句话研究主题>

**工作量估**: ~Xh
**装载船**: <ship-session UUID> (复用) 或新起
**前置 close**: R<M-1> 已 close

> 你是 R<N> 研究员 SubSession, 调研 <主题一句话>.
> 不写代码 / 不改配置 / 不做决策, 只输出分析报告.

---

## role
研究员

## why
### 起点
<问题来自哪 / 设计文档 / 前 round backlog / 业务诉求>

### 当前认知
<已知信息 / 已有调研结果 / 缺失的认知层>

### 为什么必须调研 (R<N> 范围)
1. <原因 1: 设计需要对标某项目>
2. <原因 2: 当前认知停留在文档层, 缺源码理解>
...

### 不相关历史排除
R<N> 不研究:
- <主题 A>
- <主题 B>
...

## what
### 研究范围 (N 个子 topic)
1. **<子 topic 1>** — <一句话说研究什么 / 为什么>
2. **<子 topic 2>**
...

### 研究类型 (开放探索 / 聚焦深挖)
- **开放探索** (第一轮通常用): 不带预设框架, 自由探索, 建立全景图
- **聚焦深挖** (后续轮次): 已有全景, 深入特定模块

### 已知信息 (避免重复)
<列出已有的研究成果 / 调研报告 / 知识源>

### 交付物 (N 个章节)
1. <章节 1: 项目结构总览 / 模块识别 / 等>
2. <章节 2: 架构分层 / 调用链 / 等>
...
N. 建议下一步深入的方向 (供后续 round 接续)

## how
### 流程 4 步 (Iron Law Rule 4 + 5)

1. **读 deps 必读** (cwd ..., CLAUDE.md + 设计 doc + 已有调研 report)
2. **拆研究范围**. 不清的 §a-§h 场景 raise
3. **写** `研究员-<N>-raise.md` (前置 grep / 浏览结果 + 三要素 raise: 范围 / 切入点 / 边界), 等指挥官 reply
4. **调研 + 写** `研究员-<N>-report.md` (按 N 章节交付, 每章源码引用精确), 末尾 SubSession session_id

### 规范
- **源码引用精确**: `文件路径:行号` 或 `文件路径:函数名`
- **不确定标注** "需要进一步确认", 不猜测
- **基于本地文件**: git clone 后本地分析, 不通过 GitHub API
- **看到什么写什么**, 不预设结论

### Raise 三要素
每条 raise 含: **事实** (现状 / 已读资料的限制) / **判断** (为什么处理不了 / 范围模糊在哪) / **建议** (a/b/c 选项, 不做决策).

### Report 格式 (6 节)
1. 摘要 + 核心发现 (3-5 条, 每条一句话)
2. 项目结构总览 (目录 + 文件用途)
3. 架构分层 / 调用链 (从入口到执行)
4. 关键模块识别 + 初步发现 (有价值的设计模式)
5. 建议下一步深入方向 (供后续 round 接续)
6. raise 项 (如有) + 风险 + 局限

末尾写 SubSession session_id + 装载船 UUID.

### Raise N 场景 (供 SubSession 拆问)
- §a <场景 1: 范围模糊点>
- §b <场景 2: 切入点不清>
- §c <场景 3: 已知信息冲突>
- §d <场景 4: 工具限制 (源码 minified / repo 太大 / 等)>
...

---

## deps (强依赖, 必读)

| 文件 | 用途 |
|---|---|
| `<path>/CLAUDE.md` | Iron Law (Rule 2 事实必有据 / Rule 3 一疑一问) |
| `<path>/<design-doc>.md` | 当前设计文档, 知道调研成果要对接什么 |
| `<path>/round-<M>/研究员-<M>-report.md` | 前一轮研究报告 (避免重复) |

## optDeps (按需读)

| 文件 | 用途 |
|---|---|
| `<path>/round-<X>/研究员-<X>-report.md` | 更早的研究记录 (了解演进) |

---

## 装载与验收

### 装载船
复用 R<M-1> 装载船 `<UUID>` (含历史调研上下文). 或新起 fresh session.

### 验收清单 (指挥官读 report 后跑)
- [ ] 6 节齐
- [ ] 源码引用精确 (文件路径 + 行号)
- [ ] 不确定的标了 "需要进一步确认"
- [ ] raise 三要素齐 (如有)
- [ ] 末尾 SubSession session_id + 装载船 UUID

---

## 启动指引 (主管复制粘贴一段贴给 SubSession)

```
读 docs/research/round-<N>/研究员-<N>-plan.md 全文, 你是 R<N> 研究员 SubSession.

R<N> 研究范围: <一句话>. 工作量 ~Xh.

装载船 <UUID> 含 R<X>-R<M-1> 调研历史.

按 4 步流程 (Iron Law Rule 4+5):
1. 读 deps 必读 (cwd ..., CLAUDE.md + 设计文档 + 已有调研报告)
2. 拆研究范围. 任何不清 raise (§a 范围 / §b 切入点 / §c 工具限制 / ...)
3. 写 docs/research/round-<N>/研究员-<N>-raise.md (前置 grep / 浏览 + 三要素 raise), 等指挥官 reply
4. 调研 + 写 docs/research/round-<N>/研究员-<N>-report.md (6 节: 摘要 / 总览 / 架构 / 模块 / 建议 / raise), 末尾 SubSession session_id + 装载船 UUID

规范: 源码引用精确 (文件:行号), 不确定标 "需要进一步确认", 不猜测, 看到什么写什么.

不写代码 / 不改配置 / 不做决策. 歧义 raise. 完成后 report 末尾写 SubSession session_id + 装载船 UUID <UUID>.

开始 step 1 + step 2.
```
```

---

## 4 步流程详解

### Step 1 — 读 deps

研究员起手第一件事: 全部读完 deps. optDeps 按需读。

**特别注意**:
- 读已有调研报告 (前 round) 是头等大事, 避免重复研究
- 读设计文档知道调研成果要对接什么 (避免研究跑偏)

### Step 2 — 拆研究范围

按 plan.md 的 "N 个子 topic" 逐条核对:
- 每个 topic 的边界清吗?
- 切入点选哪个 (top-down 从入口 / bottom-up 从核心模块)?
- 跟已有调研有重叠吗?
- 工具限制 (源码 minified / repo 巨大 / 需要运行时调试) 触底吗?

### Step 3 — 写 raise.md

`研究员-<N>-raise.md` 含:
1. **前置浏览结果** — 已 clone repo / 看 README / 浏览目录, 列关键发现
2. **N 项 raise** — 每项三要素:
   - **事实** (已读 / 已浏览 / 工具限制的现状)
   - **判断** (跟 plan 假设的差异 / 范围模糊点)
   - **建议** (a/b/c 多方案, 让指挥官选切入点 / 范围)

写完, **停**. 等指挥官 reply 确认范围 + 切入点。

### Step 4 — 调研 + 写 report

按 reply 确认的范围 + 切入点:
1. 按章节顺序调研 (broad → narrow / 入口 → 调用链)
2. 边读边记: 关键代码片段 / 行号 / 设计模式
3. 不确定的随手标 "需要进一步确认"
4. 写 `研究员-<N>-report.md` (6 节)
5. report 末尾必写: SubSession session_id + 装载船 UUID

---

## 反模式

❌ **跳 Step 3 raise 直接调研** — 范围不清就开干 → 跑偏 → report 跟指挥官想要的不对位 → 重做

❌ **raise 含结论** — raise 三要素 "事实 / 判断 / 建议", 建议是 a/b/c 选项。研究员**不替指挥官决定调研方向**

❌ **覆盖式调研, 平均用力** — 每个模块都浅看, 没有深点。**自己决定深入优先级**, 关键模块挖深, 次要模块概览

❌ **猜测代替事实** — 没读源码就写"应该是 X 模式" → 误导。**看到什么写什么**, 不确定标 "需要进一步确认"

❌ **report 缺源码引用** — 结论没有 `文件:行号` 支撑 → 验证成本高 → 返工

❌ **report 6 节缺章节** — 后续 round 决定接续不接续, 缺节信息丢

❌ **不写 SubSession session_id** — 指挥官没法 /resume 看历史 / 也没法 ship-session 造船

❌ **重复已有调研** — 没读前 round report 就开始 → 浪费 round, 第 1 步必读已有

---

## 进一步资源

- [04-multi-agent.md](04-multi-agent.md) — 多 Agent 协作总览
- [agents/researcher/ACTOR.md](../../agents/researcher/ACTOR.md) — 研究员角色定义
- [actor-guide-developer.md](actor-guide-developer.md) — R64 工作流总骨架 (开发者版, 5 步)
- [actor-guide-reviewer.md](actor-guide-reviewer.md) — 验收者版 + 多 LLM code review
- [session-guide.md](session-guide.md) — ship-session 造船 (装载船配套)
- [handoff-writing.md](handoff-writing.md) — 跨 round / 跨 SubSession 交接文档写法
