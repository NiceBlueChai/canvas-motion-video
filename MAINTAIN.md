# 维护规范 · 三副本同步

这个 skill 有三份副本，职责不同，**必须分清哪个是真相源**，否则改来改去会漂移。

| # | 位置 | 角色 | 版本管理 |
|---|---|---|---|
| 1 | `~/.workbuddy/skills/canvas-motion-video` | **真相源**。唯一允许直接编辑的地方，WorkBuddy 从这里加载 | git，分支 `auto-optimize/20261015-2210`，含全部优化历史 |
| 2 | `~/.agents/skills/canvas-motion-video` | 本机分发副本，供 `~/.agents` 体系的其他 runtime 使用 | 无 git，纯 rsync 产物 |
| 3 | 本仓库 `skills/canvas-motion-video` | **发布源**。推到 GitHub + Gitee，`npx skills add` 从这里发现 | git，分支 `main`，干净的单 focus 提交历史 |

## 铁律

1. **只改 #1**。#2 和 #3 都是生成物，手改一次就会和真相源漂移，下次同步被静默覆盖。
2. **同步后必须校验**，不能只信 rsync 退出码。本仓库曾发生过 SKILL.md 被外部进程改写污染的事故（frontmatter 的 `---` 被转义、`<!--GSAP_SRC-->` 字面量被删），所以校验要看**内容特征**而不是只看文件在不在。

## 同步命令

改完 #1 并 commit 后，一把梭同步 #2 和 #3：

```bash
SRC=~/.workbuddy/skills/canvas-motion-video
PUB=~/WorkBuddy/2026-10-14-23-46-38/canvas-motion-video

# → #2 本机分发副本
rsync -a --delete --exclude='.git' --exclude='.DS_Store' \
  "$SRC/" ~/.agents/skills/canvas-motion-video/

# → #3 发布源（注意发布仓库根目录还有 README/LICENSE/.gitignore，不能 --delete 到根）
rsync -a --exclude='.git' --exclude='.DS_Store' --exclude='.gitignore' \
  "$SRC/" "$PUB/skills/canvas-motion-video/"
```

## 同步后校验（必做）

```bash
SRC=~/.workbuddy/skills/canvas-motion-video
PUB=~/WorkBuddy/2026-10-14-23-46-38/canvas-motion-video

# 1) 字节级一致
diff -q "$SRC/SKILL.md" "$PUB/skills/canvas-motion-video/SKILL.md"

# 2) 内容特征未被污染（任一项为 0 就是被改了，立刻 git checkout 恢复）
grep -c '<!--GSAP_SRC-->' "$PUB/skills/canvas-motion-video/SKILL.md"   # 应为 1
grep -c '^---$'          "$PUB/skills/canvas-motion-video/SKILL.md"   # 应为 2
wc -c                    "$PUB/skills/canvas-motion-video/SKILL.md"   # 基线 6636，红线 6687

# 3) 无机器专属绝对路径泄漏
grep -rn '/Users/' "$PUB/skills/canvas-motion-video/" || echo clean
```

任一校验不过 → `cd ~/.workbuddy/skills/canvas-motion-video && git checkout -- SKILL.md` 后重同步。

## 发布

remote 由维护方提供，两个平台内容一致：

```bash
cd <发布仓库>
git remote add origin <GitHub 地址>
git remote set-url --add --push origin <GitHub 地址>   # 或分别配置
git push -u origin main
```

安装侧：

```bash
npx skills add <owner>/<repo> --skill canvas-motion-video          # GitHub
npx skills add https://gitee.com/<owner>/<repo> --skill canvas-motion-video   # Gitee（完整 URL）
```

## 加新 skill 进这个仓库

在 `skills/` 下新建子目录，各自一个 `SKILL.md`，CLI 靠这个路径发现：

```bash
mkdir -p skills/<new-skill-name>
npx skills init skills/<new-skill-name>   # 生成规范模板再改
```

SKILL.md 里的相对路径引用（`scripts/`、`references/`、`assets/`）一律相对 skill 自己的目录，**不要**写仓库根目录的相对路径，否则安装后会断。
