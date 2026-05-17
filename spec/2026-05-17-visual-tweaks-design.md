# Visual Tweaks — 手稿 / 信纸感

> 2026-05-17 · 在 2026-05-17-design.md spec 之上的视觉/CSS 改造决策。

## 决策汇总

| 维度 | 之前 | 之后 |
|---|---|---|
| 调性 | editorial serif 极简 | 手稿 / 信纸感（用户选 Variant C 古典方向） |
| 背景 | `#fafaf7` 米色纯色 | `#e8dcb8` 深米黄 + 双角 radial 高光（旧纸感） |
| 墨色 | `#1a1a1a` 黑 | `#3d2817` 深褐墨水 |
| 中文手写字体 | 无（中文 fallback 衬线） | **Long Cang**（Google Fonts 中文硬笔楷书） |
| Latin 手写字体 | 无 | Indie Flower（用于 W01 等签名 Latin 部分） |
| 装饰色 | 无 | `#8b2c1a` 印章红（仅 `·` 装饰 + 极少处） |

## 字体应用范围（重要）

**全手写**：会破坏长文阅读 → 仅"信件性"元素手写：

| 元素 | 字体 | 理由 |
|---|---|---|
| 标题（h1） | Long Cang | 手写信件的"称谓 / 标题"传统都是亲笔 |
| 首段（"亲爱的 5 岁的我，"） | Long Cang | 信件开头亲笔 |
| 签名段落（末段） | Long Cang | 信件结尾签名亲笔 |
| 正文 | Source Han Serif SC 衬线 | 保持长文可读性 |
| meta line（W0 · 2026-05-17 · Q1） | 衬线 italic 小字 | 元信息，不抢戏 |
| footer label（"死法" / "童年"） | 衬线（不跟随手写） | 防止 "label" 字体 fallback 怪 |

## Index 页（多封信列表）也走手稿风

避免"letter 页古典 + index 页 editorial" 分裂感：

| 元素 | 处理 |
|---|---|
| 站点标题 "Death Letters" | Long Cang 大字（中文 fallback 走 Long Cang，Latin 走 Indie Flower 或默认） |
| Tagline | 衬线 italic 灰 |
| 季节标题 "Q1 — 死于意外" 等 | Long Cang 中等 |
| 信件链接 "W1 · <title>" | 衬线（链接需要可点感，过手写会显得软） |
| "等待 W14-26 的信件" placeholder | 衬线 italic 灰 |
| footer "source: github..." | 衬线小字 |

## 装饰元素（最低限度）

| 装饰 | 用途 |
|---|---|
| `·` 居中红色（letter h1 下方） | 替代下划线，做章节分隔 |
| dashed border `#b29867`（letter footer 上方） | 像旧信简的拉线 |
| 双 radial gradient `rgba(120,90,40,0.04)` 角部 | 旧纸张暗角 |

不加：
- ❌ SVG noise texture（性能 + 50ms 闪烁，N=52 用户每周访问，价值不抵）
- ❌ Drop cap 首字下沉（中文 ::first-letter 跨浏览器不一致）
- ❌ 印章 / 红章图（过头，破坏克制感）
- ❌ 信封 / 邮戳图（过装饰）

## CSS 来源

直接重写 `scripts/build-site.mjs` 内的 `CSS` 常量 + 顶部加 Google Fonts link 注入到 `pageWrap`。

Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Long+Cang&family=Indie+Flower&display=swap" rel="stylesheet">
```

verified 2026-05-17 HTTP 200，Google Fonts CDN 在日本访问无障碍。

## 实施步骤（spec → implement）

1. 改 `scripts/build-site.mjs`：
   - 在 `pageWrap` 函数 head 注入 Google Fonts link
   - 重写 `CSS` 常量为新样式
2. `node scripts/build-site.mjs` rebuild docs/
3. Chrome headless 截 letter + index 两张 final 图自审
4. `git add docs/ scripts/build-site.mjs spec/` + commit + push
5. 等 90 秒 verify Pages live HTTP 200 + 跑一次 parity 比对

## 不在 scope

- ❌ 改 markdown 来源（letters/**/*.md 不动）
- ❌ 加新 page（about / archive / RSS / search 都是 v2）
- ❌ 翻译页样式（translations/ 现在空，未来再设计）
- ❌ Dark mode（这个项目本质就是纸张感，dark mode 矛盾）

## Sunset / Kill

- 连续 4 周后用户没说"想换样式" → 设计稳定，进 sunset（不再迭代）
- 任一周 publish 时 build 失败（Google Fonts CDN 不可用、CSS syntax 错） → 回滚到上一版 + fallback 系统字体

## 关联

- 上游 [2026-05-17-design.md](./2026-05-17-design.md) 第 10 节 publishing flow
- 视觉参考：[reference_typography_scale](memory) 5 级 type scale 在此扩展为 + 手写 accent
- 不受 [feedback_layout_typography_weight_match](memory) 影响（letter 信纸本来就是 informal weight）
