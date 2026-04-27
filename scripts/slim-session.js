#!/usr/bin/env node
// slim-session.js — Programmatic JSONL slimming for active Claude Code sessions.
//
// Usage: node scripts/slim-session.js <session-jsonl-path> [options]
//
// Options:
//   --no-trim-results      Skip tool_result placeholder replacement + persisted output (default: on)
//   --trim-tool-use        Enable tool_use input trimming for Write/Edit (default: off)
//   --keep-recent N        Override recent-entry protection count (default: 5, requires --trim-results)
//   --dry-run              Diagnose only, do not modify (synchronous, returns output to caller)
//   --backup               Backup before slimming (default: on)
//   --no-backup            Skip backup
//   --self                 Slimming own session: fork background, see below
//
// Behavior:
//   --dry-run:     Synchronous, outputs report, exits. No file modification.
//   Without --self: Synchronous slim + write. For slimming other sessions from outside.
//   With --self:    Forks background process, main process exits immediately.
//                   Background: sleep 2s (wait for CLI write queue drain) → read+slim
//                   → write to .slim staging file → pkill CLI → wait for death
//                   → rename .slim to original.

"use strict";

const fs = require("fs");
const path = require("path");
const { fork, execSync } = require("child_process");
const crypto = require("crypto");

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
// Find positional arg (skip values that follow --keep-recent)
let jsonlPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--keep-recent") { i++; continue; }
  if (!args[i].startsWith("-")) { jsonlPath = args[i]; break; }
}

if (!jsonlPath) {
  process.stderr.write("Usage: node scripts/slim-session.js <session-jsonl-path> [options]\n");
  process.exit(1);
}

const opts = {
  trimResults: !args.includes("--no-trim-results"),
  trimToolUse: args.includes("--trim-tool-use"),
  keepRecent: 5,
  dryRun: args.includes("--dry-run"),
  backup: !args.includes("--no-backup"),
  self: args.includes("--self"),
};

const keepIdx = args.indexOf("--keep-recent");
if (keepIdx !== -1 && args[keepIdx + 1]) {
  opts.keepRecent = parseInt(args[keepIdx + 1], 10);
  if (isNaN(opts.keepRecent) || opts.keepRecent < 0) {
    process.stderr.write("--keep-recent must be a non-negative integer\n");
    process.exit(1);
  }
}

// ─── Fork logic: --self mode forks to background ──────────────────────────────

if (opts.self && !opts.dryRun && process.env.SLIM_DETACHED_CHILD !== "1") {
  // Find CLI pid: this process → zsh (ppid) → CLI (grandparent)
  // Pass it to background child via env so it can pkill exactly that process
  let cliPid = "";
  try {
    const ppid = process.ppid;
    cliPid = require("child_process")
      .execSync(`ps -o ppid= -p ${ppid}`, { encoding: "utf8" })
      .trim();
  } catch {
    // If we can't determine CLI pid, leave empty — will skip pkill
  }

  const child = fork(__filename, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SLIM_DETACHED_CHILD: "1", SLIM_CLI_PID: cliPid },
  });
  child.unref();
  console.log(`[slim-session] Forked background process (pid ${child.pid}). Slimming in 2s...`);
  if (process.env.VSCODE_PID) {
    console.log(`VS Code: Cmd+Shift+P → Reload Window after CLI restarts.`);
  }
  process.exit(0);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomBase36(n) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(n);
  let result = "";
  for (let i = 0; i < n; i++) result += chars[bytes[i] % 36];
  return result;
}

function mediaTypeToExt(mediaType) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };
  return map[mediaType] || ".bin";
}

