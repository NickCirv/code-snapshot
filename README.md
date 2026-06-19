<div align="center">

# code-snapshot

**Named codebase checkpoints — save, diff, and restore before risky refactors**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-green?labelColor=0B0A09)](package.json)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/code-snapshot save before-refactor
```

Or install the `snap` alias globally:

```bash
npm install -g github:NickCirv/code-snapshot
snap save before-refactor
```

## Usage

```bash
# Save a checkpoint before a risky change
snap save before-auth-overhaul --desc "working login"

# See what changed
snap diff before-auth-overhaul --full

# Restore a single file if something goes wrong
snap restore before-auth-overhaul --path src/auth/session.js

# Compare two named states
snap diff before-auth-overhaul after-auth-overhaul
```

| Command | Description |
|---|---|
| `snap save <name>` | Save snapshot of current directory |
| `snap save <name> --include "src/**"` | Snapshot matching files only |
| `snap save <name> --exclude "*.test.js"` | Exclude matching files |
| `snap save <name> --desc "text"` | Add a description |
| `snap list` | Table of all snapshots with size and age |
| `snap diff <name>` | Diff snapshot vs current working directory |
| `snap diff <name1> <name2>` | Diff two named snapshots |
| `snap diff <name> --full` | Show line-by-line diffs |
| `snap diff <name> --path src/api.js` | Diff a single file |
| `snap restore <name>` | Restore all files from a snapshot |
| `snap restore <name> --path src/api.js` | Restore a single file |
| `snap restore <name> --dry-run` | Preview restore without writing |
| `snap show <name>` | List all files in a snapshot with sizes |
| `snap delete <name>` | Remove a snapshot |
| `snap export <name> backup.tar` | Export snapshot as a tar archive |

## What it does

`code-snapshot` saves named, gzip-compressed checkpoints of your working directory into `.snapshots/`. Each snapshot is content-addressable (SHA256 deduplication), gitignore-aware, and fully self-contained — no git history, no staging area, no commits required.

It fills a gap `git stash` doesn't cover: named before/after comparisons you can inspect, diff line-by-line, or partially restore at any time, even outside a git repo.

Snapshots are stored as `.snap.gz` files and can be committed for team-shared checkpoints or kept local via `.gitignore`.

---

<sub>Zero dependencies · Node >=18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
