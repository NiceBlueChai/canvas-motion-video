---
name: canvas-motion-video
description: 程序化生成动效视频(motion graphics MP4)。当用户要求"做动效视频/片头/过程演示/数据动效/教程动画",或指定"单文件 HTML + Canvas + GSAP""命令行动效模式""不要剪辑脚本不要 PPT"时使用本 skill。覆盖完整链路：写单文件 HTML 动效(Canvas + GSAP)→ 构建(GSAP 内联)→ 冒烟抽帧 → 无头 Chrome 并行截帧 → ffmpeg 合成 MP4 → 抽检交付。内含可直接运行的渲染器脚本、构建脚本和起步模板。
agent_created: true
---

# Canvas Motion Video

## 何时不用

- 需要真人实拍、口播、复杂转场特效的视频 → 本 skill 不覆盖(那是视频生成/剪辑工具的地盘)。
- 用户明确要 PPT/Keynote → 转 PPT skill。

## Workflow

### Step 1 — 明确规格

向用户确认(有默认值就少问)：时长(不锁定，按内容定，10s 片头 / 1–3 分钟教程都正常)、分辨率(默认 1920×1080 16:9)、fps(默认 30)、内容主题与分镜。产出：一张分镜/时间轴表(时间段 → 画面内容 → 动画形式)。**🔴 CHECKPOINT · 🛑 STOP**：规格有歧义(时长/内容/分镜没说清)才停下问；三项都明确就直接干。

### Step 2 — 写单文件 HTML 动效

复制 `assets/template/src.html` 为起点，按其骨架填充。核心架构(必须遵守)：

- **state 对象 + GSAP 暂停时间轴 + `drawFrame(t)` 纯函数**。GSAP timeline 只驱动 state 数值；绘制完全由 t 决定。
- 暴露 CLI API：`window.__seek(t)`(暂停时间轴到 t 并重绘一帧)、`window.__ready`、`window.__duration`；浏览器预览用 `gsap.ticker` 实时播放，`?t=5.5` 跳帧调试。
- **帧确定性红线**：所有随机数用种子化 mulberry32 在加载时预生成；绘制函数内禁止调用随机/读取会漂移的状态。每个动画元素的相位进度归一化到 [0,1](`start + dur ≤ 1`，否则最后一帧永远演不完)。

详细架构、时间轴设计模式、字幕/清单/进度条等通用组件写法 → 读 `references/animation-patterns.md`。

### Step 3 — 构建

```sh
node scripts/build.mjs <项目目录>        # 把 GSAP 内联进 src.html → index.html
```

GSAP 源自动解析(环境变量 `GSAP_PATH` → 本地缓存 → 多镜像下载)。产物 index.html 必须自包含可双击播放。

### Step 4 — 冒烟抽帧(必做，勿跳)

全量渲染前，先在**覆盖每个场景/相位**的若干时间点各渲 1 帧，逐帧目检。时间点必须包含两类，缺一类就不算冒烟通过：

- **每个场景至少 1 帧**：按 Step 1 分镜表逐场景列出时间点，一个场景都不能漏。
- **最后一个场景/收尾阶段至少 1 帧**：推镜、淡出、片尾卡。这类bug(相位进度没归一化、`start+dur>1`)在中间场景完全看不出来，只有末尾帧会暴露。

```sh
node scripts/render.mjs --html index.html --from 2 --to 2.05 --fps 10 --workers 1 \
  --out /tmp/smoke_t2.mp4 --frames-dir /tmp/smoke_frames --keep-frames
```

每个场景把 `--from/--to` 换成该场景时间点，重复执行。

**冒烟的证据是 `--frames-dir` 里的 JPEG 帧，不是 mp4。** 上面这条命令产出的 mp4 只有 1 帧(`ffprobe` 一查 `nb_frames=1`、`duration≈0.1s`)，那只是渲染器的副产物——**严禁把它当"渲染验证"交付给用户**，这是误导性交付，用户一 ffprobe 就露馅。每类场景至少看 1 帧、收尾阶段必看再进 Step 5(长视频可批量抽样)。

