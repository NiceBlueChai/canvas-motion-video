#!/usr/bin/env node
/**
 * build.mjs - 把 GSAP 内联进 src.html, 产出单文件 index.html
 *
 * 用法:
 *   node build.mjs <项目目录>            # 默认读 <项目目录>/src.html
 *   GSAP_PATH=/path/gsap.min.js node build.mjs <项目目录>
 *
 * GSAP 解析顺序: 环境变量 GSAP_PATH → <项目目录>/gsap.min.js
 *   → 共享缓存 /tmp/motion_assets/gsap.min.js → 多镜像下载(缓存到 /tmp)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const projectDir = path.resolve(process.argv[2] || ".");
const srcPath = path.join(projectDir, "src.html");
const outPath = path.join(projectDir, "index.html");
const cacheDir = "/tmp/motion_assets";
const cachePath = path.join(cacheDir, "gsap.min.js");

if (!existsSync(srcPath)) {
  console.error("ERROR: 找不到 " + srcPath);
  process.exit(1);
}

function resolveGsap() {
  const candidates = [
    process.env.GSAP_PATH,
    path.join(projectDir, "gsap.min.js"),
    cachePath
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c) && readFileSync(c, "utf8").includes("GSAP")) return readFileSync(c, "utf8");
  }
  /* 下载(jsdelivr 在某些网络下 SSL 失败, 按序尝试) */
  const mirrors = [
    "https://unpkg.com/gsap@3.12.5/dist/gsap.min.js",
    "https://cdn.bootcdn.com/ajax/libs/gsap/3.12.5/gsap.min.js",
    "https://lib.baomitu.com/gsap/3.12.5/gsap.min.js",
    "https://registry.npmmirror.com/gsap/3.12.5/files/dist/gsap.min.js"
  ];
  mkdirSync(cacheDir, { recursive: true });
  for (const url of mirrors) {
    try {
      execFileSync("curl", ["-sL", "--max-time", "30", url, "-o", cachePath], { stdio: "ignore" });
      const txt = readFileSync(cachePath, "utf8");
      if (txt.includes("GSAP")) { console.log("[build] GSAP downloaded from " + url); return txt; }
    } catch (e) { /* next mirror */ }
  }
  console.error("ERROR: GSAP 下载失败, 手动放置后设 GSAP_PATH");
  process.exit(1);
}

const gsap = resolveGsap();
const tpl = readFileSync(srcPath, "utf8");
if (!tpl.includes("<!--GSAP_SRC-->")) {
  console.error("ERROR: src.html 中找不到 <!--GSAP_SRC--> 占位符(应位于 <head> 内)");
  process.exit(1);
}
const out = tpl.replace("<!--GSAP_SRC-->", () => "<script>\n" + gsap + "\n</script>");
writeFileSync(outPath, out);
console.log("built " + outPath + " (" + (out.length / 1024).toFixed(1) + " KB, GSAP inlined)");
