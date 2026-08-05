# clink-integ-cli 使用文档

`clink-integ-cli` 是面向 ClinkBill 商户开发者和 AI agent 的集成工具。它通过 Secret Key 调用 Clink API，帮助完成产品与价格导入、checkout 创建、subscription 创建、webhook endpoint 管理、本地 webhook 验签模拟和集成 smoke test。CLI 内置 sandbox 和 production 环境，并支持自定义命名环境以适配 Clink 的不同请求域名（见“环境管理”）。

这份文档介绍日常使用方式。CLI 仓库开发和发布流程请看 `docs/cli-release-runbook.zh-CN.md`。

## 安装与版本确认

推荐在项目内隔离安装，尤其适合 AI agent、低代码平台、CI、云 IDE 和 sandbox 环境：

```bash
npm install --prefix ./.clink-tools github:5048429/clink-integ-cli
./.clink-tools/node_modules/.bin/clink --version
./.clink-tools/node_modules/.bin/clink --help
```

Windows PowerShell：

```powershell
.\.clink-tools\node_modules\.bin\clink.cmd --version
.\.clink-tools\node_modules\.bin\clink.cmd --help
```

开发者本机确认全局 npm 可用时，也可以全局安装：

```bash
npm install -g --install-links=true github:5048429/clink-integ-cli
clink --version
clink --help
```

`--install-links=true` 用于规避部分 npm/Windows 环境对 Git 依赖生成失效 junction 的问题。Git URL 安装使用仓库已提交的 `dist/` 产物，不需要在业务项目里现场编译 TypeScript 或补装 Node 类型声明。

安装后建议检查核心能力：

```bash
clink auth secret set --help
clink api request --help
clink catalog import --help
clink webhook endpoint ensure --help
```

## 环境管理（请求域名）

CLI 内置两个环境：`sandbox`（默认，`https://uat-api.clinkbill.com/api/`）和 `production`（`https://api.clinkbill.com/api/`）。Clink 还有多套联调/自建环境，你可以在本地配置里自定义命名环境，无需修改代码或重新安装。每个环境会同时切换 **Clink API base URL** 和 **Dashboard Console 地址**（Dashboard API、登录页、ClientID）。

新增一个自定义环境：

```bash
clink env add staging \
  --api-base-url https://staging-api.clinkbill.com/api/ \
  --dashboard-base-url https://staging-dashboard.clinkbill.com/prod-api/ \
  --dashboard-login-url https://staging-dashboard.clinkbill.com/auth/login \
  --dashboard-client-id <client-id>
```

只有 `--api-base-url` 是必填的；未提供的 dashboard 字段会回落到 UAT 默认值。

查看、使用和删除：

```bash
clink env list                  # 列出内置 + 自定义环境
clink env show staging --json   # 查看某个环境解析后的完整地址
clink --env staging auth status # 用 staging 环境执行命令，base URL 自动切换
clink env remove staging        # 删除自定义环境
```

自定义环境保存在 `~/.clink-integ-cli/config.json` 的 `environments` 字段下。内置环境（`sandbox`/`production`）不能删除；如需用同名覆盖内置环境，`env add` 要加 `--force`。

选择当前环境的方式（优先级从高到低）：

- 命令行 `--env <name>`
- `CLINK_ENV` 环境变量（支持内置名和自定义名）
- 已保存 profile 里的 `environment`
- 默认 `sandbox`

`--base-url` 和 `CLINK_BASE_URL` 仍可临时覆盖当前环境解析出的 API base URL，适合一次性调试，优先级高于环境注册表。

```bash
clink --env staging --base-url https://tmp-api.clinkbill.com/api/ auth status
```

## Secret Key 认证

Clink API 使用 Secret Key 认证。CLI 会为 API 请求自动发送：

```text
X-API-Key: <CLINK_SECRET_KEY>
X-Timestamp: <milliseconds timestamp>
Content-Type: application/json
```

如果已经有 sandbox Secret Key，优先通过环境变量配置：

```bash
export CLINK_SECRET_KEY=sk_test_xxx
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status --json
```

Windows PowerShell：

```powershell
$env:CLINK_SECRET_KEY="sk_test_xxx"
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status --json
```

