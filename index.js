#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import zlib from 'zlib';
import readline from 'readline';

const SNAPSHOTS_DIR = '.snapshots';
const VERSION = '1.0.0';

// ─── ANSI Colors ────────────────────────────────────────────────────────────

const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
};

const col = (color, str) => `${c[color]}${str}${c.reset}`;
const bold = (str) => `${c.bold}${str}${c.reset}`;
const dim  = (str) => `${c.dim}${str}${c.reset}`;

// ─── Gitignore Parser ───────────────────────────────────────────────────────

function loadGitignorePatterns(root) {
  const patterns = [
    '.git',
    '.snapshots',
    'node_modules',
  ];
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(trimmed);
      }
    }
  }
  return patterns;
}

function matchesPattern(filePath, pattern) {
  // Normalize
  const fp = filePath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/').replace(/^\//, '');

  // Exact match or directory prefix
  if (fp === pat || fp.startsWith(pat + '/')) return true;

  // Glob: **
  if (pat.includes('**')) {
    const regex = new RegExp(
      '^' + pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]') + '$'
    );
    if (regex.test(fp)) return true;
    // Match anywhere in path for patterns without leading /
    if (!pattern.startsWith('/')) {
      const parts = fp.split('/');
      for (let i = 0; i < parts.length; i++) {
        if (regex.test(parts.slice(i).join('/'))) return true;
      }
    }
    return false;
  }

  // Simple glob with single *
  if (pat.includes('*')) {
    const regex = new RegExp(
      '^' + pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]') + '$'
    );
    // Match basename or full path
    const basename = fp.split('/').pop();
    return regex.test(basename) || regex.test(fp);
  }

  // Plain name — match any segment
  const segments = fp.split('/');
  return segments.includes(pat);
}

function isIgnored(filePath, ignorePatterns) {
  for (const pattern of ignorePatterns) {
    if (matchesPattern(filePath, pattern)) return true;
    // Also check negation isn't needed here (keep it simple)
  }
  return false;
}

// ─── Glob Pattern Matching ──────────────────────────────────────────────────

function matchesGlob(filePath, pattern) {
  return matchesPattern(filePath, pattern);
}

// ─── File Walking ───────────────────────────────────────────────────────────

function walkDir(root, ignorePatterns, includeGlobs, excludeGlobs) {
  const files = [];

  function walk(dir, relative) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;

      if (isIgnored(relPath, ignorePatterns)) continue;

      if (excludeGlobs && excludeGlobs.length > 0) {
        if (excludeGlobs.some(g => matchesGlob(relPath, g))) continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (includeGlobs && includeGlobs.length > 0) {
          if (!includeGlobs.some(g => matchesGlob(relPath, g))) continue;
        }
        files.push(relPath);
      }
    }
  }

  walk(root, '');
  return files.sort();
}

// ─── SHA256 Hash ────────────────────────────────────────────────────────────

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ─── Snapshot Storage ───────────────────────────────────────────────────────

function snapshotsDir() {
  return path.resolve(process.cwd(), SNAPSHOTS_DIR);
}

function snapshotPath(name) {
  return path.join(snapshotsDir(), `${name}.snap.gz`);
}

function ensureSnapshotsDir() {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Add .gitignore for snapshots dir if not already in root .gitignore
    const gitignore = path.join(process.cwd(), '.gitignore');
    let shouldAdd = true;
    if (fs.existsSync(gitignore)) {
      const content = fs.readFileSync(gitignore, 'utf8');
      if (content.includes('.snapshots')) shouldAdd = false;
    }
    if (shouldAdd) {
      // Don't auto-modify user's gitignore — just note it
    }
  }
}

function saveSnapshot(snap) {
  ensureSnapshotsDir();
  const json = JSON.stringify(snap);
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
  fs.writeFileSync(snapshotPath(snap.name), compressed);
}

function loadSnapshot(name) {
  const p = snapshotPath(name);
  if (!fs.existsSync(p)) {
    console.error(col('red', `Snapshot "${name}" not found.`));
    process.exit(1);
  }
  const compressed = fs.readFileSync(p);
  const json = zlib.gunzipSync(compressed).toString('utf8');
  return JSON.parse(json);
}

