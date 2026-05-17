#!/usr/bin/env node
// Weekly death-letter ritual orchestrator.
//
// Flow:
//   voice (m4a) → whisper.cpp transcript → confirm
//   → Claude generates 3-5 followup questions
//   → readline collects your answers
//   → Claude generates letter draft
//   → write letter to letters/<quarter>/NN-<slug>.md
//   → write full dialogue archive to ~/.death-letters-private/dialogues/YYYY-WW-raw.md
//   → open $EDITOR for tweak
//
// Usage:
//   node scripts/dialogue.mjs [--week NN] [--voice <path>] [--skip-whisper]
//   node scripts/dialogue.mjs --dry-run     # no API call, prints what it would do
//
// Project W1 = 2026-05-24 (Sunday).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
// Calls Claude via `claude` CLI (Max subscription auth) — no @anthropic-ai/sdk needed.

// ── Constants ─────────────────────────────────────────────────────────────

const W1_DATE = new Date('2026-05-24T00:00:00')
const PROJECT_ROOT = join(homedir(), 'Desktop', 'Projects', 'death-letters')
const PRIVATE_ROOT = join(homedir(), '.death-letters-private')
const VOICE_DIR = join(PRIVATE_ROOT, 'voice')
const DIALOGUE_DIR = join(PRIVATE_ROOT, 'dialogues')

const QUARTERS = [
  { id: 'q1-accident',   start: 1,  end: 13, frame: '死于意外 — 不可控的死亡',
    mid_prompt: '如果今晚一场意外把你从这世界拿走，你最想告诉 5 岁的自己什么？' },
  { id: 'q2-choice',     start: 14, end: 26, frame: '死于选择 — 主动告别',
    mid_prompt: '如果你今晚选择主动结束，你想告诉 5 岁的自己哪一件事不值得带走？' },
  { id: 'q3-oblivion',   start: 27, end: 39, frame: '死于遗忘 — 慢性消逝',
    mid_prompt: '如果你正在慢慢消失（被遗忘 / 被自己忘），你想告诉 5 岁的自己哪些以为永远的东西其实会淡？' },
  { id: 'q4-completion', start: 40, end: 52, frame: '死于完成 — 圆满死亡',
    mid_prompt: '如果今晚就是完成、你心甘情愿地离开，你想告诉 5 岁的自己什么是值得活到底的？' },
]

const MODEL = 'claude-opus-4-7'  // 公开 confirmed model id

// ── Claude CLI invocation ─────────────────────────────────────────────────
// Spawns `claude --print` subprocess. Uses Max subscription auth (no --bare).
// Returns the `.result` string from JSON output. Throws on failure.
function callClaude({ systemPrompt, userMessage, maxTokens = 4000, model = MODEL }) {
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', systemPrompt,
    userMessage,
  ]
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 180000,  // 3 min cap
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

// ── Helpers ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { week: null, voice: null, skipWhisper: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week') args.week = parseInt(argv[++i], 10)
    else if (argv[i] === '--voice') args.voice = argv[++i]
    else if (argv[i] === '--skip-whisper') args.skipWhisper = true
    else if (argv[i] === '--dry-run') args.dryRun = true
  }
  return args
}

function computeWeek(today = new Date()) {
  const msPerWeek = 7 * 86400 * 1000
  const diff = today - W1_DATE
  return Math.max(1, Math.floor(diff / msPerWeek) + 1)
}

function quarterForWeek(week) {
  return QUARTERS.find(q => week >= q.start && week <= q.end) || QUARTERS[QUARTERS.length - 1]
}

function quarterWeek(week, quarter) {
  return week - quarter.start + 1
}

function pad2(n) { return String(n).padStart(2, '0') }

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function defaultVoicePath(week) {
  return join(VOICE_DIR, `W${pad2(week)}.m4a`)
}

function findPrevLetter(quarter, currentWeekInQuarter) {
  if (currentWeekInQuarter <= 1) {
    // try last letter of previous quarter
    const idx = QUARTERS.findIndex(q => q.id === quarter.id)
    if (idx === 0) return null
    const prev = QUARTERS[idx - 1]
    const dir = join(PROJECT_ROOT, 'letters', prev.id)
    if (!existsSync(dir)) return null
    const files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    if (files.length === 0) return null
    files.sort()
    return join(dir, files[files.length - 1])
  }
  const dir = join(PROJECT_ROOT, 'letters', quarter.id)
  if (!existsSync(dir)) return null
  const target = `${pad2(currentWeekInQuarter - 1)}-`
  const files = readdirSync(dir).filter(f => f.startsWith(target) && f.endsWith('.md'))
  return files.length > 0 ? join(dir, files[0]) : null
}

