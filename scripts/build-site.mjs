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
  { id: 'q1-accident',   label: 'Q. I 死于意外',   sub: 'death by accident',   start: 1,  end: 13, color: '#d96a7a', icon: 'star' },
  { id: 'q2-choice',     label: 'Q. II 死于选择',  sub: 'death by choice',     start: 14, end: 26, color: '#6ba8c4', icon: 'arrow' },
  { id: 'q3-oblivion',   label: 'Q. III 死于遗忘', sub: 'death by oblivion',   start: 27, end: 39, color: '#c79e3a', icon: 'cloud' },
  { id: 'q4-completion', label: 'Q. IV 死于完成',  sub: 'death by completion', start: 40, end: 52, color: '#7aa86a', icon: 'house' },
]

const ICONS = {
  star:  `<svg class="q-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L14 9 L20 9 L15 13 L17 19 L12 15.5 L7 19 L9 13 L4 9 L10 9 Z" transform="rotate(-3 12 12)"/></svg>`,
  arrow: `<svg class="q-icon" viewBox="0 0 24 24" width="24" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13 Q 8 8 13 12 T 21 11"/><path d="M17 7 L 21 11 L 17 15"/></svg>`,
  cloud: `<svg class="q-icon" viewBox="0 0 28 18" width="26" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14 Q 2 14 2 10 Q 2 7 5 7 Q 5 3 9 3 Q 13 3 14 6 Q 18 5 20 8 Q 25 8 25 12 Q 25 14 22 14 Z"/></svg>`,
  house: `<svg class="q-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 L12 4 L20 11"/><path d="M6 10 L6 19 L18 19 L18 10"/><path d="M10 19 L10 14 L14 14 L14 19"/></svg>`,
  heart: `<svg class="deco-heart" viewBox="0 0 24 22" width="20" height="18" fill="currentColor"><path d="M12 21 C 3 14 3 6 8 4 C 10 3 11 4 12 6 C 13 4 14 3 16 4 C 21 6 21 14 12 21 Z" opacity="0.85"/></svg>`,
  butterfly: `<svg class="deco-fly" viewBox="0 0 32 24" width="34" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 12 Q 12 3 6 4 Q 2 6 4 12 Q 2 18 6 20 Q 12 21 16 12"/><path d="M16 12 Q 20 3 26 4 Q 30 6 28 12 Q 30 18 26 20 Q 20 21 16 12"/><line x1="16" y1="6" x2="16" y2="20"/></svg>`,
  postmark: `<svg class="deco-stamp" viewBox="0 0 60 30" width="60" height="30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="30" cy="15" rx="26" ry="12" stroke-dasharray="3 3"/><text x="30" y="13" font-size="7" font-family="serif" text-anchor="middle" fill="currentColor" stroke="none">死亡邮筒</text><text x="30" y="22" font-size="5" font-family="serif" text-anchor="middle" fill="currentColor" stroke="none">DEATH POST</text></svg>`,
}

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
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&family=Long+Cang&family=Spectral:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body class="${bodyClass}">
${inner}
</body>
</html>
`
}

function letterPage(letter) {
  const titleMatch = letter.body.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : (letter.fm.slug || 'untitled').replace(/-/g, ' ')
  const bodyMd = letter.body.replace(/^#\s+.+$/m, '').trim()
  const bodyHtml = mdToHtml(bodyMd)
  const numStr = String(letter.fm.week ?? 0).padStart(2, '0')
  const q = QUARTERS.find(qq => qq.id === letter.quarter) || {}
  const quarterSub = q.sub || ''
  const quarterColor = q.color || 'var(--accent)'
  const quarterIcon = ICONS[q.icon] || ''
  const inner = `<article style="--q-color: ${quarterColor};">