function listSnapshotNames() {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.snap.gz'))
    .map(f => f.replace('.snap.gz', ''))
    .sort();
}

function snapshotExists(name) {
  return fs.existsSync(snapshotPath(name));
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

function progressBar(current, total, width = 30) {
  if (total === 0) return '';
  const pct = current / total;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pctStr = String(Math.round(pct * 100)).padStart(3);
  return `[${bar}] ${pctStr}% (${current}/${total})`;
}

// ─── Format Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Content-Addressable Store (dedup) ──────────────────────────────────────

class ContentStore {
  constructor() {
    this.blobs = {}; // sha256 -> content string
  }

  intern(content) {
    const hash = sha256(content);
    if (!this.blobs[hash]) {
      this.blobs[hash] = content;
    }
    return hash;
  }

  get(hash) {
    return this.blobs[hash] ?? null;
  }
}

// ─── Line Diff ───────────────────────────────────────────────────────────────

function lineDiff(oldContent, newContent, label) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS-based diff (Myers-lite: works well for small files)
  const result = [];
  result.push(col('cyan', `--- a/${label}`));
  result.push(col('cyan', `+++ b/${label}`));

  // Compute edit script via patience-ish diff
  const diff = computeDiff(oldLines, newLines);

  let hasChanges = false;
  for (const chunk of diff) {
    if (chunk.type === 'context') {
      result.push(dim(` ${chunk.line}`));
    } else if (chunk.type === 'remove') {
      result.push(col('red', `-${chunk.line}`));
      hasChanges = true;
    } else if (chunk.type === 'add') {
      result.push(col('green', `+${chunk.line}`));
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;
  return result.join('\n');
}

function computeDiff(oldLines, newLines) {
  // Simple O(ND) diff — sufficient for CLI diffs
  const MAX_CONTEXT = 3;
  const result = [];

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back
  const ops = []; // {type, line}
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', line: oldLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: 'add', line: newLines[j] });
      j++;
    } else {
      ops.push({ type: 'remove', line: oldLines[i] });
      i++;
    }
  }

  // Compress context: keep only MAX_CONTEXT lines around changes
  const changed = new Set();
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'context') {
      for (let d = -MAX_CONTEXT; d <= MAX_CONTEXT; d++) {
        if (k + d >= 0 && k + d < ops.length) changed.add(k + d);
      }
    }
  }

  const compressed = [];
  let skipping = false;
  for (let k = 0; k < ops.length; k++) {
    if (changed.has(k)) {
      if (skipping) {
        compressed.push({ type: 'context', line: col('cyan', '@@ ... @@') });
        skipping = false;
      }
      compressed.push(ops[k]);
    } else if (ops[k].type === 'context') {
      skipping = true;
    }
  }

  return compressed;
}

// ─── Commands ───────────────────────────────────────────────────────────────

// snap save <name> [--include <glob>] [--exclude <glob>] [--desc <text>]
async function cmdSave(name, opts) {
  if (!name) { console.error(col('red', 'Usage: snap save <name>')); process.exit(1); }
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
    console.error(col('red', 'Name must be alphanumeric (hyphens, underscores, dots allowed).'));
    process.exit(1);
  }

  if (snapshotExists(name)) {
    const ans = await prompt(col('yellow', `Snapshot "${name}" already exists. Overwrite? [y/N] `));
    if (ans.toLowerCase() !== 'y') { console.log('Aborted.'); process.exit(0); }
  }

  const root = process.cwd();
  const ignorePatterns = loadGitignorePatterns(root);
  const includeGlobs = opts.include ? (Array.isArray(opts.include) ? opts.include : [opts.include]) : null;
  const excludeGlobs = opts.exclude ? (Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude]) : null;

  process.stdout.write(`${col('blue', 'Scanning')} files...\r`);
  const filePaths = walkDir(root, ignorePatterns, includeGlobs, excludeGlobs);
  console.log(`${col('blue', 'Scanning')} ${filePaths.length} files found.   `);

  const store = new ContentStore();
  const files = [];
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    const rel = filePaths[i];
    const abs = path.join(root, rel);

    // Show progress for large repos
    if (total > 20 && i % 10 === 0) {
      process.stdout.write(`\r${progressBar(i, total)} `);
    }

    try {
      const stat = fs.statSync(abs);
      // Skip files > 10MB
      if (stat.size > 10 * 1024 * 1024) continue;
      const content = fs.readFileSync(abs, 'utf8');
      const hash = store.intern(content);
      const mode = stat.mode.toString(8);
      files.push({ path: rel, hash, mode, size: stat.size });
    } catch {
      // Binary or unreadable — store as null
      try {
        const stat = fs.statSync(abs);
        files.push({ path: rel, hash: null, mode: stat.mode.toString(8), size: stat.size, binary: true });
      } catch {
        // skip
      }
    }
  }

  if (total > 20) process.stdout.write('\r');

  const snap = {
    name,
    timestamp: Date.now(),
    description: opts.desc || opts.description || '',
    files,
    blobs: store.blobs,
    version: VERSION,
  };

  saveSnapshot(snap);

  const totalSize = files.reduce((a, f) => a + (f.size || 0), 0);
  console.log(`\n${col('green', '✓')} Snapshot ${bold(name)} saved`);
  console.log(`  ${dim('Files:')}  ${files.length}`);
  console.log(`  ${dim('Size:')}   ${formatBytes(totalSize)}`);
  console.log(`  ${dim('Stored:')} ${snapshotPath(name)}`);
}

