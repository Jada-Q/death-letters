#!/usr/bin/env node
// Build static HTML site from letters/**/*.md → docs/ (GitHub Pages target).
//
// - Reads frontmatter (yaml subset: scalar key: value lines only)
// - Converts markdown body to HTML with minimal hand-rolled parser
//   (death-letter content uses only: h1/h2, paragraphs, em, strong, links, blockquote, hr, lists)
// - Outputs:
//     docs/index.html                          (4-quarter index)
//     docs/<quarter>/<NN>-<slug>.html          (per-letter page)
//     docs/style.css                           (editorial serif minimal)
//     docs/.nojekyll                           (disable Jekyll on GH Pages)
//
// Usage:
//   node scripts/build-site.mjs          # build once
//   node scripts/build-site.mjs --serve  # build + python http.server on :3030

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = join(homedir(), 'Desktop', 'Projects', 'death-letters')
const SRC = join(ROOT, 'letters')
const OUT = join(ROOT, 'docs')

const QUARTERS = [
  { id: 'q1-accident',   label: 'Q1 — 死于意外' },
  { id: 'q2-choice',     label: 'Q2 — 死于选择' },
  { id: 'q3-oblivion',   label: 'Q3 — 死于遗忘' },
  { id: 'q4-completion', label: 'Q4 — 死于完成' },
]

// ── Markdown parser (minimal, hand-rolled, scoped to letter content) ──────

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s) {
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  // bold **x**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // italic *x* or _x_  (avoid matching inside words)
  s = s.replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$|[，。！？、；：])/g, '$1<em>$2</em>')
  s = s.replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$|[，。！？、；：])/g, '$1<em>$2</em>')
  return s
}

function mdToHtml(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  let inBlockquote = false
  let inList = false
  let paragraph = []

  function flushParagraph() {
    if (paragraph.length) {
      out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`)
      paragraph = []
    }
  }
  function closeList() {
    if (inList) { out.push('</ul>'); inList = false }
  }
  function closeBq() {
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      closeList()
      closeBq()
    } else if (trimmed === '---' || trimmed === '***') {
      flushParagraph(); closeList(); closeBq()
      out.push('<hr>')
    } else if (trimmed.startsWith('# ')) {
      flushParagraph(); closeList(); closeBq()
      out.push(`<h1>${inline(escapeHtml(trimmed.slice(2)))}</h1>`)
    } else if (trimmed.startsWith('## ')) {
      flushParagraph(); closeList(); closeBq()
      out.push(`<h2>${inline(escapeHtml(trimmed.slice(3)))}</h2>`)
    } else if (trimmed.startsWith('> ')) {
      flushParagraph(); closeList()
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push(`<p>${inline(escapeHtml(trimmed.slice(2)))}</p>`)
    } else if (trimmed.startsWith('- ')) {
      flushParagraph(); closeBq()
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(escapeHtml(trimmed.slice(2)))}</li>`)
    } else {
      closeList(); closeBq()
      paragraph.push(trimmed)
    }
    i++
  }
  flushParagraph(); closeList(); closeBq()
  return out.join('\n')
}

// ── Frontmatter parser (yaml scalar subset) ───────────────────────────────

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { fm: {}, body: raw }
  const fm = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) continue
    let val = kv[2].trim()
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    fm[kv[1]] = val
  }
  return { fm, body: m[2].trim() }
}

// ── Collect letters ───────────────────────────────────────────────────────

function collectLetters() {
  const all = []
  for (const q of QUARTERS) {
    const dir = join(SRC, q.id)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('.')) continue
      const fullPath = join(dir, f)
      const raw = readFileSync(fullPath, 'utf8')
      const { fm, body } = parseFrontmatter(raw)
      all.push({ quarter: q.id, quarterLabel: q.label, filename: f, fm, body })
    }
  }
  // sort by week ascending
  all.sort((a, b) => (parseInt(a.fm.week || '0') - parseInt(b.fm.week || '0')))
  return all
}

// ── Templates ─────────────────────────────────────────────────────────────

function pageWrap({ title, bodyClass, stylesheet, inner }) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Long+Cang&family=Indie+Flower&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body class="${bodyClass}">
${inner}
</body>
</html>
`
}

function letterPage(letter) {
  const bodyHtml = mdToHtml(letter.body)
  const title = letter.fm.slug ? letter.fm.slug.replace(/-/g, ' ') : 'untitled'
  const inner = `<article>