// ─── Main logic ───────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(jsonlPath)) {
    process.stderr.write(`File not found: ${jsonlPath}\n`);
    process.exit(1);
  }

  const origMtime = fs.statSync(jsonlPath).mtime;
  const raw = fs.readFileSync(jsonlPath, "utf8");
  if (!raw.trim()) {
    console.log("Empty JSONL, nothing to slim.");
    return null;
  }
  const lines = raw.trim().split("\n");
  const origLineCount = lines.length;
  const origSize = Buffer.byteLength(raw, "utf8");

  // Parse all entries
  const entries = lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      process.stderr.write(`Warning: unparseable line ${i + 1}, keeping as-is\n`);
      return null;
    }
  });

  // ─── Identify recent assistant entries for --trim-results protection ───────
  let protectedIds = new Set();
  let protectionBoundaryIndex = entries.length;  // P2: entries at or after this index are protected from image persisted output
  if (opts.trimResults) {
    const assistantEntries = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].type === "assistant") {
        assistantEntries.push({ index: i, uuid: entries[i].uuid });
      }
    }
    // Protect the last N assistant entries and their associated tool_results
    const protectedAssistants = opts.keepRecent === 0 ? [] : assistantEntries.slice(-opts.keepRecent);
    protectedIds = new Set(protectedAssistants.map(a => a.uuid).filter(Boolean));
    if (protectedAssistants.length > 0) {
      protectionBoundaryIndex = protectedAssistants[0].index;
    }

    // Also collect tool_use IDs from protected assistants to protect their tool_results
    for (const pa of protectedAssistants) {
      const entry = entries[pa.index];
      if (Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === "tool_use" && block.id) {
            protectedIds.add("tool_use:" + block.id);
          }
        }
      }
    }
  }

  // ─── Persisted output setup for --trim-results ─────────────────────────────
  let persistDir = null;
  if (opts.trimResults && !opts.dryRun) {
    const sessionId = path.basename(jsonlPath, ".jsonl");
    const projectDir = path.dirname(jsonlPath);
    persistDir = path.join(projectDir, sessionId, "trim-results");
    fs.mkdirSync(persistDir, { recursive: true });
  }

  // ─── Capture last totalTokens before processing mutates usage ───────────────
  // Formula from plugin internals §2: totalTokens = input + cache_creation + cache_read + output
  // With caching, input_tokens is tiny (1-3); real context size is in cache_read_input_tokens.
  let lastTotalTokens = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const u = entries[i]?.message?.usage;
    if (u) {
      const total = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      if (total > 0) { lastTotalTokens = total; break; }
    }
  }

  // ─── Process entries ────────────────────────────────────────────────────────
  const output = [];
  let lastKeptUuid = null; // track last kept entry's uuid for remap
  const uuidRemap = {}; // deleted uuid → its parentUuid
  const stats = {
    progressDeleted: 0,
    fhsDeleted: 0,
    qoDeleted: 0,
    ideTagsCleaned: 0,
    ideCharsRemoved: 0,
    usageCleared: 0,
    toolResultsTrimmed: 0,
    toolResultsPersisted: 0,
    trimCharsRemoved: 0,
    imagesPersisted: 0,
    imageCharsRemoved: 0,
    toolUseInputsTrimmed: 0,
    toolUseInputsPersisted: 0,
    toolUseInputCharsRemoved: 0,
  };

  // Thresholds
  const TRIM_MIN_CHARS = 500;  // tool_result shorter than this is not worth trimming
  const PLACEHOLDER_EST_LEN = 120;  // estimated placeholder length for dry-run token calc

  // IDE tag regex (shared with extract-topic.js)
  const IDE_SELECTION_RE = /<ide_selection>[\s\S]*?<\/ide_selection>\s*/g;
  const IDE_OPENED_FILE_RE = /<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Skip unparseable lines (keep as-is)
    if (entry === null) {
      output.push(lines[i]);
      continue;
    }

    // 1. Delete progress entries
    if (entry.type === "progress") {
      if (entry.uuid) uuidRemap[entry.uuid] = entry.parentUuid || null;
      stats.progressDeleted++;
      continue;
    }

    // 2. Delete file-history-snapshot entries
    if (entry.type === "file-history-snapshot") {
      if (entry.uuid) uuidRemap[entry.uuid] = entry.parentUuid || null;
      stats.fhsDeleted++;
      continue;
    }

    // 3. Delete queue-operation entries
    if (entry.type === "queue-operation") {
      if (entry.uuid) uuidRemap[entry.uuid] = entry.parentUuid || null;
      stats.qoDeleted++;
      continue;
    }

    // 4. Remap parentUuid if it points to a deleted entry
    //    Use the last kept entry's uuid instead of walking the deleted chain,
    //    because deleted entries (especially progress) form side branches whose
    //    ancestor may be far earlier in the conversation, not the adjacent main-chain message.
    if (entry.parentUuid && uuidRemap[entry.parentUuid] !== undefined) {
      entry.parentUuid = lastKeptUuid;
    }

    // 5. Clean IDE tags from user messages
    if (entry.type === "user" && Array.isArray(entry.message?.content)) {
      let cleaned = false;
      entry.message.content = entry.message.content.map(block => {
        if (block.type === "text" && block.text) {
          const original = block.text;
          block.text = block.text
            .replace(IDE_SELECTION_RE, "")
            .replace(IDE_OPENED_FILE_RE, "");
          if (block.text !== original) {
            cleaned = true;
            stats.ideCharsRemoved += original.length - block.text.length;
          }
        }
        return block;
      }).filter(block => !(block.type === "text" && !block.text.trim()));
      if (cleaned) stats.ideTagsCleaned++;
    }

    // 6. Clear usage on all assistant entries
    if (entry.message?.usage) {
      const u = entry.message.usage;
      if (u.input_tokens || u.output_tokens || u.cache_creation_input_tokens || u.cache_read_input_tokens) {
        entry.message.usage = {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          service_tier: u.service_tier || "standard",
        };
        stats.usageCleared++;
      }
    }

    // 7. Optional: tool_result placeholder replacement
    if (opts.trimResults && entry.type === "user" && Array.isArray(entry.message?.content)) {
      entry.message.content = entry.message.content.map(block => {
        if (block.type !== "tool_result") return block;

        // --- Array-type content (Agent subagent returns) ---
        if (Array.isArray(block.content)) {
          // Skip if array contains images — let step 8 handle them
          if (block.content.some(b => b.type === "image")) return block;
          const textParts = block.content.filter(b => b.type === "text" && b.text);
          const totalText = textParts.map(b => b.text).join("\n");
          if (totalText.length <= TRIM_MIN_CHARS) return block;
          if (block.tool_use_id && protectedIds.has("tool_use:" + block.tool_use_id)) return block;

          const origLen = totalText.length;
          stats.toolResultsTrimmed++;

          if (!opts.dryRun && persistDir) {
            const persistPath = path.join(persistDir, randomBase36(9) + ".txt");
            fs.writeFileSync(persistPath, totalText);
            stats.toolResultsPersisted++;
            // Preserve array type: replace with single-element array to match original content type
            block.content = [{ type: "text", text: `Output saved to ${persistPath}` }];
          }

          const newLen = opts.dryRun ? PLACEHOLDER_EST_LEN : (Array.isArray(block.content) ? JSON.stringify(block.content).length : block.content.length);
          stats.trimCharsRemoved += Math.max(0, origLen - newLen);
          return block;
        }

        // --- String-type content (existing logic) ---
        if (typeof block.content !== "string") return block;
        if (block.content.length <= TRIM_MIN_CHARS) return block;
        if (block.content.startsWith("[→]") || block.content.startsWith("Output saved to")) return block;

        if (block.tool_use_id && protectedIds.has("tool_use:" + block.tool_use_id)) {
          return block;
        }

        const origLen = block.content.length;
        stats.toolResultsTrimmed++;

        if (!opts.dryRun && persistDir) {
          const persistPath = path.join(persistDir, randomBase36(9) + ".txt");
          fs.writeFileSync(persistPath, block.content);
          stats.toolResultsPersisted++;
          block.content = `Output saved to ${persistPath}`;
        }

        const newLen = opts.dryRun ? PLACEHOLDER_EST_LEN : block.content.length;
        stats.trimCharsRemoved += Math.max(0, origLen - newLen);

        return block;
      });
    }

    // 8. Optional: image base64 persisted output (P2)
    if (opts.trimResults && entry.type === "user" && i < protectionBoundaryIndex && Array.isArray(entry.message?.content)) {
      entry.message.content = entry.message.content.map(block => {
        // Direct image paste in user message
        if (block.type === "image" && block.source?.type === "base64" && block.source?.data) {
          const origChars = block.source.data.length;
          stats.imageCharsRemoved += origChars;
          if (!opts.dryRun && persistDir) {
            const ext = mediaTypeToExt(block.source.media_type);
            const persistPath = path.join(persistDir, randomBase36(9) + ext);
            fs.writeFileSync(persistPath, Buffer.from(block.source.data, "base64"));
            stats.imagesPersisted++;
            return { type: "text", text: `Output saved to ${persistPath}` };
          }
          return block;
        }

        // Image inside tool_result (e.g. Read tool reading an image file)
        if (block.type === "tool_result" && Array.isArray(block.content)) {
          if (block.tool_use_id && protectedIds.has("tool_use:" + block.tool_use_id)) {
            return block;
          }
          block.content = block.content.map(inner => {
            if (inner.type === "image" && inner.source?.type === "base64" && inner.source?.data) {
              const origChars = inner.source.data.length;
              stats.imageCharsRemoved += origChars;
              if (!opts.dryRun && persistDir) {
                const ext = mediaTypeToExt(inner.source.media_type);
                const persistPath = path.join(persistDir, randomBase36(9) + ext);
                fs.writeFileSync(persistPath, Buffer.from(inner.source.data, "base64"));
                stats.imagesPersisted++;
                return { type: "text", text: `Output saved to ${persistPath}` };
              }
            }
            return inner;
          });
        }

        return block;
      });
    }

    // 9. Optional: tool_use input trimming for Write/Edit in assistant messages
    //    Default OFF — LLM needs to see what was written to maintain session memory.
    //    Enable with --trim-tool-use when context savings outweigh memory loss.
    if (opts.trimToolUse && entry.type === "assistant" && i < protectionBoundaryIndex && Array.isArray(entry.message?.content)) {
      entry.message.content = entry.message.content.map(block => {
        if (block.type !== "tool_use") return block;

        // Write tool: trim content field
        if (block.name === "Write" && typeof block.input?.content === "string" && block.input.content.length > TRIM_MIN_CHARS) {
          if (block.input.content.startsWith("Output saved to")) return block;

          const origLen = block.input.content.length;
          stats.toolUseInputsTrimmed++;

          if (!opts.dryRun && persistDir) {
            const persistPath = path.join(persistDir, randomBase36(9) + ".txt");
            fs.writeFileSync(persistPath, block.input.content);
            stats.toolUseInputsPersisted++;
            block.input.content = `Output saved to ${persistPath}`;
          }

          const newLen = opts.dryRun ? PLACEHOLDER_EST_LEN : block.input.content.length;
          stats.toolUseInputCharsRemoved += Math.max(0, origLen - newLen);
          return block;
        }

        // Edit tool: trim old_string + new_string
        if (block.name === "Edit") {
          const oldStr = block.input?.old_string || "";
          const newStr = block.input?.new_string || "";
          const totalLen = oldStr.length + newStr.length;
          if (totalLen <= TRIM_MIN_CHARS) return block;
          if (oldStr.startsWith("Output saved to")) return block;

          stats.toolUseInputsTrimmed++;

          if (!opts.dryRun && persistDir) {
            const persistContent = `=== old_string (${oldStr.length} chars) ===\n${oldStr}\n\n=== new_string (${newStr.length} chars) ===\n${newStr}`;
            const persistPath = path.join(persistDir, randomBase36(9) + ".txt");
            fs.writeFileSync(persistPath, persistContent);
            stats.toolUseInputsPersisted++;
            block.input.old_string = `Output saved to ${persistPath}`;
            block.input.new_string = "(see old_string)";
          }

          const placeholderLen = opts.dryRun ? PLACEHOLDER_EST_LEN + 20 : (block.input.old_string.length + block.input.new_string.length);
          stats.toolUseInputCharsRemoved += Math.max(0, totalLen - placeholderLen);
          return block;
        }

        return block;
      });
    }

    if (entry.uuid) lastKeptUuid = entry.uuid;
    output.push(JSON.stringify(entry));
  }

  // ─── Write-before validation: tool_use / tool_result pairing ────────────────
  const toolUseIds = new Set();
  const toolResultIds = new Set();
  for (const line of output) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_use" && b.id) toolUseIds.add(b.id);
        if (b.type === "tool_result" && b.tool_use_id) toolResultIds.add(b.tool_use_id);
      }
    }
  }

  let unpaired = 0;
  for (const id of toolResultIds) {
    if (!toolUseIds.has(id)) unpaired++;
  }

  // ─── Report ─────────────────────────────────────────────────────────────────
  const newContent = output.join("\n") + "\n";
  const newSize = Buffer.byteLength(newContent, "utf8");

  console.log("=== slim-session report ===");
  console.log(`Original: ${origLineCount} lines, ${(origSize / 1024).toFixed(1)} KB`);
  console.log(`Slimmed:  ${output.length} lines, ${(newSize / 1024).toFixed(1)} KB`);
  // Context token estimate
  const contextCharsRemoved = Math.max(0, stats.ideCharsRemoved) + Math.max(0, stats.trimCharsRemoved) + Math.max(0, stats.imageCharsRemoved) + Math.max(0, stats.toolUseInputCharsRemoved);
  const contextTokensSaved = Math.max(0, Math.round(contextCharsRemoved / 4));
  const contextPct = lastTotalTokens > 0
    ? Math.max(0, (contextTokensSaved / lastTotalTokens) * 100).toFixed(1)
    : "?";
  const savedKB = ((origSize - newSize) / 1024).toFixed(1);
  const savedFilePct = origSize > 0 ? Math.round((origSize - newSize) / origSize * 100) : 0;
  console.log(`Saved:    ${savedKB} KB (${savedFilePct}%) | ~${contextTokensSaved} Tokens (${contextPct}%)`);
  console.log(`---`);
  console.log(`progress deleted:       ${stats.progressDeleted}`);
  console.log(`file-history-snapshot:   ${stats.fhsDeleted}`);
  console.log(`queue-operation:         ${stats.qoDeleted}`);
  console.log(`ide tags cleaned:        ${stats.ideTagsCleaned}`);
  console.log(`usage cleared:           ${stats.usageCleared}`);
  if (opts.trimResults) {
    console.log(`tool_results trimmed:    ${stats.toolResultsTrimmed}`);
    console.log(`persisted:               ${stats.toolResultsPersisted}`);
    console.log(`images persisted:        ${stats.imagesPersisted}`);
    console.log(`tool_use inputs trimmed: ${stats.toolUseInputsTrimmed}`);
    console.log(`tool_use persisted:      ${stats.toolUseInputsPersisted}`);
  }
  console.log(`unpaired tool_results:   ${unpaired}`);

  if (opts.dryRun) {
    console.log("\n[dry-run] No changes written.");
    return null;
  }

  // Return prepared result for write phase
  return { output, origSize, origLineCount, origMtime, contextTokensSaved, contextPct };
}

