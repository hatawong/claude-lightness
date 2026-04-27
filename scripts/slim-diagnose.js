#!/usr/bin/env node
// slim-diagnose.js — Diagnose a session JSONL for slimming opportunities. Does not modify files.
//
// Usage: node scripts/slim-diagnose.js <session-jsonl-path>

"use strict";

const fs = require("fs");
const path = require("path");

const jsonlPath = process.argv[2];
if (!jsonlPath) {
  process.stderr.write("Usage: node scripts/slim-diagnose.js <session-jsonl-path>\n");
  process.exit(1);
}

if (!fs.existsSync(jsonlPath)) {
  process.stderr.write(`File not found: ${jsonlPath}\n`);
  process.exit(1);
}

const raw = fs.readFileSync(jsonlPath, "utf8");
if (!raw.trim()) {
  console.log("Empty JSONL, nothing to diagnose.");
  process.exit(0);
}
const lines = raw.trim().split("\n");
const fileSize = Buffer.byteLength(raw, "utf8");

const entries = lines.map((line, i) => {
  try {
    return { idx: i, data: JSON.parse(line), rawLen: line.length };
  } catch {
    return { idx: i, data: null, rawLen: line.length };
  }
});

// ─── Entry type counts ────────────────────────────────────────────────────────
const typeCounts = {};
const typeSizes = {};
for (const e of entries) {
  const t = e.data?.type || "unknown";
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  typeSizes[t] = (typeSizes[t] || 0) + e.rawLen;
}

// ─── IDE tag detection ────────────────────────────────────────────────────────
const IDE_RE = /<ide_selection>|<ide_opened_file>/;
let ideTagEntries = 0;
let ideTagChars = 0;
const IDE_SELECTION_RE = /<ide_selection>[\s\S]*?<\/ide_selection>\s*/g;
const IDE_OPENED_FILE_RE = /<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g;

for (const e of entries) {
  if (!e.data || e.data.type !== "user") continue;
  const content = e.data.message?.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block.type === "text" && block.text && IDE_RE.test(block.text)) {
      ideTagEntries++;
      const selMatches = block.text.match(IDE_SELECTION_RE) || [];
      const fileMatches = block.text.match(IDE_OPENED_FILE_RE) || [];
      for (const m of [...selMatches, ...fileMatches]) {
        ideTagChars += m.length;
      }
    }
  }
}

// ─── Large tool_result detection ──────────────────────────────────────────────
const TRIM_MIN_CHARS = 500;  // must match slim-session.js
const largeToolResults = [];
for (const e of entries) {
  if (!e.data) continue;
  const content = e.data.message?.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block.type === "tool_result" && typeof block.content === "string" && block.content.length > TRIM_MIN_CHARS) {
      largeToolResults.push({
        line: e.idx + 1,
        toolUseId: block.tool_use_id || "unknown",
        chars: block.content.length,
        preview: block.content.substring(0, 80).replace(/\n/g, " "),
      });
    } else if (block.type === "tool_result" && Array.isArray(block.content)) {
      const textParts = block.content.filter(b => b.type === "text" && b.text);
      const totalLen = textParts.reduce((sum, b) => sum + b.text.length, 0);
      if (totalLen > TRIM_MIN_CHARS) {
        const preview = (textParts[0]?.text || "").substring(0, 80).replace(/\n/g, " ");
        largeToolResults.push({
          line: e.idx + 1,
          toolUseId: block.tool_use_id || "unknown",
          chars: totalLen,
          preview: "[array] " + preview,
        });
      }
    }
  }
}

// ─── Large tool_use input detection (Write/Edit) ─────────────────────────────
const largeToolUseInputs = [];
for (const e of entries) {
  if (!e.data || e.data.type !== "assistant") continue;
  const content = e.data.message?.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    if (block.name === "Write" && typeof block.input?.content === "string" && block.input.content.length > TRIM_MIN_CHARS) {
      if (block.input.content.startsWith("Output saved to")) continue;
      largeToolUseInputs.push({
        line: e.idx + 1,
        tool: "Write",
        chars: block.input.content.length,
        preview: (block.input.file_path || "unknown").split("/").slice(-2).join("/"),
      });
    } else if (block.name === "Edit") {
      const oldLen = (block.input?.old_string || "").length;
      const newLen = (block.input?.new_string || "").length;
      const totalLen = oldLen + newLen;
      if (totalLen > TRIM_MIN_CHARS && !(block.input?.old_string || "").startsWith("Output saved to")) {
        largeToolUseInputs.push({
          line: e.idx + 1,
          tool: "Edit",
          chars: totalLen,
          preview: (block.input.file_path || "unknown").split("/").slice(-2).join("/"),
        });
      }
    }
  }
}

