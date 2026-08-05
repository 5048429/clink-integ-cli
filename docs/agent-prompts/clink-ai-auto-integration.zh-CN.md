# ClinkBill AI 自动接入提示词 v2

帮我把 ClinkBill 支付接入到当前项目。

目标：尽量全自动完成 UAT 支付接入。优先使用 CLI 自动化；如果运行环境没有可用浏览器或无法完成 Dashboard 登录，允许让我在 ClinkBill Dashboard 自己登录后，把 Secret Key 提供给 agent，由 agent 写入安全的服务端环境变量或平台 Secret。除此之外，不要让我手动复制 productId、priceId、webhook signing key，或手动配置 Dashboard webhook，除非当前 CLI/平台能力确实无法自动完成，并且你已明确说明原因。

请保持真实、可验证：如果没有人打开 `checkoutUrl` 并完成 UAT 测试支付，不要把“真实 checkout session 创建成功 + 签名模拟 webhook 通过”说成“真实付款全链路完成”。

## 资料

请先读取：

- https://github.com/clinkbillcom/clink-integ-skills
- https://docs.clinkbill.com/api-reference/introduction
- https://github.com/5048429/clink-integ-cli

如果资料中字段与本提示词不一致，以官方文档和当前 CLI 输出为准，并在最终回复中说明差异。

## 安装 CLI

不要使用 `node dist/index.js`。先安装并使用最新 `clink`。低代码/沙箱环境需要 CLI 支持 `clink auth secret set`，所以安装后必须检查命令能力。

Agent 默认使用项目内隔离安装，避免全局 npm 目录权限、旧版本残留或文件锁问题：

```bash
npm install --prefix ./.clink-tools github:5048429/clink-integ-cli
```

本地安装后：

- Linux/macOS: `./.clink-tools/node_modules/.bin/clink`
- Windows PowerShell: `.\.clink-tools\node_modules\.bin\clink.cmd`

下文统一写 `clink`，如果使用本地安装，请自动替换成对应路径。

如果你确认当前机器全局 npm 可用，也可以全局安装：

```bash
npm install -g --install-links=true github:5048429/clink-integ-cli
```

全局安装必须带 `--install-links=true`，用于规避部分 npm/Windows 环境对 Git 依赖生成失效 junction 的问题。

Git URL 安装应使用仓库内已提交的 `dist/` 产物；不要因为缺少 Node 类型声明就在业务项目里补 TypeScript 构建依赖。即使看到 prepare，它也只应校验 dist，不应编译 TypeScript。安装后必须检查命令能力：

```bash
clink auth secret set --help
clink api request --help
clink catalog import --help
clink webhook endpoint ensure --help
```

不要依赖环境里预装的旧版 `clink`。安装后必须检查命令能力：

- 必须支持 `clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox`
- 应支持 `clink api request`，用于调用当前官方 OpenAPI 中尚未被专用 CLI 命令封装的公开 API path
- 如果当前网站已有付费产品、订阅套餐或价格页，应支持 `clink catalog validate --help` / `clink catalog import --help`。产品扫描由 agent 完成，CLI 负责验证、计划、导入并保存 sourceId 映射，不要让用户手动复制 productId/priceId。
- `clink webhook endpoint ensure --help` 必须支持 `--save-secret`
- 如果需要把 webhook signing key 写入低代码/云平台 Secret，`clink webhook endpoint ensure --help` 还应支持 `--show-secret`
- `clink dashboard webhook ensure` 仅作为兼容别名保留，底层也应使用 Secret Key API；不要为了配置 webhook endpoint 要求 `clink login`。

## Webhook endpoint 当前硬规则

webhook endpoint 管理已经支持 Secret Key API。Agent 必须优先使用：

```bash
clink webhook endpoint ensure \
  --url <public-webhook-url> \
  --events commerce \
  --save-secret \
  --json
```

完整收费接入使用 `--events commerce`，CLI 会先读取运行时 `GET /webhook/events`，再展开 checkout、subscriptions、disputes 和 payment-methods 的并集。`core` 只保留 6 个兼容事件，不覆盖完整订阅生命周期、催缴、取消、拒付、`refund.failed` 和 `session.expired`。`--events all` 使用运行时 Catalog 的全部事件。`--save-secret` 会把 signing key 保存到 CLI profile；需要写入外部平台 Secret 时才使用 `--show-secret` 读取明文。

如果普通安装拿到的 CLI 过旧，不支持 `auth secret set`，请重新安装/更新最新 CLI 后再继续。不要因为旧 CLI 缺少能力就直接把 webhook 配置交给用户。