// snap list
function cmdList() {
  const names = listSnapshotNames();
  if (names.length === 0) {
    console.log(dim('No snapshots yet. Run: snap save <name>'));
    return;
  }

  const rows = names.map(name => {
    const snap = loadSnapshot(name);
    const totalSize = snap.files.reduce((a, f) => a + (f.size || 0), 0);
    return {
      name,
      time: relativeTime(snap.timestamp),
      fullTime: formatDate(snap.timestamp),
      files: snap.files.length,
      size: formatBytes(totalSize),
      desc: snap.description || '',
    };
  });

  const colWidths = {
    name: Math.max(4, ...rows.map(r => r.name.length)),
    time: Math.max(4, ...rows.map(r => r.time.length)),
    files: 5,
    size: Math.max(4, ...rows.map(r => r.size.length)),
    desc: Math.max(11, ...rows.map(r => r.desc.length)),
  };

  const header = [
    col('cyan', 'NAME'.padEnd(colWidths.name)),
    col('cyan', 'WHEN'.padEnd(colWidths.time)),
    col('cyan', 'FILES'.padEnd(colWidths.files)),
    col('cyan', 'SIZE'.padEnd(colWidths.size)),
    col('cyan', 'DESCRIPTION'),
  ].join('  ');

  const sep = dim('─'.repeat(
    colWidths.name + colWidths.time + colWidths.files + colWidths.size + colWidths.desc + 8
  ));

  console.log('');
  console.log(header);
  console.log(sep);

  for (const row of rows) {
    console.log([
      col('white', row.name.padEnd(colWidths.name)),
      dim(row.time.padEnd(colWidths.time)),
      String(row.files).padEnd(colWidths.files),
      row.size.padEnd(colWidths.size),
      dim(row.desc),
    ].join('  '));
  }
  console.log('');
}

