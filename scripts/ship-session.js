#!/usr/bin/env node
// ship-session.js — Long-session slim + clone shipbuilding tool.
//
// Subcommands:
//   scan     <jsonl>                     按 user/text 切 task blocks (external-only)
//   list     <jsonl> <L_start> <L_end>   列指定 line range 每条 entry
//   verify   <jsonl>                     主链 + sideband 分层校验
//   slim     <jsonl> <qa.json>           替换 L_start..L_end 为 N 对 QA (输出到 /tmp/slim-rN.tmp.jsonl)
//   clone    <slim.jsonl> <qa.json>      从 slim 产物 clone 新船 (新 sessionId + title 对)
//   spawn-test <slim.jsonl> <qa.json> <N>  测试船 (前 N 条 = title + QA), 不含下文
//   ship     <jsonl> <qa.json>           一键: sleep 5 → verify source → slim → verify slim → clone → (可选) spawn-test → (可选) survival
//
// See docs/guide/session-guide.md for concepts.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Type classification (aligned with guide §0.2 + §4) ─────────
const MAIN_TYPES = new Set(["user", "assistant", "system"]);
const SKIP_TYPES = new Set(["progress", "file-history-snapshot", "queue-operation"]);

// ─── Helpers ───────────────────────────────────────────────────
function readJsonl(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) {
    die(`File not found: ${jsonlPath}`);
  }
  const raw = fs.readFileSync(jsonlPath, "utf8");
  if (!raw.trim()) die("Empty JSONL");
  return raw.replace(/\n$/, "").split("\n");
}

function parseEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Strict parse: die on any non-JSON line. Use for write paths (slim/clone). */
function parseEntriesStrict(lines, ctxPath) {
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch (err) {
      die(`${ctxPath}: non-JSON line at L${i + 1}: ${lines[i].slice(0, 120)}`);
    }
  }
  return entries;
}

/** Find first main entry (user/assistant/system with uuid) starting from index i (inclusive). */
function findNextMainIdx(entries, i) {
  for (let k = i; k < entries.length; k++) {
    const e = entries[k];
    if (e && e.uuid && MAIN_TYPES.has(e.type)) return k;
  }
  return -1;
}

/** Find nearest preceding main entry at or before index i. */
function findPrevMainIdx(entries, i) {
  for (let k = i; k >= 0; k--) {
    const e = entries[k];
    if (e && e.uuid && MAIN_TYPES.has(e.type)) return k;
  }
  return -1;
}

/** Validate qa.json schema. die with readable msg on failure. */
function validateQa(qa) {
  if (!qa || typeof qa !== "object") die("qa must be an object");
  if (!Array.isArray(qa.line_range) || qa.line_range.length !== 2) die("qa.line_range must be [L_start, L_end]");
  const [s, e] = qa.line_range;
  if (!Number.isInteger(s) || s < 1) die(`qa.line_range[0] must be integer >= 1, got ${s}`);
  if (!Number.isInteger(e) || e < s) die(`qa.line_range[1] must be integer >= line_range[0]=${s}, got ${e}`);
  if (typeof qa.title_user !== "string" || !qa.title_user.trim()) die("qa.title_user required (non-empty string)");
  if (typeof qa.title_assistant !== "string" || !qa.title_assistant.trim()) die("qa.title_assistant required (non-empty string)");
  if (!Array.isArray(qa.pairs) || qa.pairs.length === 0) die("qa.pairs must be non-empty array");
  qa.pairs.forEach((p, i) => {
    if (!p || typeof p !== "object") die(`qa.pairs[${i}] must be object`);
    if (typeof p.user !== "string" || !p.user.trim()) die(`qa.pairs[${i}].user required (non-empty string)`);
    if (typeof p.assistant !== "string" || !p.assistant.trim()) die(`qa.pairs[${i}].assistant required (non-empty string)`);
    if (p.survival_expect !== undefined && !Array.isArray(p.survival_expect)) {
      die(`qa.pairs[${i}].survival_expect must be array of strings`);
    }
  });
  if (qa.expected_source_session_id !== undefined && typeof qa.expected_source_session_id !== "string") {
    die("qa.expected_source_session_id must be string if present");
  }
}

function die(msg, code = 1) {
  process.stderr.write(`[ship-session] ERROR: ${msg}\n`);
  process.exit(code);
}

function warn(msg) {
  process.stderr.write(`[ship-session] WARN: ${msg}\n`);
}

function log(msg) {
  process.stdout.write(`[ship-session] ${msg}\n`);
}

/** Format timestamp: YYYY-MM-DDTHH:MM:SS.mmmZ (3-digit ms, matches CC native) */
function fmtTs(date) {
  const iso = date.toISOString(); // 2026-04-23T12:34:56.789Z
  return iso.replace(/\.(\d{3})\d*Z$/, ".$1Z");
}

