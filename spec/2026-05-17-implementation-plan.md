# Death Letters — Implementation Plan

> 2026-05-17 · 基于 [2026-05-17-design.md](./2026-05-17-design.md) 的执行计划。

## Open Questions 决策（spec section 13）

| # | Question | 决策 | 理由 |
|---|---|---|---|
| 1 | whisper 本地 vs API | **本地 whisper.cpp** | 童年隐私不上云；一次性 setup 成本可接受；Mac M4 Pro 跑 base.en + medium 中文模型流畅 |
| 2 | Checklist 第一版条目数 | **15-25 条模板由我提供占位，真名由你私填** | 我永不读真名 |
| 3 | Q1 W1 起跑日 | **2026-05-24（下周日）** | 本周（5/17-5/23）做 setup + dry-run，下周日正式 W1 |
| 4 | 季末翻译 draft 7 天 cooldown | **是** | 翻译质量看一遍不够 |
| 5 | 是否预告项目 | **不预告** | 第 1 封信本身就是介绍 |

---

## Phase 0 — 任务分工总览

| 类别 | 我做（Claude） | 你做（Jada） | 双人 |
|---|---|---|---|
| 代码 | 4 个 script + .gitignore + package.json + pre-commit hook | — | — |
| 模板文件 | ANONYMIZE-CHECKLIST 模板 + README 骨架 | 填真名条目 | — |
| 外部账号 | — | GitHub repo 建立 + Substack publication 建立 | — |
| Ritual setup | — | 第一段 Voice Memo 录音 | — |
| W1 第一封 dry-run | 在你旁边跑 | 录音 + 改稿 + publish | 一起 |
| 1 月 review | review 数据 | 决定调整 | 一起 |

---

## Phase 1 — 仓库骨架（我做，~20 分钟）

### 1.1 创建 public repo 目录结构

```
~/Desktop/Projects/death-letters/
├── letters/
│   ├── q1-accident/.gitkeep
│   ├── q2-choice/.gitkeep
│   ├── q3-oblivion/.gitkeep
│   └── q4-completion/.gitkeep
├── translations/.gitkeep
├── scripts/         (Phase 2-5 填充)
├── docs/            (已有 design.md + 本 plan)
└── README.md
```

### 1.2 创建 private 目录（**永不入 git**）

```
~/.death-letters-private/
├── voice/.gitkeep
├── dialogues/.gitkeep
└── ANONYMIZE-CHECKLIST.md   (我建模板，你填真名)
```

### 1.3 `.gitignore`

```
.env*
node_modules/
.DS_Store

# 防误推
voice/
*.m4a
*.wav
*.mp3
~/.death-letters-private/

# whisper.cpp 输出
*.srt
*.vtt
```

### 1.4 `package.json`

```json
{
  "name": "death-letters",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dialogue": "node scripts/dialogue.mjs",
    "anonymize": "node scripts/anonymize-check.mjs",
    "translate": "node scripts/translate.mjs",
    "publish": "node scripts/publish-helper.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "dotenv": "^16.4.0"
  }
}
```

（版本号到 install 时按 `npm view` 实查，不在此 hardcode）

### 1.5 `.env.local`（已废弃 — 2026-05-17 改造）

**不再需要**。dialogue.mjs / translate.mjs 已改成走 `claude` CLI 子进程，用 Max 订阅认证，无需 API key。

历史保留：旧版（SDK 模式）需要 `ANTHROPIC_API_KEY=<your-key>` 写到 `.env.local`。

### 1.6 `ANONYMIZE-CHECKLIST.md` 模板（我建占位，你填）

写在 `~/.death-letters-private/ANONYMIZE-CHECKLIST.md`：

```
# Anonymize Checklist

格式：每行一个 case-insensitive 黑名单条目。空行 / # 开头行被忽略。

## 家人真名（必填）
# 父
# 母
# 兄弟姐妹（每人一行）
# 配偶
# 子女

## 出生地 / 童年所在地
# 出生省
# 出生市
# 童年所在区

## 学校
# 小学名
# 幼儿园名

## 童年好友（前 5-10 个）
#

## 曾用名 / 小名
#
```

你私下填，永不入 git。

### 1.7 `README.md`（公开版骨架）

