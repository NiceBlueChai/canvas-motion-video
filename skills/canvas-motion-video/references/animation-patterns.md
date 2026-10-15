# 动效架构规范与踩坑表

> 配套 `canvas-motion-video` skill。写任何动效 HTML 前先读本文档的「架构」与「确定性红线」；完成后按「验证流程」走一遍。

## 1. 架构(标准姿势)

```
state 对象(全部动画数值)
   ↑ GSAP paused timeline 只负责把 state 从 A 补间到 B
drawFrame(t) 纯函数: 只读 state + t, 画一帧
   ↑ window.__seek(t) = tl.pause(t); drawFrame(tl.time())
```

```js
var state = { titleAlpha: 0, particles: 0, zoom: 1, fade: 1 };
var tl = gsap.timeline({ paused: true });
tl.to(state, { titleAlpha: 1, duration: 0.9, ease: "power2.out" }, 0.0)
  .to(state, { particles: 1, duration: 3, ease: "power2.out" }, 1.0)
  .to(state, { zoom: 1.08, duration: 3, ease: "power2.inOut" }, 7.0)
  .to(state, { fade: 0, duration: 1.5, ease: "power2.in" }, 8.5);

function drawFrame(t) { /* 只读 state 和 t, 画背景/主体/叠层 */ }

window.__seek = function (t) { tl.pause(t); drawFrame(tl.time()); };
window.__duration = 10;
window.__ready = true;

/* 浏览器预览: ?t=5.5 跳帧, 否则实时播放 */
var autoT = parseFloat(new URLSearchParams(location.search).get("t"));
if (!isNaN(autoT)) window.__seek(autoT);
else { gsap.ticker.add(function () { drawFrame(tl.time()); }); tl.play(); }
```

要点：
- **GSAP 是时钟 + 缓动引擎**，不持有画面知识；画面全部由 drawFrame 从 state 重建。这样任意 t 都能画出正确的一帧——这是并行截帧和跳帧调试的基础。
- 画布固定内部分辨率(默认 1920×1080)。**CSS 必须信箱式适配**：`width:min(100vw, 100vh*16/9); height:min(100vh, 100vw*9/16)`，画布用 flex 或 margin auto 居中。别写 `width:100vw;height:100vh` 直接拉伸——非 16:9 窗口预览时圆变椭圆、构图畸变，用户一拖窗口就露馅(盲测实测踩过：本 skill 曾把这个错误写法写成规定，被 baseline 的信箱式适配比下去)。截图时 viewport 设为同尺寸、deviceScaleFactor 1。
- 短动效(≤15s)用 GSAP tween 排时间轴；长视频(≥1min)用「场景数组 + 局部进度算术」排期，GSAP 只驱动全局属性(标题、zoom、fade)，避免时间轴几十行排不动。

## 2. 确定性红线(违反 = 帧漂移/复现失败)

1. **随机数只允许出现在数据预生成阶段**：加载时用种子化 RNG(mulberry32)生成所有粒子/坐标/大小/相位，绘制函数内**禁止**调用随机。曾把 `rand()` 写在西柚粒绘制的 ellipse 旋转参数里，导致每帧 RNG 状态漂移、同一 t 画出不同画面。
2. **相位归一化**：每个分相位动画(如第 i 颗珍珠)的局部进度 `prog = (phase - start_i) / dur_i`，必须保证 `max(start_i + dur_i) ≤ 1`，否则相位结束时还有元素悬在半空(珍珠悬空 bug 的根因:最后一颗需要 1.14 的进度)。
3. **浮点 epsilon**：秒数窗口做帧数换算时 `Math.round((to - from) * fps + 1e-6)`，否则 `3.05 - 3 = 0.04999…` 会被 round 成 0 帧。
4. 拖尾/累积效果(如半透明黑覆盖)在 seek 模式下不可用——seek 是整帧重绘，拖尾要解析式画(沿速度方向画线段)，不能依赖上一帧残留。

## 3. 时间轴设计模式

