# 多 LLM 并行 Code Review 指南

> 配合 [actor-guide-reviewer.md](actor-guide-reviewer.md) 阅读。本指南聚焦**用多个外部 LLM 并行 review** 同一份代码的实践, 是 reviewer 角色的增强工具。

---

## 何时用

- 完成一个 round 的实现后 (大改 / 跨模块)
- 重大重构后
- 合并到 master / production 前的最终检查
- 想要独立第二意见 (避免单 LLM bias)

**不必用** (单 reviewer 角色够):
- 单文件小改 / typo 修复
- 探索期代码 (会大改)
- 没有可比较的"正确"标准 (PoC / spike)

---

## 为什么并行而非串行

不同 LLM 强项不同:

| LLM | 偏好 |
|---|---|
| **Codex (GPT-5.X)** | 严抠类型 / 边角 case / 性能 |
| **GPT-5 series** | 架构 / 设计模式 / 最佳实践 |
| **Claude Opus** | 安全 / 正确性 / 长上下文一致性 |
| **Claude Sonnet** | 快速覆盖 / 平衡 |

**并行**: 每个 LLM 独立读同一 prompt + 同一代码, 输出独立 review report → 指挥官综合 (不同 LLM 发现的问题互补)。
**避免**: 串行 (一个 LLM 看了另一个 review 后再 review) → 后跑的会受先跑的影响, 不独立。

实战收益: 单 LLM 通常找 5-10 个 issue, 5 LLM 并行综合后 30+ issue (互补 + 去重)。

---

## 工作流

```
1. 指挥官写 code-review.md (review prompt)
2. 指挥官并行调 N 个 LLM (Codex / GPT-5.X / Opus 等), 各输出独立 review report
3. 指挥官综合所有 review → code-review-report.md (P1/P2/P3 分类 + 处置决策)
4. 派开发者下一 round 修复 P1/P2 (P3 看情况)
```

---

## prompt 模板

### 模板 A: 单次变更 review

```
你是代码审查员。请审查 <repo-path> 仓库最新一次 commit (<COMMIT_HASH>) 的所有变更。

## 项目背景
<一句话描述项目>

## 本次变更目标
<描述这次改了什么, 为什么改, 关联 plan 文件路径>

## 获取变更
cd <repo-path> && git show <COMMIT_HASH> --stat && git diff <COMMIT_HASH>~1..<COMMIT_HASH>

## 审查要求
请用<语言>回答, 按以下维度审查:
1. **安全性**: SQL 注入 / 路径遍历 / XSS / 注入
2. **正确性**: 状态机 / 事件处理 / 竞态条件
3. **代码质量**: 死代码 / unused imports / linter 合规
4. **UI/UX** (如涉及): 滚动行为 / 布局 / 事件监听生命周期
5. **遗漏**: plan 要求但未实现的功能

输出格式: 按严重级 P1/P2/P3 分类, 每条含: 文件路径 + 行号 + 问题描述 + 修复建议
```

### 模板 B: 多 commit 范围 review

```
你是代码审查员。请审查 <repo-path> 仓库从 <BASE_SHA> 到 HEAD 的所有变更。

## 项目背景
<项目描述>

## 本次变更目标
<plan 文件路径, 或直接描述>

## 变更经历了多次迭代, 最终架构:
<列出核心设计决策, 帮助 LLM 理解意图而非逐行挑刺>

### 后端核心设计
<列出关键设计点>

### 前端核心设计
<列出关键设计点>

## 获取变更
cd <repo-path> && git log --oneline <BASE_SHA>..HEAD && git diff <BASE_SHA>..HEAD --stat && git diff <BASE_SHA>..HEAD

## 关键文件
<列出最重要的 5-10 个文件 + 各自职责>

## 已知问题 (不需要重复报告)
<列出已知的限制 / raise 项, 避免 LLM 重复报告>

## 审查要求
请用<语言>回答, 按以下维度审查:
<根据变更类型调整维度>

输出格式: 按严重级 P1/P2/P3 分类, 每条含: 文件路径 + 行号 + 问题描述 + 修复建议
```

### 模板 C: 全量仓库审查

```
你是代码审查员。请对 <repo-path> 仓库进行全量代码审查 (不限于最近变更)。

## 项目背景
<完整项目描述, 含技术栈和功能模块>

## 项目结构
<列出关键目录和文件>

## 关键设计决策 (已确认, 不需要质疑)
<列出已确认的架构决策, 避免 LLM 质疑已定方案>

## 审查范围
全量审查所有 <语言 1> 和 <语言 2> 源码, 重点关注:

### 安全性
<具体关注点>

### 正确性
<具体关注点>

### 代码质量
<具体关注点>

### 架构
<具体关注点>

## 获取代码
cd <repo-path> && find <core-dir> -name "*.<ext>" | head -30

## 已知问题 (不需要重复报告)
<列出所有已知问题>

## 输出格式
按严重级 P1/P2/P3 分类, 每条含:
- 文件路径 + 行号
- 问题描述
- 修复建议

请用<语言>回答。重点发现新问题, 不要重复已知问题。
```

---

## prompt 编写要点

### 必须包含

- **项目路径**: 让 LLM 知道去哪里读代码
- **获取变更命令**: git diff / git show 具体命令
- **变更目标**: plan 文件路径 / 直接描述意图
- **输出格式**: P1/P2/P3 + 文件路径 + 行号 + 语言

### 提质量技巧