```markdown
# Death Letters

每周 1 封"今晚我可能死去"的我，写给"5 岁的真实我"的信。
52 周 × 中文为主 + 季末日英译。

> 公开作品。详见 [Substack](https://...)（W1 后更新）。

## 索引

每季末更新。
```

Substack 链接 W1 后填。

---

## Phase 2 — `scripts/anonymize-check.mjs`（我做，~30 分钟）

**先做这个**，因为是 pre-commit gate。

### 行为

1. 从 `~/.death-letters-private/ANONYMIZE-CHECKLIST.md` 读条目列表（忽略空行 + `#` 开头）
2. 接受参数：本次 staged 文件列表，或 `--all`（全 letters/ 目录）
3. 对每个文件 case-insensitive grep 每个黑名单条目
4. 命中任何条目 → 打印 `ERROR: <file>:<line>: hit blacklist "<term>"`，退出码 1
5. 软警告 regex：
   - `\b\d+\s*岁` (年龄)
   - `[0-9]{4}-[0-9]{2}-[0-9]{2}` (精确日期)
   - `[一-龯]+(省|市|区|县|路|号|街道)` (具体地点)
   - 命中 → 打印 `WARN: <file>:<line>: <pattern>`，退出码 0
6. `--quiet` 模式（pre-commit hook 用）：只在硬命中时输出 + 退出 1

### Pre-commit hook

`.git/hooks/pre-commit`：

```bash
#!/usr/bin/env bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep '^letters/' || true)
[ -z "$STAGED" ] && exit 0
node scripts/anonymize-check.mjs --quiet $STAGED
```

`chmod +x .git/hooks/pre-commit`。

### 测试

```bash
# 1. 模拟硬命中
echo "我妈妈<真名>说..." > letters/q1-accident/01-test.md
git add letters/q1-accident/01-test.md
git commit -m "test" # 应被拦下

# 2. 模拟软警告
echo "我 7 岁那年..." > letters/q1-accident/01-test.md
node scripts/anonymize-check.mjs --quiet letters/q1-accident/01-test.md # 应 exit 0 + warn

# 3. 干净通过
echo "亲爱的小小的我，" > letters/q1-accident/01-test.md
node scripts/anonymize-check.mjs --quiet letters/q1-accident/01-test.md # 应静默 exit 0
```

测完删 test 文件。

---

## Phase 3 — `scripts/dialogue.mjs`（我做，~90 分钟，最复杂）

### 行为

```
node scripts/dialogue.mjs [--week NN] [--voice <path>]
```

默认参数：
- `--week` 不传 → 自动算（项目 W1 = 2026-05-24，按当前日期算 week diff）
- `--voice` 不传 → 默认 `~/.death-letters-private/voice/YYYY-WWNN.m4a`（按 week 推路径）

### 步骤

1. **加载 env + Claude SDK**
2. **算 week + quarter**
   ```
   const W1_DATE = new Date('2026-05-24')
   const week = Math.floor((today - W1_DATE) / (7 * 86400000)) + 1
   const quarter = week <= 13 ? 'q1-accident'
                  : week <= 26 ? 'q2-choice'
                  : week <= 39 ? 'q3-oblivion'
                  : 'q4-completion'
   ```
3. **whisper.cpp 转写**
   - 调用：`whisper-cli -m models/ggml-medium.bin -l zh ~/.death-letters-private/voice/W21.m4a -otxt`
   - 读 `.txt` 输出
   - 显示 transcript 给用户 → readline 等 confirm（y/n/edit）
   - n → 退出；edit → 打开 $EDITOR 让你改后再 confirm
4. **读上周 letter context**
   - 找 `letters/<quarter>/<NN-1>-*.md`（如 NN=1 则跳过）
   - 提取 frontmatter + 正文（≤500 字）
5. **Claude API call 1：生成 3-5 个追问**
   - System prompt：
     ```
     你是 Jada 这周 death-letter 项目的对话伙伴。她刚录了一段语音 dump（见 transcript）。
     当前是 W{NN}（{quarter} 季中）。
     上周信件主题（参考）：{prev_letter_excerpt}
     根据 {quarter} 的 frame（{frame_description}），针对她今天的 dump，提 3-5 个追问。
     追问要：1) 聚焦细节而非抽象 2) 帮她下沉到童年具体场景 3) 不重复 transcript 里已说的
     输出格式：每行一个问题，不编号。
     ```
   - User message：transcript 全文