也可以直接传入 literal key：

```bash
clink auth secret set --api-key sk_test_xxx --env sandbox
```

但在共享机器、CI、AI agent 和低代码平台中，更推荐 `env:CLINK_SECRET_KEY`，避免真实密钥进入命令历史、日志或仓库。

## 本地 Dashboard 登录辅助

`clink login` 只用于本地桌面环境下的人工辅助 bootstrap。当没有现成 Secret Key 且可以打开浏览器时，可以运行：

```bash
clink login
clink dashboard whoami --json
clink dashboard apikey ensure-secret --save --json
clink auth status --json
```

`clink login` 会打开 Dashboard 登录页。用户只在浏览器里手动登录；CLI 不会输入密码、绕过 MFA、读取验证码或解决 CAPTCHA。打开的 Dashboard 地址会跟随当前环境，默认是 sandbox 的 UAT Dashboard；如需对自定义环境登录，先用 `--env <name>` 选择，例如 `clink --env staging login`。

拿到 Secret Key 后，后续产品、价格、checkout、subscription、order、refund、webhook endpoint、doctor、smoke-test 和 `api request` 都应使用 Secret Key API。正常集成不需要 Dashboard Console token。

如果业务运行时也需要 `CLINK_SECRET_KEY`，只在受控的本地 secret 写入步骤中使用：

```bash
clink dashboard apikey ensure-secret --save --show-secret --json
```

然后把值写入被 git 忽略的 `.env`、平台 Secret 或 secret manager。不要把真实 Secret Key 写入源码、README、测试 fixture、公开日志、前端变量或最终交付说明。

## Catalog 导入与图片管线

当网站、CMS、数据库、源码或价格页已经存在付费产品、订阅套餐、价格、币种或计费周期时，建议先生成 `clink-catalog.json`，再交给 CLI 导入。

CLI 不负责爬取网站。Agent 或开发者负责发现产品数据；CLI 负责校验、计划、导入和维护本地 sourceId 映射。

最小 catalog 示例：

```json
{
  "version": 1,
  "source": {
    "site": "https://merchant.example/pricing"
  },
  "products": [
    {
      "sourceId": "starter-plan",
      "name": "Starter",
      "description": "Starter subscription plan",
      "imageFile": "public/images/starter.png",
      "taxCategory": "software_service",
      "prices": [
        {
          "sourceId": "starter-monthly",
          "type": "recurring",
          "amount": 9.99,
          "currency": "USD",
          "interval": "month",
          "intervalCount": 1,
          "default": true
        }
      ]
    }
  ]
}
```

每个 product 必须提供且只提供一个图片来源：

- `imageId`：已有 Clink OSS 图片 ID。
- `imageUrl`：公开 HTTP(S) 图片 URL。
- `imageFile`：本地图片路径，默认相对 `clink-catalog.json` 解析。

URL 不应写入 `imageId`，应写入 `imageUrl`。本地 public/static 图片应写入 `imageFile`，并可通过 `--project-root` 和 `--public-dir` 解析。

推荐流程：

```bash
clink catalog validate \
  --file ./clink-catalog.json \
  --project-root . \
  --public-dir public \
  --json

clink catalog plan \
  --file ./clink-catalog.json \
  --mapping-file ./.clink/catalog-map.json \
  --project-root . \
  --public-dir public \
  --json

clink catalog import \
  --file ./clink-catalog.json \
  --mapping-file ./.clink/catalog-map.json \
  --project-root . \
  --public-dir public \
  --json
```

`catalog validate` 会校验图片存在性、MIME 类型、大小和字段使用方式。支持的图片格式包括常见 `jpg/jpeg/png/gif/webp`，大小不得超过 5 MB。

`catalog plan` 会输出哪些图片将上传、哪些会复用 sha256 缓存、哪些会因为已有 OSS ID 或 mapping 而跳过。

`catalog import` 会自动下载 `imageUrl` 或读取 `imageFile`，上传到 `/product/image/upload`，拿到 `ossId` 后创建产品，并把 `sha256 -> ossId` 写入 mapping file，避免重复上传。

如只想查看 API 请求体，可使用 dry-run：

```bash
clink --dry-run --json catalog import --file ./clink-catalog.json
```