function randomUuidV4() {
  return crypto.randomUUID();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract user/text content from an entry. Returns { text, isExternal, isCompactSummary } or null if not a user/text. */
function extractUserText(e) {
  if (!e || e.type !== "user") return null;
  if (e.isCompactSummary === true) return { text: "", isExternal: true, isCompactSummary: true };
  const isExternal = e.userType === "external";
  const c = e.message?.content;
  if (typeof c === "string") return { text: c, isExternal, isCompactSummary: false };
  if (Array.isArray(c) && c[0]?.type === "text") {
    return { text: c[0].text || "", isExternal, isCompactSummary: false };
  }
  return null;
}

/** Strip system-injection prefixes from user text. Returns cleaned text. */
function stripSystemInjection(text) {
  if (!text) return text;
  const prefixes = [
    /^<system-reminder>[\s\S]*?<\/system-reminder>\s*/,
    /^<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>\s*/,
    /^<command-name>[\s\S]*?<\/command-name>\s*/,
    /^<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/,
    /^<available-skills>[\s\S]*?<\/available-skills>\s*/,
    /^<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>\s*/,
    /^Stop hook[\s\S]*?$/m,
    /^Recent commits:[\s\S]*?$/m,
  ];
  let t = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of prefixes) {
      const next = t.replace(re, "");
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  return t.trim();
}

// ─── Subcommand: scan ───────────────────────────────────────────
function cmdScan(args) {
  const [jsonlPath, mode = "seq", thresholdKBStr = "20"] = args;
  if (!jsonlPath) die("Usage: scan <jsonl> [seq|size|top] [thresholdKB]");
  const thresholdKB = parseFloat(thresholdKBStr);
  const lines = readJsonl(jsonlPath);

  // Find external user/text (skip internal, skip compact summary, skip system-injection-only)
  const starts = [];
  lines.forEach((l, i) => {
    const e = parseEntry(l);
    const info = extractUserText(e);
    if (!info) return;
    if (!info.isExternal) return;
    if (info.isCompactSummary) return;
    const cleaned = stripSystemInjection(info.text);
    if (!cleaned) return; // pure system-injection user entry, skip
    starts.push({ line: i + 1, uuid: e.uuid || "", text: cleaned });
  });

  // Compute block bytes
  const totalLines = lines.length;
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].line - 1;
    const to = i + 1 < starts.length ? starts[i + 1].line - 1 : totalLines;
    let bytes = 0;
    for (let j = from; j < to; j++) bytes += lines[j].length + 1;
    starts[i].endLine = to;
    starts[i].bytes = bytes;
    starts[i].kb = bytes / 1024;
    starts[i].count = to - from;
  }

  const totalBytes = lines.reduce((s, l) => s + l.length + 1, 0);
  log(`File: ${(totalBytes / 1024).toFixed(1)} KB, ${totalLines} lines, ${starts.length} task blocks (external, non-compact).`);
  log(`Mean: ${(totalBytes / 1024 / starts.length).toFixed(1)} KB / block, ${(totalLines / starts.length).toFixed(1)} lines / block.\n`);

  let rows = starts.map((b, i) => ({ ...b, idx: i }));
  if (mode === "size") rows.sort((a, b) => b.kb - a.kb);
  else if (mode === "top") {
    rows = rows.filter((r) => r.kb >= thresholdKB).sort((a, b) => b.kb - a.kb);
    log(`Showing >= ${thresholdKB} KB (${rows.length} of ${starts.length})\n`);
  }

  console.log(`  #    L_start..L_end  lines  Size     Preview`);
  console.log(`  ---  --------------- -----  -------  -----------------------------------------------------`);
  rows.forEach((b) => {
    const range = `${b.line.toString().padStart(5)}..${b.endLine.toString().padStart(5)}`;
    const sz = `${b.kb.toFixed(1)}K`.padStart(7);
    const prev = (b.text || "").slice(0, 80).replace(/\n/g, "⏎");
    console.log(`  ${b.idx.toString().padStart(3)}  ${range}  ${b.count.toString().padStart(5)}  ${sz}  ${prev}`);
  });
}

// ─── Subcommand: list ───────────────────────────────────────────
function cmdList(args) {
  const [jsonlPath, startStr, endStr, previewStr = "120"] = args;
  if (!jsonlPath || !startStr || !endStr) die("Usage: list <jsonl> <start> <end> [preview]");
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  const preview = parseInt(previewStr, 10);
  const lines = readJsonl(jsonlPath);

  for (let i = start - 1; i < Math.min(end, lines.length); i++) {
    const lineNum = i + 1;
    const e = parseEntry(lines[i]);
    const uuid = e?.uuid ? e.uuid.slice(0, 8) : "-------";
    const sz = lines[i].length;
    const sum = summarizeEntry(e, preview);
    console.log(`L${lineNum.toString().padStart(4)}  ${uuid}  ${sz.toString().padStart(6)}B  ${sum}`);
  }
}

function summarizeEntry(e, preview = 120) {
  if (!e) return "(parse error)";
  const t = e.type || "?";
  if (t === "user") {
    const info = extractUserText(e);
    if (info?.isCompactSummary) return "user/COMPACT-SUMMARY";
    if (info) {
      const tag = info.isExternal ? "external" : "internal";
      return `user/${tag} "${(info.text || "").slice(0, preview).replace(/\n/g, "⏎")}"`;
    }
    const c = e.message?.content;
    if (Array.isArray(c) && c[0]?.type === "tool_result") {
      const content = typeof c[0].content === "string" ? c[0].content : JSON.stringify(c[0].content);
      return `user/tool_result(${c[0].tool_use_id?.slice(-6)}) "${content.slice(0, preview).replace(/\n/g, "⏎")}"`;
    }
    return `user/${c?.[0]?.type || "?"}`;
  }
  if (t === "assistant") {
    const c = e.message?.content;
    if (Array.isArray(c)) {
      const parts = c.map((p) => {
        if (p.type === "text") return `text:"${(p.text || "").slice(0, 80).replace(/\n/g, "⏎")}"`;
        if (p.type === "tool_use") return `tool_use:${p.name}(${JSON.stringify(p.input || {}).slice(0, 80).replace(/\n/g, "⏎")})`;
        if (p.type === "thinking") return `thinking(${(p.thinking || "").length}ch)`;
        return p.type;
      });
      return `asst | ${parts.join(" | ").slice(0, preview)}`;
    }
    return "asst/?";
  }
  return t;
}

