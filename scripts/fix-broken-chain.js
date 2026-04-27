#!/usr/bin/env node
// fix-broken-chain.js — Fix parentUuid chain breaks caused by progress entries.
//
// When system/user/assistant entries have parentUuid pointing to a progress entry,
// re-parent them to the nearest main-chain entry (assistant/user/system).
//
// Usage: node scripts/fix-broken-chain.js <session-jsonl-path> [options]
//
// Options:
//   --dry-run    Report only, do not modify
//   --backup     Create .bak before writing (default: on)
//   --no-backup  Skip backup

"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
let jsonlPath = null;
for (const a of args) {
  if (!a.startsWith("-")) { jsonlPath = a; break; }
}

if (!jsonlPath) {
  process.stderr.write("Usage: node scripts/fix-broken-chain.js <session-jsonl-path> [options]\n");
  process.exit(1);
}

if (!fs.existsSync(jsonlPath)) {
  process.stderr.write(`File not found: ${jsonlPath}\n`);
  process.exit(1);
}

const dryRun = args.includes("--dry-run");
const backup = !args.includes("--no-backup");

const raw = fs.readFileSync(jsonlPath, "utf8");
if (!raw.trim()) {
  console.log("Empty JSONL, nothing to fix.");
  process.exit(0);
}

const lines = raw.trim().split("\n");
const entries = lines.map((line, i) => {
  try { return JSON.parse(line); } catch { return null; }
});

// Build uuid → entry map and children map (same structure as detect-broken-chain.js)
const MAIN_TYPES = new Set(["assistant", "user", "system"]);
const SKIP_TYPES = new Set(["progress", "file-history-snapshot", "queue-operation"]);

const msgs = new Map();       // uuid → { index, type, parentUuid }
const children = new Map();   // uuid → [child uuids]

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (!e || !e.uuid) continue;
  msgs.set(e.uuid, { index: i, type: e.type, parentUuid: e.parentUuid || null });
  if (e.parentUuid) {
    if (!children.has(e.parentUuid)) children.set(e.parentUuid, []);
    children.get(e.parentUuid).push(e.uuid);
  }
}

// Strategy (aligned with detect-broken-chain.js):
//   1. Find user/system entries whose parentUuid points to a progress entry
//   2. Walk the progress chain UP to find the fork ancestor (first non-progress)
//   3. From the fork ancestor, find its conversation children (non-progress)
//   4. Walk DOWN the conversation branch to find its tip (deepest descendant)
//   5. Re-parent the broken entry to that conversation tip
const fixes = [];

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (!e || !e.parentUuid || !e.uuid) continue;
  if (SKIP_TYPES.has(e.type)) continue;

  const parent = msgs.get(e.parentUuid);

  // Case 1: parent exists and is a main type → chain is OK
  if (parent && MAIN_TYPES.has(parent.type)) continue;

  // Case 2: parent uuid doesn't exist at all (entry was deleted) → re-parent to previous entry
  if (!parent) {
    // Find the nearest preceding entry with a uuid
    let newParent = null;
    for (let j = i - 1; j >= 0; j--) {
      if (entries[j] && entries[j].uuid && !SKIP_TYPES.has(entries[j].type)) {
        newParent = entries[j].uuid;
        break;
      }
    }
    fixes.push({
      line: i + 1,
      type: e.type,
      uuid: e.uuid.slice(0, 8),
      oldParent: e.parentUuid.slice(0, 8),
      oldParentType: "missing",
      newParent: newParent ? newParent.slice(0, 8) : "null",
      forkAncestor: "n/a",
    });
    e.parentUuid = newParent;
    continue;
  }

  // Case 3: parent exists but is a skip type (progress etc.) → walk up to fork ancestor
  let cur = parent;
  while (cur && !MAIN_TYPES.has(cur.type) && cur.parentUuid) {
    const next = msgs.get(cur.parentUuid);
    if (!next) break;
    cur = next;
  }
  if (!MAIN_TYPES.has(cur.type)) {
    // All-progress chain to root — fallback: re-parent to nearest preceding conversation entry
    let newParent = null;
    for (let j = i - 1; j >= 0; j--) {
      if (entries[j] && entries[j].uuid && !SKIP_TYPES.has(entries[j].type)) {
        newParent = entries[j].uuid;
        break;
      }
    }
    fixes.push({
      line: i + 1,
      type: e.type,
      uuid: e.uuid.slice(0, 8),
      oldParent: e.parentUuid.slice(0, 8),
      oldParentType: parent.type,
      newParent: newParent ? newParent.slice(0, 8) : "null",
      forkAncestor: "n/a (all-progress root)",
    });
    e.parentUuid = newParent;
    continue;
  }

  // cur is the fork ancestor — find its uuid
  let forkUuid = null;
  for (const [uuid, m] of msgs) {
    if (m === cur) { forkUuid = uuid; break; }
  }
  if (!forkUuid) continue;

  // Step 3-4: Find the tip of the conversation branch from the fork ancestor
  // Walk down conversation children (non-progress) to find the deepest one
  // that comes BEFORE the current entry in JSONL order
  let tip = forkUuid;
  let changed = true;
  while (changed) {
    changed = false;
    const kids = children.get(tip) || [];
    for (const kid of kids) {
      const m = msgs.get(kid);
      if (!m || !MAIN_TYPES.has(m.type)) continue;
      if (m.index < i) { // must be before the broken entry
        tip = kid;
        changed = true;
        break; // take the first conversation child (there should be only one)
      }
    }
  }

  if (tip !== e.parentUuid) {
    fixes.push({
      line: i + 1,
      type: e.type,
      uuid: e.uuid.slice(0, 8),
      oldParent: e.parentUuid.slice(0, 8),
      oldParentType: parent.type,
      newParent: tip.slice(0, 8),
      forkAncestor: forkUuid.slice(0, 8),
    });
    e.parentUuid = tip;
  }
}