## Product 与 Price 命令

单个测试产品可以直接创建：

```bash
clink product create \
  --name "Starter" \
  --image-id oss_xxx \
  --tax-category software_service \
  --amount 9.99 \
  --currency USD \
  --type recurring \
  --interval month \
  --default \
  --json
```

常用命令：

```bash
clink product list --json
clink price create --product-id prd_xxx --amount 9.99 --currency USD --type recurring --interval month --json
clink price list --product-id prd_xxx --json
```

真实站点已有多个产品或套餐时，优先使用 `clink catalog validate/plan/import`，不要让用户手动复制大量 `productId` 和 `priceId`。

## Checkout 命令

创建 inline 一次性 checkout：

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 10 \
  --currency USD \
  --name "A One-time purchase" \
  --quantity 1 \
  --merchant-reference-id "order-123" \
  --success-url https://your-site.com/success \
  --cancel-url https://your-site.com/cancel \
  --json
```

使用已注册的 Clink product 和 price：

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 9.99 \
  --currency USD \
  --product-id prd_xxx \
  --price-id price_xxx \
  --merchant-reference-id "order-123" \
  --success-url https://your-site.com/success \
  --cancel-url https://your-site.com/cancel \
  --json
```

查询 checkout session：

```bash
clink checkout get sess_xxx --json
```

`merchantReferenceId` 用于关联本地订单和 Clink 订单，不是 Clink 侧幂等键。支付完成状态应以 webhook 和服务端查询为准，不能只依赖 `successUrl`。

## Subscription 命令

创建 subscription：

```bash
clink subscription create \
  --customer-email buyer@example.com \
  --product-id prd_xxx \
  --price-id price_xxx \
  --payment-instrument-id pi_xxx \
  --payment-method-type CARD \
  --payment-currency USD \
  --return-url https://your-site.com/account \
  --json
```

查询和取消：

```bash
clink subscription get sub_xxx --json
clink subscription cancel sub_xxx --reason "No longer needed" --json
```

如果没有 `paymentInstrumentId`，不要伪造订阅成功。应先通过真实 checkout 或客户支付方式流程获得可用 payment instrument，再创建 subscription。

## Order、Refund、Payment 和 Billing 命令

订单：

```bash
clink order list --page 1 --page-size 20 --json
clink order get order_xxx --json
```

退款：

```bash
clink refund create \
  --order-id order_xxx \
  --refund-merchant-order-id refund_merchant_xxx \
  --amount 9.99 \
  --json

clink refund get rfd_xxx --json
```

Billing portal：

```bash
clink billing portal-session \
  --customer-id cus_xxx \
  --return-url https://your-site.com/account \
  --json
```

Payment API：

```bash
clink payment create \
  --data '{"customerEmail":"buyer@example.com","paymentInstrumentId":"pi_xxx","paymentMethodType":"CARD","amount":9.99,"currency":"USD","returnUrl":"https://your-site.com/payment/return"}' \
  --json

clink payment instrument create \
  --data '{"customerEmail":"buyer@example.com","paymentInstrumentType":"GCASH"}' \
  --json
```

尚未封装为专用命令的公开 API，可用：

```bash
clink api request GET /order --query pageNum=1 --query pageSize=20 --json
clink api request POST /refund --data '{"orderId":"order_xxx","refundMerchantOrderId":"refund_merchant_xxx","refundAmount":9.99}' --json
```

## Webhook Endpoint 管理

Webhook endpoint 管理使用 Secret Key API，不需要 `clink login` 或 Dashboard Console token。

查看事件目录：

```bash
clink webhook endpoint events --json
```

常用 endpoint 命令：

```bash
clink webhook endpoint list --json

clink webhook endpoint ensure \
  --url https://your-public-host.example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --json

clink webhook endpoint update whk_xxx \
  --url https://new-public-host.example.com/api/clink/webhook \
  --events commerce \
  --json

clink webhook endpoint enable whk_xxx --json
clink webhook endpoint disable whk_xxx --json
clink webhook endpoint rotate-secret whk_xxx --save-secret --json
clink webhook endpoint delete whk_xxx --json
```