- **列核心设计决策**: 帮 LLM 理解 "为什么这样做", 避免对已确认方案提无效质疑
- **列已知问题**: 避免浪费 LLM 时间重复报告
- **指定审查维度**: 按变更类型调整 (安全相关 → 多关注安全; UI → 多关注 UX)
- **提供关键文件列表**: 引导 LLM 重点读, 不平均用力

### 避免

- ❌ **让 LLM 猜项目结构** — 明确告诉哪些文件在哪
- ❌ **省略背景** — LLM 没有上下文, 必须 prompt 提供
- ❌ **只说 "review 代码"** — 没具体维度的 review 流于表面
- ❌ **忘记指定语言** — 默认输出英文, 需要中文必须明说

---

## 并行执行实操

每个 LLM 独立 session 跑同一 prompt:

```bash
# 1. 写 prompt 到 code-review.md
$EDITOR docs/design/round-<N>/开发者-<N>-code-review.md

# 2. 并行调多 LLM (多终端 / 多 IDE / 多 plugin)
# Terminal A: Claude Code (Opus)
claude < docs/design/round-<N>/开发者-<N>-code-review.md > docs/design/round-<N>/开发者-<N>-code-review-opus-X.X.md

# Terminal B: Codex (via plugin / API)
codex < docs/design/round-<N>/开发者-<N>-code-review.md > docs/design/round-<N>/开发者-<N>-code-review-codex-X.X.md

# Terminal C/D/E: 其他 LLM
...
```

**实战推荐 5 LLM 组合** (一次大 round 用):
- `codex-X.X` (Codex / GPT-5.X)
- `gpt-X.X` × 2 (不同版本, 多角度)
- `opus-X.X` (Claude Opus)
- `sonnet-X.X` (Claude Sonnet, 快速覆盖)

---

## 综合 (review-report.md)

收齐 N 个 LLM review 后, 指挥官综合:

```markdown
# Round <N> Code Review 综合报告

## 总览

| 来源 | issue 数 | 含 P1 | 含 P2 | 含 P3 |
|---|---|---|---|---|
| codex-X.X | N | X | Y | Z |
| gpt-X.X (v1) | N | X | Y | Z |
| gpt-X.X (v2) | N | X | Y | Z |
| opus-X.X | N | X | Y | Z |
| (去重后) | M | X | Y | Z |

## P1 issue (必须修, M 项)

### P1-1 <一句话>
- 来源: codex-X.X / opus-X.X (重复发现 → 高置信)
- 文件: `<file>:<line>`
- 问题: <详述>
- 修复方向: <建议>
- 处置: ✓ 接受 (派 R<N+1> 修)

### P1-2 ...
...

## P2 issue (应该修, K 项)
...

## P3 issue (可不修, J 项)
...

## 不接受 (Y 项, 含理由)

### NA-1 <来源> 提议 <X>
- 不接受理由: <基于错误理解 / 已确认设计>

## 处置统计

- 修: M
- 记录到 backlog (R<N+2>+ 处理): K
- 不接受 (有理由): Y
```

---

## 综合的判断原则

逐条评估, 不盲从:

- **必须修**: P1 安全 / 正确性 bug
- **应该修**: P2 代码质量 / UX
- **可不修**: P3 风格 / 极端边界
- **不接受**: 基于错误理解的建议 (写明理由)

**多 LLM 都报的同一 issue → 高置信** (不同模型独立发现 = 不是单一 bias)
**只一个 LLM 报 → 低置信** (可能是该模型的 quirk)

---

## 修复后再跑

修完 P1 + P2 后, 跑一次单 LLM 增量 review (不必再 5 LLM 并行) 确认:
- 修复无新引入问题
- 修复对齐综合 review 的建议方向

---

## 实战案例

一次大 round (跨模块改, ~20 文件 / ~1500 行 diff) 用 5 LLM 并行:

| LLM | 单独发现 issue 数 |
|---|---|
| codex-X.X | 12 |
| gpt-X.X (v1) | 9 |
| gpt-X.X (v2) | 11 |
| opus-X.X | 14 |
| 综合去重后 | 30 |

处置:
- 修: 18 (含 P1: 8 / P2: 10)
- 记录到 backlog: 7 (P3 大多)
- 不接受: 5 (基于错误理解)

**收益**: 单 LLM 平均 ~11 个, 5 并行 30 个 → ~3x 召回率。修复 18 个真问题, 漏报多个不会被发现。

---

## 反模式

- ❌ **串行 review** — 后跑的看了先跑的 → 不独立, 失去多视角价值
- ❌ **只挑一个 LLM 综合** — 综合是过滤 + 去重, 不是替换为另一种意见
- ❌ **盲从 LLM 建议** — review 给建议, 指挥官给决策。盲从会引入错误判断
- ❌ **不写"已知问题"** — LLM 重复报告 → 浪费综合时间
- ❌ **不写"已确认设计决策"** — LLM 质疑已定方案 → 综合阶段全部判 NA, 浪费时间
- ❌ **修完 P1 / P2 不再跑增量** — 可能引入新问题 / 修偏方向

---

## 进一步资源

- [actor-guide-reviewer.md](actor-guide-reviewer.md) — 验收者角色 (R64 风格), 单 LLM 冷读 review (本指南是其增强)
- [04-multi-agent.md](04-multi-agent.md) — 多 Agent 协作总览
- [agents/reviewer/ACTOR.md](../../agents/reviewer/ACTOR.md) — 验收者角色定义