// ─── Subcommand: verify ─────────────────────────────────────────
function cmdVerify(args) {
  const [jsonlPath, ...opts] = args;
  if (!jsonlPath) die("Usage: verify <jsonl> [--lax-linear]");
  const laxLinear = opts.includes("--lax-linear"); // 允许 非 strict 线性 (旧 session 兼容)
  const lines = readJsonl(jsonlPath);
  // strict parse: 非 JSON 行直接 FAIL (损坏输入绝不放行)
  const entries = parseEntriesStrict(lines, jsonlPath);

  const uuidSet = new Set();
  for (const e of entries) if (e?.uuid) uuidSet.add(e.uuid);

  // Main chain: user/assistant/system with uuid, in file order
  const mainChain = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e && e.uuid && MAIN_TYPES.has(e.type));

  let mainBroken = 0;
  let mainTsReverse = 0;
  let mainSessionMismatch = 0;
  let firstSessionId = null;
  let prevTs = null;
  // Linear chain: in file order, each main.parentUuid === prev-main.uuid (or null for first)
  let linearBreaks = 0;
  let rootCount = 0;
  let prevMainUuid = null;
  for (const { e, i } of mainChain) {
    if (e.parentUuid && !uuidSet.has(e.parentUuid)) {
      mainBroken++;
      warn(`L${i + 1} main chain broken: parent ${e.parentUuid.slice(0, 8)} not found`);
    }
    // Linear check
    if (prevMainUuid === null) {
      // First main entry: parent must be null (CC session start) OR we note as root
      if (e.parentUuid === null || e.parentUuid === undefined) rootCount++;
    } else {
      if (e.parentUuid !== prevMainUuid) {
        linearBreaks++;
        warn(`L${i + 1} non-linear: parent=${(e.parentUuid || "null").slice(0, 8)} expected=${prevMainUuid.slice(0, 8)}`);
      }
    }
    prevMainUuid = e.uuid;
    if (e.timestamp && prevTs && e.timestamp < prevTs) {
      mainTsReverse++;
      warn(`L${i + 1} main chain ts reverse: ${e.timestamp} < ${prevTs}`);
    }
    if (e.timestamp) prevTs = e.timestamp;
    if (e.sessionId) {
      if (!firstSessionId) firstSessionId = e.sessionId;
      else if (e.sessionId !== firstSessionId) mainSessionMismatch++;
    }
  }

  // Sideband soft check: count only
  let sidebandCount = 0;
  let sidebandNoUuid = 0;
  for (const e of entries) {
    if (!e) continue;
    if (MAIN_TYPES.has(e.type)) continue;
    sidebandCount++;
    if (!e.uuid) sidebandNoUuid++;
  }

  console.log(`\n=== verify report ===`);
  console.log(`File: ${jsonlPath}`);
  console.log(`Total lines: ${lines.length}`);
  console.log(`\n--- Main chain (user/assistant/system with uuid, ${mainChain.length} entries) ---`);
  console.log(`  Broken parentUuid: ${mainBroken}`);
  console.log(`  Non-linear breaks: ${linearBreaks} ${laxLinear ? "(--lax-linear mode, warn only)" : "(FAIL)"}`);
  console.log(`  Root count: ${rootCount} (expected 1)`);
  console.log(`  Timestamp reverse: ${mainTsReverse} (warn, CC 常见)`);
  console.log(`  SessionId mismatch: ${mainSessionMismatch} (first: ${firstSessionId})`);
  console.log(`\n--- Sideband (${sidebandCount} entries) ---`);
  console.log(`  Without uuid (OK): ${sidebandNoUuid}`);
  console.log(`  (timestamp/parentUuid 宽松, 不校验)`);

  // FAIL: parent 断 / sessionId 混 / (strict) 线性断 / root 非 1
  const fail = mainBroken > 0 || mainSessionMismatch > 0 ||
               (!laxLinear && (linearBreaks > 0 || rootCount !== 1));
  const warnOnly = mainTsReverse > 0 || (laxLinear && linearBreaks > 0);
  if (fail) {
    const reasons = [];
    if (mainBroken > 0) reasons.push(`parentUuid broken ${mainBroken}`);
    if (!laxLinear && linearBreaks > 0) reasons.push(`non-linear breaks ${linearBreaks}`);
    if (!laxLinear && rootCount !== 1) reasons.push(`root count=${rootCount} (expected 1)`);
    if (mainSessionMismatch > 0) reasons.push(`sessionId mismatch ${mainSessionMismatch}`);
    console.log(`\nResult: FAIL (${reasons.join(", ")})`);
    process.exit(2);
  }
  if (warnOnly) {
    console.log(`\nResult: OK with warnings`);
  } else {
    console.log(`\nResult: OK (main chain healthy)`);
  }
}

