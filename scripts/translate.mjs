#!/usr/bin/env node
// Quarter-end translation: ja / en versions of the season's final letter.
//
// Usage:
//   node scripts/translate.mjs --quarter q1 --lang ja
//   node scripts/translate.mjs --quarter q1 --lang en
//   node scripts/translate.mjs --quarter q1 --lang both
//
// Triggered manually at quarter end (W13 / W26 / W39 / W52).
// Output: translations/<quarter>-end-<lang>.md
// Recommendation: commit on draft branch, merge to main after 7-day cooldown.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const PROJECT_ROOT = join(homedir(), 'Desktop', 'Projects', 'death-letters')
const QUARTER_MAP = {
  q1: 'q1-accident',
  q2: 'q2-choice',
  q3: 'q3-oblivion',
  q4: 'q4-completion',
}
const MODEL = 'claude-opus-4-7'

// Calls Claude via `claude` CLI subprocess (Max subscription auth — no API key billing).
function callClaude({ systemPrompt, userMessage, model = MODEL }) {
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', systemPrompt,
    userMessage,
  ]
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 300000,  // 5 min for translation
    maxBuffer: 20 * 1024 * 1024,
  })
  if (r.error) throw new Error(`spawn claude failed: ${r.error.message}`)
  if (r.status !== 0) {
    throw new Error(`claude exit ${r.status}: ${r.stderr || r.stdout.slice(0, 500)}`)
  }
  let parsed
  try { parsed = JSON.parse(r.stdout) } catch (e) {
    throw new Error(`claude stdout not JSON: ${r.stdout.slice(0, 300)}`)
  }
  if (parsed.is_error) {
    throw new Error(`claude api error: ${parsed.api_error_status || parsed.result}`)
  }
  return parsed.result
}

const LANG_INSTRUCT = {
  ja: {
    name: '日本語',
    style: '現代日本語の文学作品の語り口で訳す。古風・直訳・煽情的な誇張は禁止。「親愛なる五歳の私へ」のような表現は自然な日本語に変える（例：「五歳のわたしへ」）。署名行も翻訳する。',
    footnote_hint: '中国特有の意象（「中陰」「物哀」など）は本文中に置かず、文末に footnote として注釈する。',
  },
  en: {
    name: 'English',
    style: 'Literary essay register, not commercial / not therapeutic. Preserve restraint. Do NOT compensate for cultural distance with extra explanation in the body — keep the body tight, push explanations to footnotes.',
    footnote_hint: 'Culturally-specific images (中陰 / 物哀 / specific Chinese childhood items) go in numbered footnotes at the end, not inline.',
  },
}

function parseArgs(argv) {
  const a = { quarter: null, lang: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quarter') a.quarter = argv[++i]
    else if (argv[i] === '--lang') a.lang = argv[++i]
    else if (argv[i] === '--force') a.force = true
  }
  return a
}

function findEndLetter(quarter) {
  const dir = join(PROJECT_ROOT, 'letters', quarter)
  if (!existsSync(dir)) {
    console.error(`ERROR: ${dir} does not exist.`)
    process.exit(1)
  }
  const files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))
  // quarter_week 13 = the last one numerically
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8')
    const m = raw.match(/^quarter_week:\s*(\d+)/m)
    if (m && parseInt(m[1], 10) === 13) {
      return { path: join(dir, f), content: raw, filename: f }
    }
  }
  console.error(`ERROR: no quarter_week=13 letter found in ${quarter}. Are you sure the season is complete?`)
  process.exit(2)
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { fm: '', body: raw }
  return { fm: m[1], body: m[2].trim() }
}

function translate(content, lang) {
  const ins = LANG_INSTRUCT[lang]
  const systemPrompt = `あなたは文学翻訳者です。中国語の death-letter（死を想起しつつ 5 歳の自分に書く手紙）を ${ins.name} に翻訳します。

文体: ${ins.style}
注釈方針: ${ins.footnote_hint}

絶対のルール:
- frontmatter ブロック（--- で囲まれた YAML）はそのまま残す。ただし title / death_mode / childhood_anchor の値は翻訳する。slug は変えない。
- 本文の構造（段落区切り、署名行）を保持する。
- 翻訳に注釈が必要な箇所には [^1] のような numbered footnote を挿入し、本文の最後に注釈リストを置く。
- 不要な意訳や付け足しは禁止。中国語原文の sparse な質感を壊さない。`

  return callClaude({
    systemPrompt,
    userMessage: content,
  }).trim()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.quarter || !QUARTER_MAP[args.quarter]) {
    console.error('Usage: --quarter q1|q2|q3|q4 --lang ja|en|both')
    process.exit(2)
  }
  if (!args.lang || !['ja', 'en', 'both'].includes(args.lang)) {
    console.error('Usage: --quarter q1|q2|q3|q4 --lang ja|en|both')
    process.exit(2)
  }

  const fullQuarter = QUARTER_MAP[args.quarter]
  const letter = findEndLetter(fullQuarter)
  console.error(`Found end letter: ${letter.path}\n`)

  // Sanity check claude CLI
  const check = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 })
  if (check.status !== 0) {
    console.error('ERROR: `claude` CLI not found. Install Claude Code first.')
    process.exit(4)
  }

  const langs = args.lang === 'both' ? ['ja', 'en'] : [args.lang]
  const outDir = join(PROJECT_ROOT, 'translations')
  mkdirSync(outDir, { recursive: true })

  const written = []
  for (const lang of langs) {
    const outPath = join(outDir, `${args.quarter}-end-${lang}.md`)
    if (existsSync(outPath) && !args.force) {
      console.error(`SKIP: ${outPath} exists. Use --force to overwrite.`)
      continue
    }
    console.error(`Translating to ${lang} via claude CLI (Max subscription)...`)
    const translated = translate(letter.content, lang)
    writeFileSync(outPath, translated)
    written.push(outPath)
    console.error(`✓ ${outPath} (${translated.length} chars)`)
  }

  if (written.length === 0) {
    console.error('\nNothing written. Done.')
    return
  }

  console.error(`\nRecommended next steps (7-day cooldown before merge to main):`)
  console.error(`  git checkout -b draft/${args.quarter}-end-${args.lang}`)
  written.forEach(p => {
    console.error(`  git add ${p.replace(PROJECT_ROOT + '/', '')}`)
  })
  console.error(`  git commit -m "draft translation: ${args.quarter} end - ${args.lang}"`)
  console.error(`  # wait ≥7 days, re-read, edit, then:`)
  console.error(`  git checkout main && git merge draft/${args.quarter}-end-${args.lang}`)
  console.error(`\n  Also remember to update the source letter's frontmatter:`)
  console.error(`  translations: [${langs.map(l => `"${l}"`).join(', ')}]`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(99)
})
