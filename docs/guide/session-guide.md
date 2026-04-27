# Session 操作指南 (JSONL 基础 + 工具操作)

> 配合 [skills/slim-session](../../skills/slim-session/SKILL.md) + [skills/ship-session](../../skills/ship-session/SKILL.md) + [scripts/](../../scripts/) 阅读。

本指南分两部分:
- **Part A — JSONL 基础**: Claude Code session 持久化机制, 读 / 写 / 校验 JSONL 必读
- **Part B — 工具操作**: 4 个工具用法 (slim-session / ship-session / detect-broken-chain / fix-broken-chain)

---

# Part A — JSONL 基础

## A.1 Session 文件位置

CC 把每个 session 持久化为 JSONL 文件:

```
~/.claude/projects/<cwd-encoded>/<session-uuid>.jsonl
```

`<cwd-encoded>` = 启动 CC 时 cwd 的绝对路径, 前导 `/` 去掉, 每级 `/` 替换成 `-`。

例: cwd `/Users/me/my-project` → 目录 `-Users-me-my-project`。

一个 project 目录下可有多个 session (每次 `claude` 或 `/resume` 可能产生新或续写已有)。

## A.2 JSONL 格式 + entry schema

每行一个 JSON object。关键字段:

| 字段 | 类型 | 作用 |
|---|---|---|
| `uuid` | string (v4) | 本 entry 唯一 id |
| `parentUuid` | string 或 null | 前一 entry 的 uuid (链条). 首条 = null |
| `sessionId` | string (v4) | 本 entry 所属 session 的 uuid (= 文件名) |
| `type` | "user" / "assistant" / "system" / "attachment" / "file-history-snapshot" / "queue-operation" / "last-prompt" / 等 | entry 类型 |
| `timestamp` | ISO 8601 (`.mmmZ` 3 位毫秒) | append 时点, 严格递增 |
| `message.role` | "user" / "assistant" | 消息角色 |
| `message.content` | string 或 array (含 type=text / tool_use / tool_result / thinking) | 消息内容 |
| `userType` | "external" / "internal" | user 消息子类型 (见 A.6) |
| `permissionMode`, `entrypoint`, `cwd`, `version`, `gitBranch`, `isSidechain` | 各种元数据 | 环境标识 |

对话结构: user → assistant → user → assistant → ... 交替的**单链 parentUuid 结构** (不是分支树)。

## A.3 消息类型速查

| type | 说明 | 是否含对话内容 |
|---|---|---|
| `user` | 用户消息 (含真用户、系统注入、compact 摘要) | ✅ (compact 摘要有 `isCompactSummary: true` 标记, 见 A.7) |
| `assistant` | Agent 回复 | ✅ |
| `system` | 系统消息 (SessionStart hook 注入等) | ⚠️ 通常上下文注入, 非对话 |
| `last-prompt` | Compact 边界标记 | ❌ |
| `file-history-snapshot` | 文件历史快照 | ❌ |
| `progress` | 工具执行进度 | ❌ |
| `queue-operation` | 队列操作 | ❌ |

提取对话时, **只看 `user` 和 `assistant` 类型**。

## A.4 主链 vs sideband 校验

`/resume <uuid>` 或重开 CC 时, CC 对 jsonl 做**分层校验**:

**主链** (type = `user` / `assistant` / `system`, 有 `uuid`):
- **parentUuid 链**: 从 `parentUuid=null` 首条沿 `uuid → 下一条 parentUuid` 走完整链。**断链 → 装载失败**。
- **timestamp 顺序**: 允许少量同毫秒 / 毫秒级逆序, 不要大规模逆序。

**Sideband** (type = `queue-operation` / `last-prompt` / `file-history-snapshot` / `attachment` 等, 可无 `uuid`):
- parentUuid 可为 null (sideband root 合法)
- timestamp 可逆序 (CC 不校验)
- sessionId 可缺失

**人工编辑 jsonl 的红线**:
- 主链必严格: parentUuid 全连 + timestamp 尽量严格递增 (推荐 +1s 每新 QA entry)
- Sideband 原样保留: 不动 sessionId / parentUuid / timestamp, 照搬

## A.5 append-only 行为

CC 对**当前活跃** session jsonl 是 append-only: 每次 user + agent + tool, 按时间顺序 append 到末尾, 不修改已有行。

后果:
- **不能安全覆盖活跃 jsonl** (race: 脚本写完, CC 又 append 到旧 offset, 破坏结构)。解: 生成新 UUID 新 jsonl ("clone 新船"), CC `/resume` 切到新文件。
- **活跃 jsonl 有写入延迟**: CC 缓冲 N 秒才落盘。脚本读前需 `sleep 5` 等 pending 写完, 否则丢最后 1-2 条。

## A.6 识别用户原话 vs 系统注入

`type: "user"` 有两种来源, **必须区分**:

| 字段组合 | 含义 |
|---|---|
| `type: "user"` + `userType: "external"` | 真用户手写指令 |
| `type: "user"` + `userType: "internal"` | 系统自动注入 (Stop hook / SessionStart reminder / IDE event) |