// ─── Subcommand: slim ───────────────────────────────────────────
function cmdSlim(args) {
  const [jsonlPath, qaPath, outPath] = args;
  if (!jsonlPath || !qaPath) die("Usage: slim <source.jsonl> <qa.json> [out.jsonl]");

  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  validateQa(qa);
  const actualOut = outPath || `/tmp/slim-${qa.round || "rN"}.tmp.jsonl`;

  const lines = readJsonl(jsonlPath);
  const entries = parseEntriesStrict(lines, jsonlPath);
  const [L_start, L_end] = qa.line_range;
  const startI = L_start - 1;
  const endI = L_end - 1;

  // Assertion 1: line_range bounds
  if (endI >= lines.length) die(`qa.line_range[1]=${L_end} exceeds file length ${lines.length}`);

  // Assertion 2: expected_source_session_id (from first main entry with sessionId, NOT lines[0])
  if (qa.expected_source_session_id) {
    let got = null;
    for (const e of entries) {
      if (e && MAIN_TYPES.has(e.type) && e.sessionId) { got = e.sessionId; break; }
    }
    if (got !== qa.expected_source_session_id) {
      die(`sessionId mismatch: source=${got}, expected=${qa.expected_source_session_id}`);
    }
  }

  // Assertion 3: sentinel (start_preview / end_preview) — both fail-fast
  const getEntryText = (e) => {
    if (!e) return "";
    // Try user/text
    const info = extractUserText(e);
    if (info && info.text) return info.text;
    // Try assistant/text
    if (e.type === "assistant") {
      const c = e.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) if (b.type === "text" && b.text) return b.text;
      }
    }
    return "";
  };
  if (qa.source_sentinels?.start_preview) {
    const t = getEntryText(entries[startI]);
    if (!t.startsWith(qa.source_sentinels.start_preview)) {
      die(`start sentinel mismatch at L${L_start}: expect "${qa.source_sentinels.start_preview}" got "${t.slice(0, 80)}"`);
    }
  }
  if (qa.source_sentinels?.end_preview) {
    const t = getEntryText(entries[endI]);
    if (!t.startsWith(qa.source_sentinels.end_preview)) {
      die(`end sentinel mismatch at L${L_end}: expect "${qa.source_sentinels.end_preview}" got "${t.slice(0, 80)}"`);
    }
  }

  // Prev: nearest main entry BEFORE L_start (skip sideband). If startI=0 or none before, parent=null (session head).
  const prevIdx = startI > 0 ? findPrevMainIdx(entries, startI - 1) : -1;
  const prev = prevIdx >= 0 ? entries[prevIdx] : null;

  // Next: nearest main entry AFTER L_end (skip sideband). If none, no patch needed (slim at EOF).
  const nextMainIdx = findNextMainIdx(entries, endI + 1);
  const nextMain = nextMainIdx >= 0 ? entries[nextMainIdx] : null;

  // Timestamp base + monotonicity assertion
  let baseTs;
  let tpl;
  if (prev && prev.timestamp) {
    const t = new Date(prev.timestamp);
    if (isNaN(t.getTime())) die(`prev entry at L${prevIdx + 1} has invalid timestamp: ${prev.timestamp}`);
    baseTs = new Date(t.getTime() + 1000);
    tpl = prev;
  } else {
    // No prev main: use first entry in range as template, ts = its ts - pairCount*2 seconds (or session start)
    const firstInRange = entries[startI] || {};
    const tRef = firstInRange.timestamp ? new Date(firstInRange.timestamp) : new Date();
    if (isNaN(tRef.getTime())) die(`range-start entry timestamp invalid`);
    baseTs = new Date(tRef.getTime() - qa.pairs.length * 2 * 1000);
    tpl = firstInRange;
  }
  const pairCount = qa.pairs.length;
  const endTs = new Date(baseTs.getTime() + (pairCount * 2 - 1) * 1000);
  if (nextMain && nextMain.timestamp) {
    const nt = new Date(nextMain.timestamp);
    if (isNaN(nt.getTime())) die(`next main entry at L${nextMainIdx + 1} has invalid timestamp: ${nextMain.timestamp}`);
    if (endTs >= nt) {
      die(`timestamp cumulative overflow: new QA end ts ${fmtTs(endTs)} >= next main ts ${nextMain.timestamp} (at L${nextMainIdx + 1}). Reduce QA pair count or choose earlier baseTs.`);
    }
  }

  // Build new entries
  const newEntries = [];
  let parent = prev ? prev.uuid : null;
  let tsOffset = 0;
  const mkEntry = (role, text) => {
    const uuid = randomUuidV4();
    const ts = fmtTs(new Date(baseTs.getTime() + tsOffset * 1000));
    tsOffset++;
    const content = role === "assistant" ? [{ type: "text", text }] : text;
    const base = {
      parentUuid: parent,
      isSidechain: false,
      type: role,
      uuid,
      timestamp: ts,
      permissionMode: tpl.permissionMode || "bypassPermissions",
      userType: role === "user" ? "external" : undefined,
      entrypoint: tpl.entrypoint || "claude-vscode",
      cwd: tpl.cwd || process.cwd(),
      sessionId: tpl.sessionId,
      version: tpl.version || "2.1.114",
      gitBranch: tpl.gitBranch || "main",
      message: { role, content },
    };
    // Remove undefined fields (assistant without userType)
    if (base.userType === undefined) delete base.userType;
    return base;
  };

  for (const p of qa.pairs) {
    const u = mkEntry("user", p.user);
    newEntries.push(u);
    parent = u.uuid;
    const a = mkEntry("assistant", p.assistant);
    newEntries.push(a);
    parent = a.uuid;
  }

  // Write output:
  //   L1..L_start-1 (preserve) + newEntries + (sideband entries strictly inside L_end+1..nextMainIdx-1) + patched nextMain + L_end+2..end
  // Actually: we replace lines[startI..endI] with newEntries. Keep sideband between endI+1..nextMainIdx-1 unchanged.
  const writeLines = [];
  for (let i = 0; i < startI; i++) writeLines.push(lines[i]);
  const firstNewLineIdx = writeLines.length; // 0-indexed line in output
  for (const e of newEntries) writeLines.push(JSON.stringify(e));
  const lastNewLineIdx = writeLines.length - 1;
  // Preserve sideband between endI+1 and nextMainIdx-1 (if any)
  if (nextMain) {
    for (let i = endI + 1; i < nextMainIdx; i++) writeLines.push(lines[i]);
    // Patch nextMain parentUuid to new last
    const patched = { ...nextMain, parentUuid: parent };
    writeLines.push(JSON.stringify(patched));
    // Rest after nextMainIdx
    for (let i = nextMainIdx + 1; i < lines.length; i++) writeLines.push(lines[i]);
  } else {
    // No next main: copy everything after endI (may include sideband at tail)
    for (let i = endI + 1; i < lines.length; i++) writeLines.push(lines[i]);
  }

  // Atomic write: staging then rename
  const stagePath = actualOut + ".tmp";
  fs.writeFileSync(stagePath, writeLines.join("\n") + "\n");
  fs.renameSync(stagePath, actualOut);

  log(`slim done: ${actualOut}`);
  log(`  source: ${lines.length} lines -> ${writeLines.length} lines`);
  log(`  replaced L${L_start}..L${L_end} (${L_end - L_start + 1} lines) -> ${newEntries.length} entries (${pairCount} QA pairs)`);
  log(`  prev main: ${prev ? `L${prevIdx + 1} uuid=${prev.uuid.slice(0, 8)}` : "(none, session head)"}`);
  log(`  next main: ${nextMain ? `L${nextMainIdx + 1} (output line ${lastNewLineIdx + 1 + (nextMainIdx - endI - 1) + 1}) uuid=${nextMain.uuid.slice(0, 8)} -> parent patched` : "(none, slim at EOF)"}`);
  log(`  first new uuid: ${newEntries[0].uuid}`);
  log(`  last new uuid: ${parent}`);

  return {
    outPath: actualOut,
    firstNewLineIdx: firstNewLineIdx + 1, // 1-indexed
    lastNewLineIdx: lastNewLineIdx + 1,
    pairCount,
    newFirstUuid: newEntries[0].uuid,
    newLastUuid: parent,
  };
}