## 登录与密钥

根据运行环境选择认证方式。

### 路径 A：本地/桌面环境，有可用浏览器

优先运行：

```bash
clink login
```

如果 CLI 打开了 Dashboard 登录页，请暂停并提示我：

```text
请在打开的浏览器里完成 ClinkBill UAT Dashboard 登录。登录完成后告诉我继续。
```

我确认后继续：

```bash
clink dashboard whoami --json
clink dashboard apikey ensure-secret --save --json
clink auth status --json
```

### 路径 B：云环境/沙箱/无浏览器环境

如果 `clink login` 无法打开浏览器、无法捕获登录态，或当前是在低代码/云 IDE/sandbox 中运行，请不要卡死在登录流程。改用手动 Secret Key 兜底：

1. 明确提示我去 ClinkBill UAT Dashboard 登录并复制 Secret Key。
2. 我把 Secret Key 发给你后，你把它只写入安全的服务端环境变量、平台 Secret 或本地 `.env`。
3. 只向我索取 `CLINK_SECRET_KEY`。不要在这一步向我索取 `CLINK_WEBHOOK_SIGNING_KEY`，也不要让我手动复制 webhook signing key。
4. 使用当前 `clink` CLI 支持的 Secret Key 配置方式保存本地 profile；如果命令参数不确定，先运行：

```bash
clink auth secret set --help
```

5. 配置完成后运行：

```bash
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status --json
clink doctor --json
```

手动 Secret Key 是无浏览器环境的允许人工步骤。仍然必须遵守密钥保护规则：不要把真实 Secret Key 写入源码、README、测试 fixture、前端变量、公开日志或最终回复。

**Webhook signing key 规则（硬规则）**：

- `CLINK_WEBHOOK_SIGNING_KEY` 不应在初始接入时向用户索取。
- webhook endpoint 管理已经支持 Secret Key API。必须使用 `clink webhook endpoint ensure` 自动创建/更新 webhook endpoint，并自动保存/写入 signing key。
- `clink dashboard webhook ensure` 仅作为兼容别名保留；新接入默认不要使用，也不要为了配置 webhook endpoint 要求 `clink login`。
- 不要给用户同时索取 `CLINK_SECRET_KEY` 和 `CLINK_WEBHOOK_SIGNING_KEY` 的初始表单或消息。正确说法是：先提供 `CLINK_SECRET_KEY`；agent 会用 CLI 自动配置 webhook endpoint，并把生成或轮换得到的 signing key 写入项目运行环境。

如果项目需要 `.env`，可以用 CLI 获取真实 key 并写入 `.env`，但必须：

- 不要把真实 key 写进源码、README、测试 fixture 或最终回复
- 不要在最终回复中展示真实 key
- 确保 `.env` 被 git 忽略
- `.env.example` 只写占位符
- 每次运行 `clink webhook endpoint ensure --save-secret` 后，必须把 CLI profile 里最新的 webhook signing key 同步到 `.env`，然后重启本地服务，否则 webhook 验签会失败

推荐 `.env.example`：

```env
CLINK_ENV=sandbox
CLINK_BASE_URL=https://uat-api.clinkbill.com/api/
CLINK_SECRET_KEY=sk_uat_xxx
# 由 agent 在 clink webhook endpoint ensure --save-secret 后自动写入；不要让用户初始手动提供
CLINK_WEBHOOK_SIGNING_KEY=whsec_xxx
CLINK_SUBSCRIPTION_PRODUCT_ID=prod_xxx
CLINK_SUBSCRIPTION_PRICE_ID=price_xxx
CLINK_PAYMENT_INSTRUMENT_ID=pi_xxx
```

## 架构侦察（强制前置）

不要预设当前项目使用哪种后端架构，也不要根据文件名先入为主。接入前必须先自行收集证据，识别项目的真实运行方式。

在修改代码前，先完成以下侦察：

1. 列出项目根目录关键文件和目录，例如 package/lock 文件、依赖清单、部署配置、server 入口、api/routes 目录、环境变量示例、构建脚本。
2. 读取启动脚本、依赖、部署配置和 README，判断：
   - 前端入口在哪里
   - 是否存在服务端运行时
   - HTTP 路由在哪里定义
   - 环境变量如何注入
   - 订单/购买按钮/发货逻辑在哪里
   - 当前框架是否会默认解析 body，webhook 是否能拿到 raw body