`external` 消息的 `message.content` 数组里也可能混系统注入 text block, 识别:
- 以 `<system-reminder>` 开头 → 系统提示, 跳过
- 以 `<ide_` 开头 → IDE 事件, 跳过
- 以 `Stop hook` / `Recent commits:` 等前缀 → hook 通知, 跳过

提取用户原话时, 剥掉这些段, 只保留真正的指令文本。

## A.7 Compact 摘要识别

CC 对长 session 自动 `/compact` (有损压缩) 后, jsonl 里出现:

```json
{"type": "user", "userType": "external", "isCompactSummary": true, "message": {...}}
```

这条 `type=user`, `userType=external`, **但不是用户写的**, 是 CC 自动生成的压缩摘要。

**判断 session 是否经历过 compact, 唯一可靠方法: 看是否存在 `isCompactSummary: true` 的消息。** 不要看 `last-prompt` / 命令痕迹等伴生现象 (它们的存在与否不固定)。

## A.8 .bak 文件

```
<session-id>.jsonl       ← 当前版本 (含 compact 后摘要)
<session-id>.jsonl.bak   ← compact 前的备份 (含被压缩掉的原始对话)
```

**何时需要 .bak**:
- compact 摘要前面有原始消息段 → 不需要 .bak
- compact 摘要前面没有原始消息段 (已被更早 compact 覆盖) → 那部分原始对话只能去 .bak 找
- .bak 也没 → 找不回来了

## A.9 常见陷阱

| 陷阱 | 后果 | 避免 |
|---|---|---|
| 把 compact 摘要当用户原话 | 归因错误 | 检查 `isCompactSummary: true` |
| 把 `internal` 消息当用户说的 | 归因错误 | 检查 `userType === "external"` |
| compact 摘要前没原始段, 不查 .bak | 遗漏被压缩对话 | 摘要前无原始段 → 查 .bak; 都没 → 报告 |
| 自己写脚本解析 JSONL 对话 | 重造轮 + 漏边角 | 优先用工具脚本, 别手撸 |
| 把 `tool_result` 当对话内容 | 引用垃圾 | 只看 `content[].type === "text"` |
| 引用 `<system-reminder>` 内容 | 把系统注入当讨论 | 跳过此前缀文本 |
| JSONL 行数多 = 对话多 | 过度阅读 | 大量行是 progress/file-history/queue, 跳过 |

---

# Part B — 工具操作

本仓库提供 4 个 session 工具 + 1 个诊断工具:

| 工具 | 路径 | 作用 |
|---|---|---|
| **slim-session** | [scripts/slim-session.js](../../scripts/slim-session.js) | 当前 session 无损去冗余 (清 IDE tag / persist 大 tool_result / 清 usage) |
| **slim-diagnose** | [scripts/slim-diagnose.js](../../scripts/slim-diagnose.js) | 只读诊断: 算 slim 后省多少 KB (不动文件) |
| **ship-session** | [scripts/ship-session.js](../../scripts/ship-session.js) | 长 session 按边界造新船 (slim 段落为 QA + clone 新 sessionId) |
| **detect-broken-chain** | [scripts/detect-broken-chain.js](../../scripts/detect-broken-chain.js) | 检测 parentUuid 链断 (progress 分叉等) |
| **fix-broken-chain** | [scripts/fix-broken-chain.js](../../scripts/fix-broken-chain.js) | 修复 parentUuid 链断 |

## B.1 slim-session — 无损去冗余

**何时**: context > 70%, 想保留全对话语义。
**对比 `/compact`**: `/compact` 是有损 LLM 摘要; slim 是机械去冗余, 无损。

### 诊断 (只读)

```bash
node scripts/slim-diagnose.js <jsonl-path>
# 输出: Estimated savings ~XX KB (Y%)
```

### 执行 (改文件)

```bash
# 当前 session 自身 (forks background, sleep 2s, slim, pkill CLI)
node scripts/slim-session.js <jsonl-path> --backup --self

# 其他 session (无 --self, 同步执行)
node scripts/slim-session.js <jsonl-path> --backup
```

**Flags**:
- `--no-trim-results` 跳过 tool_result 占位替换
- `--keep-recent N` 最近 N 条不动 (默认 5)
- `--dry-run` 只诊断不改

## B.2 ship-session — 按边界造新船

**何时**: session 长 (>700K tokens), 用户口头宣布 round / 阶段边界。
**对比 slim**: slim 是无损去冗余; ship 是按语义边界整体打包 (slim 段对话 → QA 摘要), 有损但保因果链。

### Step 1 — 扫 task blocks

```bash
node scripts/ship-session.js scan <active.jsonl>           # 按 line 顺序
node scripts/ship-session.js scan <active.jsonl> size      # 按 size 降序
node scripts/ship-session.js scan <active.jsonl> top 20    # 仅 ≥20KB 的
```

输出每条 user 指令的 line 起止 / size / preview。找 round 起终 line。

### Step 2 — 子 topic 聚类

按用户 instruction 语义聚成 N 个子 topic (典型: 复杂 round 10-18 对, 简单 round 5-10 对)。

### Step 3 — 写 qa-r<N>.json