// ─── Subcommand: clone ──────────────────────────────────────────
function cmdClone(args) {
  const [slimPath, qaPath, ...opts] = args;
  if (!slimPath || !qaPath) die("Usage: clone <slim.jsonl> <qa.json> [--keep-old-titles] [--out-dir <dir>]");
  const keepOldTitles = opts.includes("--keep-old-titles");
  const outDirIdx = opts.indexOf("--out-dir");
  const defaultOutDir = path.dirname(slimPath.startsWith("/") ? slimPath : fs.realpathSync(slimPath));
  const guessedOutDir = inferCcProjectDir(slimPath) || defaultOutDir;
  const outDir = outDirIdx >= 0 ? opts[outDirIdx + 1] : guessedOutDir;

  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  if (!qa.title_user || !qa.title_assistant) die("qa.title_user and qa.title_assistant required");

  const lines = readJsonl(slimPath);
  // 非 JSON 行 fail-fast (保证新船结构完整)
  const entries = parseEntriesStrict(lines, slimPath);
  const newSession = randomUuidV4();

  // Find old title pairs (A-scheme default strip; --keep-old-titles disables)
  let stripUpTo = 0;
  if (!keepOldTitles) {
    stripUpTo = detectOldTitleEnd(lines, 20);
    if (stripUpTo > 0) log(`stripping ${stripUpTo} old title entries (L1-L${stripUpTo})`);
  }

  // Collect stripped uuids (parentUuid references to these are dead → patch to new titleA)
  const strippedUuids = new Set();
  for (let i = 0; i < stripUpTo; i++) {
    const e = entries[i];
    if (e?.uuid) strippedUuids.add(e.uuid);
  }

  // Template entry (for metadata: permissionMode / entrypoint / cwd / version / gitBranch)
  const tplEntry = entries[stripUpTo] || entries[0];
  if (!tplEntry) die("cannot find template entry in source");
  const tplTs = tplEntry.timestamp || fmtTs(new Date());
  const tplDate = new Date(tplTs);
  if (isNaN(tplDate.getTime())) die(`template entry has invalid timestamp: ${tplTs}`);

  // Title pair: ts = first kept entry ts - 2s (so prepended order works)
  const baseTs = new Date(tplDate.getTime() - 2000);
  const fmt = (d) => fmtTs(d);

  const titleU = mkTitleEntry("user", qa.title_user, null, fmt(baseTs), tplEntry, newSession);
  const titleA = mkTitleEntry("assistant", qa.title_assistant, titleU.uuid, fmt(new Date(baseTs.getTime() + 1000)), tplEntry, newSession);

  // Build remaining uuidSet (after strip) to judge if parentUuid is still valid
  const remainingUuidSet = new Set();
  for (let i = stripUpTo; i < entries.length; i++) {
    if (entries[i]?.uuid) remainingUuidSet.add(entries[i].uuid);
  }

  const outLines = [];
  outLines.push(JSON.stringify(titleU));
  outLines.push(JSON.stringify(titleA));

  let firstKeptPatched = false;
  let rewroteSession = 0;
  let sessionIdAbsent = 0;
  let forcePatchWarned = 0;
  for (let i = stripUpTo; i < entries.length; i++) {
    const e = entries[i];
    // Rewrite sessionId for all entries that have the field
    if ("sessionId" in e) {
      e.sessionId = newSession;
      rewroteSession++;
    } else {
      sessionIdAbsent++;
    }
    // Patch first kept main entry's parentUuid to titleA.uuid (precise rule)
    if (!firstKeptPatched && e.uuid && MAIN_TYPES.has(e.type)) {
      const origParent = e.parentUuid;
      if (origParent === null || origParent === undefined) {
        e.parentUuid = titleA.uuid;
      } else if (strippedUuids.has(origParent)) {
        // Original parent was in stripped range → dangling, patch
        e.parentUuid = titleA.uuid;
      } else if (!remainingUuidSet.has(origParent)) {
        // Original parent not in remaining uuids → dangling (external / out-of-order), patch
        e.parentUuid = titleA.uuid;
      } else {
        // Original parent still valid → preserve (uncommon but legal)
        warn(`first kept main entry L${i + 1} retained original parentUuid ${origParent.slice(0, 8)} (not null/stripped/dangling). titleA.uuid will NOT be injected into chain. Verify if this is intended.`);
        forcePatchWarned++;
      }
      firstKeptPatched = true;
    }
    outLines.push(JSON.stringify(e));
  }

  if (!firstKeptPatched) warn(`first kept main-chain entry parentUuid not patched (no main-type entry found after strip)`);

  const outPath = path.join(outDir, `${newSession}.jsonl`);
  const tmpPath = outPath + ".tmp";
  fs.writeFileSync(tmpPath, outLines.join("\n") + "\n");
  fs.renameSync(tmpPath, outPath);

  log(`clone done: ${outPath}`);
  log(`  new session UUID: ${newSession}`);
  log(`  title pair prepended (2 entries)`);
  log(`  stripped old titles: ${stripUpTo}`);
  log(`  total entries: ${outLines.length}`);
  log(`  sessionId rewritten: ${rewroteSession}`);
  log(`  sessionId absent (sideband, kept absent): ${sessionIdAbsent}`);
  if (forcePatchWarned > 0) log(`  parent retain warned: ${forcePatchWarned}`);
  log(``);
  log(`立切: /resume ${newSession}`);

  return { outPath, sessionId: newSession };
}

