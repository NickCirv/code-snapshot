# code-snapshot

> Named snapshots of your codebase. Diff and restore. Zero dependencies.

Take named checkpoints of your codebase before risky changes — then diff, restore, or export them. Like `git stash` but for named before/after comparisons you can inspect at any time.

## Install

```bash
# Run directly (no install needed)
npx code-snapshot save before-refactor

# Or install globally
npm install -g code-snapshot
snap save before-refactor
```

## Quick Start

```
$ snap save before-refactor
  Scanning 47 files found.
  ✓ Snapshot before-refactor saved
    Files:  47
    Size:   128.3KB

  [ refactor your code... ]

$ snap diff before-refactor
  Diff: before-refactor → current working directory

  ~ 3 modified
    ~ src/api.js (+2.1KB)
    ~ src/utils/parser.js (-400B)
    ~ src/index.js (+64B)

  44 files unchanged

$ snap restore before-refactor --path src/api.js
  Restore: before-refactor → current directory
  Restore 1 file(s) from "before-refactor"? [y/N] y
  ✓ src/api.js
  ✓ Restored 1 files
```

## Commands

| Command | Description |
|---|---|
| `snap save <name>` | Save snapshot of current directory |
| `snap save <name> --include "src/**"` | Only snapshot matching files |
| `snap save <name> --exclude "*.test.js"` | Exclude matching files |
| `snap save <name> --desc "before migration"` | Add a description |
| `snap list` | Table of all snapshots with size and age |
| `snap diff <name>` | Diff snapshot vs current working directory |
| `snap diff <name1> <name2>` | Diff two named snapshots |
| `snap diff <name> --full` | Show line-by-line diffs (like `git diff`) |
| `snap diff <name> --path src/api.js` | Diff a single file |
| `snap restore <name>` | Restore all files from snapshot |
| `snap restore <name> --path src/api.js` | Restore a single file |
| `snap restore <name> --dry-run` | Preview restore without writing |
| `snap show <name>` | List all files in a snapshot with sizes |
| `snap delete <name>` | Remove a snapshot |
| `snap export <name> backup.tar` | Export snapshot as tar archive |

## Features

- **Gitignore-aware** — respects `.gitignore` patterns automatically
- **Content-addressable** — identical files stored once (SHA256 deduplication)
- **Compressed** — snapshots stored as gzip-compressed JSON in `.snapshots/`
- **Progress bar** — visual feedback for large codebases
- **ANSI colors** — clean, readable output
- **File restore** — restore entire snapshot or individual files
- **TAR export** — portable archive for sharing or backup

## Storage

Snapshots are stored in `.snapshots/` in your project directory as `.snap.gz` files (gzip-compressed JSON).

Each snapshot contains:
```json
{
  "name": "before-refactor",
  "timestamp": 1709500000000,
  "description": "pre-migration checkpoint",
  "files": [{ "path": "src/api.js", "hash": "sha256...", "size": 4200 }],
  "blobs": { "sha256...": "file content here" }
}
```

Add `.snapshots/` to your `.gitignore` if you don't want to commit snapshots, or commit them for team-shared checkpoints.

## Why?

`git stash` is great but it's tied to git state. Sometimes you want to:

- Save a checkpoint before a risky refactor without making a commit
- Compare two named states of your codebase (not just HEAD vs stash)
- Restore a single file from a checkpoint without resetting everything
- Share a before/after snapshot with a teammate
- Work outside a git repo entirely

`code-snapshot` fills that gap — named, portable, diffable checkpoints with zero setup.

## Examples

```bash
# Before a big refactor
snap save before-auth-overhaul --desc "working login system"

# Do your refactor...

# See what changed
snap diff before-auth-overhaul --full

# Oops, just restore one file
snap restore before-auth-overhaul --path src/auth/session.js

# Save the after state too
snap save after-auth-overhaul

# Compare the two
snap diff before-auth-overhaul after-auth-overhaul

# Archive for posterity
snap export before-auth-overhaul checkpoints/auth-v1.tar
```

---

Built with Node.js · Zero dependencies · MIT License