3. 用搜索定位已有支付、订单、checkout、webhook、subscription、email、download、fulfillment 等相关代码。
4. 输出一小段“架构侦察结果”，说明你准备把 Clink 接入到哪些文件/模块，依据是什么。

如果没有发现可信的服务端运行时：

- 不要把 `CLINK_SECRET_KEY` 或 webhook signing key 放进前端代码
- 不要从浏览器直接请求 Clink UAT API
- 不要声称已经完成支付接入
- 应说明当前项目缺少安全保存密钥和接收 webhook 的后端能力
- 如果项目已有可部署的 serverless/functions/edge 目录或部署平台配置，可以在该后端能力中接入
- 如果完全是静态站点，应给出需要新增的最小后端/API 服务方案，并只在当前项目结构允许安全落地时实现

## 参考 starter

可以运行官方 starter 到临时目录作为字段和代码参考，但不要直接覆盖当前项目：

```bash
clink init --framework generic --out <temp-dir>
```

starter 只能作为 Clink 字段、签名、curl 和示例流程参考，不能替代架构侦察结果。只有在已经确认当前项目框架后，才可以生成对应 starter 到临时目录辅助参考。

## 代码接入

基于“架构侦察结果”接入 Clink。使用项目现有 HTTP/server 能力，不要在已有后端旁边平行引入一个无关的新后端框架。若必须新增最小服务端能力，需要说明原因，并保持与项目现有部署方式兼容。

必须实现：

1. 创建 checkout session 的服务端接口
2. 创建 subscription 的服务端接口
3. webhook 接收接口，并校验签名
4. 一个可一键启动的最小 demo
5. curl 示例
6. 本地自动测试或 smoke test

Clink UAT API：

```text
https://uat-api.clinkbill.com/api/
```

服务端请求必须带：

```text
X-API-Key: <CLINK_SECRET_KEY>
X-Timestamp: <milliseconds timestamp>
Content-Type: application/json
```

不要把 `CLINK_SECRET_KEY` 暴露到浏览器。前端只能调用自己后端的 API。

## Product catalog

如果当前网站、CMS、源码或价格页已经存在付费产品、一次性购买项、订阅套餐或多币种/多周期价格，先由 agent 扫描这些来源，生成确定性的 `clink-catalog.json`，再交给 CLI 导入。不要把“扫描网站”放进 CLI；CLI 的职责是验证、预览计划、调用官方 Product/Price API 并维护本地映射。

推荐流程：

```bash
clink catalog validate --file ./clink-catalog.json --json
clink catalog plan --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --json
clink catalog import --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --json
```

生成 catalog 时，每个 product 和 price 必须有稳定 `sourceId`，来源可以是站点 slug、SKU、CMS ID、路由名或 agent 生成后可重复的 slug。重复运行时，CLI 会用 mapping 文件跳过已导入的 product/price，避免重复创建。

如果只是临时创建一个测试订阅套餐，仍可使用 `clink product create`；但对于真实网站上已有的多个付费产品/订阅产品，优先使用 `clink catalog`。

## Checkout

必须支持：

- 使用已有 Clink `productId` / `priceId`
- 使用临时 `priceDataList`

推荐服务端 route：

```text
POST /api/clink/checkout
```

推荐上游 API path：

```text
POST /checkout/session
```

请求 payload 至少支持：

- `customerEmail`
- `merchantReferenceId`
- `successUrl`
- `cancelUrl`
- `uiMode`
- `paymentMethodType`
- `productId` / `priceId`
- `priceDataList`

字段映射注意：

- CLI 的 `--amount 10 --currency USD` 表示 10 USD；服务端传给 checkout 的 `originalAmount` / `unitAmount` 应按用户可见金额传递，除非官方文档明确要求 minor unit。
- webhook fixture 或某些事件里的 `amount` 可能看起来像 minor unit。不要用 webhook 的金额重新计算本地订单金额；保留为 provider 原始字段即可。
- 创建本地订单时，用本地订单号作为 `merchantReferenceId`，后续通过 webhook 的 `merchantReferenceId` 回填本地订单。
- Clink checkout 返回字段可能在不同层级，提取 checkout URL 时请兼容：
  - `checkoutUrl`
  - `url`
  - `sessionUrl`
  - `data.checkoutUrl`
  - `data.url`
  - `data.sessionUrl`
- 提取 session id 时请兼容：
  - `sessionId`
  - `id`
  - `data.sessionId`
  - `data.id`

用 CLI 验证：

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

## Subscription

推荐服务端 route：

```text
POST /api/clink/subscription
```

