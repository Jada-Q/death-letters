# Death Letters

每周 1 封"今晚我可能死去"的我，写给"5 岁的真实我"的信。
52 周 × 中文为主 + 季末日英译。

> 公开作品。Substack：_W1 后更新_

## Frame

- Q1 (W1-13) 死于意外
- Q2 (W14-26) 死于选择
- Q3 (W27-39) 死于遗忘
- Q4 (W40-52) 死于完成

## 索引

每季末更新。

## 工具

仓库内的 `scripts/` 是这个 ritual 的最小工具：voice → transcript → Claude 对话 → letter draft → anonymize check → publish。

```bash
pnpm install
pnpm dialogue        # 周日晚 30 分钟仪式
pnpm anonymize -- letters/q1-accident/*.md
pnpm publish -- <slug>      # 复制 markdown 到剪贴板
pnpm translate -- --quarter q1 --lang ja  # 季末触发
```

详见 [`spec/2026-05-17-design.md`](./spec/2026-05-17-design.md) 和 [`spec/2026-05-17-implementation-plan.md`](./spec/2026-05-17-implementation-plan.md)。

公开站点：https://jada-q.github.io/death-letters/（GitHub Pages 自动从 main 分支 `docs/` 部署）