// snap diff <name1> [name2] [--full] [--path <file>]
function cmdDiff(name1, name2, opts) {
  if (!name1) { console.error(col('red', 'Usage: snap diff <name1> [name2]')); process.exit(1); }

  const snap1 = loadSnapshot(name1);

  let snap2;
  let snap2Label;
  if (name2) {
    snap2 = loadSnapshot(name2);
    snap2Label = name2;
  } else {
    // Compare against current working state
    const root = process.cwd();
    const ignorePatterns = loadGitignorePatterns(root);
    const filePaths = walkDir(root, ignorePatterns, null, null);
    const store = new ContentStore();
    const files = [];

    for (const rel of filePaths) {
      const abs = path.join(root, rel);
      try {
        const stat = fs.statSync(abs);
        if (stat.size > 10 * 1024 * 1024) continue;
        const content = fs.readFileSync(abs, 'utf8');
        const hash = store.intern(content);
        files.push({ path: rel, hash, size: stat.size });
      } catch {
        try {
          const stat = fs.statSync(abs);
          files.push({ path: rel, hash: null, size: stat.size, binary: true });
        } catch { }
      }
    }

    snap2 = {
      name: 'current',
      timestamp: Date.now(),
      files,
      blobs: store.blobs,
    };
    snap2Label = 'current working directory';
  }

  console.log(`\n${bold('Diff:')} ${col('cyan', name1)} → ${col('cyan', snap2Label)}`);
  console.log(dim(`  ${formatDate(snap1.timestamp)} → ${snap2.name === 'current' ? 'now' : formatDate(snap2.timestamp)}`));
  console.log('');

  const map1 = Object.fromEntries(snap1.files.map(f => [f.path, f]));
  const map2 = Object.fromEntries(snap2.files.map(f => [f.path, f]));

  const allPaths = [...new Set([...Object.keys(map1), ...Object.keys(map2)])].sort();

  // Filter by --path if provided
  const pathFilter = opts.path || opts.p;
  const filteredPaths = pathFilter
    ? allPaths.filter(p => p === pathFilter || p.includes(pathFilter))
    : allPaths;

  const added = [];
  const deleted = [];
  const modified = [];
  const unchanged = [];

  for (const p of filteredPaths) {
    const f1 = map1[p];
    const f2 = map2[p];

    if (!f1) {
      added.push(p);
    } else if (!f2) {
      deleted.push(p);
    } else if (f1.hash !== f2.hash) {
      modified.push(p);
    } else {
      unchanged.push(p);
    }
  }

  if (added.length === 0 && deleted.length === 0 && modified.length === 0) {
    console.log(col('green', '  No differences found. Snapshots are identical.'));
    console.log('');
    return;
  }

  // Summary
  if (added.length > 0) {
    console.log(col('green', `  + ${added.length} added`));
    for (const p of added) {
      const f = map2[p];
      console.log(col('green', `    + ${p}`) + dim(` (${formatBytes(f?.size || 0)})`));
    }
    console.log('');
  }

  if (deleted.length > 0) {
    console.log(col('red', `  - ${deleted.length} deleted`));
    for (const p of deleted) {
      const f = map1[p];
      console.log(col('red', `    - ${p}`) + dim(` (${formatBytes(f?.size || 0)})`));
    }
    console.log('');
  }

  if (modified.length > 0) {
    console.log(col('yellow', `  ~ ${modified.length} modified`));
    for (const p of modified) {
      const f1 = map1[p];
      const f2 = map2[p];
      const sizeDiff = (f2?.size || 0) - (f1?.size || 0);
      const sizeDiffStr = sizeDiff >= 0 ? `+${formatBytes(sizeDiff)}` : `-${formatBytes(Math.abs(sizeDiff))}`;
      console.log(col('yellow', `    ~ ${p}`) + dim(` (${sizeDiffStr})`));

      if (opts.full || opts['full']) {
        // Show line diff
        const content1 = snap1.blobs[f1.hash] ?? '';
        const content2 = snap2.blobs[f2.hash] ?? '';
        if (!f1.binary && !f2.binary && content1 !== null && content2 !== null) {
          const diff = lineDiff(content1, content2, p);
          if (diff) {
            console.log('');
            console.log(diff);
            console.log('');
          }
        }
      }
    }
    console.log('');
  }

  console.log(dim(`  ${unchanged.length} files unchanged`));
  console.log('');
}