推荐上游 API path：

```text
POST /subscription
```

如果需要单个临时 product/price，请用 CLI 自动创建，不要让我手动找 ID。若网站已经有多个付费产品或订阅套餐，请优先回到 `Product catalog` 流程批量导入：

```bash
clink product create \
  --name "AI Subscription Test" \
  --image-file <local-image-path> \
  --tax-category software_service \
  --amount 10 \
  --currency USD \
  --type recurring \
  --interval month \
  --default \
  --json
```

注意：

- 当前 CLI 创建 product 可能要求 `--image-id` 或 `--image-file`。如果项目没有现成图片，可以自动生成临时 PNG 作为 product image，不要让我手动准备。
- 从返回值自动读取 `productId` 和 `defaultPrice` / `initialPriceId`，写入 `.env` 或项目配置。
- 不要把真实 ID 写进源码；可以写入本地 `.env`。

创建订阅：

```bash
clink subscription create \
  --customer-email buyer@example.com \
  --product-id <productId> \
  --price-id <priceId> \
  --payment-instrument-id <paymentInstrumentId> \
  --payment-method-type CARD \
  --payment-currency USD \
  --return-url https://example.com/subscription/return \
  --json
```

如果没有 `paymentInstrumentId`：

- subscription route 仍然要实现
- 返回清晰错误，说明需要先完成一笔 UAT checkout，并从真实 `order.succeeded` webhook 中读取
- 不要假造 `paymentInstrumentId`
- 不要为了让测试通过而把 subscription 伪装成真实成功

## Webhook

推荐 route：

```text
POST /api/clink/webhook
```

必须读取 raw body 后验签，不要先调用任何会消耗请求体的 JSON parser 或框架自动 body parser。验签通过后再解析 JSON。

签名：

```text
HMAC_SHA256(CLINK_WEBHOOK_SIGNING_KEY, X-Clink-Timestamp + "." + rawBody)
```

读取 headers：

```text
X-Clink-Timestamp
X-Clink-Signature
```

至少处理：

| 事件 | 行为 |
| --- | --- |
| `session.complete` | 记录 checkout session 完成，可更新订单为等待最终支付结果，但不要仅凭这个事件发货 |
| `order.succeeded` | 标记本地订单已支付/已完成，授予权益，触发发货 |
| `order.failed` | 标记支付失败，不发货 |
| `refund.succeeded` | 标记退款成功 |
| `subscription.created` | 记录订阅创建状态 |
| `invoice.paid` | 记录发票/续费付款 |

必须记录收到的 webhook event，便于验证：

- event id
- event type
- receivedAt
- `merchantReferenceId`
- provider order/session/subscription id
- 验签是否通过
- 处理动作

## 自动配置 webhook endpoint

先判断当前项目是否已经有公网 HTTPS 域名。不要默认所有环境都走 tunnel。

### 云端托管 / 低代码平台硬规则

如果当前项目运行在云端托管平台、低代码平台、云 IDE、sandbox 或类似无浏览器托管环境，并且 `CLINK_SECRET_KEY` 已经在平台 Secret 中配置：

- 不要要求用户再到本地终端运行 `scripts/clink-bootstrap.sh` 来复制 `CLINK_WEBHOOK_SIGNING_KEY`。
- 不要把“脚本会打印 signing key，请用户粘贴到平台 Secret”作为正常最终交付。
- 先在 agent 环境安装项目内 CLI，并确认 `clink webhook endpoint ensure --help` 支持 `--show-secret`。
- 使用平台已配置的 `CLINK_SECRET_KEY`，或在受控的一次性命令环境里让用户只提供 `CLINK_SECRET_KEY`，运行 `clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox`。
- 部署包含 webhook route 的版本，拿到公网 HTTPS webhook URL。
- 运行 `clink webhook endpoint ensure --url <public-webhook-url>/api/clink/webhook --events commerce --save-secret --show-secret --json`。
- agent 如果有平台 Secret 写入能力，必须自己把返回或轮换得到的 signing key 写入平台后端 Secret：`CLINK_WEBHOOK_SIGNING_KEY`，然后重新发布/重启后端。
- 只有当平台不允许 agent 写入 Secret、也没有可用平台 Secret API 时，才把“请用户把这一个 signing key 写入平台后端 Secret 并重新发布”列为阻塞的人类步骤，并明确说明这是平台写入权限限制，不是 Clink CLI 能力缺失。