- 画张表再写代码：`时间段 → 画面内容 → 动画形式`。10s 片头的经典节奏：0–1s 标题淡入 / 1–4s 主体元素 / 4–7s 信息层(数据/指标卡) / 7–10s 推镜 + 淡出。
- 常用缓动：淡入 `power2.out`、位移入场 `power3.out`、液体/进度 `power1.inOut`、打勾弹出 `back.out(2)`、镜头 `power2.inOut`。
- 通用组件(直接抄)：
  - **字幕条**：底部居中胶囊(圆角矩形 + 编号圆徽 + 文本)，进出用 smoothstep 包 0.35s 淡入淡出。
  - **步骤清单**：左侧竖排，编号圆圈 → 完成态填充主题色 + 打勾(scale 弹出)，当前项加脉冲光环(alpha 随时间 sin 呼吸)。
  - **进度条**：底部细条，按场景边界打刻度，填充用主题色渐变。
  - **液体**：clip 容器路径 → 波浪路径(沿 x 正弦)向下填充 → 界面高光线；倾倒流=二次贝塞尔细线 + 表面涟漪椭圆(相位循环)。
  - **count-up**：`value = target * phase`(phase 已被 GSAP 缓动过，直接乘)。
  - **标题字距展开**：逐字 measureText 排版，间距 = base + spread * N。

## 4. 验证流程(每步都不能省)

1. **冒烟抽帧**：在每个场景/相位各选 1 个时间点渲单帧(渲染器 `--from t --to t+0.05 --fps 10 --workers 1 --keep-frames`)，逐帧目检。黑帧(<20KB)= 没画出来；内容错 = 查该时间点的窗口条件。
2. **全量渲染**：`--to <总秒数> --workers 6`，长视频(>1min)必须多并行。
3. **接触sheet 抽检**：用**精确 -ss 逐点抽帧**再拼 tile——`ffmpeg -ss <t> -i out.mp4 -frames:v 1` 循环 → 顺序命名 → `ffmpeg -f image2 -i %02d.png -vf tile=4x3`。不要用 `select='not(mod(n,N))'` 拼版(帧号映射会偏移，曾误导判断)。
4. **ffprobe 验证**：duration 精确等于目标秒数、width/height、r_frame_rate。
5. 交付：MP4 + index.html(可预览)+ contact sheet + README。

## 5. 环境与踩坑表(macOS 实测)

| 坑 | 现象 | 解法 |
|---|---|---|
| 无头 Chrome 要沙箱外执行 | 后台渲染任务秒退无输出；前台需一次 sandbox bypass 批准 | 渲染命令前台跑，预期批准；失败时看 stderr 而非只 grep |
| 父进程 spawn 子 worker 不透传参数 | 子进程用默认 framesDir/fps，帧写错目录或 ENOENT | spawn 时带 `...process.argv.slice(2)` |
| JS 浮点 | 0.05s 窗口 round 成 0 帧 | `+ 1e-6` epsilon |
| jsdelivr SSL 失败 | curl exit 35 | GSAP 换 unpkg(备选 bootcdn/baomitu/npmmirror) |
| ESM 不吃 NODE_PATH | `import puppeteer-core` 失败 | `createRequire(<node_modules 目录>)("puppeteer-core")` |
| crcmod 等源码包构建 EEXIST | pip 装 COS sdk 失败(沙箱对系统临时目录多次 mkdir 的限制) | 与 CVM 查询无关时 `--no-deps` 跳过；需要时关沙箱装 |
| 长视频渲染慢 | 5400 帧单线程 ~15min | 多 worker 并行(每 worker 独立 Chrome userDataDir，防配置文件竞争)~3min |
| 帧文件占磁盘 | 5400 PNG ~2GB | JPEG q=92 ~400MB，编码后自动清 |
| 并行 worker 的 Chrome 实例 | 6 实例内存/CPU 争抢 | 1080p 6 workers 实测可行；更慢的机器降 workers |

## 6. 渲染器 CLI 速查

```sh
node scripts/build.mjs <项目目录>                                  # 构建单文件
node scripts/render.mjs --html <项目目录>/index.html --to <总秒数>   # 全量(默认 30fps/6 workers/1920x1080)
node scripts/render.mjs --html ... --from 4 --to 7                 # 片段
node scripts/render.mjs --html ... --to 10 --fps 60 --workers 8    # 高帧率/多并行
node scripts/render.mjs --html ... --to 10 --keep-frames           # 留帧
node scripts/render.mjs --html ... --to 10 --quality 80            # JPEG 画质 1-100，默认 92
```

`--width/--height` 改内部分辨率，`--fps` 改输出帧率，`--workers` 改并行度，`--quality` 改 JPEG 画质(默认 92，想要更小文件调 70-80，更高质量调 95+)。

Chrome 定位：`--chrome` > `RENDER_CHROME` > 常见路径 > mdfind。puppeteer-core 定位：`RENDER_NODE_MODULES` > 托管 node 工作区 > `./node_modules`。
