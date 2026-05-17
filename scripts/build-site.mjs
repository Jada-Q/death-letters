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
  { id: 'q1-accident',   label: 'Q. I 死于意外',   sub: 'death by accident',   start: 1,  end: 13 },
  { id: 'q2-choice',     label: 'Q. II 死于选择',  sub: 'death by choice',     start: 14, end: 26 },
  { id: 'q3-oblivion',   label: 'Q. III 死于遗忘', sub: 'death by oblivion',   start: 27, end: 39 },
  { id: 'q4-completion', label: 'Q. IV 死于完成',  sub: 'death by completion', start: 40, end: 52 },
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Spectral:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body class="${bodyClass}">
${inner}
</body>
</html>
`
}

function letterPage(letter) {
  // Extract title from first h1 in body; strip that h1 from body before rendering
  const titleMatch = letter.body.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : (letter.fm.slug || 'untitled').replace(/-/g, ' ')
  const bodyMd = letter.body.replace(/^#\s+.+$/m, '').trim()
  const bodyHtml = mdToHtml(bodyMd)
  const numStr = String(letter.fm.week ?? 0).padStart(2, '0')
  const quarterSub = (QUARTERS.find(q => q.id === letter.quarter) || {}).sub || ''
  const inner = `<article>
<a href="../index.html" class="back">← all letters</a>
<header class="letter-header">
<p class="number">no. ${numStr}</p>
<h1>${escapeHtml(title)}</h1>
<hr class="hairline">
<p class="meta-line">${escapeHtml(letter.quarterLabel)} · ${escapeHtml(quarterSub)} · ${escapeHtml(letter.fm.date || '')}</p>
</header>
${bodyHtml}
<footer class="signature-meta">
${letter.fm.death_mode ? `<p><span class="label">death</span>${escapeHtml(letter.fm.death_mode)}</p>` : ''}
${letter.fm.childhood_anchor ? `<p><span class="label">anchor</span>${escapeHtml(letter.fm.childhood_anchor)}</p>` : ''}
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
    const sub = `<p class="quarter-sub">${escapeHtml(q.sub)} · weeks ${q.start}–${q.end}</p>`
    if (items.length === 0) {
      return `<section class="quarter empty">
<h2>${escapeHtml(q.label)}</h2>
${sub}
<p class="empty-note">to come</p>
</section>`
    }
    const lis = items.map(l => {
      const slug = l.fm.slug || l.filename.replace(/\.md$/, '')
      const titleFromBody = (l.body.match(/^#\s+(.+)$/m) || [, slug.replace(/-/g, ' ')])[1]
      const numStr = String(l.fm.week ?? 0).padStart(2, '0')
      const href = `${l.quarter}/${l.filename.replace(/\.md$/, '.html')}`
      return `<li><a href="${href}">
<span class="num">no. ${numStr}</span>
<span class="title">${escapeHtml(titleFromBody)}</span>
<span class="leader"></span>
<span class="date">${escapeHtml(l.fm.date || '')}</span>
</a></li>`
    }).join('\n')
    return `<section class="quarter">
<h2>${escapeHtml(q.label)}</h2>
${sub}
<ul>
${lis}
</ul>
</section>`
  }).join('\n')

  const inner = `<header>
<h1>Death Letters</h1>
<p class="tagline">52 周公开文学。"今晚我可能死去"的我，写给"5 岁的真实我"的信。</p>
<p class="start">begins · 2026 / 05 / 24</p>
</header>
<main>
${sections}
</main>
<footer class="site-footer">
<p>source · <a href="https://github.com/Jada-Q/death-letters">github.com/Jada-Q/death-letters</a></p>
</footer>`
  return pageWrap({ title: 'Death Letters', bodyClass: 'index-page', stylesheet: 'style.css', inner })
}

// ── CSS ───────────────────────────────────────────────────────────────────