// ─── Write phase: backup, append status, write to disk ──────────────────────

function write(prepared, { staging = false } = {}) {
  const { output, origSize, origLineCount, origMtime, contextTokensSaved, contextPct } = prepared;
  const writePath = staging ? jsonlPath + ".slim" : jsonlPath;

  // ─── Backup ─────────────────────────────────────────────────────────────────
  if (opts.backup) {
    let bakPath = jsonlPath + ".bak";
    if (fs.existsSync(bakPath)) {
      let n = 2;
      while (fs.existsSync(jsonlPath + ".bak" + n)) n++;
      bakPath = jsonlPath + ".bak" + n;
    }
    fs.copyFileSync(jsonlPath, bakPath);
    console.log(`Backup: ${bakPath}`);
  }

  // ─── Append slim status as assistant message ─────────────────────────────────
  // Simulates a historical assistant reply so it shows in UI and Agent context on resume.
  const lastEntry = (() => {
    for (let i = output.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(output[i]);
        if (e.uuid) return e;
      } catch { continue; }
    }
    return null;
  })();
  const sessionId = path.basename(jsonlPath, ".jsonl");
  const newSize = Buffer.byteLength(output.join("\n") + "\n", "utf8");
  const fileSaved = Math.max(0, origSize - newSize);
  const selfSavedKB = (fileSaved / 1024).toFixed(1);
  const selfSavedPct = origSize > 0 ? Math.round(fileSaved / origSize * 100) : 0;

  const reportLines = [
    `=== slim-session complete ===`,
    `Saved ~${contextTokensSaved} Tokens (${contextPct}%)`,
    `File: ${origLineCount}→${output.length} lines, ${selfSavedKB} KB saved (${selfSavedPct}%)`,
    ``,
    `I persisted some earlier tool results to disk to free up context. When I see "Output saved to {path}" in my history, I SHOULD Read that file to retrieve the original content before answering questions about it.`,
  ];
  const statusEntry = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: reportLines.join("\n") }],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    uuid: crypto.randomUUID(),
    parentUuid: lastEntry?.uuid || null,
    sessionId,
    timestamp: new Date().toISOString(),
  };
  output.push(JSON.stringify(statusEntry));
  const finalContent = output.join("\n") + "\n";

  // ─── Write ──────────────────────────────────────────────────────────────────
  fs.writeFileSync(writePath, finalContent);
  if (!staging) {
    // Restore original mtime so session list order is preserved
    fs.utimesSync(writePath, new Date(), origMtime);
  }
  console.log(`Written: ${writePath}${staging ? " (staging)" : " (mtime preserved)"}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

// ─── Helper: wait for a process to die ──────────────────────────────────────

function waitForProcessDeath(pid, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      process.kill(pid, 0); // signal 0 = check existence
      // Still alive, busy-wait briefly
      execSync("sleep 0.1", { stdio: "ignore" });
    } catch {
      return true; // Process is dead
    }
  }
  return false; // Timeout
}

if (process.env.SLIM_DETACHED_CHILD === "1") {
  // Background child: sleep 2s for CLI write queue to drain,
  // then read+slim, write to staging file, kill CLI, wait, rename.
  setTimeout(() => {
    const prepared = run();
    if (!prepared) process.exit(0); // dry-run or empty

    // Write to staging file (CLI still alive, don't touch original yet)
    write(prepared, { staging: true });

    const cliPid = process.env.SLIM_CLI_PID;
    if (process.env.SLIM_NO_PKILL !== "1" && cliPid) {
      const pid = parseInt(cliPid, 10);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // pid doesn't exist — already dead
      }
      waitForProcessDeath(pid);

      // Terminal TUI: print resume hint
      const sessionId = path.basename(jsonlPath, ".jsonl");
      if (!process.env.VSCODE_PID) {
        try {
          const ttyFd = fs.openSync("/dev/tty", "w");
          fs.writeSync(ttyFd, `\nResume this session with:\nclaude --resume ${sessionId}\n`);
          fs.closeSync(ttyFd);
        } catch {
          // No tty — skip
        }
      }
    }

    // CLI is dead — rename staging file to replace original
    const slimPath = jsonlPath + ".slim";
    fs.renameSync(slimPath, jsonlPath);
    // Restore original mtime so session list order is preserved
    fs.utimesSync(jsonlPath, new Date(), prepared.origMtime);
    console.log(`Renamed: ${slimPath} → ${jsonlPath} (mtime preserved)`);
  }, 2000);
} else {
  // Dry-run or non-self mode: synchronous read+slim+write
  const prepared = run();
  if (prepared) write(prepared);
}
