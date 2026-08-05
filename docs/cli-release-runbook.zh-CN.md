# Clink Integ CLI 更新与发布操作指南

这份文档用于指导人或 AI agent 迭代 `clink-integ-cli`，避免“功能已经推到某个远程分支，但用户/低代码平台安装默认 GitHub 包时仍拿到旧 CLI”的问题。

核心原则：

- Agent、低代码平台、沙箱和 CI 默认使用 `npm install --prefix ./.clink-tools github:5048429/clink-integ-cli`，避免全局 npm 目录权限、旧版本残留或文件锁。
- 开发者本机确认全局 npm 可用时，可以使用 `npm install -g --install-links=true github:5048429/clink-integ-cli`。
- 因此，面向用户的能力必须合并到 GitHub 默认分支 `main`。
- 仅推送 feature/integration 分支不等于发布。
- Git URL 安装必须使用仓库提交的 `dist/` 产物，不能依赖安装环境现场编译 TypeScript 或安装 Node 类型声明；`prepare` 只能做轻量 `dist/` 存在性校验，不能构建。
- 每次新增会影响 agent 接入流程的 CLI 能力，都必须完成远程安装验证。

## 1. 发布前检查

进入仓库：

```bash
cd D:/Clink_intern/AutoCliSurvey/clink-integ-cli
git status --short --branch
git branch --show-current
git remote -v
```

如果有无关未提交改动：

- 不要顺手提交。
- 先判断是否属于本次发布。
- 无关改动可以保留未跟踪状态，或用 `git stash push -u -m "wip before cli release"` 暂存。

确认目标功能在哪个分支，例如：

```bash
git branch -vv
git log --oneline --decorate --graph --all -20
```

## 2. 在功能分支验证

切到功能分支：

```bash
git checkout <feature-or-integration-branch>
git pull --ff-only origin <feature-or-integration-branch>
npm install
npm run verify
```

`npm run verify` 必须通过：

- `npm run check`
- `npm test`
- `npm run build`

如果新增了命令能力，必须直接验证命令帮助输出。例如 dashboardless Secret Key auth：

```bash
node dist/index.js --version
node dist/index.js auth secret set --help
node dist/index.js webhook endpoint ensure --help
```

需要确认的关键能力示例：

```text
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink webhook endpoint ensure --save-secret --show-secret
```

## 3. 合并到 main

更新 main：

```bash
git checkout main
git pull --ff-only origin main
```

合并功能分支：

```bash
git merge --no-ff <feature-or-integration-branch> -m "Merge <short feature name>"
```

如果有冲突：

1. 只解决本次功能相关冲突。
2. 不要删除或覆盖用户未说明的本地文件。
3. 解决后重新运行验证。

## 4. Bump 版本号

只要发布给用户安装，就要 bump 版本。通常使用 patch：

```bash
npm version patch --no-git-tag-version
```

这会更新：

- `package.json`
- `package-lock.json`

版本号更新后重新构建，并确认 `dist/` 会进入提交：

```bash
npm run build
git status --short
git ls-files dist/index.js
```

提交版本号、源码、文档和 `dist/`：

```bash
git add package.json package-lock.json src dist README.md docs
git commit -m "Release clink-integ-cli v<new-version>"
```

不要只改代码不改版本，否则 agent 很难判断自己是否拿到新能力。
不要只提交源码不提交 `dist/`，否则 Git URL 安装会拿不到可执行产物。

## 5. 在 main 上重新验证

```bash
npm run verify
node dist/index.js --version
node dist/index.js auth secret set --help
node dist/index.js webhook endpoint ensure --help
npm run pack:dry-run
```

如果发布的是其他能力，请替换成对应命令的 `--help` 或 dry-run 验证。

## 6. 推送 main 和 tag

确认没有意外文件进入提交：

```bash
git status --short --branch
git log --oneline --decorate -5
```

推送 main：

```bash
git push origin main
```

创建并推送 tag，tag 名与版本号一致：

```bash
git tag v<new-version>
git push origin v<new-version>
```

如果 tag 已存在，不要覆盖。先确认远端：

```bash
git ls-remote --tags origin v<new-version>
```

## 7. 远程安装验证（必须）

这是最容易漏掉、也最关键的一步。

创建临时目录，从 GitHub 默认分支安装到项目内工具目录：

```bash
tmp="$(mktemp -d)"
npm install --prefix "$tmp/.clink-tools" github:5048429/clink-integ-cli
"$tmp/.clink-tools/node_modules/.bin/clink" --version
"$tmp/.clink-tools/node_modules/.bin/clink" auth secret set --help
"$tmp/.clink-tools/node_modules/.bin/clink" webhook endpoint ensure --help
```