// snap restore <name> [--path <file>] [--dry-run]
async function cmdRestore(name, opts) {
  if (!name) { console.error(col('red', 'Usage: snap restore <name>')); process.exit(1); }

  const snap = loadSnapshot(name);
  const root = process.cwd();
  const pathFilter = opts.path || opts.p;

  const filesToRestore = pathFilter
    ? snap.files.filter(f => f.path === pathFilter || f.path.includes(pathFilter))
    : snap.files;

  if (filesToRestore.length === 0) {
    console.log(col('yellow', 'No matching files to restore.'));
    return;
  }

  const dryRun = opts['dry-run'] || opts.dryRun;

  console.log(`\n${bold('Restore:')} ${col('cyan', name)} → ${dryRun ? col('yellow', '[DRY RUN] ') : ''}current directory`);
  console.log(dim(`  Snapshot from ${formatDate(snap.timestamp)}`));
  console.log(dim(`  Restoring ${filesToRestore.length} file(s)`));
  console.log('');

  if (!dryRun) {
    const ans = await prompt(col('yellow', `Restore ${filesToRestore.length} file(s) from "${name}"? This will overwrite current files. [y/N] `));
    if (ans.toLowerCase() !== 'y') { console.log('Aborted.'); process.exit(0); }
  }

  let restored = 0;
  let skipped = 0;

  for (const file of filesToRestore) {
    const abs = path.join(root, file.path);

    if (file.binary || file.hash === null) {
      console.log(dim(`  skip (binary): ${file.path}`));
      skipped++;
      continue;
    }

    const content = snap.blobs[file.hash];
    if (content === undefined || content === null) {
      console.log(col('yellow', `  skip (no content): ${file.path}`));
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(col('green', `  would restore: ${file.path}`));
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      try {
        fs.chmodSync(abs, parseInt(file.mode, 8));
      } catch { /* ignore chmod failures */ }
      console.log(col('green', `  ✓ ${file.path}`));
    }
    restored++;
  }

  console.log('');
  if (dryRun) {
    console.log(col('yellow', `[DRY RUN] Would restore ${restored} files, skip ${skipped}`));
  } else {
    console.log(col('green', `✓ Restored ${restored} files`) + (skipped ? dim(`, skipped ${skipped} (binary)`) : ''));
  }
  console.log('');
}

// snap delete <name>
async function cmdDelete(name) {
  if (!name) { console.error(col('red', 'Usage: snap delete <name>')); process.exit(1); }

  if (!snapshotExists(name)) {
    console.error(col('red', `Snapshot "${name}" not found.`));
    process.exit(1);
  }

  const ans = await prompt(col('yellow', `Delete snapshot "${name}"? [y/N] `));
  if (ans.toLowerCase() !== 'y') { console.log('Aborted.'); process.exit(0); }

  fs.unlinkSync(snapshotPath(name));
  console.log(col('green', `✓ Deleted snapshot "${name}"`));
}

// snap show <name>
function cmdShow(name) {
  if (!name) { console.error(col('red', 'Usage: snap show <name>')); process.exit(1); }

  const snap = loadSnapshot(name);

  console.log(`\n${bold(snap.name)}`);
  console.log(dim(`  Created: ${formatDate(snap.timestamp)}`));
  if (snap.description) console.log(dim(`  Note:    ${snap.description}`));

  const totalSize = snap.files.reduce((a, f) => a + (f.size || 0), 0);
  console.log(dim(`  Files:   ${snap.files.length}  |  Total: ${formatBytes(totalSize)}`));
  console.log('');

  const colW = Math.max(4, ...snap.files.map(f => f.path.length));

  console.log([
    col('cyan', 'PATH'.padEnd(colW)),
    col('cyan', 'SIZE'.padEnd(8)),
    col('cyan', 'TYPE'),
  ].join('  '));
  console.log(dim('─'.repeat(colW + 20)));

  for (const file of snap.files.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log([
      file.path.padEnd(colW),
      formatBytes(file.size || 0).padEnd(8),
      file.binary ? col('yellow', 'binary') : dim('text'),
    ].join('  '));
  }
  console.log('');
}

