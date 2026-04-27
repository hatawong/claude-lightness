# 02. CLAUDE.md 写法心法

> 配合根 [CLAUDE.md](../../CLAUDE.md) 阅读。

## 为什么需要 CLAUDE.md

Claude Code 启动时会自动读项目根的 `CLAUDE.md` 注入对话上下文。这是**唯一一份每次都强制加载的 prompt**, 价值堪比"项目宪法"。

不写 CLAUDE.md, 你会:

- 每次新开 session 都要重新跟 agent 解释项目背景
- 同一个错 agent 反复犯 (如用错语言、跳过确认、瞎猜事实)
- 团队多人协作时, 每人调出来的 agent 行为风格不一致
- 没法把"踩坑沉淀"变成"机制约束"

写好 CLAUDE.md, 你能:

- agent 一上来就知道**项目是什么、主管是谁、用什么语言、设计哲学是什么**
- 把反复犯的错变成"Iron Law", agent 自己 Checkpoint, 不靠你每次提醒
- 团队任何人调 agent 都拿到同一个"已对齐"的助手

## Iron Law 命名由来

> Violating the letter of these rules is violating the spirit of these rules.

普通 "guidelines / best practices" 的问题: agent 会**机械按字面执行**, 一遇边角就跑偏。

Iron Law 的核心不是"规则字面", 而是**规则的精神**。每条 Rule 都附 Checkpoint (写之前 / 写之后停下来自检的提问), 让 agent 在判断边角时**回归精神而非字面**。

举例 — Rule 6 禁用 `git reset`:
- **字面**: 不让用 `git reset`
- **精神**: 不要做不可恢复的破坏性操作
- **Checkpoint**: "If you are about to type `git reset` in any tool call — STOP. Use `git revert` / `git restore` / `git stash` 代替"

agent 即使遇到陌生场景 (比如想 `git checkout -- .`), 也应回归精神判断"这是不是不可恢复破坏", 自己判断该不该 STOP。

## 怎么从踩坑提取一条 Rule

**反模式**: 凭想象 / 看别人的最佳实践 / 翻文档拼一份 — 结果 agent 不踩这些规则, 因为它们没有真实张力。

**正模式** (4 步):

1. **踩坑** — 真实事故发生, 损失明确 (代码丢、白干、信任崩)
2. **诊断** — 为什么 agent 会这么做? 什么场景触发? 单次 vs 反复?
3. **沉淀规则** — 写一句话规则 + 一句话事故案例 + 一句话 Checkpoint
4. **命名** — 给规则起短名 (Rule N: X), 让 agent 在 prompt 里能引用

举例 — Rule 6 禁用 `git reset` 怎么来的:

| 步 | 内容 |
|---|---|
| 踩坑 | agent 一次 `git reset --hard <commit>`, 把累积在多个文件的未 commit 修改全丢, git 无法恢复 |
| 诊断 | agent 想"清干净 working tree", 没意识到 `--hard` 会拉走未 commit 的其他文件; 多文件状态下 `--soft` vs `--hard` 易误判 |
| 沉淀 | "任何情况下不得执行 `git reset` (含 --soft / --mixed / --hard)" + 替代三件套 (revert / restore / stash) |
| 命名 | Rule 6: 禁用 `git reset` |

**判别**: 一条规则候选, 如果你**讲不出对应的事故案例**, 那它八成是凭空想出来的, 别加 — 加了 agent 也不会真正遵守。

## CLAUDE.md 结构 (本模板)

按 6 节排:

```
1. 项目概述           — 一段话, 项目是什么 / 解决什么问题 / 核心能力
2. 项目主管           — 谁是 owner / 怎么沟通 / 偏好语言
3. 设计哲学           — 2-3 条贯穿全项目的元原则 (本模板: 够用就行 + 假设→实验→观察→修正)
4. The Iron Law       — 核心: 6 条强约束 + Checkpoint
5. 参考源码           — 项目参考的外部代码 (路径 + 用途)
6. 常用命令           — 开发期高频命令 (避免 agent 翻 README)
```

**前 3 节** 给 agent 项目背景 (是什么 + 跟谁干 + 怎么思考)。
**第 4 节 Iron Law** 给 agent 强约束 (不许干什么 / 必须先做什么)。
**后 2 节** 给 agent 工具索引 (从哪儿学已有实现 + 怎么跑命令)。

## 6 条 Iron Law 速览

| Rule | 名 | 解决的问题 |
|---|---|---|
| 1 | 先拆后议 | agent 看到大话题就长篇大论, 没有先拆解 |
| 2 | 事实性信息必须有据 | agent 编造数据 / 编造技术方案存在性 |
| 3 | Agent 对齐准则 | agent 凭印象写代码 / 不站主管位置 / 一次堆多问 |
| 4 | 反馈两道确认 | agent 收到反馈就立刻改, 没分析根因没确认方案 |
| 5 | 输出语言与编码分层 | 中英混杂 / 注释含 round 号 / UI 硬编码任意单语 |
| 6 | 禁用 `git reset` | reset --hard 把未 commit 修改全丢, git 无法恢复 |

每条都来自踩过的坑或反复纠偏 — 不是凭空假设。新加 Rule 遵循同样标准。

## 怎么扩展 / 调整

**clone 后必改**:
- 主标题 `Claude-Lightness` → 你的项目名
- 项目概述 + 项目主管的 Example 段落
- 占位符 `<your-project>` / `<owner-name>` / `<core-modules>` / `<reference-source>` / `<common-commands>`

**clone 后建议保留**:
- 6 条 Iron Law 全保留 — 它们覆盖的场景 (拆解 / 事实 / 对齐 / 反馈 / 语言 / git) 几乎所有 agent 项目都会遇到
- 设计哲学两条 ("够用就行" + "假设→实验→观察→修正") — 通用元原则

**clone 后按需加**:
- 项目特有的 Iron Law (来自你自己踩的坑)
- 项目特有的子命令 / 工具链入口
- 项目特有的"主管偏好" (如"凌晨别 push" / "下班后 stage 不 commit")

## 反模式

❌ **写一堆但 agent 不读** — CLAUDE.md 太长 (> 300 行) 会被 agent 注意力稀释。本模板 ~150 行是上限。

❌ **没 Checkpoint 的 Rule** — 没 Checkpoint, agent 只能记住"这条规则存在", 不知道"什么时候触发"。每条 Rule 必须有 Checkpoint (写之前 STOP 提问 / 写之后 STOP 自检)。

❌ **Iron Law 之外塞太多 "tips"** — 想加 tip 的, 大概率是 nice-to-have, 不是非加不可。Iron Law 只放真正"违反字面 = 违反精神"级别的强约束, 其他放 docs/guide/ 或 docs/tech/。

❌ **凭空想出来的 Rule** — 没事故案例的规则, agent 不会真正遵守。要么有案例, 要么不加。

## 进一步资源

- 根 [CLAUDE.md](../../CLAUDE.md) — 完整 6 条 Iron Law
- [docs/SUMMARY.md](../SUMMARY.md) — 三个核心理念档牌讲义 (含 Iron Law 部分)
- [docs/guide/03-context-engineering.md](03-context-engineering.md) — 上下文工程 (CLAUDE.md 是其一种, skills/hooks/memory 是其他)