黑帧(JPEG <20KB)或内容不对就修 HTML。详见 `references/animation-patterns.md`「验证流程」。

### Step 5 — 全量渲染 + 抽检交付

```sh
node scripts/render.mjs --html index.html --from 0 --to <总秒数> --fps 30 --workers 6 --out out/<名称>.mp4
```

渲染器自动多 worker 并行截帧并 ffmpeg 合成。**🔴 CHECKPOINT · 🛑 STOP**：Step 4 冒烟全过才允许跑这条——全量几分钟起步，冒烟没过就全量等于白烧机器。产出后用**精确 -ss 抽帧**做 contact sheet 目检(勿用 select/mod 抽帧拼版，映射会偏移)，ffprobe 验证时长/分辨率。

**交付闭环(硬要求，四项全做才算完)**：用户原话是「要有命令行动效模式渲染成 MP4」「给我完整运行命令」——他拿到项目目录必须能自己复现，不能依赖你这台机器上 skill 装在哪。收尾时逐项确认：

1. **渲染命令写进项目**：在项目里落一个 `README.md`(或 `render.sh`)，内容是**本项目专属**的 build / smoke / 全量渲染三条命令，路径和参数写死成实际值。
2. **渲染器可达**：`scripts/render.mjs` 在 skill 目录里，用户机器上不一定有。二选一，必须落实一个——把 `scripts/render.mjs` + `scripts/build.mjs` 复制进项目目录；或在 README 里写明本 skill 的安装方式。只给一句「用 skill 的渲染器」等于没给。
3. **构建可复现**：`src.html` 里的 `<!--GSAP_SRC-->` 占位符必须已被 `build.mjs` 替换成交付的 `index.html`，且用户重跑 `node build.mjs` 能产出同一个文件。别交付一个带着未替换占位符的 index.html。
4. **present_files 交付**：MP4 + index.html + contact sheet 拼版图。**不要交付 1 帧的冒烟 mp4**(见 Step 4)。

## 故障排查

| 症状(触发条件) | 一线修复 | 仍失败兜底 |
|---|---|---|
| `ERROR: 找不到 Chrome` | `--chrome <路径>` 或 `RENDER_CHROME` 指过去 | 装 Chrome；有 Chromium 就顶上 |
| puppeteer-core 解析失败 | `RENDER_NODE_MODULES` 指向有该包的目录 | 项目内 `npm install puppeteer-core` 再跑 |
| 渲染命令秒退、零输出 | 沙箱拦了：改**前台**运行，预期一次 sandbox bypass 批准 | 别用后台任务跑渲染，会被静默拦掉 |
| GSAP 内联失败(下载 SSL/超时) | 换镜像：unpkg → bootcdn → npmmirror | `GSAP_PATH` 指向本地 `gsap.min.js` |
| 冒烟黑帧(JPEG <20KB) | 查相位归一化(`start+dur≤1`)、绘制函数内是否混进 `rand()` | 读 `references/animation-patterns.md` 踩坑表 |
| 成片时长/帧数与预期不符 | 复核 `--from/--to` 与 `--fps` | 分段 `--from/--to` 渲染，定位漂移的那一段 |

耗时参考：1080p 单帧 ~0.15s，6 并行约 3 分钟/5400 帧。

## 文件清单

| 文件 | 用途 |
|---|---|
| `scripts/build.mjs` | GSAP 内联构建(src.html → index.html) |
| `scripts/render.mjs` | 命令行动效模式：并行截帧 + ffmpeg 合成 |
| `references/animation-patterns.md` | 架构规范、时间轴、确定性规则、验证流程、踩坑表 |
| `assets/template/src.html` | 可直接跑的起步模板(含全部 API 骨架) |