// snap export <name> <file.tar>
function cmdExport(name, outFile) {
  if (!name || !outFile) {
    console.error(col('red', 'Usage: snap export <name> <file.tar>'));
    process.exit(1);
  }

  const snap = loadSnapshot(name);
  const outPath = path.resolve(process.cwd(), outFile);

  // Build a simple TAR archive (POSIX ustar format)
  const chunks = [];

  function padRight(str, len, char = '\0') {
    return str.padEnd(len, char).slice(0, len);
  }

  function writeEntry(filePath, content) {
    const buf = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);

    // name (100 bytes)
    header.write(padRight(filePath, 100), 0, 'utf8');
    // mode (8 bytes)
    header.write('0000644\0', 100, 'utf8');
    // uid, gid (8 bytes each)
    header.write('0000000\0', 108, 'utf8');
    header.write('0000000\0', 116, 'utf8');
    // size (12 bytes, octal)
    header.write(buf.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
    // mtime (12 bytes)
    header.write(Math.floor(snap.timestamp / 1000).toString(8).padStart(11, '0') + '\0', 136, 'utf8');
    // checksum placeholder
    header.write('        ', 148, 'utf8');
    // type flag
    header.write('0', 156, 'utf8');
    // magic
    header.write('ustar\0', 257, 'utf8');
    header.write('00', 263, 'utf8');

    // compute checksum
    let cksum = 0;
    for (let i = 0; i < 512; i++) cksum += header[i];
    header.write(cksum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');

    chunks.push(header);

    // file data + padding to 512-byte boundary
    chunks.push(buf);
    const pad = (512 - (buf.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }

  for (const file of snap.files) {
    if (file.binary || file.hash === null) continue;
    const content = snap.blobs[file.hash];
    if (content === undefined || content === null) continue;
    writeEntry(file.path, content);
  }

  // End-of-archive: two 512-byte zero blocks
  chunks.push(Buffer.alloc(1024, 0));

  const tar = Buffer.concat(chunks);
  fs.writeFileSync(outPath, tar);

  console.log(`${col('green', '✓')} Exported ${bold(name)} → ${outPath}`);
  console.log(dim(`  ${snap.files.filter(f => !f.binary).length} text files, ${formatBytes(tar.length)}`));
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${bold('code-snapshot')} ${dim(`v${VERSION}`)} — Named codebase snapshots. Diff before/after refactors.

${col('cyan', 'USAGE')}
  snap <command> [options]
  code-snapshot <command> [options]

${col('cyan', 'COMMANDS')}
  ${bold('save')} <name>                  Save a snapshot of the current directory
    ${dim('--include <glob>')}             Only include matching files
    ${dim('--exclude <glob>')}             Exclude matching files
    ${dim('--desc <text>')}                Add a description

  ${bold('list')}                          List all snapshots

  ${bold('diff')} <name1> [name2]          Diff two snapshots (or snapshot vs current)
    ${dim('--full')}                       Show line-by-line diff
    ${dim('--path <file>')}                Filter diff to a specific file

  ${bold('restore')} <name>               Restore snapshot to working directory
    ${dim('--path <file>')}                Restore only a specific file
    ${dim('--dry-run')}                    Preview without writing

  ${bold('delete')} <name>               Delete a snapshot

  ${bold('show')} <name>                  List files in a snapshot

  ${bold('export')} <name> <file.tar>     Export snapshot as tar archive

${col('cyan', 'EXAMPLES')}
  snap save before-refactor
  snap save api-v2 --include "src/**" --exclude "*.test.js" --desc "pre-migration"
  snap list
  snap diff before-refactor
  snap diff before-refactor after-refactor --full
  snap restore before-refactor --path src/api.js --dry-run
  snap export before-refactor backup.tar

${col('cyan', 'STORAGE')}
  Snapshots stored in ${bold('.snapshots/')} as compressed JSON (gzip).
  ${dim('Zero dependencies. Node 18+. MIT License.')}
`);
}

// ─── Argument Parser ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = [];
  const opts = {};
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i += 2;
      } else {
        opts[key] = true;
        i++;
      }
    } else {
      args.push(argv[i]);
      i++;
    }
  }
  return { args, opts };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  const raw = process.argv.slice(2);
  const { args, opts } = parseArgs(raw);
  const [cmd, ...rest] = args;

  if (!cmd || cmd === 'help' || opts.help || opts.h) {
    printHelp();
    return;
  }

  if (cmd === '--version' || cmd === '-v' || opts.version) {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case 'save':
      await cmdSave(rest[0], opts);
      break;
    case 'list':
    case 'ls':
      cmdList();
      break;
    case 'diff':
      cmdDiff(rest[0], rest[1], opts);
      break;
    case 'restore':
      await cmdRestore(rest[0], opts);
      break;
    case 'delete':
    case 'rm':
      await cmdDelete(rest[0]);
      break;
    case 'show':
      cmdShow(rest[0]);
      break;
    case 'export':
      cmdExport(rest[0], rest[1]);
      break;
    default:
      console.error(col('red', `Unknown command: ${cmd}`));
      console.error(dim('Run "snap help" for usage.'));
      process.exit(1);
  }
}

main().catch(err => {
  console.error(col('red', `Error: ${err.message}`));
  process.exit(1);
});