`clink dashboard webhook ensure` 只是兼容旧脚本的别名，底层同样使用 Secret Key API。新接入优先使用 `clink webhook endpoint ensure`。

Endpoint URL 必须是公网 HTTPS，不能使用 localhost、loopback、private、link-local 或 multicast host。

事件参数说明：

- `--events core`：兼容预设，固定展开为 `session.complete`、`order.succeeded`、`order.failed`、`refund.succeeded`、`subscription.created`、`invoice.paid` 这 6 个事件。它不是完整订阅预设，不覆盖完整订阅生命周期、催缴、取消、争议/拒付、`refund.failed` 和 `session.expired`。
- `--events checkout`：2 个 session、4 个 order、3 个 refund，共 9 个事件。
- `--events subscriptions`：11 个 subscription 生命周期事件加 3 个 invoice 事件，共 14 个。
- `--events disputes`：5 个争议生命周期事件。
- `--events payment-methods`：当前公开的 3 个 payment method 事件；只有运行时 Catalog 返回 `payment_method.deleted` 时才会加入。
- `--events commerce`：推荐用于完整收费接入，是 checkout、subscriptions、disputes、payment-methods 的并集；在当前 44 事件 Catalog 中为 31 个。
- `--events all`：使用运行环境 `GET /webhook/events` 实际返回的全部事件。
- 支持组合 preset，例如 `--events checkout,subscriptions,disputes,payment-methods`，CLI 会自动去重。
- 自定义事件列表：使用逗号分隔的事件名，例如 `order.succeeded,invoice.paid`。

CLI 每次解析事件前都会调用运行环境的 `GET /webhook/events`，同时读取 events 和 aliases。preset 所需事件如果不在运行时 Catalog，命令会失败并列出缺失项，不会静默裁剪。

`webhook endpoint ensure` 对事件集合执行 **replace，而不是 merge**：

1. 先按 URL 查询现有 endpoint。
2. 展示 `added`、`removed`、`unchanged`。
3. 只要会删除现有事件，默认退出非 0；必须显式传入 `--allow-remove-events`，交互终端还会再次确认。
4. PUT 完成后重新读取 endpoint，最终事件集合与 resolved events 不完全一致时退出非 0。

公开 API 请求体使用事件名，不使用 Dashboard 数字 event code。

## Webhook Signing Key 与 .env 同步

`--save-secret` 会把返回的 signing secret 保存到当前 CLI profile，供 `clink webhook simulate/sign/verify` 使用。

本地项目建议直接同步到 `.env.local`：

```bash
clink webhook endpoint ensure \
  --url https://your-public-host.example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --sync-env-file .env.local \
  --json
```

如果写入 env 后需要自动重启本地服务：

```bash
clink webhook endpoint ensure \
  --url https://your-public-host.example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --sync-env-file .env.local \
  --restart-command "npm run restart" \
  --json
```

`--restart-command` 应使用会执行完成并退出的重启命令，例如进程管理器 restart、触发框架热重载的脚本或自定义 restart script。不要传入会长期占用终端的 dev server 前台命令。

如果现有 endpoint 无法返回旧的 plaintext signing secret，当使用 `--save-secret`、`--show-secret` 或 `--sync-env-file` 时，`ensure` 会请求 API 在必要时 rotate secret，以获得可用明文。轮换会立即使旧 signing key 失效，必须同步新 `CLINK_WEBHOOK_SIGNING_KEY` 并重启或重新部署服务后再验证 webhook。

## 本地 Webhook 开发

生成 fixture：

```bash
clink webhook fixture invoice.paid --out ./fixtures/invoice-paid.json --json
```

默认 profile 是 `merchant-webhook`：事件 ID 使用 `event_` 前缀，外层 `object` 固定为 `event`，`created` 是 Unix 毫秒整数，完整资源位于 `data.object`。旧摊平格式只能通过 `--fixture-profile legacy` 显式生成，并会输出 deprecated warning：

```bash
clink webhook fixture invoice.paid --fixture-profile legacy --out ./fixtures/invoice-paid-legacy.json --json
```

签名：

```bash
clink webhook sign \
  --body-file ./fixtures/invoice-paid.json \
  --secret env:CLINK_WEBHOOK_SIGNING_KEY \
  --json
```

