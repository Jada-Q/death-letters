#!/usr/bin/env node
// Copy a letter markdown to macOS clipboard for paste-to-Substack.
//
// Usage:
//   node scripts/publish-helper.mjs --latest
//   node scripts/publish-helper.mjs <slug>
//   node scripts/publish-helper.mjs --week 5
//   node scripts/publish-helper.mjs --strip-frontmatter   # remove frontmatter before copy

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const PROJECT_ROOT = join(homedir(), 'Desktop', 'Projects', 'death-letters')
const LETTERS_DIR = join(PROJECT_ROOT, 'letters')
const QUARTERS = ['q1-accident', 'q2-choice', 'q3-oblivion', 'q4-completion']

function parseArgs(argv) {
  const a = { latest: false, slug: null, week: null, strip: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--latest') a.latest = true
    else if (argv[i] === '--week') a.week = parseInt(argv[++i], 10)
    else if (argv[i] === '--strip-frontmatter') a.strip = true
    else if (!argv[i].startsWith('--')) a.slug = argv[i]
  }
  return a
}

function allLetters() {
  const out = []
  for (const q of QUARTERS) {
    const dir = join(LETTERS_DIR, q)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('.')) continue
      const full = join(dir, f)
      out.push({ path: full, quarter: q, name: f, mtime: statSync(full).mtimeMs })
    }
  }
  return out
}

function findBy({ slug, week, latest }) {
  const letters = allLetters()
  if (letters.length === 0) {
    console.error('No letters found in letters/. Write one with: node scripts/dialogue.mjs')
    process.exit(1)
  }
  if (latest) {
    letters.sort((a, b) => b.mtime - a.mtime)
    return letters[0]
  }
  if (slug) {
    const found = letters.find(l => l.name.includes(slug))
    if (!found) {
      console.error(`No letter matched slug "${slug}". Available:`)
      letters.forEach(l => console.error(`  ${l.path}`))
      process.exit(1)
    }
    return found
  }
  if (week !== null) {
    // read frontmatter to match week
    for (const l of letters) {
      const raw = readFileSync(l.path, 'utf8')
      const m = raw.match(/^week:\s*(\d+)/m)
      if (m && parseInt(m[1], 10) === week) return l
    }
    console.error(`No letter found for week ${week}.`)
    process.exit(1)
  }
  console.error('Specify --latest, <slug>, or --week N.')
  process.exit(2)
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n+/, '')
}

const args = parseArgs(process.argv.slice(2))
const letter = findBy(args)
let content = readFileSync(letter.path, 'utf8')
if (args.strip) content = stripFrontmatter(content)

// pbcopy
const r = spawnSync('pbcopy', [], { input: content })
if (r.status !== 0) {
  console.error('pbcopy failed. Are you on macOS?')
  process.exit(3)
}

console.error(`✓ Copied to clipboard: ${letter.path}`)
console.error(`  ${content.length} chars · frontmatter ${args.strip ? 'stripped' : 'included (check before paste)'}`)
console.error(`\nNext:`)
console.error(`  open https://substack.com/inbox → New post → ⌘V`)
console.error(`  If frontmatter slipped into Substack body, delete the --- block manually.`)