<a href="../index.html" class="back">← all letters</a>
<header class="letter-header">
<p class="number">no. ${numStr} <span class="q-tag">${quarterIcon}</span></p>
<h1>${escapeHtml(title)}</h1>
<hr class="hairline">
<p class="meta-line">${escapeHtml(letter.quarterLabel)} · ${escapeHtml(quarterSub)} · ${escapeHtml(letter.fm.date || '')}</p>
</header>
${bodyHtml}
<div class="deco-divider">${ICONS.heart}</div>
<footer class="signature-meta">
${letter.fm.death_mode ? `<p><span class="label">death</span>${escapeHtml(letter.fm.death_mode)}</p>` : ''}
${letter.fm.childhood_anchor ? `<p><span class="label">anchor</span>${escapeHtml(letter.fm.childhood_anchor)}</p>` : ''}
<div class="postmark">${ICONS.postmark}</div>
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
    const icon = ICONS[q.icon] || ''
    const sub = `<p class="quarter-sub">${escapeHtml(q.sub)} · weeks ${q.start}–${q.end}</p>`
    if (items.length === 0) {
      return `<section class="quarter empty" style="--q-color: ${q.color};">
<h2><span class="q-icon-wrap">${icon}</span>${escapeHtml(q.label)}</h2>
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
    return `<section class="quarter" style="--q-color: ${q.color};">
<h2><span class="q-icon-wrap">${icon}</span>${escapeHtml(q.label)}</h2>
${sub}
<ul>
${lis}
</ul>
</section>`
  }).join('\n')

  const inner = `<header>
<div class="title-flank">${ICONS.butterfly}</div>
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
  --paper: #faf3e2;
  --ink: #2a2218;
  --ink-soft: #4a3f30;
  --meta: #8a7d6a;
  --rule: #d4c6a8;
  --accent: #d96a7a;
  --rose:  #d96a7a;
  --blue:  #6ba8c4;
  --yellow:#c79e3a;
  --green: #7aa86a;
  --hand: 'Caveat', 'Long Cang', 'Source Han Serif SC', 'Songti SC', cursive;
  --body: 'Long Cang', 'Caveat', 'Source Han Serif SC', 'Songti SC', cursive;
  --serif-fallback: 'Source Han Serif SC', 'Songti SC', 'Noto Serif CJK SC', Georgia, serif;
}

* { box-sizing: border-box; }

::selection { background: var(--accent); color: var(--paper); }

body {
  font-family: var(--body);
  font-weight: 400;
  background: var(--paper);
  color: var(--ink);
  max-width: 32em;
  margin: 0 auto;
  padding: 4rem 2rem 6rem;
  font-size: 22px;
  line-height: 1.7;
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
  font-family: var(--hand);
  color: var(--meta);
  text-decoration: none;
  font-size: 1.1rem;
  letter-spacing: 0.02em;
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
  font-family: var(--hand);
  font-weight: 500;
  font-size: 1.3rem;
  color: var(--q-color, var(--accent));
  letter-spacing: 0.05em;
  text-transform: lowercase;
  margin: 0 0 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
}

.letter-page .q-tag {
  color: var(--q-color, var(--accent));
  display: inline-flex;
  transform: rotate(-3deg);
}

.letter-page h1 {
  font-family: var(--hand);
  font-weight: 500;
  font-size: 4rem;
  letter-spacing: 0.02em;
  color: var(--ink);
  margin: 0 0 1.2rem;
  line-height: 1.1;
}

/* hand-drawn wavy hairline under title */
.letter-page .hairline {
  display: block;
  width: 5em;
  height: 8px;
  margin: 0 auto 1.5rem;
  border: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 8' preserveAspectRatio='none'><path d='M0,4 q5,-4 10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0' stroke='%23d96a7a' fill='none' stroke-width='1.8' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-size: 100% 100%;
}

.letter-page .meta-line {
  font-family: var(--hand);
  font-size: 1.05rem;
  color: var(--meta);
  letter-spacing: 0.02em;
  margin: 0;
}

.letter-page article p {
  margin: 1.4rem 0;
  text-align: left;
  letter-spacing: 0.01em;
}