验签：

```bash
clink webhook verify \
  --body-file ./fixtures/invoice-paid.json \
  --secret env:CLINK_WEBHOOK_SIGNING_KEY \
  --timestamp <timestamp-from-sign> \
  --signature <signature-from-sign> \
  --tolerance-seconds 300 \
  --json
```

转发签名模拟 webhook 到本地或公网 endpoint：

```bash
clink webhook simulate order.succeeded \
  --secret env:CLINK_WEBHOOK_SIGNING_KEY \
  --forward-to http://localhost:3000/api/clink/webhook \
  --json
```

Webhook 签名算法是：

```text
HMAC_SHA256(CLINK_WEBHOOK_SIGNING_KEY, X-Clink-Timestamp + "." + rawBody)
```

Webhook handler 必须先保留 raw body 并完成验签，再执行 `JSON.parse` 和 normalize；不得先改写或重新序列化 body。canonical 载荷直接处理对象形式的 `data.object`。legacy 载荷只在 `data.object` 为字符串时迁移字段、把 ISO `created` 转成毫秒并把 `lineItems` 改为 `items`，同时记录只包含 `event.id` 和 `event.type` 的结构化 warning/metric。无法识别的载荷和未知事件必须返回非 2xx，进入项目的 Inbox/重试策略，不得静默返回 200。

此外仍需幂等处理并容忍重试和乱序事件。订单匹配建议使用 `merchantReferenceId` + `sessionId` 双重匹配。

## Smoke Test 与真实支付验收

运行 CLI 健康检查：

```bash
clink doctor --json
```

运行 smoke test：

```bash
clink smoke-test --webhook-url https://your-public-host.example.com/api/clink/webhook --json
```

`smoke-test` 可以创建 checkout session 并发送签名模拟 webhook，但 webhook HTTP 200 不是真实支付完成标准。

真实 sandbox 支付验收必须确认：

- 用户打开真实 `checkoutUrl` 并完成 sandbox 测试支付。
- 真实 webhook 到达并通过签名验证。
- 本地订单通过 `merchantReferenceId` + `sessionId` 匹配并变为 paid/completed。
- 权益、额度、下载权限、发货或其他 fulfillment 已完成。

不能把“真实 checkout session 创建成功 + 签名模拟 webhook 通过”描述为“真实支付全链路完成”。

## Framework Starters

生成常见服务端框架 starter：

```bash
clink init --framework nextjs --out ./tmp-next --force --json
clink init --framework express --out ./tmp-express --force --json
clink init --framework fastapi --out ./tmp-fastapi --force --json
```

Starter 包含 checkout、subscription、raw-body webhook 示例、`.env.example`、curl 示例和接入文档。它们适合作为字段和实现参考，不应无脑覆盖已有业务项目。

## 常见问题

### 低代码平台为什么不应该手动要 webhook signing key？

Webhook signing key 应由 `clink webhook endpoint ensure --save-secret` 创建、返回、保存或轮换。Agent 如果有平台 Secret 写入能力，应直接把返回的 signing key 写入 `CLINK_WEBHOOK_SIGNING_KEY` 并重新部署。只有平台没有 agent 可用的 Secret 写入能力时，才把“人工写入 signing key”列为剩余步骤。

### 什么时候用 `--events all`？

完整收费接入默认用 `--events commerce`；它覆盖 checkout、11 个 subscription 生命周期事件、3 个 invoice、dispute 和公开 payment method 事件。`all` 适合确实还需要 risk rule、agent order/refund、purchase instruction 或 VIC device 等 commerce 以外事件的场景。

### CLI 会自动扫描网站商品吗？

不会。商品发现是 agent 或开发者的责任。CLI 接收 `clink-catalog.json`，负责校验、计划、导入、上传图片和维护 sourceId 映射。

### 是否还需要 Dashboard Console token？

配置好 `CLINK_SECRET_KEY` 后，正常的 product/catalog import、checkout、subscription、order、refund、payment、billing portal、webhook endpoint、doctor、smoke-test 和 `api request` 都不需要 Dashboard Console token。`clink login` 只作为本地桌面环境下获取或初始化 Secret Key 的辅助路径。