function inferCcProjectDir(slimPath) {
  // If slim is in /tmp/, guess CC project dir from current cwd
  const home = process.env.HOME || require("os").homedir();
  const cwd = process.cwd();
  const encoded = "-" + cwd.replace(/^\//, "").replace(/\//g, "-");
  const guess = path.join(home, ".claude", "projects", encoded);
  return fs.existsSync(guess) ? guess : null;
}

function mkTitleEntry(role, text, parentUuid, ts, tpl, newSession) {
  const content = role === "assistant" ? [{ type: "text", text }] : text;
  return {
    parentUuid,
    isSidechain: false,
    type: role,
    uuid: randomUuidV4(),
    timestamp: ts,
    permissionMode: tpl.permissionMode || "bypassPermissions",
    userType: "external",
    entrypoint: tpl.entrypoint || "claude-vscode",
    cwd: tpl.cwd || process.cwd(),
    sessionId: newSession,
    version: tpl.version || "2.1.114",
    gitBranch: tpl.gitBranch || "main",
    message: { role, content },
  };
}

/** Detect old title pairs in first N lines. Returns count of lines to strip (0 if none).
 *
 * Algorithm:
 *   1. Find first main entry that is NOT a title-pair member (neither title-prefix user nor its paired assistant).
 *   2. Use that entry's timestamp as anchor.
 *   3. For each consecutive (title-prefix user + its assistant) pair before anchor, check:
 *      - parentUuid: user's parent is null or chains to prev title's assistant
 *      - timestamp: user's ts within 60s before anchor
 *   4. Return total lines stripped.
 */
function detectOldTitleEnd(lines, scanLines = 20) {
  const TITLE_PREFIX_RE = /^【.*造船】/;
  const SCAN_CAP = Math.min(scanLines, lines.length);

  // Step 1: count consecutive title-pair candidates at the start
  let candidateCount = 0; // in pairs (2 lines each)
  let candidateEndLine = 0; // lines[0..candidateEndLine - 1] are title-pair candidates
  let i = 0;
  while (i + 1 < SCAN_CAP) {
    const eU = parseEntry(lines[i]);
    if (!eU || eU.type !== "user") break;
    const info = extractUserText(eU);
    if (!info || !TITLE_PREFIX_RE.test(info.text)) break;
    const eA = parseEntry(lines[i + 1]);
    if (!eA || eA.type !== "assistant") break;
    if (eU.uuid && eA.parentUuid !== eU.uuid) break;
    candidateCount++;
    candidateEndLine = i + 2;
    i += 2;
  }
  if (candidateCount === 0) return 0;

  // Step 2: find anchor ts from first main entry AFTER candidateEndLine
  let anchorTs = null;
  for (let j = candidateEndLine; j < lines.length; j++) {
    const e = parseEntry(lines[j]);
    if (!e || !MAIN_TYPES.has(e.type)) continue;
    if (e.timestamp) {
      anchorTs = new Date(e.timestamp);
      break;
    }
  }
  if (!anchorTs || isNaN(anchorTs.getTime())) return 0; // no anchor → conservative, don't strip

  // Step 3: validate each candidate pair against parent + timestamp conditions
  let stripCount = 0;
  let prevUuid = null;
  for (let k = 0; k < candidateCount; k++) {
    const eU = parseEntry(lines[k * 2]);
    const eA = parseEntry(lines[k * 2 + 1]);
    const condParent = eU.parentUuid === null || eU.parentUuid === prevUuid;
    const ts = eU.timestamp ? new Date(eU.timestamp) : null;
    const diffSec = ts ? (anchorTs - ts) / 1000 : Infinity;
    // title must be BEFORE anchor (positive diff) AND within 60s
    const condTime = diffSec >= 0 && diffSec < 60;
    if (!condParent || !condTime) break;
    stripCount = (k + 1) * 2;
    prevUuid = eA.uuid;
  }
  return stripCount;
}

// ─── Subcommand: spawn-test ─────────────────────────────────────
function cmdSpawnTest(args) {
  const [slimPath, qaPath, ...opts] = args;
  if (!slimPath || !qaPath) die("Usage: spawn-test <slim.jsonl> <qa.json> [N|--from <L>] [--to <L>] [--out-dir <dir>]");

  // Parse options: N (positional int), --from <L>, --to <L>, --out-dir <dir>
  let fromIdx = opts.indexOf("--from");
  let toIdx = opts.indexOf("--to");
  let outDirIdx = opts.indexOf("--out-dir");
  let N = null;
  let from1 = null;
  let to1 = null;

  for (let i = 0; i < opts.length; i++) {
    const a = opts[i];
    if (a === "--from" || a === "--to" || a === "--out-dir") {
      i++; // skip value
      continue;
    }
    if (!a.startsWith("--") && N === null) {
      N = parseInt(a, 10);
      if (!Number.isInteger(N) || N <= 0) die(`N must be positive integer, got: ${a}`);
    }
  }
  if (fromIdx >= 0) {
    from1 = parseInt(opts[fromIdx + 1], 10);
    if (!Number.isInteger(from1) || from1 < 1) die(`--from must be integer >= 1, got: ${opts[fromIdx + 1]}`);
  }
  if (toIdx >= 0) {
    to1 = parseInt(opts[toIdx + 1], 10);
    if (!Number.isInteger(to1) || to1 < (from1 || 1)) die(`--to must be integer >= from, got: ${opts[toIdx + 1]}`);
  }

  const guessedOutDir = inferCcProjectDir(slimPath) || path.dirname(slimPath);
  const outDir = outDirIdx >= 0 ? opts[outDirIdx + 1] : guessedOutDir;
  if (!outDir) die(`--out-dir flag given but no value`);
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) die(`--out-dir not a valid directory: ${outDir}`);

  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  if (!qa.title_user || !qa.title_assistant) die("qa.title_user and qa.title_assistant required");

  const lines = readJsonl(slimPath);
  parseEntriesStrict(lines, slimPath); // non-JSON fail-fast

  // Determine range: explicit --from/--to OR positional N OR error
  let startI, endI;
  if (from1 !== null) {
    startI = from1 - 1;
    endI = to1 !== null ? to1 - 1 : lines.length - 1;
  } else if (N !== null) {
    startI = 0;
    endI = N - 1;
  } else {
    die("spawn-test needs either positional N or --from <L> [--to <L>]");
  }
  if (endI >= lines.length) die(`range end L${endI + 1} > source lines ${lines.length}`);
  if (startI > endI) die(`range empty: from=${startI + 1}, to=${endI + 1}`);

  const newSession = randomUuidV4();
  const firstInRange = parseEntry(lines[startI]);
  if (!firstInRange) die(`cannot parse first entry in range at L${startI + 1}`);
  const tplTs = firstInRange.timestamp || fmtTs(new Date());
  const tplDate = new Date(tplTs);
  if (isNaN(tplDate.getTime())) die(`first-in-range entry has invalid timestamp: ${tplTs}`);
  const baseTs = new Date(tplDate.getTime() - 2000);

  const titleU = mkTitleEntry("user", qa.title_user, null, fmtTs(baseTs), firstInRange, newSession);
  const titleA = mkTitleEntry("assistant", qa.title_assistant, titleU.uuid, fmtTs(new Date(baseTs.getTime() + 1000)), firstInRange, newSession);

  const outLines = [];
  outLines.push(JSON.stringify(titleU));
  outLines.push(JSON.stringify(titleA));

  let firstKeptPatched = false;
  const selLen = endI - startI + 1;
  for (let i = startI; i <= endI; i++) {
    const e = parseEntry(lines[i]);
    if (!e) die(`unexpected non-JSON line at L${i + 1} (strict parse should have caught this)`);
    if ("sessionId" in e) e.sessionId = newSession;
    if (!firstKeptPatched && e.uuid && MAIN_TYPES.has(e.type)) {
      e.parentUuid = titleA.uuid;
      firstKeptPatched = true;
    }
    outLines.push(JSON.stringify(e));
  }

  const outPath = path.join(outDir, `${newSession}.jsonl`);
  const tmpPath = outPath + ".tmp";
  fs.writeFileSync(tmpPath, outLines.join("\n") + "\n");
  fs.renameSync(tmpPath, outPath);

  log(`spawn-test done: ${outPath}`);
  log(`  test session UUID: ${newSession}`);
  log(`  range: L${startI + 1}..L${endI + 1} (${selLen} entries)`);
  log(`  2 title + ${selLen} range entries = ${2 + selLen} total`);
  log(``);
  log(`Resume: /resume ${newSession}`);

  return { outPath, sessionId: newSession };
}