const CSS = `:root {
  --paper: #f5f0e2;
  --ink: #1a1a1a;
  --ink-soft: #3a3a3a;
  --meta: #797569;
  --rule: #cfc5b0;
  --accent: #a8281d;
  --display: 'Cormorant Garamond', 'Source Han Serif SC', 'Songti SC', 'Noto Serif CJK SC', serif;
  --body: 'Spectral', 'Source Han Serif SC', 'Songti SC', 'Noto Serif CJK SC', Georgia, serif;
}

* { box-sizing: border-box; }

::selection { background: var(--accent); color: var(--paper); }

body {
  font-family: var(--body);
  font-weight: 400;
  background: var(--paper);
  color: var(--ink);
  max-width: 38em;
  margin: 0 auto;
  padding: 5rem 2rem 7rem;
  font-size: 17px;
  line-height: 1.78;
  font-feature-settings: "kern", "liga", "calt";
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
  text-decoration-color: var(--rule);
  transition: text-decoration-color 0.2s ease;
}
a:hover { text-decoration-color: var(--accent); }

.back {
  font-family: var(--display);
  font-style: italic;
  color: var(--meta);
  text-decoration: none;
  font-size: 14px;
  letter-spacing: 0.05em;
  display: inline-block;
  margin-bottom: 4.5rem;
}
.back:hover { color: var(--accent); }

/* ── Letter page ──────────────────────────────────────────────────────── */

.letter-header {
  text-align: center;
  margin-bottom: 3.5rem;
}

.letter-page .number {
  font-family: var(--display);
  font-style: italic;
  font-weight: 400;
  font-size: 0.95rem;
  color: var(--meta);
  letter-spacing: 0.25em;
  text-transform: lowercase;
  margin: 0 0 1.8rem;
}

.letter-page h1 {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  font-size: 2.8rem;
  letter-spacing: 0;
  color: var(--ink);
  margin: 0 0 1.5rem;
  line-height: 1.18;
}

.letter-page .hairline {
  display: block;
  width: 3.5em;
  height: 0;
  margin: 0 auto 1.5rem;
  border: 0;
  border-top: 1px solid var(--ink);
}

.letter-page .meta-line {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.85rem;
  color: var(--meta);
  letter-spacing: 0.1em;
  margin: 0;
  text-transform: lowercase;
}

.letter-page article p {
  margin: 1.3rem 0;
  text-align: left;
}

/* opening line ("亲爱的 5 岁的我，") — emphasis */
.letter-page article p:nth-of-type(1) {
  font-weight: 500;
  margin-top: 0;
  letter-spacing: 0.02em;
}

/* signature 末段 — italic, right-aligned, smaller */
.letter-page article p:last-of-type {
  font-family: var(--display);
  font-style: italic;
  font-weight: 400;
  text-align: right;
  font-size: 1.05rem;
  color: var(--ink-soft);
  margin: 3rem 0 0;
  letter-spacing: 0.02em;
}

article blockquote {
  margin: 1.5rem 1.5rem;
  font-style: italic;
  color: var(--ink-soft);
  font-family: var(--display);
  font-size: 1.05rem;
}

article hr {
  border: none;
  width: 3em;
  height: 0;
  margin: 2.5rem auto;
  border-top: 1px solid var(--rule);
}

.signature-meta {
  margin-top: 5rem;
  padding-top: 1.8rem;
  border-top: 1px solid var(--rule);
  font-family: var(--display);
  font-style: italic;
  font-weight: 400;
  font-size: 13px;
  color: var(--meta);
  text-align: center;
  letter-spacing: 0.02em;
}

.signature-meta p { margin: 0.5rem 0; }

.signature-meta .label {
  font-style: normal;
  font-variant: small-caps;
  letter-spacing: 0.2em;
  margin-right: 0.6em;
  font-size: 10px;
  color: var(--ink-soft);
}

/* ── Index page ────────────────────────────────────────────────────────── */

.index-page header {
  text-align: center;
  margin-bottom: 5rem;
}

.index-page h1 {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  font-size: 4rem;
  letter-spacing: 0;
  color: var(--ink);
  margin: 0 0 0.8rem;
  line-height: 1.1;
}

.tagline {
  font-family: var(--body);
  color: var(--ink-soft);
  font-size: 14px;
  font-style: italic;
  margin: 0 auto 1.2rem;
  max-width: 28em;
  line-height: 1.5;
}

.start {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 0.35em;
  margin: 0;
  text-transform: uppercase;
}

.quarter {
  margin: 0 0 3.5rem;
}

.quarter h2 {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.6rem;
  color: var(--ink);
  margin: 0 0 0.3rem;
  letter-spacing: 0.01em;
}

.quarter-sub {
  font-family: var(--display);
  font-style: italic;
  font-size: 13px;
  color: var(--meta);
  letter-spacing: 0.05em;
  margin: 0 0 1.4rem;
  text-transform: lowercase;
}

.quarter ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.quarter li {
  margin: 0.65rem 0;
  font-size: 16px;
}

.quarter li a {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  text-decoration: none;
  color: var(--ink);
}

.quarter li .num {
  font-family: var(--display);
  font-style: italic;
  color: var(--meta);
  font-size: 13px;
  letter-spacing: 0.1em;
  flex-shrink: 0;
  width: 4em;
  text-transform: lowercase;
}

.quarter li .title {
  color: var(--ink);
  flex-shrink: 0;
}

.quarter li .leader {
  flex: 1;
  min-width: 1em;
  border-bottom: 1px dotted var(--rule);
  transform: translateY(-0.25em);
  margin: 0 0.4em;
}

.quarter li .date {
  font-family: var(--display);
  font-style: italic;
  color: var(--meta);
  font-size: 13px;
  flex-shrink: 0;
}

.quarter li a:hover .title { color: var(--accent); }
.quarter li a:hover .leader { border-bottom-color: var(--accent); }

.quarter.empty .empty-note {
  font-family: var(--display);
  font-style: italic;
  color: var(--meta);
  font-size: 14px;
  letter-spacing: 0.05em;
  margin: 0;
}

.site-footer {
  margin-top: 6rem;
  padding-top: 2rem;
  border-top: 1px solid var(--rule);
  font-family: var(--display);
  font-style: italic;
  font-size: 12px;
  color: var(--meta);
  text-align: center;
  letter-spacing: 0.05em;
}

.site-footer a { color: var(--meta); }
.site-footer a:hover { color: var(--accent); }
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