/* opening line ("亲爱的 5 岁的我，") */
.letter-page article p:nth-of-type(1) {
  font-size: 1.6rem;
  color: var(--q-color, var(--accent));
  margin: 0 0 2rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

/* signature 末段 — right-aligned */
.letter-page article p:last-of-type {
  text-align: right;
  font-size: 1.5rem;
  color: var(--ink-soft);
  margin: 3rem 0 0;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

.deco-divider {
  display: flex;
  justify-content: center;
  margin: 3rem 0 1.5rem;
  color: var(--q-color, var(--accent));
}
.deco-heart {
  transform: rotate(-8deg);
}

article blockquote {
  margin: 1.5rem 1.5rem;
  color: var(--ink-soft);
  font-family: var(--hand);
  font-size: 1.3rem;
}

article hr {
  border: none;
  width: 5em;
  height: 8px;
  margin: 2.5rem auto;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 8' preserveAspectRatio='none'><path d='M0,4 q5,-4 10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0' stroke='%23d4c6a8' fill='none' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-size: 100% 100%;
}

.signature-meta {
  margin-top: 1.5rem;
  padding-top: 0;
  border-top: 0;
  font-family: var(--hand);
  font-weight: 500;
  font-size: 1.2rem;
  color: var(--meta);
  text-align: center;
  letter-spacing: 0.02em;
}

.signature-meta p { margin: 0.4rem 0; }

.signature-meta .label {
  font-family: 'Caveat', cursive;
  letter-spacing: 0.1em;
  margin-right: 0.5em;
  font-size: 1rem;
  color: var(--q-color, var(--rose));
  font-weight: 500;
  text-transform: lowercase;
}

.postmark {
  display: flex;
  justify-content: center;
  margin-top: 2.5rem;
  color: var(--q-color, var(--accent));
  transform: rotate(-6deg);
  opacity: 0.85;
}

/* ── Index page ────────────────────────────────────────────────────────── */

.index-page header {
  text-align: center;
  margin-bottom: 5rem;
}

.title-flank {
  display: flex;
  justify-content: center;
  margin-bottom: 0.5rem;
  color: var(--rose);
}

.index-page h1 {
  font-family: var(--hand);
  font-weight: 600;
  font-size: 5rem;
  letter-spacing: 0.02em;
  color: var(--ink);
  margin: 0 0 0.8rem;
  line-height: 1.05;
}

.tagline {
  font-family: var(--hand);
  font-weight: 500;
  color: var(--ink-soft);
  font-size: 1.25rem;
  margin: 0 auto 1.2rem;
  max-width: 28em;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.start {
  font-family: var(--hand);
  font-weight: 500;
  font-size: 1.3rem;
  color: var(--rose);
  letter-spacing: 0.03em;
  margin: 0;
}

.quarter {
  margin: 0 0 3.5rem;
}

.quarter h2 {
  font-family: var(--hand);
  font-weight: 500;
  font-size: 2.3rem;
  color: var(--q-color, var(--ink));
  margin: 0 0 0.2rem;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.q-icon-wrap {
  display: inline-flex;
  align-items: center;
  color: var(--q-color);
  transform: rotate(-4deg);
}

.quarter-sub {
  font-family: 'Caveat', cursive;
  font-size: 1.05rem;
  color: var(--meta);
  letter-spacing: 0.02em;
  margin: 0 0 1.4rem;
  padding-left: 1.6em;
}

.quarter ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.quarter li {
  margin: 0.7rem 0;
  font-size: 1.1rem;
  padding-left: 1.6em;
}

.quarter li a {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  text-decoration: none;
  color: var(--ink);
}

.quarter li .num {
  font-family: var(--hand);
  color: var(--q-color, var(--accent));
  font-size: 1.15rem;
  letter-spacing: 0.03em;
  flex-shrink: 0;
  width: 4em;
}

.quarter li .title {
  font-family: var(--hand);
  color: var(--ink);
  flex-shrink: 0;
  font-size: 1.2rem;
}

/* hand-drawn wavy leader instead of dotted */
.quarter li .leader {
  flex: 1;
  min-width: 1em;
  height: 8px;
  margin: 0 0.4em;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 8' preserveAspectRatio='none'><path d='M0,4 q5,-4 10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0' stroke='%23d4c6a8' fill='none' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: repeat-x;
  background-size: 40px 8px;
  background-position: center;
  align-self: center;
  transform: translateY(0.1em);
}

.quarter li .date {
  font-family: var(--hand);
  color: var(--meta);
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.quarter li a:hover .title { color: var(--q-color, var(--accent)); }

.quarter.empty .empty-note {
  font-family: var(--hand);
  color: var(--q-color, var(--meta));
  opacity: 0.6;
  font-size: 1.3rem;
  letter-spacing: 0.02em;
  margin: 0;
  padding-left: 1.6em;
}

.site-footer {
  margin-top: 6rem;
  padding-top: 2rem;
  border-top: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 8' preserveAspectRatio='none'><path d='M0,4 q5,-4 10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0 t10,0' stroke='%23d4c6a8' fill='none' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-position: top center;
  background-size: 30% 8px;
  font-family: var(--hand);
  font-size: 1rem;
  color: var(--meta);
  text-align: center;
  letter-spacing: 0.02em;
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