// ─── parentUuid chain check ───────────────────────────────────────────────────
const uuidSet = new Set();
for (const e of entries) {
  if (e.data?.uuid) uuidSet.add(e.data.uuid);
}
let brokenChains = 0;
for (const e of entries) {
  if (e.data?.parentUuid && !uuidSet.has(e.data.parentUuid)) {
    brokenChains++;
  }
}

// ─── Usage entries ────────────────────────────────────────────────────────────
let usageEntries = 0;
for (const e of entries) {
  if (!e.data) continue;
  const u = e.data.message?.usage;
  if (u && (u.input_tokens || u.output_tokens)) usageEntries++;
}

// ─── Estimate savings ─────────────────────────────────────────────────────────
const deletableTypes = ["progress", "file-history-snapshot", "queue-operation"];
let deletableSize = 0;
let deletableCount = 0;
for (const t of deletableTypes) {
  deletableSize += typeSizes[t] || 0;
  deletableCount += typeCounts[t] || 0;
}

// ─── Output ───────────────────────────────────────────────────────────────────
console.log("=== slim-diagnose report ===");
console.log(`File: ${jsonlPath}`);
console.log(`Lines: ${lines.length}`);
console.log(`Size: ${(fileSize / 1024).toFixed(1)} KB`);

console.log("\n--- Entry types ---");
const sortedTypes = Object.entries(typeCounts).sort((a, b) => (typeSizes[b[0]] || 0) - (typeSizes[a[0]] || 0));
for (const [t, count] of sortedTypes) {
  console.log(`  ${t}: ${count} entries, ${((typeSizes[t] || 0) / 1024).toFixed(1)} KB`);
}

console.log("\n--- IDE tags ---");
console.log(`  Entries with ide tags: ${ideTagEntries}`);
console.log(`  Total ide tag chars: ${ideTagChars}`);

console.log(`\n--- Large tool_results (>${TRIM_MIN_CHARS} chars) ---`);
if (largeToolResults.length === 0) {
  console.log("  (none)");
} else {
  largeToolResults.sort((a, b) => b.chars - a.chars);
  for (const tr of largeToolResults.slice(0, 30)) {
    console.log(`  L${tr.line} ${tr.chars} chars | ${tr.preview}`);
  }
  if (largeToolResults.length > 30) {
    console.log(`  ... and ${largeToolResults.length - 30} more`);
  }
}

console.log("\n--- Chain integrity ---");
console.log(`  Broken parentUuid refs: ${brokenChains}`);

console.log("\n--- Usage ---");
console.log(`  Entries with non-zero usage: ${usageEntries}`);

console.log("\n--- Estimated savings (default ops) ---");
console.log(`  Deletable entries: ${deletableCount} (progress/fhs/qo)`);
console.log(`  Deletable size: ${(deletableSize / 1024).toFixed(1)} KB`);
console.log(`  IDE tag chars: ~${(ideTagChars / 1024).toFixed(1)} KB`);
const totalSavings = deletableSize + ideTagChars;
console.log(`  Total estimated: ~${(totalSavings / 1024).toFixed(1)} KB (${fileSize > 0 ? Math.round(totalSavings / fileSize * 100) : 0}% of file)`);

// Always show trim-results estimate (trim is default on)
const toolResultChars = largeToolResults.reduce((s, tr) => s + tr.chars, 0);
const toolUseInputChars = largeToolUseInputs.reduce((s, tu) => s + tu.chars, 0);

console.log(`\n--- Large tool_use inputs (Write/Edit, >${TRIM_MIN_CHARS} chars) ---`);
if (largeToolUseInputs.length === 0) {
  console.log("  (none)");
} else {
  largeToolUseInputs.sort((a, b) => b.chars - a.chars);
  for (const tu of largeToolUseInputs.slice(0, 20)) {
    console.log(`  L${tu.line} ${tu.tool} ${tu.chars} chars | ${tu.preview}`);
  }
  if (largeToolUseInputs.length > 20) {
    console.log(`  ... and ${largeToolUseInputs.length - 20} more`);
  }
}

if (toolResultChars > 0 || toolUseInputChars > 0) {
  console.log(`\n--- With trim-results (default) ---`);
  if (toolResultChars > 0) {
    console.log(`  Large tool_results: ${largeToolResults.length}, ~${(toolResultChars / 1024).toFixed(1)} KB`);
  }
  if (toolUseInputChars > 0) {
    console.log(`  Large tool_use inputs: ${largeToolUseInputs.length}, ~${(toolUseInputChars / 1024).toFixed(1)} KB`);
  }
  const combinedSavings = totalSavings + toolResultChars + toolUseInputChars;
  console.log(`  Combined total: ~${(combinedSavings / 1024).toFixed(1)} KB (${fileSize > 0 ? Math.round(combinedSavings / fileSize * 100) : 0}%)`);
}
