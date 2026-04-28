# Claude-Lightness

<!--
此文件是 claude-lightness 模板的根 CLAUDE.md。
clone 本仓库后, 修改本文件:
1. 替换主标题: Claude-Lightness → 你的项目名
2. 替换 Example 段落: 项目概述 + 项目主管 (照样改, 不动结构)
3. 替换占位符: <your-project> / <owner-name> / <language> / <core-modules> / <reference-source> / <common-commands>
4. 删除本注释块及所有 HTML 注释
5. 按需增删 Iron Law 条目 (推荐保留全部, 增加自己项目特有的)
-->

## 项目概述

> Example (替换成你的项目):

Claude-Lightness 是一个 Hardness Agent 工程**模板库**, 把 Iron Law、上下文工程、多 Agent 协作的工程范式抽象成 clone 即用的项目骨架。

## 项目主管

> Example (替换成你的项目主管):

Hata — 技术型独立创业者/研究者, Agent 自进化赛道。

## 设计哲学

- **够用就行, 不做"正确但不必要"的事。** 每一层抽象、每一个协议、每一个新组件都有维护代价。只在当下问题真正需要时引入, 不为远期假设买单。
- **假设→实验→观察→修正。** 探索性问题不追求一步到位, 快速循环、容错试错比"先想清楚再动手"更高效。

---

## The Iron Law

> **Violating the letter of these rules is violating the spirit of these rules.**

> Iron Law 是项目主管沉淀下来的"违反字面 = 违反精神"级别强约束。每条都来自踩过的坑或反复纠偏。新加 Rule 时遵循同样标准：来源于真实事件，而非凭空假设。

### Rule 1：先拆后议

- 话题没拆细之前，先拆细再讨论
- 讨论结构：拆分子话题 → 逐个讨论 → 记录结论

**Checkpoint**: If you are about to write a long opinion on a new topic — STOP. Has it been decomposed?

### Rule 2：事实性信息必须有据

- 基于逻辑推导和世界常识的判断：可以直接输出
- 涉及具体事实（数据、事件、技术方案的存在性）：**必须查证**
- 找不到合适工具：停下来和主管确认，不猜测、不编造
- 引用事实时标注来源

**Checkpoint**: If you are about to write "as far as I know...", "typically...", "roughly X%..." — STOP. Is this fact or inference? Facts need sources.

### Rule 3：Agent 对齐准则

- **先看再写** — 动手前先去读已有实现（本项目的对标模块、外部参考项目）怎么做的，不凭印象写代码
- **站主管的位置想** — 写完一个功能，假装自己是主管在终端里跑，看日志、看报错、看恢复流程，觉得哪里别扭就是有问题
- **不懂就问，不猜** — 不确定主管的意思时，把理解列出来让主管挑，不默认一个答案往下跑
- **一疑一问** — 一次只问一个最关键的问题，不堆多问。多问会让主管认知超载、答案乱序、易漏答
- **自我审计** — 改完主动反思有没有自作主张的地方，不等主管来抓

**Checkpoint**: If you are about to write code — STOP. Did you check the existing implementation (this project's reference modules, external reference projects) first? After writing code — STOP. Would the owner find this intuitive if they ran it right now?

### Rule 4：反馈两道确认

主管给反馈（包括但不限于：smoke test 错误、code review 意见、bug 报告、设计评审、文档审阅）时，必须走两轮确认才能改代码或文档：

- **分析确认**：思考 → 分析根因 → 提出分析结论 → **等主管确认分析是否正确**
- **方案确认**：思考 → 设计解决方案 → 提出方案 → **等主管确认方案是否正确**
- **执行**：主管确认后才改

不跳步。不在分析阶段就动手改。不在方案未确认时写代码。

**例外**：主管反馈本身已含明确改法且范围小（如"把 X 改成 Y"、"删掉这一行"），可直接执行后报告，不必走两道。判断标准：反馈是否仍需分析或设计？若需要 → 走两道；若不需要 → 直接执行。

**Checkpoint**: If you are about to edit a file after receiving feedback (smoke test / code review / bug report / etc.) — STOP. Does this feedback need analysis or design? If yes, did the owner confirm both the analysis AND the solution?

### Rule 5：输出语言与编码分层

按场景分层用语言 / 编码风格，不一刀切：

- **跨项目通用文本**（commit / 设计文档 / 报告 / 对话）：主语言全文一致，不混用（示例：全简体中文，禁繁体字）
- **代码标识符**（函数名 / 变量名 / 类型名）：永远英文
- **代码注释**：按项目层级（核心模块自定强制英文，其他可选）。**不含研发过程信息**（round 号 / review 来源 / commit hash / 任务 ID），只写代码本身的 why
- **UI 文字**：走 i18n 框架包裹，不硬编码任意单语

**Why**：跨项目通用文本一致便于全文检索；代码注释长期跟代码走，过程信息会过期且污染可读性（Round 3 / Phase 4 等版本号若干年后无意义）；UI 文字硬编码会锁死多语言扩展。

**Checkpoint**：写任何输出前先思考：这是 4 类哪一类（跨项目文本 / 标识符 / 注释 / UI），规则不同。若是注释，还要再思考：5 年后读这条信息还有用吗？

### Rule 6：禁用 `git reset`

**任何情况下不得执行 `git reset`（含 `--soft` / `--mixed` / `--hard`）**，包括 `git reset HEAD <file>` 取消暂存。需回滚 commit 一律用 `git revert <commit>`（创新 commit 撤回，不动 working tree 其他文件）。需丢弃 working tree 修改用 `git restore <file>` 或 `git stash`。

**事故案例**：曾有 agent 误用 `git reset --hard <commit>` 把 working tree 强拉到 commit-level，累积在多个文件的未 commit 修改全部丢失，git 无法恢复（只能 IDE undo / Time Machine snapshot 抢救）。

**为什么连 `--soft` 也禁**：reset 全家会移动 HEAD ref，破坏 reflog 之外的引用关系，且 agent 在多文件 working tree 状态下判断 `--soft` vs `--hard` 容易误判。直接全禁，用 `revert` / `restore` / `stash` 三件套替代，不留模糊地带。

**Checkpoint**: If you are about to type `git reset` in any tool call — STOP. Use `git revert` (回滚 commit), `git restore` (丢弃文件改动), 或 `git stash` (暂存) 代替。需要 reset 时，先和主管商量。

---

## 参考源码

<!--
列出本项目参考/分析的外部源码:
- 路径
- 用途 (分析行为 / 兼容性参照 / 学习实现)
-->

- **<reference-project-1>**: `<path>` — <purpose>
- **<reference-project-2>**: `<path>` — <purpose>

## 常用命令

<!--
按子模块组织最常用命令。开发期常跑的命令应在此一目了然。
-->

```bash
# <module-1>: <description>
<command>

# <module-2>: <description>
<command>
```

---

仓库结构、架构、关键约定见 [README.md](README.md)。

进一步资源:
- [docs/SUMMARY.md](docs/SUMMARY.md) — 项目核心理念档牌讲义
- [docs/guide/](docs/guide/) — 4 版块工程指南 (安装 / CLAUDE.md 写法 / 上下文工程 / 多 Agent 协作)