`CLINK_CATALOG_MAP` 不是密钥。优先把 catalog mapping 写入仓库内受控文件，例如 `.clink/catalog-map.json`，或写入后端可读取的配置；不要让用户手动复制粘贴 catalog map，除非平台没有可写文件/配置能力并且已经说明原因。

### 路径 A：已有公网 HTTPS 域名

如果项目已经部署在可公网访问的 HTTPS 域名上，例如：

- 低代码编辑器/云 IDE/沙箱环境自动生成的预览域名
- Vercel/Netlify/Cloudflare Pages/Render/Railway/Fly.io 等部署域名
- 客户自己已有的网站域名

则直接使用该域名配置 webhook，不要再额外创建 cloudflared tunnel。

先确认 webhook endpoint 的完整地址，例如：

```text
https://example.com/api/clink/webhook
```

如果当前平台要求先部署后才能得到域名，先部署包含 webhook endpoint 的版本。此时 `CLINK_WEBHOOK_SIGNING_KEY` 可以暂时为空或使用占位值；不要因此在初始阶段向用户索取 webhook signing key。

先检查当前 CLI 是否支持用 Secret Key 管理 webhook endpoint。支持后使用 Secret Key 路径自动配置，不要回退到浏览器登录：

```bash
clink webhook endpoint ensure \
  --url https://example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --json
```

`ensure --save-secret` 成功后，从 CLI profile 或命令结果中获取最新 webhook signing key，自动写入项目运行环境的 `CLINK_WEBHOOK_SIGNING_KEY` / 平台 Secret，然后重启或重新部署服务。

如果当前环境是低代码编辑器/云 IDE/sandbox，且 agent 有写入平台 Secret 的工具或 API，请优先执行完整自动流程：

1. 部署或发布包含 webhook endpoint 的站点，拿到公网 HTTPS URL。
2. 运行：

```bash
clink webhook endpoint ensure \
  --url https://example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --show-secret \
  --json
```

3. 从命令输出中读取明文 signing key，写入平台 Secret：`CLINK_WEBHOOK_SIGNING_KEY=<signing key>`。
4. 重新部署/重启服务，让 webhook handler 使用最新 Secret。
5. 使用 `clink webhook simulate` 或等价方式验证 webhook 返回 200。

不要把第 2 步得到的 signing key 发给用户让用户再转发给你；这是 agent 应自动完成的步骤。也不要在最终交付中写“Dashboard webhook endpoint（请你配置）”，除非 CLI 自动配置和平台 Secret 写入能力都已尝试失败，并且你已说明具体失败原因。

如果平台需要重新部署后函数才生效，先部署，再配置 webhook，再写入 signing key 并重新部署。每次域名、预览 URL 或 webhook path 变化后，都要重新运行 `clink webhook endpoint ensure --save-secret --json`，同步新的 webhook signing key 到项目运行环境，并重启/重新部署服务。

如果 `clink webhook endpoint ensure` 报错：

1. 先确认已安装最新 `clink` CLI，并运行 `clink api request --help` 与 `clink webhook endpoint ensure --help`。
2. 如果缺少 Secret Key，先让用户提供 `CLINK_SECRET_KEY`，再用 `clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox` 保存。
3. 如果是 URL 不合规，先部署到公网 HTTPS 域名或启动 HTTPS tunnel 后重试。
4. 如果是后端接口返回的业务错误，保留脱敏错误信息并向用户说明具体原因。不要直接改成手工 Dashboard 流程。

### 路径 B：纯本地环境，没有公网域名

只有在服务仅运行在 `localhost` / `127.0.0.1` 且没有公网 HTTPS URL 时，才使用 HTTPS tunnel。优先 cloudflared，不要用 localtunnel。

Windows 如果没有 cloudflared，可以尝试：

```powershell
winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
```

启动 tunnel：

```bash
cloudflared tunnel --url http://127.0.0.1:<PORT> --no-autoupdate
```

如果日志显示 QUIC / UDP 超时，例如 `QUIC connection failed` 或公网 URL 返回 Cloudflare 1033，请切到 HTTP/2：

```bash
cloudflared tunnel --url http://127.0.0.1:<PORT> --no-autoupdate --protocol http2
```

得到公网 URL 后运行，注意 path 要使用当前项目真实 webhook route：

```bash
clink webhook endpoint ensure \
  --url <public-webhook-url>/api/clink/webhook \
  --events commerce \
  --save-secret \
  --json
```

