#!/usr/bin/env node
// detect-broken-chain.js — 扫描 session JSONL，检测 progress 分叉导致的对话断链
//
// Bug 模式（parentUuid-chain-bug.md）：
//   SubAgent 的 progress 消息缓冲写入 JSONL，parentUuid 链从 Agent tool_use 节点分叉。
//   resume 时 tip 选择走 progress 分支，对话分支被孤立。
//
// 检测策略（直接证据）：
//   找到 parentUuid 指向 progress 消息的 user/system 消息。
//   这意味着 resume 时链经过了 progress 而非对话，是 bug 的直接表现。
//   然后从该 progress 消息向上回溯到分叉点，计算孤立的对话分支。
//
// Usage:
//   node scripts/detect-broken-chain.js [jsonl-path]        # 扫描单个文件
//   node scripts/detect-broken-chain.js                     # 扫描当前项目所有 session（从 cwd 推导）
//   node scripts/detect-broken-chain.js --dir <path>        # 指定 session 目录
//   node scripts/detect-broken-chain.js --id <session-id>   # 按 session ID（前缀匹配）
//   node scripts/detect-broken-chain.js --hours 24          # 最近 N 小时内修改的
//   node scripts/detect-broken-chain.js --days 7            # 最近 N 天内修改的

const fs = require("fs");
const path = require("path");

// Default to current project; override with --dir <path>
const dirIdx = process.argv.indexOf("--dir");
const PROJECT_DIR = dirIdx !== -1 && process.argv[dirIdx + 1]
  ? process.argv[dirIdx + 1]
  : path.join(process.env.HOME, ".claude/projects/" + process.cwd().replace(/\//g, "-"));

function analyzeSession(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;

  const lines = raw.split("\n");
  const msgs = new Map();
  const children = new Map();

  for (let i = 0; i < lines.length; i++) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!obj.uuid) continue;

    msgs.set(obj.uuid, {
      line: i + 1,
      type: obj.type,
      parentUuid: obj.parentUuid || null,
      timestamp: obj.timestamp,
    });

    if (obj.parentUuid) {
      if (!children.has(obj.parentUuid)) children.set(obj.parentUuid, []);
      children.get(obj.parentUuid).push(obj.uuid);
    }
  }

  // Step 0: Find orphan parentUuids — entries pointing to non-existent uuids
  const orphanPoints = [];
  for (const [uuid, msg] of msgs) {
    if (!msg.parentUuid) continue;
    if (msgs.has(msg.parentUuid)) continue;
    orphanPoints.push({
      line: msg.line,
      type: msg.type,
      parentUuid: msg.parentUuid,
    });
  }

  // Step 1: Find direct evidence — user/system messages whose parentUuid is a progress message
  const bugPoints = []; // { bridgeMsg, progressParent, forkAncestor }
  for (const [uuid, msg] of msgs) {
    if (msg.type !== "user" && msg.type !== "system") continue;
    if (!msg.parentUuid) continue;
    const parent = msgs.get(msg.parentUuid);
    if (!parent || parent.type !== "progress") continue;

    // Found: msg.parentUuid -> progress. Trace progress chain up to find the fork ancestor.
    let cur = parent;
    while (cur && cur.type === "progress" && cur.parentUuid) {
      const next = msgs.get(cur.parentUuid);
      if (!next) break;
      cur = next;
    }
    // cur is the fork ancestor (first non-progress in the upward chain)
    if (cur.type === "progress") continue; // all-progress chain to root, skip

    bugPoints.push({
      bridgeLine: msg.line,
      bridgeType: msg.type,
      forkLine: cur.line,
      forkUuid: (() => {
        for (const [u, m] of msgs) {
          if (m === cur) return u;
        }
        return null;
      })(),
    });
  }

  if (bugPoints.length === 0 && orphanPoints.length === 0) return null;

  // Step 2: For each fork ancestor, count orphaned conversation messages
  // Orphaned = conversation descendants of the fork that are NOT reachable via the progress path
  const seen = new Set();
  const forks = [];

  for (const bp of bugPoints) {
    if (seen.has(bp.forkUuid)) continue;
    seen.add(bp.forkUuid);

    const forkKids = children.get(bp.forkUuid) || [];
    const progressKids = forkKids.filter((k) => msgs.get(k)?.type === "progress");
    const convKids = forkKids.filter((k) => {
      const m = msgs.get(k);
      return m && m.type !== "progress";
    });

    if (convKids.length === 0) continue;

    // Collect all uuids reachable from progress branch (these are NOT orphaned)
    const progressReachable = new Set();
    for (const pk of progressKids) {
      const stack = [pk];
      while (stack.length > 0) {
        const c = stack.pop();
        if (progressReachable.has(c)) continue;
        progressReachable.add(c);
        const ch = children.get(c) || [];
        for (const cc of ch) stack.push(cc);
      }
    }

    // Count conversation messages in conv branch that are NOT in progress-reachable
    let orphanedCount = 0;
    let orphanedUserAssistant = 0;
    for (const ck of convKids) {
      const stack = [ck];
      const visited = new Set();
      while (stack.length > 0) {
        const c = stack.pop();
        if (visited.has(c) || progressReachable.has(c)) continue;
        visited.add(c);
        const node = msgs.get(c);
        if (!node) continue;
        orphanedCount++;
        if (node.type === "user" || node.type === "assistant") orphanedUserAssistant++;
        const ch = children.get(c) || [];
        for (const cc of ch) stack.push(cc);
      }
    }

    if (orphanedUserAssistant === 0) continue;

    forks.push({
      forkLine: bp.forkLine,
      bridgeLine: bp.bridgeLine,
      orphanedConv: orphanedUserAssistant,
      orphanedTotal: orphanedCount,
      progressCount: progressReachable.size,
    });
  }

  if (forks.length === 0 && orphanPoints.length === 0) return null;

  return {
    file: path.basename(filePath),
    sessionId: path.basename(filePath, ".jsonl"),
    totalLines: lines.length,
    forks,
    orphanPoints,
  };
}