<a href="../index.html" class="back">← all letters</a>
<header>
<p class="meta">W${escapeHtml(letter.fm.week || '?')} · ${escapeHtml(letter.fm.date || '')} · ${escapeHtml(letter.quarterLabel)}</p>
</header>
${bodyHtml}
<footer class="signature-meta">
${letter.fm.death_mode ? `<p><span class="label">死法</span>${escapeHtml(letter.fm.death_mode)}</p>` : ''}
${letter.fm.childhood_anchor ? `<p><span class="label">童年</span>${escapeHtml(letter.fm.childhood_anchor)}</p>` : ''}
</footer>
</article>`
  return pageWrap({ title: `${title} — Death Letters`, bodyClass: 'letter-page', stylesheet: '../style.css', inner })
}

function indexPage(letters) {
  const byQuarter = {}
  for (const q of QUARTERS) byQuarter[q.id] = []
  for (const l of letters) byQuarter[l.quarter].push(l)

  const sections = QUARTERS.map(q => {
    const items = byQuarter[q.id]
    if (items.length === 0) {
      return `<section class="quarter empty">
<h2>${escapeHtml(q.label)}</h2>
<p class="empty-note">等待 W${q.id === 'q1-accident' ? '1-13' : q.id === 'q2-choice' ? '14-26' : q.id === 'q3-oblivion' ? '27-39' : '40-52'} 的信件</p>
</section>`
    }
    const lis = items.map(l => {
      const slug = l.fm.slug || l.filename.replace(/\.md$/, '')
      const titleFromBody = (l.body.match(/^#\s+(.+)$/m) || [, slug.replace(/-/g, ' ')])[1]
      return `<li><a href="${l.quarter}/${l.filename.replace(/\.md$/, '.html')}"><span class="w">W${escapeHtml(l.fm.week || '?')}</span> · ${escapeHtml(titleFromBody)}</a></li>`
    }).join('\n')
    return `<section class="quarter">
<h2>${escapeHtml(q.label)}</h2>
<ul>
${lis}
</ul>
</section>`
  }).join('\n')

  const inner = `<header>
<h1>Death Letters</h1>
<p class="tagline">52 周公开文学。"今晚我可能死去"的我，写给"5 岁的真实我"的信。</p>
<p class="start">W1 起跑：2026-05-24</p>
</header>
<main>
${sections}
</main>
<footer class="site-footer">
<p>source: <a href="https://github.com/Jada-Q/death-letters">github.com/Jada-Q/death-letters</a></p>
</footer>`
  return pageWrap({ title: 'Death Letters', bodyClass: 'index-page', stylesheet: 'style.css', inner })
}

// ── CSS ───────────────────────────────────────────────────────────────────

const CSS = `:root {
  --paper: #e8dcb8;
  --paper-tint: rgba(120, 90, 40, 0.04);
  --ink: #3d2817;
  --ink-soft: #5a4226;
  --meta: #8a6f45;
  --rule: #b29867;
  --accent: #8b2c1a;
  --hand: 'Long Cang', cursive;
  --hand-sig-en: 'Indie Flower', cursive;
  --serif: 'Source Han Serif SC', 'Songti SC', 'Noto Serif CJK SC', 'Crimson Text', Georgia, serif;
}

* { box-sizing: border-box; }

body {
  font-family: var(--serif);
  background:
    radial-gradient(circle at 80% 10%, var(--paper-tint) 0%, transparent 40%),
    radial-gradient(circle at 10% 90%, var(--paper-tint) 0%, transparent 50%),
    var(--paper);
  color: var(--ink);
  max-width: 36em;
  margin: 0 auto;
  padding: 5rem 2.5rem 6rem;
  font-size: 17px;
  line-height: 1.95;
}

a { color: var(--ink); }
a:hover { opacity: 0.65; }

.back {
  color: var(--meta);
  text-decoration: none;
  font-size: 12px;
  letter-spacing: 0.15em;
  font-style: italic;
  display: inline-block;
  margin-bottom: 3rem;
}

.meta {
  color: var(--meta);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin: 0 0 0.5rem;
  font-style: italic;
}

/* ── Letter page ──────────────────────────────────────────────────────── */

.letter-page h1 {
  font-family: var(--hand);
  font-weight: 400;
  font-size: 3.4rem;
  margin: 0 0 0.5rem;
  line-height: 1.15;
  color: var(--ink);
  letter-spacing: 0.05em;
}

.letter-page h1::after {
  content: '·';
  display: block;
  text-align: center;
  color: var(--accent);
  font-size: 1.2rem;
  margin: 1rem 0 2.5rem;
  letter-spacing: 0.5em;
}