// ─── Subcommand: ship (一键) ────────────────────────────────────
async function cmdShip(args) {
  const [jsonlPath, qaPath, ...opts] = args;
  if (!jsonlPath || !qaPath) die("Usage: ship <source.jsonl> <qa.json> [--no-sleep] [--spawn-test] [--survival] [--keep-old-titles]");
  const noSleep = opts.includes("--no-sleep");
  const withSpawnTest = opts.includes("--spawn-test") || opts.includes("--survival");
  const withSurvival = opts.includes("--survival");
  const keepOldTitles = opts.includes("--keep-old-titles");

  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));

  if (!noSleep) {
    log(`sleeping 5s for CC to flush pending entries...`);
    await sleep(5000);
  }

  log(`=== step 1: verify source ===`);
  // Source 是旧 session, 允许非 strict 线性 (历史 session 可能有旁枝); --lax-linear
  cmdVerify([jsonlPath, "--lax-linear"]);

  log(`\n=== step 2: slim ===`);
  const slimOut = `/tmp/slim-${qa.round || "rN"}.tmp.jsonl`;
  const slimResult = cmdSlim([jsonlPath, qaPath, slimOut]);

  log(`\n=== step 3: verify slim ===`);
  // slim 产物仍是 lax (因为保留了 source 的 sideband), 只关心主链
  cmdVerify([slimOut, "--lax-linear"]);

  log(`\n=== step 4: clone ===`);
  const cloneOpts = [];
  if (keepOldTitles) cloneOpts.push("--keep-old-titles");
  const clone = cmdClone([slimOut, qaPath, ...cloneOpts]);

  if (withSpawnTest) {
    log(`\n=== step 5: spawn-test (QA range only) ===`);
    // 用 cmdSlim 返回的 range 精确切 QA 部分 (避免包含 L_start 之前的 prelude)
    const test = cmdSpawnTest([
      slimOut, qaPath,
      "--from", String(slimResult.firstNewLineIdx),
      "--to", String(slimResult.lastNewLineIdx),
    ]);

    if (withSurvival) {
      log(`\n=== step 6: survival tests ===`);
      const results = await runSurvival(test.sessionId, qa);
      const pass = results.filter((r) => r.pass).length;
      log(`\nsurvival: ${pass}/${results.length} pass`);
      for (const r of results) {
        log(`  ${r.pass ? "✓" : "✗"} ${r.topic}`);
      }
    }
  }

  log(`\n立切: /resume ${clone.sessionId}`);
}

