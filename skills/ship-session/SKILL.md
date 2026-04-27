---
name: ship-session
description: Use when the current session has accumulated long history (context >700K tokens) and the user wants to ship a new session by slimming old work boundaries into QA pairs while keeping causality and decision refs. Do NOT use as a substitute for slim-session (lighter mechanism). Do NOT use for short sessions or when user just wants compact-style summary.
---

# ship-session

Long-session **造船** (shipbuilding): 按用户宣布的 round / 工作阶段边界, 把老段对话 (几百 task / 数 MB) 替换为 N 对 QA 摘要 (数十 KB), 然后 clone 新 sessionId 切换。**保留因果链 + decision refs + 关键数据**, 但卸老段细节。

类比 **忒修斯之船**: 老木板 (原对话) 逐段换成新木板 (QA 摘要), 但船的同一性 (因果 / 决策 / 数据 ref) 保留。

## 何时用

- session 长 (>700K tokens 水位), 工作带拥挤, 决策速度下降
- 用户口头宣布 "R<N> 可以收了" / "X 阶段做完了" 等明确边界
- 有结构化的 round / 阶段, 不是杂乱的连续对话
- 比 slim-session 更彻底 (slim 是去冗余, ship 是按语义边界整体打包)

## 何时不用

- session 短 (< 300K), 没必要造船 — slim-session 就够
- 没有清晰边界 (没有"round" / 阶段概念) — 强行 ship 会丢信息
- 想保留全部细节 — ship 是有损的, 用 slim 替代
- 危机模式 (context > 95% 立马丢) — 走 session-surgery 类紧急救援

## Instructions

### Preparation

1. 确认 session 边界 — 让用户**明确宣布**哪个 round / 阶段可以收了, 不要 agent 自决
2. 找当前活跃 session jsonl: `ls -t ~/.claude/projects/<proj>/*.jsonl | head -1`
3. 确认 ship-session.js 路径: `<repo-root>/scripts/ship-session.js`

### Step 1 — Scan task blocks

```bash
node <repo>/scripts/ship-session.js scan <active.jsonl>
# 或按大小排序:
node <repo>/scripts/ship-session.js scan <active.jsonl> size
# 或只看大块:
node <repo>/scripts/ship-session.js scan <active.jsonl> top 20
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
  "title_user": "【<your-prefix>】R<N> 已 slim — <brief scope>",
  "title_assistant": "已装载。R<N> N 对覆盖 <topics>。可接续 R<N+1>。",
  "pairs": [
    { "topic": "<topic-tag>", "user": "<merged 用户原话>", "assistant": "<substance summary + commit/doc refs>" },
    ...
  ]
}
```

每对 QA: user = 用户原话骨架; assistant = agent deliverable 核心 + commit/doc refs。

### Step 4 — 一键 ship

```bash
ACTIVE=$(ls -t ~/.claude/projects/<proj>/*.jsonl | head -1)
node <repo>/scripts/ship-session.js ship "$ACTIVE" qa-rN.json
```

`ship` 完成: sleep 5 → verify source → slim → verify slim → clone → 输出新 UUID。

Flags:
- `--no-sleep` — 跳过 5s flush 等待 (测试用)
- `--spawn-test` — 同时生成测试船
- `--survival` — `--spawn-test` 后跑 `claude -p` 问 survival 题, 报通过率
- `--keep-old-titles` — 不删 source 旧标题对

### Step 5 — 用户立刻 /resume

agent **第 1 句仅给 UUID + 立切提示**, 不分析 / 不估算 / 不清理。用户 `/resume <new-uuid>`, 从此不在原船续谈 (避免 append race 丢消息)。

## 协议要点

- **round 边界 = 用户宣布**, 不是 agent 自探
- **timestamp 严格递增 +1s** (CC 校验)
- **parentUuid 链不能断** (CC 装载校验)
- **source 必用最新活跃 jsonl** (`ls -t ... | head -1`), 不用老 /tmp 快照
- **clone 不覆盖原船** (避免 append race), 原船永保对照
- **造完只报 UUID**, 让用户立切, 不在原船继续操作

## 反模式

- ❌ agent 自决 round 边界 → 切错点, 因果链断
- ❌ 用 source = 老 /tmp 快照 → 丢最新 N 条对话
- ❌ 造完不立切, 在原船继续 → CC append race, 丢消息
- ❌ 短 session 也 ship → 浪费, slim 就够

## Related

- [`scripts/ship-session.js`](../../scripts/ship-session.js) — 实现 (含 7 子命令: scan/list/verify/slim/clone/spawn-test/ship)
- [`docs/guide/session-guide.md`](../../docs/guide/session-guide.md) — JSONL 知识 + 工具操作完整指南
- slim-session — 比 ship-session 轻的版本 (无损去冗余, 不动结构)
- [`scripts/detect-broken-chain.js`](../../scripts/detect-broken-chain.js) / [`scripts/fix-broken-chain.js`](../../scripts/fix-broken-chain.js) — 造船过程出问题时排查