// Report
console.log(`=== fix-broken-chain report ===`);
console.log(`File: ${jsonlPath}`);
console.log(`Entries: ${entries.length}`);
console.log(`Fixes: ${fixes.length}`);

if (fixes.length > 0) {
  console.log(`\n--- Repairs ---`);
  for (const f of fixes) {
    console.log(`  L${f.line} [${f.type}] ${f.uuid}: parent ${f.oldParent} (${f.oldParentType}) → ${f.newParent} (fork at ${f.forkAncestor})`);
  }
}

if (fixes.length === 0) {
  console.log("\nNo broken parent chains found.");
  process.exit(0);
}

// Remove progress entries (they're orphaned after fix and useless in history)
// Track deleted indices explicitly to avoid fragile string-based filtering during output
const deletedIndices = new Set();
let progressRemoved = 0;
for (let i = 0; i < entries.length; i++) {
  if (entries[i] && entries[i].type === "progress") {
    deletedIndices.add(i);
    entries[i] = null;
    progressRemoved++;
  }
}
if (progressRemoved > 0) {
  console.log(`\nProgress entries removed: ${progressRemoved}`);
}

if (dryRun) {
  console.log("\n[dry-run] No changes written.");
  process.exit(0);
}

// Backup
if (backup) {
  let bakPath = jsonlPath + ".bak";
  if (fs.existsSync(bakPath)) {
    let n = 2;
    while (fs.existsSync(jsonlPath + ".bak" + n)) n++;
    bakPath = jsonlPath + ".bak" + n;
  }
  fs.copyFileSync(jsonlPath, bakPath);
  console.log(`\nBackup: ${bakPath}`);
}

// Preserve original mtime
const origMtime = fs.statSync(jsonlPath).mtime;

// Write (skip deleted entries, keep unparseable non-deleted lines as-is)
const output = entries
  .map((e, i) => e ? JSON.stringify(e) : (deletedIndices.has(i) ? null : lines[i] || null))
  .filter(l => l !== null);
fs.writeFileSync(jsonlPath, output.join("\n") + "\n");

// Restore original mtime so session list order is preserved
fs.utimesSync(jsonlPath, new Date(), origMtime);
console.log(`Written: ${jsonlPath} (mtime preserved)`);