`--events commerce` 在当前 44 事件 Catalog 中展开为 31 个收费相关事件，包括 checkout、11 个 subscription 生命周期事件、3 个 invoice、5 个 dispute 和 3 个 payment method 事件。`payment_method.deleted` 只有运行时 Catalog 返回时才会加入。`core` 仍固定为原有 6 个事件，但必须提示它不是完整订阅集成预设。

如需订阅 commerce 之外的 risk rule、agent order/refund、purchase instruction 或 VIC device 等事件，使用运行时解析的 `--events all`。

重要：无论使用已有域名还是 cloudflared tunnel，每次 webhook URL 变化后，都要重新运行 `clink webhook endpoint ensure --save-secret --json`。运行后必须同步最新 webhook signing key 到 `.env`、平台 Secret 或服务端环境变量，并重启/重新部署服务。

## 验证

先运行本地自动测试。如果真实 UAT API 不适合自动测试，可以加入明确的本地 mock 开关，例如 `CLINK_MOCK=true`，但最终要清楚区分 mock 与真实 UAT。

推荐验证顺序：

1. 本地测试：

```bash
npm test
```

2. Clink CLI 健康检查：

```bash
clink doctor --json
```

3. 签名模拟 webhook：

```bash
clink webhook simulate order.succeeded \
  --secret env:CLINK_WEBHOOK_SIGNING_KEY \
  --forward-to <local-or-public-webhook-url>/api/clink/webhook \
  --json
```

4. CLI smoke test：

```bash
clink smoke-test \
  --webhook-url <public-webhook-url>/api/clink/webhook \
  --json
```

5. 创建真实 UAT checkout session：

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 10 \
  --currency USD \
  --name "Webhook Real Test" \
  --quantity 1 \
  --payment-method-type CARD \
  --merchant-reference-id "ai-webhook-test-<timestamp>" \
  --success-url https://example.com/success \
  --cancel-url https://example.com/cancel \
  --json
```

如果需要确认真实付款 webhook：

- 打开 `checkoutUrl`
- 完成 UAT 测试支付
- 等待 Dashboard webhook 调用本地公网 URL
- 确认真实收到 `session.complete` 和 `order.succeeded`

如果没有完成这一步，只能报告：

- 真实 UAT checkout session 创建成功
- 签名模拟 webhook 通过公网 tunnel 返回 200
- 本地订单处理逻辑通过模拟事件验证

不能报告“真实付款 webhook 已完成”。

## curl 示例

最终 README 或交付说明里至少提供：

创建 checkout：

```bash
curl -X POST http://localhost:3000/api/clink/checkout \
  -H "Content-Type: application/json" \
  -d '{"productId":"beijing-72h","customerEmail":"buyer@example.com"}'
```

使用已有 Clink product/price：

```bash
curl -X POST http://localhost:3000/api/clink/checkout \
  -H "Content-Type: application/json" \
  -d '{"productId":"prod_xxx","priceId":"price_xxx","amount":10,"currency":"USD","customerEmail":"buyer@example.com","name":"AI Integration Test"}'
```

创建 subscription：

```bash
curl -X POST http://localhost:3000/api/clink/subscription \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"buyer@example.com","productId":"prod_xxx","priceId":"price_xxx","paymentInstrumentId":"pi_xxx","paymentMethodType":"CARD","paymentCurrency":"USD","returnUrl":"http://localhost:3000/subscription/return"}'
```

## 最终交付

请给我：

1. 架构侦察结果：项目运行方式、服务端入口、路由位置、订单入口、raw body 处理方式
2. 修改文件列表
3. 新增 API route / service 说明
4. `.env.example`
5. 一键启动命令
6. curl 示例
7. CLI 验证结果摘要
8. Dashboard webhook endpoint
9. tunnel URL 和本地 URL（如果仍在运行）
10. 测试结果，明确区分：
   - 本地 mock
   - 签名模拟 webhook
   - 真实 UAT checkout session
   - 真实 UAT 付款 webhook
11. 剩余人工步骤

预期剩余人工步骤只能是：

- 本地/桌面环境：如果没有现成 Secret Key，我在 `clink login` 打开的 Dashboard 页面里手动登录，供 CLI 读取或创建 Secret Key
- 云环境/沙箱/无浏览器环境：我在 ClinkBill Dashboard 自己登录并把 Secret Key 提供给 agent
- 如需验证真实付款 webhook，我手动打开 `checkoutUrl` 完成 UAT 测试支付

如果启动了临时服务或 tunnel：

- 如果是为了交付给我试用，请保留运行并给出 URL / PID
- 如果只是自动验证，请在最终回复前停止临时进程
