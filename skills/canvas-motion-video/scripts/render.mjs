#!/usr/bin/env node
/**
 * render.mjs - 命令行动效模式：无头 Chrome 多 worker 并行截帧 + ffmpeg 合成 MP4
 *
 * 用法:
 *   node render.mjs --html index.html --to 10                  # 全段 1920x1080@30fps, 6 workers
 *   node render.mjs --html index.html --to 180 --workers 8     # 长视频多并行
 *   node render.mjs --html index.html --from 4 --to 7          # 只渲染 4-7s 片段
 *   node render.mjs --html index.html --to 10 --fps 24         # 24fps
 *   node render.mjs --html index.html --to 10 --keep-frames    # 保留逐帧 JPEG
 *   node render.mjs --html index.html --to 10 --quality 80     # JPEG 画质 1-100，默认 92
 *
 * 原理: HTML 暴露 window.__seek(t) 把 GSAP 时间轴暂停到 t 重绘一帧，
 * 每帧独立 → 可任意并行、输出可复现、与播放帧率解耦。
 *
 * 依赖: puppeteer-core(复用本机 Chrome, 见下方解析顺序) + 系统 ffmpeg
 */
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const args = {
    html: "index.html", fps: 30, out: "out/motion.mp4", framesDir: ".frames",
    from: 0, to: 10, keepFrames: false, workers: 6,
    width: 1920, height: 1080, quality: 92,
    chrome: process.env.RENDER_CHROME || ""
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--html") args.html = argv[++i];
    else if (a === "--fps") args.fps = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--frames-dir") args.framesDir = argv[++i];
    else if (a === "--from") args.from = parseFloat(argv[++i]);
    else if (a === "--to") args.to = parseFloat(argv[++i]);
    else if (a === "--keep-frames") args.keepFrames = true;
    else if (a === "--workers") args.workers = parseInt(argv[++i], 10);
    else if (a === "--width") args.width = parseInt(argv[++i], 10);
    else if (a === "--height") args.height = parseInt(argv[++i], 10);
    else if (a === "--quality") args.quality = Math.min(100, Math.max(1, parseInt(argv[++i], 10) || 92));
    else if (a === "--chrome") args.chrome = argv[++i];
    else if (a === "--help" || a === "-h") { console.log("see header comment"); process.exit(0); }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const W = args.width, H = args.height;
const framesDir = path.resolve(args.framesDir);
const outPath = path.resolve(args.out);
const htmlPath = path.resolve(args.html);

if (!fs.existsSync(htmlPath)) {
  console.error("ERROR: HTML 不存在: " + htmlPath);
  process.exit(1);
}

/* ---------- Chrome 定位 ---------- */
function findChrome() {
  if (args.chrome && fs.existsSync(args.chrome)) return args.chrome;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const found = execFileSync("mdfind", ["kMDItemCFBundleIdentifier == 'com.google.Chrome'"], { encoding: "utf8" })
      .split("\n")[0].trim();
    if (found) {
      const p = path.join(found, "Contents/MacOS/Google Chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ---------- puppeteer-core 解析(ESM 不吃 NODE_PATH, 用 createRequire) ----------
 * 候选取相对路径，不硬编码任何机器专属绝对路径，保证 skill 可整目录复制迁移 */
function loadPuppeteer() {
  const dirs = [
    process.env.RENDER_NODE_MODULES,
    path.join(here, "node_modules"),
    path.join(here, "..", "node_modules"),
    path.join(process.cwd(), "node_modules")
  ].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(path.join(d, "package.json"))("puppeteer-core"); }
    catch (e) { /* try next */ }
  }
  console.error("ERROR: 找不到 puppeteer-core。任选其一:\n" +
    "  1) 设置 RENDER_NODE_MODULES=<含 puppeteer-core 的 node_modules 目录>\n" +
    "  2) 在任意目录 npm install puppeteer-core 后设 RENDER_NODE_MODULES 指向它");
  process.exit(1);
}
const puppeteer = loadPuppeteer();

/* ================= worker 模式: 截取一段帧 ================= */
async function captureRange(fromT, toT) {
  const chrome = findChrome();
  if (!chrome) { console.error("ERROR: 找不到 Chrome, 用 --chrome 指定"); process.exit(1); }
  const startIdx = Math.round(fromT * args.fps);
  const endIdx = Math.round(toT * args.fps);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-chrome-"));
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: userDir,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars"]
  });
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto("file://" + htmlPath, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true", { timeout: 20000 });
    for (let idx = startIdx; idx < endIdx; idx++) {
      const t = idx / args.fps;
      await page.evaluate((tt) => window.__seek(tt), t);
      const file = path.join(framesDir, "f_" + String(idx).padStart(5, "0") + ".jpg");
      await page.screenshot({ path: file, type: "jpeg", quality: args.quality, clip: { x: 0, y: 0, width: W, height: H }, captureBeyondViewport: false });
      if ((idx - startIdx) % 150 === 0) {
        console.log(`[worker ${process.pid}] frame ${idx} (t=${t.toFixed(1)}s) +${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }
    console.log(`[worker ${process.pid}] done ${endIdx - startIdx} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    /* 完成标记：父进程轮询此文件而非 await child exit 事件
     * （Node 22 top-level await + stdio:inherit 下 exit 事件可能不触发，EXIT=13） */
    fs.writeFileSync(path.join(framesDir, ".done_" + process.pid + ".marker"), "ok " + (endIdx - startIdx));
  } finally {
    await browser.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
}

if (process.env.WORKER_MODE === "1") {
  await captureRange(parseFloat(process.env.W_FROM), parseFloat(process.env.W_TO));
  process.exit(0);
}

/* ================= 父进程: 切段 spawn + 编码 ================= */
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(path.dirname(outPath), { recursive: true });

/* epsilon: 防 3.05-3=0.04999.. 被 round 成 0 帧 */
const totalFrames = Math.max(1, Math.round((args.to - args.from) * args.fps + 1e-6));
const workers = Math.max(1, Math.min(args.workers, totalFrames));
const chunk = Math.ceil(totalFrames / workers);
console.log(`[render] ${W}x${H} @ ${args.fps}fps, ${args.from}s -> ${args.to}s, ${totalFrames} frames, ${workers} workers`);

const t0 = Date.now();
const procs = [];
for (let w = 0; w < workers; w++) {
  const wa = args.from + (w * chunk) / args.fps;
  const wb = Math.min(args.to, args.from + ((w + 1) * chunk) / args.fps);
  if (wb <= wa) continue;
  /* 必须透传 CLI 参数, 否则子进程用默认值写错目录 */
  const child = spawn(process.execPath, [path.join(here, "render.mjs"), ...process.argv.slice(2)], {
    env: { ...process.env, WORKER_MODE: "1", W_FROM: String(wa), W_TO: String(wb) },
    stdio: "inherit"
  });
  child.unref();
  procs.push(child);
}

/* 轮询完成标记（不依赖 child exit 事件 —— Node 22 ESM top-level await 下不可靠） */
const expected = procs.length;
const timeoutMs = Math.max(180000, totalFrames * 100);  // 实测 ~0.02s/帧/6worker，留 5 倍余量
await new Promise((resolve, reject) => {
  const started = Date.now();
  const iv = setInterval(() => {
    let dones = [], fails = [];
    try {
      const files = fs.readdirSync(framesDir);
      dones = files.filter(f => f.startsWith(".done_"));
      fails = files.filter(f => f.startsWith(".fail_"));
    } catch (e) { /* framesDir 暂不可读，下一轮再试 */ }
    if (fails.length > 0) {
      clearInterval(iv);
      reject(new Error(fails.length + " worker(s) reported failure"));
    } else if (dones.length >= expected) {
      clearInterval(iv);
      resolve();
    } else if (Date.now() - started > timeoutMs) {
      clearInterval(iv);
      reject(new Error(`timeout: ${dones.length}/${expected} workers done in ${timeoutMs}ms`));
    }
  }, 200);
});
console.log(`[render] all frames captured in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

console.log("[ffmpeg] encoding -> " + outPath);
const startNumber = Math.round(args.from * args.fps);
execFileSync("ffmpeg", [
  "-y",
  "-framerate", String(args.fps),
  "-start_number", String(startNumber),
  "-i", path.join(framesDir, "f_%05d.jpg"),
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  outPath
], { stdio: ["ignore", "ignore", "inherit"] });

if (!args.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
const sizeMB = (fs.statSync(outPath).size / 1048576).toFixed(2);
const dur = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", outPath]).toString().trim();
console.log(`[done] ${outPath} (${sizeMB} MB, ${dur}s)`);
