# Agent 使用 Clink Integ CLI 接入说明

完整 CLI 命令和能力说明见 [clink-integ-cli 使用文档](cli-usage.zh-CN.md)。本文件只保留 agent 安装和执行策略。

目标：让接入 ClinkBill 的 agent 不需要手动 clone 本仓库，也不需要运行 `node dist/index.js`，而是自己安装 `clink` 命令并用它完成密钥、checkout、webhook 和本地验证。

## 前置要求

- Node.js 20 或更高版本
- 可以访问 GitHub
- 可以运行 `npm install`

## 推荐安装方式

Agent、沙箱、低代码平台、CI 环境默认使用项目内隔离安装，避免全局 npm 目录权限、旧版本残留或文件锁影响接入：

```bash
npm install --prefix ./.clink-tools github:5048429/clink-integ-cli
./.clink-tools/node_modules/.bin/clink --version
./.clink-tools/node_modules/.bin/clink --help
```

Windows PowerShell 本地路径：

```powershell
.\.clink-tools\node_modules\.bin\clink.cmd --version
.\.clink-tools\node_modules\.bin\clink.cmd --help
```

开发者自己的机器如果确认全局 npm 可用，也可以全局安装：

```bash
npm install -g --install-links=true github:5048429/clink-integ-cli
clink --version
clink --help
```

`--install-links=true` 用于规避部分 npm 版本在 Windows 全局安装 Git 依赖时生成失效 junction 的问题。

Git URL 安装会直接使用仓库提交的 `dist/` 产物，不需要在目标项目里现场编译 TypeScript 或安装 Node 类型声明。安装期 `prepare` 只校验 `dist/` 是否存在。

下文统一写 `clink`。如果使用本地安装，把 `clink` 替换为对应的本地 binary 路径。

## Agent 接入流程

1. 安装 CLI 并确认可运行：

```bash
clink --version
clink auth status --json
```

2. 如果已有 Secret Key，把它写入环境变量并保存到 CLI profile。官方公开 API 命令会使用 `X-API-KEY` + `X-Timestamp`，不需要浏览器登录：

```bash
export CLINK_SECRET_KEY=sk_uat_xxx
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
```

3. 如果没有 Secret Key，在 UAT Dashboard 登录后让 CLI 创建或读取 key：

```bash
clink login
clink dashboard apikey ensure-secret --save --json
```

4. 创建 checkout session：

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 10 \
  --currency USD \
  --name "AI Integration Test" \
  --quantity 1 \
  --success-url https://example.com/success \
  --cancel-url https://example.com/cancel \
  --json
```

5. 配置 webhook endpoint：

webhook endpoint 创建、更新、启用、禁用、删除、签名 key 轮换已经支持 Secret Key 公开 API，不需要 `clink login`。优先使用顶层 endpoint 命令；`clink dashboard webhook ensure` 仍作为兼容别名保留，但底层同样走 `X-API-KEY`。

```bash
clink webhook endpoint ensure \
  --url https://your-public-host.example.com/clink/webhook \
  --events commerce \
  --save-secret \
  --sync-env-file .env.local \
  --json
```

完整收费接入推荐 `--events commerce`，它从运行时 `GET /webhook/events` 校验并展开 checkout、subscriptions、disputes、payment-methods 的并集。`core` 仅保留 6 个兼容事件，不覆盖完整订阅生命周期、催缴、取消、拒付、`refund.failed` 和 `session.expired`。公开 API 不接受 Dashboard 数字 event code。

6. 本地验证 webhook 签名：

```bash
clink webhook simulate order.succeeded \
  --forward-to http://localhost:3000/clink/webhook \
  --json
```

7. 生成 starter 示例代码：

```bash
clink init --framework nextjs --out ./clink-demo --force --json
clink init --framework express --out ./clink-demo --force --json
clink init --framework fastapi --out ./clink-demo --force --json
```

## 可直接放进接入提示词的片段

```text
你需要先安装 Clink Integ CLI。不要使用 node dist/index.js。

默认安装到项目本地，避免全局 npm 目录权限或文件锁问题：
  npm install --prefix ./.clink-tools github:5048429/clink-integ-cli

Linux/macOS 使用：
  ./.clink-tools/node_modules/.bin/clink --version

Windows PowerShell 使用：
  .\.clink-tools\node_modules\.bin\clink.cmd --version

如果你确认当前机器全局 npm 可用，也可以全局安装：
  npm install -g --install-links=true github:5048429/clink-integ-cli
  clink --version

Git URL 安装应使用仓库内已提交的 dist 产物；不要因为缺少 Node 类型声明就在业务项目里补 TypeScript 构建依赖。即使看到 prepare，它也只应校验 dist，不应编译 TypeScript。

如果本地安装失败，请说明脱敏错误并重试一次：
  npm install --prefix ./.clink-tools github:5048429/clink-integ-cli

本地安装后，Linux/macOS 使用：
  ./.clink-tools/node_modules/.bin/clink

Windows PowerShell 使用：
  .\.clink-tools\node_modules\.bin\clink.cmd

之后用 clink 完成：
1. 如果已有 Secret Key：clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
2. 如果没有 Secret Key 且本地有浏览器：clink login && clink dashboard apikey ensure-secret --save --json
3. clink checkout create ... --json
4. clink api request GET /order --query pageNum=1 --query pageSize=20 --json
5. 如需完整收费 webhook 自动配置：clink webhook endpoint ensure --url <public-webhook-url> --events commerce --save-secret --sync-env-file .env.local --json
6. clink webhook simulate order.succeeded --forward-to <local-or-public-webhook-url> --json

所有涉及 Secret Key、Dashboard token、webhook signing key 的输出都必须打码，不要写入源码。
```