Windows PowerShell：

```powershell
$tmp = Join-Path $env:TEMP ("clink-install-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
npm install --prefix (Join-Path $tmp ".clink-tools") github:5048429/clink-integ-cli
& (Join-Path $tmp ".clink-tools\node_modules\.bin\clink.cmd") --version
& (Join-Path $tmp ".clink-tools\node_modules\.bin\clink.cmd") auth secret set --help
& (Join-Path $tmp ".clink-tools\node_modules\.bin\clink.cmd") webhook endpoint ensure --help
```

再验证 tag 安装：

```bash
npm install --prefix "$tmp/.clink-tools-tag" github:5048429/clink-integ-cli#v<new-version>
"$tmp/.clink-tools-tag/node_modules/.bin/clink" --version
```

如果默认分支安装没有拿到新能力，说明功能没有正确进入 `main`，不能交付。

如需额外验证全局安装，不要复用可能有锁的旧全局目录；使用临时 prefix 模拟。`--install-links=true` 用于规避部分 npm/Windows 环境对 Git 依赖生成失效 junction 的问题：

```bash
npm install -g --install-links=true --prefix "$tmp/global-prefix" github:5048429/clink-integ-cli
"$tmp/global-prefix/bin/clink" --version
```

## 8. 更新 agent 提示词

如果 CLI 能力会影响 agent 接入流程，发布 CLI 后要同步更新提示词仓库：

```bash
cd D:/Clink_intern/agent-prompts
git status --short --branch
```

更新原则：

- 提示词不要硬编码某个具体版本号，除非需要临时规避坏版本。
- 提示词应要求 agent 安装最新 `clink` 并检查命令能力。
- 对关键流程使用能力检查，例如：

```bash
clink --version
clink auth secret set --help
clink webhook endpoint ensure --help
```

如果能力不存在，提示 agent 更新 CLI，而不是把自动化步骤转嫁给用户。

更新后提交并推送：

```bash
git add <changed-files>
git commit -m "Update prompts for latest CLI flow"
git push
```

验证 raw GitHub 地址：

```bash
curl -L https://raw.githubusercontent.com/5048429/agent-prompts/main/clink-ai-auto-integration.zh-CN.md
curl -L https://raw.githubusercontent.com/5048429/agent-prompts/main/clink-universal-website-agent-prompt.zh-CN.md
```

## 9. 发布完成交付清单

发布完成后，最终回复或 PR 说明应包含：

- 合并来源分支
- main 最新 commit
- tag
- 新版本号
- `npm run verify` 结果
- GitHub 默认安装验证结果
- tag 安装验证结果
- 关键命令能力验证结果
- 是否同步更新 agent 提示词
- 是否存在未纳入发布的本地未跟踪文件

## 10. 常见问题

### 功能在远程分支上，但 agent 仍装到旧 CLI

原因：`github:5048429/clink-integ-cli` 默认安装 GitHub 默认分支 `main`。功能只在其他分支时，普通安装不会拿到。

解决：合并到 `main`，推送，打 tag，并做远程安装验证。

### agent 说某个命令不存在

先让 agent 运行：

```bash
clink --version
clink <command> --help
```

如果确实不存在，先更新 CLI。不要直接改成手工流程。

### 低代码/沙箱环境要求 webhook signing key

当前边界：

- 公开 Clink API 命令应优先使用 `CLINK_SECRET_KEY`，不要要求浏览器登录。
- webhook endpoint 管理已经支持 Secret Key API，不需要 Dashboard Console token 或 `clink login`。
- 完整收费接入优先使用 `clink webhook endpoint ensure --url <public-webhook-url> --events commerce --save-secret --json`；`core` 只作为 6 事件兼容预设。
- `clink dashboard webhook ...` 只作为兼容别名保留，底层也必须走 Secret Key API。

低代码/云 IDE/sandbox 的正确流程是：

1. 先让用户提供 `CLINK_SECRET_KEY`。
2. agent 用 `clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox` 保存认证。
3. agent 用 `clink webhook endpoint ensure --save-secret` 通过官方 Secret Key API 配置 webhook endpoint。
4. agent 写入平台 Secret `CLINK_WEBHOOK_SIGNING_KEY`。
5. 重新部署/重启。

不要一开始就让用户同时提供 `CLINK_SECRET_KEY` 和 `CLINK_WEBHOOK_SIGNING_KEY`。正确说法是：先提供 `CLINK_SECRET_KEY`；agent 会用 CLI 自动配置 webhook endpoint，并把生成或轮换得到的 signing key 写入平台 Secret。