async function runSurvival(testSessionId, qa) {
  const { execFileSync } = require("child_process");
  const results = [];
  const timeout = (qa.survival_timeout_ms && Number.isInteger(qa.survival_timeout_ms)) ? qa.survival_timeout_ms : 60000;
  for (const p of qa.pairs) {
    if (!p.survival_q) continue;
    const expects = p.survival_expect || [];
    let output = "";
    try {
      // argv 数组, shell:false, 彻底绕开 shell 注入
      output = execFileSync("claude", ["-p", "--resume", testSessionId, p.survival_q], {
        encoding: "utf8",
        timeout,
      });
    } catch (e) {
      results.push({ topic: p.topic || p.survival_q.slice(0, 40), pass: false, err: e.message });
      continue;
    }
    const hit = expects.every((kw) => output.includes(kw));
    results.push({ topic: p.topic || p.survival_q.slice(0, 40), pass: hit, output: output.slice(0, 500) });
  }
  return results;
}

// ─── Main ───────────────────────────────────────────────────────
function printHelp() {
  console.log(`ship-session.js — long-session slim + clone shipbuilding tool.

Concepts: docs/guide/session-guide.md
QA schema: see qa-template.json reference (define your own per project)
Examples: see qa-r*.json reference

USAGE
  node ship-session.js <subcommand> [args]

SUBCOMMANDS
  scan <jsonl> [seq|size|top] [thresholdKB]
      List task blocks (user/external boundaries). seq=by line order,
      size=by bytes desc, top=only blocks >= thresholdKB.
      e.g.  node ship-session.js scan ~/.claude/projects/<proj>/<uuid>.jsonl size

  list <jsonl> <L_start> <L_end> [preview_chars]
      Print entry-per-line summary for given line range (preview_chars default 100).
      e.g.  node ship-session.js list <jsonl> 120 160 150

  verify <jsonl> [--lax-linear]
      Main-chain linearity + sideband + timestamp checks.
      --lax-linear tolerates legacy non-linear ancestry (e.g. original ship).

  slim <source.jsonl> <qa.json> [out.jsonl]
      Replace L_start..L_end with N QA pairs. Writes to /tmp/slim-<round>.tmp.jsonl
      by default. Fail-fast on schema / sentinel / parentUuid / timestamp invariants.

  clone <slim.jsonl> <qa.json> [--keep-old-titles] [--out-dir <dir>]
      Clone to new sessionId + prepend new title pair. Output to CC projects dir
      by default (inferred from source path).

  spawn-test <slim.jsonl> <qa.json> [N|--from <L> --to <L>] [--out-dir <dir>]
      Create test ship with only first N entries (or range) + new title. Does not
      contain the remaining conversation; used to validate QA via "claude -p".

  ship <source.jsonl> <qa.json> [--no-sleep] [--spawn-test] [--survival] [--keep-old-titles]
      One-shot: sleep 5 → verify source → slim → verify slim → clone.
      --spawn-test adds test ship; --survival runs claude -p questions from qa.
      --no-sleep skips the 5s flush wait (use only for offline replays).

EXAMPLES (cross-project: use absolute path to this script)
  ACTIVE=\$(ls -t ~/.claude/projects/<proj>/*.jsonl | head -1)
  SHIP=/path/to/claude-lightness/scripts/ship-session.js
  node \$SHIP scan "\$ACTIVE"
  node \$SHIP ship "\$ACTIVE" ./qa.json

EXIT CODES
  0  success                        2  verify failed (non-lax)
  1  generic error / invariant die`);
}

async function main() {
  const [subcmd, ...args] = process.argv.slice(2);
  if (!subcmd || subcmd === "-h" || subcmd === "--help" || subcmd === "help") {
    printHelp();
    process.exit(subcmd ? 0 : 1);
  }
  switch (subcmd) {
    case "scan": cmdScan(args); break;
    case "list": cmdList(args); break;
    case "verify": cmdVerify(args); break;
    case "slim": cmdSlim(args); break;
    case "clone": cmdClone(args); break;
    case "spawn-test": cmdSpawnTest(args); break;
    case "ship": await cmdShip(args); break;
    default:
      console.error(`Unknown subcommand: ${subcmd}`);
      console.error(`Run 'node ship-session.js --help' for usage.`);
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Exports for testing
module.exports = {
  extractUserText,
  stripSystemInjection,
  fmtTs,
  detectOldTitleEnd,
  summarizeEntry,
  validateQa,
  findNextMainIdx,
  findPrevMainIdx,
  parseEntriesStrict,
  MAIN_TYPES,
  SKIP_TYPES,
};