function extractLetterBody(path, maxChars = 600) {
  const raw = readFileSync(path, 'utf8')
  // strip frontmatter
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  return body.length > maxChars ? body.slice(0, maxChars) + '…' : body
}

// Convert any audio format to whisper-friendly wav (16kHz mono pcm_s16le).
// Returns path to wav (either input itself if already wav, or new /tmp/.wav).
function ensureWav(voicePath) {
  if (voicePath.toLowerCase().endsWith('.wav')) return { path: voicePath, isTmp: false }
  // Need ffmpeg
  try {
    execSync('which ffmpeg', { stdio: 'pipe' })
  } catch {
    console.error('ERROR: ffmpeg not found. Install: brew install ffmpeg')
    console.error('(Or convert your audio to .wav manually and re-run.)')
    process.exit(3)
  }
  const wavPath = join('/tmp', `dl-audio-${Date.now()}.wav`)
  console.error(`Converting ${voicePath} → ${wavPath} via ffmpeg...`)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', voicePath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('ffmpeg conversion failed.')
    process.exit(3)
  }
  return { path: wavPath, isTmp: true }
}

async function runWhisper(voicePath) {
  // Check whisper.cpp exists
  try {
    execSync('which whisper-cli', { stdio: 'pipe' })
  } catch {
    console.error(`
ERROR: whisper-cli not found. Install:
  brew install whisper-cpp
Then download a Chinese model:
  curl -L -o ~/whisper-models/ggml-medium.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
`)
    process.exit(3)
  }
  // Try env var, then default location
  const model = process.env.WHISPER_MODEL || join(homedir(), 'whisper-models', 'ggml-medium.bin')
  if (!existsSync(model)) {
    console.error(`ERROR: whisper model not found at ${model}`)
    console.error(`Download:  curl -L -o ${model} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin`)
    console.error(`Or set WHISPER_MODEL=<path> in env to point elsewhere.`)
    process.exit(3)
  }

  // Auto-convert non-wav formats (m4a, mp3, ogg, flac …) to wav for whisper.cpp
  const audio = ensureWav(voicePath)
  const out = join('/tmp', `dl-transcript-${Date.now()}`)
  console.error(`Running whisper-cli on ${audio.path} (model: ${model})...`)
  const r = spawnSync('whisper-cli', ['-m', model, '-l', 'zh', '-otxt', '-of', out, audio.path], { stdio: 'inherit' })

  // Cleanup tmp wav if we made one
  if (audio.isTmp) {
    try { execSync(`rm -f ${audio.path}`) } catch { /* swallow */ }
  }

  if (r.status !== 0) {
    console.error('whisper-cli failed.')
    process.exit(3)
  }
  return readFileSync(`${out}.txt`, 'utf8').trim()
}

async function confirmTranscript(transcript, rl) {
  console.error('\n─── Transcript ───')
  console.error(transcript)
  console.error('─────────────────\n')
  const a = (await rl.question('Confirm? [y/n/edit] ')).trim().toLowerCase()
  if (a === 'y' || a === '') return transcript
  if (a === 'n') {
    console.error('Aborted. Re-record and retry.')
    process.exit(0)
  }
  if (a === 'edit') {
    const tmp = `/tmp/dl-transcript-edit-${Date.now()}.txt`
    writeFileSync(tmp, transcript)
    const editor = process.env.EDITOR || 'vi'
    spawnSync(editor, [tmp], { stdio: 'inherit' })
    return readFileSync(tmp, 'utf8').trim()
  }
  return transcript
}

