# canvas-motion-video

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Standard-534AB7)
![Multi-Runtime](https://img.shields.io/badge/runtime-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%2070%2B-378ADD)
![License](https://img.shields.io/badge/license-MIT-97C459)

用「单文件 HTML（Canvas + GSAP）」写动效，用「无头 Chrome 逐帧截取 + ffmpeg 合成」渲染成 MP4。

不写剪辑脚本、不依赖 PPT/PR/AE，全部代码化、可复现、可跳帧调试。适合片头、数据动效、流程演示（饮品/甜品制作过程）、教学动画。

## 安装

通过 [skills CLI](https://github.com/vercel-labs/skills)（`npx skills`）安装，无需预先全局装任何东西：

```bash
# GitHub
npx skills add NiceBlueChai/canvas-motion-video --skill canvas-motion-video

# 安装仓库内全部 skill
npx skills add NiceBlueChai/canvas-motion-video

# Gitee 镜像（CLI 支持任意 git URL，需写完整地址且带 .git 后缀——否则会被当成直接下载文件而失败）
npx skills add https://gitee.com/NiceBlueChai/canvas-motion-video.git --skill canvas-motion-video

# 全局安装（对所有项目生效）
npx skills add NiceBlueChai/canvas-motion-video --skill canvas-motion-video -g
```

常用参数：

| 参数 | 说明 |
|---|---|
| `-s, --skill <name>` | 只装指定 skill，可重复 |
| `-g, --global` | 装到用户目录而非项目目录 |
| `-a, --agent <name>` | 指定目标 agent（如 `claude-code`、`codex`、`cursor`） |
| `--copy` | 复制文件而非软链（软链是默认推荐方式） |
| `-l, --list` | 只列出仓库里有哪些 skill，不安装 |
| `-y, --yes` | 跳过所有交互确认，适合 CI |

也可以直接本地路径安装（开发调试用）：

```bash
npx skills add /path/to/canvas-motion-video --skill canvas-motion-video
```

## 环境要求

| 依赖 | 说明 |
|---|---|
| Node.js | 18+ |
| ffmpeg | 系统自带或自行安装，渲染器直接调用 |
| Google Chrome / Chromium | 渲染器自动探测，也可用 `--chrome <路径>` 或 `RENDER_CHROME` 覆盖 |
| puppeteer-core | 渲染器按 `RENDER_NODE_MODULES` → skill 目录 `node_modules` → 当前目录 `node_modules` 顺序解析；都没有就在项目里 `npm install puppeteer-core` |

> macOS 注意：无头 Chrome 启动需要在沙箱外执行。渲染命令请**前台**运行并预期一次 sandbox 批准；后台任务会被静默拦掉（表现为秒退无输出）。

## 快速开始

skill 被触发后按 SKILL.md 的五步走，典型会话长这样：

```bash
# 1) 复制起步模板，填充你的分镜
cp <skill目录>/assets/template/src.html 你的项目/src.html

# 2) 构建：把 GSAP 内联进 src.html → index.html
node <skill目录>/scripts/build.mjs 你的项目

# 3) 冒烟抽帧：每个场景/相位各渲 1 帧，逐帧目检（证据是 JPEG 帧，不是 mp4）
node <skill目录>/scripts/render.mjs --html index.html --from 2 --to 2.05 --fps 10 --workers 1 \
  --out /tmp/smoke.mp4 --frames-dir /tmp/smoke_frames --keep-frames

# 4) 冒烟全过后再全量渲染
node <skill目录>/scripts/render.mjs --html index.html --from 0 --to <总秒数> --fps 30 --workers 6 --out out/成片.mp4
```

按 SKILL.md Step 5 的要求，收尾时应把 `build.mjs` + `render.mjs` 复制进项目、并在项目里落一份写死实际路径参数的 README，这样用户拿到目录就能自己复现。

## 仓库结构

```
skills/canvas-motion-video/
├── SKILL.md                          # skill 本体：触发条件 + 五步工作流 + 故障排查表
├── scripts/
│   ├── build.mjs                     # GSAP 内联构建（src.html → index.html）
│   └── render.mjs                    # 命令行动效模式：无头 Chrome 并行截帧 + ffmpeg 合成
├── references/
│   └── animation-patterns.md         # 架构规范、时间轴设计、确定性规则、验证流程、踩坑表
├── assets/
│   └── template/src.html             # 可直接跑的起步模板（含全部 API 骨架）
└── test-prompts.json                 # 验收用测试 prompt 集
```

`skills/<name>/SKILL.md` 是 Agent Skills 生态的标准布局，`npx skills` 靠这个路径发现 skill。一个仓库可以放多个 skill，各自一个子目录。

## 什么时候会触发

agent 读到 SKILL.md 的 frontmatter，命中以下任一类表述时启用：

- **意图类**：「做动效视频」「片头」「过程演示」「数据动效」「教程动画」
- **技术栈类**：「单文件 HTML + Canvas + GSAP」
- **交付形态类**：「命令行动效模式」「不要剪辑脚本」「不要 PPT」

明确**不**覆盖：真人实拍/口播/复杂转场特效的视频；用户明确要 PPT/Keynote。

## 运行时中立性

SKILL.md 内不含任何 runtime-specific 措辞（无「在 Claude Code 里」之类绑定单一 runtime 的指令），可在 Claude Code、Codex、Cursor、OpenCode、Gemini CLI 等任何 skills-compatible runtime 中使用。脚本不硬编码任何机器专属绝对路径。

## 质量验证

本 skill 经 Darwin Skill 2.0（9 维 rubric）评估与优化：

- 基线评估：4 名独立评委盲测，一致判定「不带 skill 的 baseline」优于「带 skill」——根因是交付闭环断裂（产出目录无可复现的渲染命令与脚本）
- 三轮优化全部 keep（paired 3-0 × 3）：交付闭环四项硬要求 / 三段式故障排查表 / 双 🔴 CHECKPOINT
- 同评委 before/after：**77.3 → 89.0**
- 端到端复跑验证：README 三条命令 + 脚本随项目交付 + 冒烟帧全覆盖 + 构建可复现，四项全部落地

## License

[MIT](./LICENSE)