```json
{
  "round": "R<N>",
  "line_range": [<L_start>, <L_end>],
  "expected_source_session_id": "<source-uuid>",
  "source_sentinels": {
    "start_preview": "<first user instruction opening chars>",
    "end_preview": "<last assistant text opening chars>"
  },
  "title_user": "【<your-prefix>】R<N> 已 slim — <brief>",
  "title_assistant": "已装载。R<N> N 对覆盖 <topics>。可接续 R<N+1>。",
  "pairs": [
    { "topic": "<tag>", "user": "<merged 用户原话>", "assistant": "<substance + commit/doc refs>" }
  ]
}
```

### Step 4 — 一键 ship

```bash
ACTIVE=$(ls -t ~/.claude/projects/<proj>/*.jsonl | head -1)
node scripts/ship-session.js ship "$ACTIVE" qa-rN.json
```

`ship` 一键: sleep 5 → verify source → slim → verify slim → clone → 输出新 UUID。

**Flags**:
- `--spawn-test` — 同时生成测试船 (用 `claude -p` 跑 survival 题)
- `--survival` — 与 `--spawn-test` 配合, 自动跑 survival 题 + 报通过率
- `--keep-old-titles` — 不删 source 旧标题对

### Step 5 — 立刻 /resume

agent **第 1 句仅给 UUID + 立切提示**, 不分析 / 不估算 / 不清理。用户 `/resume <new-uuid>`, 不在原船续谈 (避免 append race 丢消息)。

## B.3 detect-broken-chain — 检测断链

**何时**: 怀疑 session 装载失败 / SubAgent progress 分叉 / parentUuid 链异常。

```bash
# 扫单文件
node scripts/detect-broken-chain.js <jsonl-path>

# 扫整 project (从 cwd 推导)
node scripts/detect-broken-chain.js

# 按 session id 前缀
node scripts/detect-broken-chain.js --id <session-id-prefix>

# 最近 N 小时
node scripts/detect-broken-chain.js --hours 24
```

**bug 模式**: SubAgent 的 progress 消息缓冲写入 jsonl, parentUuid 链从 Agent tool_use 节点分叉, resume 时 tip 选 progress 分支 → 对话分支被孤立。

## B.4 fix-broken-chain — 修复断链

```bash
# 诊断
node scripts/fix-broken-chain.js <jsonl-path> --dry-run

# 修复 (默认带 --backup)
node scripts/fix-broken-chain.js <jsonl-path>

# 修复且不备份
node scripts/fix-broken-chain.js <jsonl-path> --no-backup
```

**修复逻辑**: 把 `parentUuid` 指向 `progress` entry 的 system/user/assistant 重新挂到最近的主链 entry (assistant/user/system)。

## B.5 协议要点

| # | 规则 | 为什么 |
|---|---|---|
| 1 | round 边界 = 用户宣布 | 避免 agent 自探 (语义易错) |
| 2 | timestamp 严格递增 +1s | CC 校验, 同秒被拒 |
| 3 | timestamp 格式 3 位 ms (`.141Z`) | CC 原生 `.141Z` 非 `.141000Z` |
| 4 | parentUuid 链不能断 | CC 装载校验 |
| 5 | slim source = 活跃 jsonl | clone source = slim 产物 (静态) |
| 6 | clone 不覆盖原船 | 避免 append race |
| 7 | sleep 5 置于 slim 前 | 等 CC buffer 落盘, 否则丢最后 1-2 条 |
| 8 | 造完只报 UUID, 立切 | 在原船续谈会 append race |

## B.6 常见 bug + 解

| bug | 根因 | 解 |
|---|---|---|
| 索引偏 2 行 | Python `splitlines()` 在 `\r` 多切 | 用 `read().rstrip("\n").split("\n")` |
| timestamp 格式不匹配 | `datetime.isoformat()` 给 6 位 microseconds | 手写 `strftime + microsecond//1000` 3 位 |
| clone 后丢 N 条 | source 用了老 /tmp 快照 | source 必用 `ls -t ... | head -1` |
| sessionId 不统一 | clone 时漏改某条 | 每条 entry `e.sessionId = newUuid` |
| parentUuid 链断 | 跨 round 边界没 patch | 新 R 首条 parentUuid 指前 R 末 uuid |
| 造完不立切丢消息 | 在原船续谈, append race | 造完第 1 句强提示立切 |
| CC 装载失败 | jsonl 损坏 | 从 .bak 或原船恢复 |

## B.7 自动化: register / unregister

把本仓库的 hooks + skills 注册到任意目标项目:

```bash
# 注册 (写 .claude/settings.json + symlink skills)
bash scripts/register.sh <target-project-dir>

# 注销
bash scripts/unregister.sh <target-project-dir>
```

注册后 hook 指向**源仓库** (非 plugin cache 副本), 改 hook 立即生效, 无需重装。

## 进一步资源

- [skills/slim-session/SKILL.md](../../skills/slim-session/SKILL.md)
- [skills/ship-session/SKILL.md](../../skills/ship-session/SKILL.md)
- [docs/guide/03-context-engineering.md](03-context-engineering.md) — 上下文工程总论