// Main
const args = process.argv.slice(2);
let files;

// Parse flags
let sessionId = null;
let maxAgeMs = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--id" && args[i + 1]) {
    sessionId = args[++i];
  } else if (args[i] === "--hours" && args[i + 1]) {
    maxAgeMs = parseFloat(args[++i]) * 3600_000;
  } else if (args[i] === "--days" && args[i + 1]) {
    maxAgeMs = parseFloat(args[++i]) * 86400_000;
  } else if (args[i] === "--dir" && args[i + 1]) {
    i++; // skip value, already handled by PROJECT_DIR
  } else if (!args[i].startsWith("--")) {
    // positional arg = direct file path
    files = [args[i]];
  }
}

if (!files) {
  const allFiles = fs
    .readdirSync(PROJECT_DIR)
    .filter((f) => f.endsWith(".jsonl") && !f.includes(".bak"));

  files = allFiles
    .filter((f) => {
      if (sessionId) {
        return f.startsWith(sessionId);
      }
      if (maxAgeMs) {
        const stat = fs.statSync(path.join(PROJECT_DIR, f));
        return Date.now() - stat.mtimeMs < maxAgeMs;
      }
      return true;
    })
    .map((f) => path.join(PROJECT_DIR, f));
}

let broken = 0;
let clean = 0;
const results = [];

for (const f of files) {
  const result = analyzeSession(f);
  if (result) {
    broken++;
    results.push(result);
  } else {
    clean++;
  }
}

// Output
if (results.length === 0) {
  console.log(`Scanned ${files.length} sessions. No broken chains found.`);
  process.exit(0);
}

console.log(
  `Scanned ${files.length} sessions: ${broken} broken, ${clean} clean\n`
);

for (const r of results) {
  const totalOrph = r.forks.reduce((s, f) => s + f.orphanedConv, 0);
  const orphanCount = r.orphanPoints.length;
  console.log(
    `--- ${r.sessionId.slice(0, 8)} (${r.totalLines} lines, ${r.forks.length} forks, ${totalOrph} msgs orphaned, ${orphanCount} orphan parentUuids) ---`
  );
  for (const f of r.forks) {
    console.log(
      `  Fork L${f.forkLine} → bridge L${f.bridgeLine}:` +
        ` ${f.orphanedConv} conv orphaned` +
        ` (${f.progressCount} progress msgs in between)`
    );
  }
  for (const o of r.orphanPoints) {
    console.log(
      `  Orphan L${o.line} [${o.type}]: parentUuid ${o.parentUuid.slice(0, 8)} not found`
    );
  }
}

// Summary
const totalOrphaned = results.reduce(
  (sum, r) => sum + r.forks.reduce((s, f) => s + f.orphanedConv, 0),
  0
);
const totalOrphanPts = results.reduce(
  (sum, r) => sum + r.orphanPoints.length,
  0
);
console.log(
  `\nTotal: ${broken} broken sessions, ${totalOrphaned} orphaned conversation messages, ${totalOrphanPts} orphan parentUuids`
);