6. **Readline 收集回答**
   - 一问一答，每个答案多行用 `\\` 续行；空行 + Enter 结束当前题
7. **Claude API call 2：生成 letter draft**
   - System prompt：
     ```
     你是 Jada 这周 death-letter 的共创者。基于她的语音 dump + 你提问 + 她的回答，
     写一封信。形态：{quarter} 季中 frame 下，由"今晚可能死去的我"写给"5 岁的真实她"。
     长度：600-1200 字中文。语气：克制 / 文学性 / 不煽情。
     必含：本周想象的死法（一句话融入正文，不要单列）；童年锚点（一个具体意象）。
     不要包含具体真名 / 地名 / 学校名（Jada 后续会过 anonymize-check）。
     ```
   - User message：transcript + 追问列表 + 答案列表
8. **写文件**
   - 提示用户：letter 标题？slug？
   - 写 `letters/<quarter>/<NN-padded>-<slug>.md`：frontmatter（自动填 week/quarter/quarter_week/date/slug/death_mode/childhood_anchor）+ 正文
   - 同时写 `~/.death-letters-private/dialogues/YYYY-WW-raw.md`（transcript + Q&A + 生成的 letter 全留档）
9. **打开 $EDITOR**
   - `code letters/<quarter>/...` 或 `nvim`，看 $EDITOR env

### 4 个 quarter 的 frame_description（spec 7.1）

```js
const FRAME = {
  'q1-accident':   '不可控的死亡 — 追问偏向"如果今晚一场意外..."',
  'q2-choice':     '主动告别 — 追问偏向"如果你今晚选择主动..."',
  'q3-oblivion':   '慢性消逝 — 追问偏向"如果你正在慢慢消失..."',
  'q4-completion': '圆满死亡 — 追问偏向"如果今晚就是完成..."',
}
```

### 错误处理

- whisper.cpp 没装 → 报错 + 给安装指令链接
- transcript 空 / < 50 字符 → 提示重录
- Claude API 失败 → 重试 3 次 + 指数退避；3 次都失败 → 保存 transcript + 退出，提示稍后用 `--resume` 继续（v1 不实现 resume，先报错退出）
- API key 缺失 → 报错指向 `.env.local`

### 依赖

- `@anthropic-ai/sdk` （已在 package.json）
- whisper.cpp 本地装：`brew install whisper-cpp` 或 GitHub release（待 install 时实查命令）
- whisper model: 装好后 `whisper-cli --help` 看下载方式

---

## Phase 4 — `scripts/publish-helper.mjs`（我做，~15 分钟）

```
node scripts/publish-helper.mjs <slug>
# 或: node scripts/publish-helper.mjs --latest
```

