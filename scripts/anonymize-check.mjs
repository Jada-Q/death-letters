#!/usr/bin/env node
// Anonymize check — pre-commit gate for letters/**/*.md
//
// Usage:
//   node scripts/anonymize-check.mjs <file1> <file2> ...   # explicit files
//   node scripts/anonymize-check.mjs --all                  # all letters
//   node scripts/anonymize-check.mjs --quiet <files>        # hook mode: silent on warn
//
// Exit codes:
//   0 — clean (warnings still printed unless --quiet)
//   1 — hit hard blacklist (commit blocked)
//   2 — checklist file missing or unreadable

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

const CHECKLIST_PATH = join(homedir(), '.death-letters-private', 'ANONYMIZE-CHECKLIST.md')

// Soft-warn patterns
const SOFT_PATTERNS = [
  { re: /\b\d+\s*岁/g, label: '年龄具体数字' },
  { re: /[0-9]{4}-[0-9]{2}-[0-9]{2}/g, label: '精确日期' },
  { re: /[一-龯]+(省|市|区|县|路|号|街道|镇|村)\b/g, label: '具体地点' },
]

const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const all = args.includes('--all')
const fileArgs = args.filter(a => !a.startsWith('--'))

// 1. Load checklist
if (!existsSync(CHECKLIST_PATH)) {
  console.error(`ERROR: checklist not found at ${CHECKLIST_PATH}`)
  console.error('Run: mkdir -p ~/.death-letters-private && touch the checklist file (see docs/2026-05-17-design.md §8)')
  process.exit(2)
}

const checklistRaw = readFileSync(CHECKLIST_PATH, 'utf8')
// Only lines starting with "- " are treated as blacklist entries.
// Everything else (# comments, prose, headers, empty lines) is ignored.
const blacklist = checklistRaw
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.startsWith('- '))
  .map(l => l.slice(2).trim())
  .filter(l => l.length > 0)
  .map(l => l.toLowerCase())

if (!quiet) {
  console.error(`Loaded ${blacklist.length} blacklist entries from ${CHECKLIST_PATH}`)
}

if (blacklist.length === 0) {
  console.error('WARN: checklist has 0 active entries. Fill in real names before W1 launch.')
  // Don't exit; allow scaffolding phase to commit
}

// 2. Collect files to check
let files = []
if (all) {
  const root = join(process.cwd(), 'letters')
  if (existsSync(root)) {
    walkMd(root, files)
  }
} else if (fileArgs.length > 0) {
  files = fileArgs
} else if (!quiet) {
  console.error('Usage: anonymize-check.mjs [--all|--quiet] [file1] [file2] ...')
  process.exit(0)
}

function walkMd(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkMd(full, acc)
    else if (entry.endsWith('.md') && !entry.startsWith('.')) acc.push(full)
  }
}

// 3. Scan each file
let hardHits = 0
let softHits = 0

for (const f of files) {
  if (!existsSync(f)) {
    if (!quiet) console.error(`SKIP (not found): ${f}`)
    continue
  }
  const content = readFileSync(f, 'utf8')
  const lower = content.toLowerCase()
  const lines = content.split('\n')
  const lowerLines = lower.split('\n')

  // hard blacklist
  for (const term of blacklist) {
    if (lower.includes(term)) {
      // find line number
      for (let i = 0; i < lowerLines.length; i++) {
        if (lowerLines[i].includes(term)) {
          console.error(`ERROR: ${relative(process.cwd(), f)}:${i + 1}: hit blacklist "${term}"`)
          hardHits++
          break
        }
      }
    }
  }

  // soft warn (skip in quiet mode)
  if (!quiet) {
    for (const { re, label } of SOFT_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].match(re)
        if (matches) {
          for (const m of matches) {
            console.error(`WARN:  ${relative(process.cwd(), f)}:${i + 1}: ${label} — "${m}"`)
            softHits++
          }
        }
      }
    }
  }
}

// 4. Exit
if (hardHits > 0) {
  console.error(`\n${hardHits} hard hit(s). Commit blocked.`)
  process.exit(1)
}

if (!quiet && softHits > 0) {
  console.error(`\n${softHits} soft warning(s). Commit allowed but review.`)
}

process.exit(0)