function generateFollowups(transcript, week, quarter, qWeek, prevExcerpt) {
  const systemPrompt = `你是 Jada 这周 death-letter 项目的对话伙伴。她刚录了一段语音 dump（transcript 见下面 user message）。

当前是 W${week}（${quarter.id} 季中第 ${qWeek} 周）。
本季 frame: ${quarter.frame}
本季 mid prompt 参考: ${quarter.mid_prompt}
${prevExcerpt ? `上 1 周信件节选（参考、不要复用）:\n---\n${prevExcerpt}\n---` : '（这是第一封信，无前作）'}

根据本季 frame 和她今天的 dump，提 3-5 个追问。追问要求：
1. 聚焦细节而非抽象（避免"你害怕什么"这种空问题）
2. 帮她下沉到童年具体场景（5 岁的真实她）
3. 不重复 transcript 里已说的内容
4. 至少 1 个问题指向"死亡"维度，至少 1 个指向"童年具体感官（声音 / 气味 / 触感 / 颜色）"维度

输出格式：每行一个问题，不编号，不加引号，无前置解释。`

  const text = callClaude({
    systemPrompt,
    userMessage: `本周语音 transcript:\n${transcript}`,
  })
  return text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

async function collectAnswers(questions, rl) {
  const answers = []
  for (let i = 0; i < questions.length; i++) {
    console.error(`\n── Q${i + 1}/${questions.length} ──`)
    console.error(questions[i])
    console.error('（多行答案：每按 Enter 一行，空行结束）\n')
    const lines = []
    while (true) {
      const l = await rl.question('> ')
      if (l === '') break
      lines.push(l)
    }
    answers.push(lines.join('\n'))
  }
  return answers
}

function generateLetter(transcript, questions, answers, week, quarter, qWeek) {
  const qa = questions.map((q, i) => `Q: ${q}\nA: ${answers[i] || '(留空)'}`).join('\n\n')
  const systemPrompt = `你是 Jada 这周 death-letter 项目的共创者。基于她的语音 dump、你提的追问、她的回答，写一封信。

形态：当前 ${quarter.id} 季（${quarter.frame}）第 ${qWeek} 周。由"今晚可能死去的我"写给"5 岁的真实她"。
长度：600-1100 字中文。
语气：克制 / 文学性 / 不煽情 / 不抒情 / 不说教 / 不"治愈"。
必含：本周想象的一种死法（一句话融入正文，不要单列）；童年的一个具体感官锚点（一个意象、不展开成回忆杀）。
绝对禁止：
- 任何家人 / 朋友 / 学校 / 地名的真实名字（写"妈妈"/"她"/"那个朋友"/"那个城市"即可）
- 抒情排比 / 鸡汤句式 / "亲爱的"以外的称谓套话
- 解释式的元叙述（"我想告诉你..."这种）

输出格式：
1. 第一行：建议的英文 slug（kebab-case，3-5 词），不要加任何前缀或标点
2. 第二行：建议的中文标题
3. 第三行：死法一句话（用于 frontmatter death_mode）
4. 第四行：童年锚点一句话（用于 frontmatter childhood_anchor）
5. 第五行：空行
6. 之后：信件正文（以"亲爱的 5 岁的我，"开始，以"—— 即将死去的我，W${pad2(week)}"结束）`

  return callClaude({
    systemPrompt,
    userMessage: `Transcript:\n${transcript}\n\nQ&A:\n${qa}`,
  }).trim()
}

function parseLetterOutput(raw) {
  const lines = raw.split('\n')
  if (lines.length < 6) {
    throw new Error(`Letter output too short, expected ≥6 lines, got ${lines.length}:\n${raw}`)
  }
  return {
    slug: lines[0].trim().replace(/[^a-z0-9-]/gi, '').toLowerCase(),
    title: lines[1].trim(),
    death_mode: lines[2].trim(),
    childhood_anchor: lines[3].trim(),
    body: lines.slice(5).join('\n').trim(),
  }
}

function writeLetterFile(parsed, week, quarter, qWeek, date) {
  const dir = join(PROJECT_ROOT, 'letters', quarter.id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${pad2(qWeek)}-${parsed.slug}.md`)
  const fm = `---
week: ${week}
quarter: ${quarter.id}
quarter_week: ${qWeek}
date: ${date}
slug: ${parsed.slug}
death_mode: ${JSON.stringify(parsed.death_mode)}
childhood_anchor: ${JSON.stringify(parsed.childhood_anchor)}
translations: []
---

# ${parsed.title}

${parsed.body}
`
  writeFileSync(path, fm)
  return path
}

function writeDialogueArchive(transcript, questions, answers, parsed, week, date) {
  mkdirSync(DIALOGUE_DIR, { recursive: true })
  const path = join(DIALOGUE_DIR, `W${pad2(week)}-raw.md`)
  const qa = questions.map((q, i) => `**Q${i + 1}:** ${q}\n\n**A${i + 1}:**\n${answers[i] || '(空)'}`).join('\n\n---\n\n')
  const content = `# Dialogue archive — W${pad2(week)} (${date})

> 含真实童年素材，永不入 public repo。

## Transcript

\`\`\`
${transcript}
\`\`\`

## Q&A

${qa}

## Generated letter (pre-edit)

- slug: \`${parsed.slug}\`
- title: ${parsed.title}
- death_mode: ${parsed.death_mode}
- childhood_anchor: ${parsed.childhood_anchor}

---

${parsed.body}
`
  writeFileSync(path, content)
  return path
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const week = args.week ?? computeWeek()
  const quarter = quarterForWeek(week)
  const qWeek = quarterWeek(week, quarter)
  const today = new Date()
  const date = formatDate(today)

  console.error(`\nWeek ${week} · ${quarter.id} (季中第 ${qWeek} 周) · ${date}\n`)

  if (args.dryRun) {
    console.error('DRY RUN — would do:')
    console.error(`  voice:    ${args.voice ?? defaultVoicePath(week)}`)
    console.error(`  quarter:  ${quarter.frame}`)
    console.error(`  prev:     ${findPrevLetter(quarter, qWeek) ?? '(none)'}`)
    process.exit(0)
  }

  // Sanity check: `claude` CLI on PATH (Max subscription auth used)
  const checkClaude = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 })
  if (checkClaude.status !== 0) {
    console.error('ERROR: `claude` CLI not found or not working. Install Claude Code first.')
    process.exit(4)
  }

  const voicePath = args.voice ?? defaultVoicePath(week)
  const rl = createInterface({ input: stdin, output: stdout })

  // 1. Whisper transcript
  let transcript
  if (args.skipWhisper) {
    console.error('(--skip-whisper) Paste transcript directly. Empty line + Enter to finish.\n')
    const lines = []
    while (true) {
      const l = await rl.question('')
      if (l === '') break
      lines.push(l)
    }
    transcript = lines.join('\n').trim()
  } else {
    if (!existsSync(voicePath)) {
      console.error(`ERROR: voice file not found: ${voicePath}`)
      console.error(`Record via macOS Voice Memos and copy to ${VOICE_DIR}/W${pad2(week)}.m4a`)
      console.error(`Or run with --skip-whisper to paste transcript directly.`)
      rl.close()
      process.exit(5)
    }
    transcript = await runWhisper(voicePath)
    transcript = await confirmTranscript(transcript, rl)
  }

  if (transcript.length < 50) {
    console.error('ERROR: transcript too short (<50 chars). Re-record.')
    rl.close()
    process.exit(6)
  }

  // 2. Load prev letter context
  const prevPath = findPrevLetter(quarter, qWeek)
  const prevExcerpt = prevPath ? extractLetterBody(prevPath) : null
  if (prevPath) console.error(`Prev letter context loaded from ${prevPath}\n`)

  // 3. Generate followups
  console.error('Generating followups via claude CLI (Max subscription)...')
  const questions = generateFollowups(transcript, week, quarter, qWeek, prevExcerpt)
  console.error(`Got ${questions.length} questions.`)

  // 4. Collect answers
  const answers = await collectAnswers(questions, rl)

  // 5. Generate letter
  console.error('\nGenerating letter draft via claude CLI...')
  const raw = generateLetter(transcript, questions, answers, week, quarter, qWeek)
  const parsed = parseLetterOutput(raw)

  // 6. Write files
  const letterPath = writeLetterFile(parsed, week, quarter, qWeek, date)
  const archivePath = writeDialogueArchive(transcript, questions, answers, parsed, week, date)

  rl.close()

  console.error(`\n✓ Letter draft:   ${letterPath}`)
  console.error(`✓ Dialog archive: ${archivePath}`)
  console.error(`\nNext:`)
  console.error(`  1. ${process.env.EDITOR || '$EDITOR'} ${letterPath}    # edit`)
  console.error(`  2. node scripts/anonymize-check.mjs --all`)
  console.error(`  3. git add ${letterPath.replace(PROJECT_ROOT + '/', '')} && git commit -m "week ${week}: ${parsed.slug}"`)
  console.error(`  4. node scripts/publish-helper.mjs --latest`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(99)
})