/* 首段「亲爱的 5 岁的我，」用手写体 */
.letter-page article p:nth-of-type(1) {
  font-family: var(--hand);
  font-size: 1.8rem;
  color: var(--ink-soft);
  margin: 0 0 2rem;
  padding-left: 1.5em;
  line-height: 1.5;
}

.letter-page article p { margin: 1.4rem 0; }

/* signature 行：末段（含 "—— 即将死去的我，W01"） */
.letter-page article p:last-of-type {
  font-family: var(--hand);
  font-size: 1.8rem;
  text-align: right;
  margin-top: 4rem;
  padding-right: 0.5em;
  color: var(--ink);
  line-height: 1.4;
}

article blockquote {
  margin: 1.5rem 0;
  padding-left: 1.5rem;
  border-left: 2px solid var(--rule);
  color: var(--ink-soft);
  font-style: italic;
}

article hr {
  border: none;
  border-top: 1px solid var(--rule);
  margin: 2.5rem 0;
}

.signature-meta {
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px dashed var(--rule);
  font-size: 12px;
  color: var(--meta);
  font-style: italic;
  font-family: var(--serif);
}

.signature-meta p { margin: 0.3rem 0; }

.signature-meta .label {
  display: inline-block;
  min-width: 3em;
  margin-right: 0.6em;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  font-size: 10px;
  vertical-align: 0.1em;
  font-style: normal;
  font-family: var(--serif);
}

/* ── Index page ────────────────────────────────────────────────────────── */

.index-page h1 {
  font-family: var(--hand);
  font-weight: 400;
  font-size: 3.4rem;
  margin: 0 0 0.5rem;
  line-height: 1.2;
  color: var(--ink);
  letter-spacing: 0.05em;
}

.tagline {
  color: var(--ink-soft);
  margin: 0.5rem 0 0.3rem;
  font-style: italic;
  font-size: 15px;
}

.start {
  color: var(--meta);
  font-size: 12px;
  margin: 0 0 3rem;
  letter-spacing: 0.15em;
  font-style: italic;
  text-transform: uppercase;
}

.quarter {
  margin: 0 0 2.5rem;
}

.quarter h2 {
  font-family: var(--hand);
  font-size: 1.6rem;
  font-weight: 400;
  margin: 0 0 1rem;
  color: var(--ink);
  letter-spacing: 0.03em;
}

.quarter ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.quarter li {
  margin: 0.5rem 0;
  font-size: 16px;
}

.quarter li a {
  text-decoration: none;
  color: var(--ink);
}

.quarter li a:hover {
  color: var(--accent);
}

.quarter .w {
  color: var(--meta);
  font-size: 12px;
  display: inline-block;
  min-width: 3.2em;
  letter-spacing: 0.1em;
  font-style: italic;
}

.quarter.empty .empty-note {
  color: var(--meta);
  font-style: italic;
  font-size: 14px;
  margin: 0;
}

.site-footer {
  margin-top: 5rem;
  padding-top: 2rem;
  border-top: 1px dashed var(--rule);
  font-size: 12px;
  color: var(--meta);
  text-align: center;
  font-style: italic;
}

.site-footer a { color: var(--meta); }
`

// ── Main ──────────────────────────────────────────────────────────────────

function build() {
  // Clean docs/ but preserve .git etc — just rm what we generate
  if (existsSync(OUT)) {
    for (const f of readdirSync(OUT)) {
      const p = join(OUT, f)
      if (f.startsWith('.')) continue  // keep .nojekyll
      rmSync(p, { recursive: true, force: true })
    }
  } else {
    mkdirSync(OUT, { recursive: true })
  }

  // .nojekyll (disable Jekyll on GitHub Pages)
  writeFileSync(join(OUT, '.nojekyll'), '')

  // style.css
  writeFileSync(join(OUT, 'style.css'), CSS)

  const letters = collectLetters()

  // index.html
  writeFileSync(join(OUT, 'index.html'), indexPage(letters))

  // per-letter pages
  for (const l of letters) {
    const qDir = join(OUT, l.quarter)
    mkdirSync(qDir, { recursive: true })
    const outFile = join(qDir, l.filename.replace(/\.md$/, '.html'))
    writeFileSync(outFile, letterPage(l))
  }

  console.error(`✓ Built ${letters.length} letter page${letters.length === 1 ? '' : 's'} + index → docs/`)
  if (letters.length === 0) {
    console.error('  (letters/ is empty — index shows "waiting for W1" placeholders)')
  }
}

build()

if (process.argv.includes('--serve')) {
  console.error('\nServing docs/ on http://localhost:3030  (Ctrl+C to stop)')
  spawn('python3', ['-m', 'http.server', '3030', '--directory', OUT], { stdio: 'inherit' })
}