行为：
1. 找文件：letters/*/<slug>.md 或最新 mtime 的 letter
2. 读 markdown 全文（保留 frontmatter — 你 Substack 前手动删，看一眼有没有元数据漏出）
3. `pbcopy` 复制（macOS）
4. 打印：`已复制 letters/<quarter>/<NN>-<slug>.md (1234 chars) → 打开 https://substack.com/inbox → New post → 粘贴`

---

## Phase 5 — `scripts/translate.mjs`（我做，~30 分钟）

```
node scripts/translate.mjs --quarter q1 --lang ja
node scripts/translate.mjs --quarter q1 --lang en
```

行为：
1. 找该季末信（quarter 目录里 quarter_week == 13 的）
2. 调 Claude API：
   - System prompt：
     ```
     你是文学译者。把以下中文 death-letter 翻译成{lang}。
     要求：保持文学性，不直译；译注（如"中阴期" / 中国特有意象）放 footnote；
     {lang === 'ja' ? '用现代日本文学语体，不用古风' : '偏 literary essay 不偏 commercial'}.
     保留 frontmatter 但翻译标题。
     ```
3. 写到 `translations/<quarter>-end-<lang>.md`
4. 提示：默认在 `draft/<quarter>-end-<lang>` branch 上 commit 7 天 cooldown 后 merge main

```bash
git checkout -b draft/q1-end-ja
git add translations/q1-end-ja.md
git commit -m "draft translation: q1 end - ja"
# 7 天后:
git checkout main && git merge draft/q1-end-ja
```

---

## Phase 6 — Day 0 → W1 Dry-run（双人，本周 5/17-5/23）

目标：确认 30 分钟 ritual 真能完成 + script 跑通。

### Day 0（今天 / 明天）

我做完 Phase 1-5 → 你做：
1. 填 ANONYMIZE-CHECKLIST.md 真名条目
2. `pnpm install`（或 `npm install`）
3. brew install whisper-cpp + 下载 medium 中文 model
4. test pre-commit hook（Phase 2.3 步骤）
5. test dialogue.mjs：录 1 段语音 dump 跑全流程
   - **不发布**，只看 ritual UX：用时多少？追问质量？letter draft 像样吗？
6. 反馈给我 → 调 prompt / fix bug

### W1 启动（2026-05-24）

7. 录第一段正式 voice
8. 跑 dialogue.mjs --week 1
9. Edit letter → anonymize-check → commit + push
10. publish-helper.mjs → Substack publish
11. 起始 issue：Substack subscription link 加到 README

### 失败 criteria（dry run）

- Ritual > 60 分钟 → 调 Claude prompt 让追问 3 个不要 5 个，letter 长度 600-1000 不要 1200
- Transcript 错误率 > 30% → 评估换 OpenAI Whisper API
- Letter draft 质量"读不下去" → 调 system prompt，看是否要给 examples（cf [feedback_specificity_needs_honesty]）
- 3 次以上想推翻 quarter frame → 触发 [feedback_macro_rebuild_signal]，停下重 frame

---

## Phase 7 — 上线（你做，5/24 周日）

1. `gh repo create death-letters --public --source=. --description "52 weekly letters from the dying me to the 5-year-old me"`
2. Substack publication setup：
   - publication name（建议短：`death letters` / `周日邮筒` / 你定）
   - tagline、about
   - **不开评论**（你已经做了内容审查，不需要再审读者评论）
3. W1 第一封 publish
4. README 加 Substack subscription link

---

## Phase 8 — 1 个月 review（双人，2026-06-21 周日 / W5 结束）

回看 4 封信 + ritual 数据：

| 指标 | 通过线 | 失败处理 |
|---|---|---|
| 4 周 ritual 完成 ≥ 3 周 | 是 | 否 → kill 项目 |
| Substack 订阅 > 0 | 不重要（这不是流量项目） | — |
| 平均 ritual 时长 ≤ 45 分钟 | 是 | 否 → 减追问数 / 减 letter 长度 |
| 你自己回看 ≥ 1 封觉得"这是我会留下来的东西" | 是 | 否 → 调 Claude prompt 增加 specificity，或考虑改 form |
| 隐私失误 0 次 | 必须 | 否 → ANONYMIZE-CHECKLIST 加条目 + 复评 anonymize Layer 1 严格度 |

review 后：调 prompt / 调 frame / 或 kill。

---

## 我下一步可执行的（你说"开干"即开始）

Phase 1-5 全部我能在这个 session 跑完（用 Bash + Write 工具），按顺序：

1. **Phase 1 仓库骨架**（~20 min）— 建目录 + .gitignore + package.json + ANONYMIZE-CHECKLIST 模板 + README 骨架
2. **Phase 2 anonymize-check.mjs + pre-commit hook**（~30 min）— 测试通过
3. **Phase 3 dialogue.mjs**（~90 min，最大头）— 我会先跳过 whisper.cpp 部分写其余，whisper 留个 stub 等你装好再 wire 上
4. **Phase 4 publish-helper.mjs**（~15 min）
5. **Phase 5 translate.mjs**（~30 min）

总计 ~3 小时纯 coding 时间，我可以在这个 session 跑完。

完成后你做的事：
- 装 whisper.cpp（一行 brew 命令 + 下 model）
- 填 ANONYMIZE-CHECKLIST 真名
- pnpm install
- 录第一段 dry-run voice（任意主题，今天就能跑）

**说"开干"我就启动 Phase 1。**

或者你想先调整 plan 哪部分？
