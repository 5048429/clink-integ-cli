# ClinkBill AI 自动接入官网与 Developers 更新产品需求文档

## 1. 背景

ClinkBill 已经具备面向 AI agent 的 `clink-integ-cli` 和 `clink-integ-skills` 接入能力。新的接入目标不再是让开发者照着文档在 Dashboard 里逐项创建产品、复制价格 ID、配置 webhook 和复制 signing key，而是让用户只完成必要的人类授权动作：

- 本地桌面环境：用户通过 `clink login` 在浏览器里手动登录 Dashboard，CLI 继续读取或初始化 sandbox Secret Key。
- 云端、低代码、托管 IDE 或无浏览器环境：用户在 Dashboard 创建并复制一次 sandbox Secret Key，交给 agent 写入平台 Secret 或安全环境变量。

完成 Secret Key 准备后，产品创建、价格创建、图片上传、webhook endpoint 创建、webhook signing key 同步、测试 checkout、签名模拟 webhook、真实支付验收提示等操作都应由 agent 通过 `clink-integ-cli` 自动执行。

因此官网需要更新 AI 自动接入提示词，Developers 页面需要更新 Integration Skills 的 GitHub 跳转内容，让用户从一开始就进入“skill + CLI 自动化”的新流程。

## 2. 一句话目标

让开发者把“接入 ClinkBill sandbox 支付”交给 AI 后，只需要完成登录或复制 Secret Key 这一个人工步骤，其余接入工作由 AI 使用 `clink-integ-cli` 和 `clink-integ-skills` 自动完成；对于 Elements 嵌入式支付，AI 还应根据客户网站颜色和设计 token 自动匹配支付组件风格。

## 3. 用户与场景

| 用户类型 | 场景 | 期望 |
| --- | --- | --- |
| 独立开发者 | 在本地项目中接入 ClinkBill sandbox 支付 | 运行提示词后，登录一次 Dashboard，剩余步骤自动完成 |
| 低代码/托管平台用户 | 在 Lovable、云 IDE、在线 sandbox 等环境接入支付 | 只提供 `CLINK_SECRET_KEY`，不再手动复制 webhook signing key 或 product/price ID |
| 商户技术负责人 | 评估 ClinkBill 是否适合 AI 自动接入 | 在官网看到明确的自动化能力、边界和验收路径 |
| Agent/IDE 用户 | 给 Cursor、Codex、Claude Code 等 agent 下达接入任务 | 一段提示词即可安装或读取 skill，并按 skill 完成自动化接入 |

## 4. 范围

### 4.1 本期范围

- 更新官网 AI 自动接入提示词。
- 更新 Developers 页面 Integration Skills 卡片、说明和 GitHub 跳转目标。
- 更新 GitHub 仓库落地内容，使其承载 skill 安装、简短提示词、CLI 自动化能力说明和安全边界。
- 明确本地与云端两类接入路径。
- 明确 agent、skill、CLI 的职责边界。
- 明确 Elements 支付方式的颜色与风格自动匹配要求。

### 4.2 非本期范围

- 不要求生产环境完全自动上线。生产环境仍应经过 readiness/approval/validation gate。
- 不把 Secret Key、webhook signing key 或 Dashboard Console token 放入前端代码、公开文档、README、日志或最终交付说明。
- 不把网站商品发现逻辑塞进 CLI。商品发现由 agent 完成，CLI 负责校验、计划、导入和维护映射。
- 不要求用户手动提供 `CLINK_WEBHOOK_SIGNING_KEY` 作为初始接入输入。

## 5. 核心体验

### 5.1 官网上用户看到的主路径

官网 AI 接入区块应给用户一个清晰承诺：

```text
只需登录或复制一次 sandbox Secret Key，AI 将使用 ClinkBill Integration Skill 和 clink-integ-cli 自动完成产品导入、checkout/subscription 接入、webhook 配置、signing key 同步和 sandbox 验收。
```

用户点击或复制提示词后，agent 应先安装或读取官方 Integration Skill，然后按 skill 指令执行项目侦察、Secret Key 配置、商品发现、catalog 导入、webhook 自动配置和验收。

### 5.2 本地桌面路径

当 agent 运行在本地桌面环境且可以打开浏览器时：

1. 安装或确认最新 `clink-integ-cli`。
2. 运行 `clink login`。
3. 用户在打开的 Dashboard 页面手动登录。
4. agent 运行：

```bash
clink dashboard whoami --json
clink dashboard apikey ensure-secret --save --json
clink auth status --json
```

5. 后续操作全部走 Secret Key API，不再依赖 Dashboard Console token。

### 5.3 云端/低代码/托管路径

当 agent 运行在无浏览器、低代码、云 IDE 或托管 sandbox 环境时：

1. 提示用户去 `Merchant Dashboard > Developers > API Keys` 点击 `Initialize Key` 并复制 sandbox Secret Key。
2. 用户只提供 `CLINK_SECRET_KEY`。
3. agent 将 Secret Key 写入平台 Secret、secret manager 或被 git 忽略的 `.env`。
4. agent 运行：

```bash
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status --json
clink doctor --json
```

5. 后续操作全部自动完成。初始阶段不向用户索要 `CLINK_WEBHOOK_SIGNING_KEY`。

## 6. 自动化能力要求

### 6.1 商品发现与 catalog

agent 负责发现接入网站中的付费产品、订阅产品、价格、计费周期、货币、套餐权益和图片资产。发现顺序应为：

1. 运行中 API、价格页 DOM、页面 JSON、CMS 接口。
2. 源码、配置、数据库 seed、静态内容、i18n 文案。
3. 信息不足时再向用户询问。

发现结果必须写入 `clink-catalog.json`，并包含稳定的 `sourceId`。商品图片字段支持：

- `imageId`：已有 Clink OSS 图片 ID。
- `imageUrl`：公开 HTTP(S) 图片 URL。
- `imageFile`：本地图片文件，默认相对 `clink-catalog.json` 解析，也可结合 `--project-root` 和 `--public-dir`。

CLI 负责：

- `clink catalog validate` 校验字段、图片存在性、MIME、大小和 URL/imageId 误用。
- `clink catalog plan` 输出将创建、复用、跳过、上传或缓存哪些资源。
- `clink catalog import` 自动上传 `imageUrl`/`imageFile` 到 `/product/image/upload`，获得 `ossId` 后创建 product/price。
- 使用 sha256 缓存 `url/file -> ossId`，避免重复上传。

### 6.2 Webhook 自动配置

agent 必须优先使用 CLI 自动创建或更新 webhook endpoint：

```bash
clink webhook endpoint ensure \
  --url <public-webhook-url> \
  --events commerce \
  --save-secret \
  --json
```

要求：

- 完整收费接入默认使用运行时校验的 `--events commerce`；只有明确只需最小事件集时才使用自定义列表。`core` 仅是 6 事件兼容预设，不能代表完整订阅接入。
- webhook URL 必须是公网 HTTPS；只有纯本地开发才使用 tunnel。
- `--save-secret` 后必须把 signing key 同步到项目运行时的 `CLINK_WEBHOOK_SIGNING_KEY`，并重启或重新部署服务。
- 如果平台允许 agent 写入 Secret，应由 agent 自动写入，不能把“请用户手动复制 webhook signing key”作为默认最终步骤。
- 每次 webhook URL 变化都必须重新 ensure、重新同步 signing key、重新启动或部署服务。

### 6.3 Checkout、subscription 与订单验证

agent 应根据项目真实商品模型选择：

- registered product 模式：使用 catalog import 创建或复用 Clink product/price。
- non-registered product 模式：由商户系统定义 line items，并通过 checkout payload 传递。

服务端必须创建本地订单，再将本地订单号作为 `merchantReferenceId` 传给 Clink。Webhook handler 必须至少支持：

- raw body 签名验证。
- 幂等处理。
- retry 与乱序容忍。
- `merchantReferenceId + sessionId` 双重匹配，不能只依赖一个字段。
- 将真实支付结果回填到本地订单、权益、额度、发货或订阅状态。

验收时不能把 “webhook 200” 当作支付完成。真实支付完成的验收标准必须包括：

- 用户打开真实 sandbox `checkoutUrl` 并完成测试支付。
- 真实 webhook 送达且签名验证通过。
- 本地订单变为 paid/completed。
- 权益、额度、下载权限、发货或订阅开通完成。

### 6.4 Elements 风格自动匹配

当商户选择 Elements 嵌入式支付时，agent 应自动扫描客户网站视觉风格，并将结果映射到 Elements 的安全前端配置。

扫描来源：

- CSS variables、Tailwind config、theme config、design token。
- 运行中页面 computed styles。
- 价格页、checkout 页、按钮、卡片、表单控件、暗色模式。
- logo 或主品牌色，仅在设计 token 不明确时作为辅助。

建议提取：

- primary color。
- background、surface、text、border。
- border radius。
- font family。
- light/dark theme。
- spacing 和按钮风格。

Elements 侧要求：

- Secret Key、webhook signing key、checkout session 创建都必须保留在服务端。
- 前端只使用 `publishKey`、`environment`、`sessionId` 和 Elements SDK 所需的安全配置。
- `loadClinkElements` 的 `presetOptions` 应尽量匹配站点风格，例如 `theme`、`primaryColor`、`radius`、`locale`。
- `session-success` 和 `session-pending` 只作为前端 UX 信号，支付确认仍以 webhook 和服务端状态为准。
- agent 应在可行时做截图或视觉检查，确认支付区域不突兀、不遮挡、不溢出。

## 7. 官网 AI 接入提示词要求

官网上的提示词应短、可复制、skill-first，不应把完整长文档直接塞给用户。建议主提示词：

```text
请先安装或读取 ClinkBill Integration Skill：
https://github.com/clinkbillcom/clink-integ-skills

然后使用该 skill 帮我把 ClinkBill sandbox 支付接入当前项目。

目标：除我登录 Dashboard 或提供 CLINK_SECRET_KEY 外，其余步骤尽量全自动完成。请自动识别项目架构和付费商品，生成 clink-catalog.json，使用 clink-integ-cli 导入产品/价格/图片，创建 checkout 或 subscription 接口，自动创建 webhook endpoint，同步 CLINK_WEBHOOK_SIGNING_KEY，完成签名模拟 webhook 和真实 sandbox checkout 验收指引。

如果是本地桌面环境，可以运行 clink login 并让我在浏览器里登录；如果是云端、低代码或无浏览器环境，请只向我索取 CLINK_SECRET_KEY，不要让我手动提供 webhook signing key。

如果使用 Clink Elements 嵌入式支付，请根据当前网站颜色和设计 token 自动匹配支付组件风格，并确保 Secret Key 只存在服务端。
```

官网还应提供两个辅助链接：

- 详细 skill 仓库：`https://github.com/clinkbillcom/clink-integ-skills`
- CLI 使用文档：指向 `clink-integ-cli` 官方仓库中的 usage 文档

## 8. Developers 页面 Integration Skills 更新要求

Developers 页面应新增或更新 “AI Integration Skills” 卡片。

建议卡片内容：

- 标题：`AI Integration Skills`
- 描述：`Use ClinkBill skills and clink-integ-cli to let coding agents import products, configure webhooks, integrate checkout/subscriptions, and verify sandbox payments with only one human Secret Key step.`
- 主按钮：`Open GitHub`
- 跳转目标：`https://github.com/clinkbillcom/clink-integ-skills`
- 次级链接：`clink-integ-cli docs`

卡片应明确：

- 本地支持 `clink login` 人工登录后自动获取或初始化 Secret Key。
- 云端/低代码只需要用户提供 `CLINK_SECRET_KEY`。
- Webhook endpoint 和 signing key 由 CLI 自动创建、保存和同步。
- 商品扫描由 agent 完成，CLI 负责 catalog 校验、计划、图片上传和导入。
- Elements 可根据商户网站风格自动匹配前端支付组件。

## 9. GitHub 仓库落地内容要求

Integration Skills GitHub 仓库首页应服务三个动作：

1. 让 agent 安装或读取 skill。
2. 让用户复制一段最短接入提示词。
3. 让开发者理解 CLI 自动化能力、限制和安全边界。

README 必须包含：

- 一段 “Copy this prompt”。
- 本地路径与云端路径的差异。
- Secret Key 获取方式：`Merchant Dashboard > Developers > API Keys > Initialize Key`。
- 明确不要求初始手动提供 `CLINK_WEBHOOK_SIGNING_KEY`。
- 自动化能力清单：catalog、image upload、checkout、subscription、webhook endpoint、signing key sync、smoke-test、real payment checklist。
- Elements 专区：嵌入式支付、服务端 session、前端安全参数、风格自动匹配。
- 安全规则：不得把 Secret Key 或 webhook signing key 写入前端、公开仓库、日志或最终回复。
- 与 `clink-integ-cli` 文档的链接。

## 10. 成功指标

| 指标 | 目标 |
| --- | --- |
| 人工步骤数 | sandbox 接入过程中除登录或 Secret Key 复制外，默认 0 个 Dashboard 手工配置步骤 |
| 商品接入自动化 | 已有价格页或配置中的产品能生成 `clink-catalog.json` 并通过 CLI 导入 |
| Webhook 自动化 | endpoint 创建、事件订阅、signing key 同步、重启/部署提示均由 agent 执行或明确报告 |
| Elements 视觉匹配 | 支付组件主色、圆角、明暗主题与商户网站基本一致 |
| 真实支付验收 | 能区分 mock、签名模拟 webhook、真实 checkout session、真实 sandbox payment |
| 安全性 | 无 Secret Key/signing key 泄漏到前端、README、日志、公开仓库或最终回复 |

## 11. 验收标准

本期上线后，以下验收应全部通过：

1. 官网 AI 接入区块提供一段可复制的 skill-first 提示词。
2. Developers 页面 Integration Skills 卡片跳转到官方 `clinkbillcom/clink-integ-skills` 仓库。
3. GitHub 仓库 README 能说明本地和云端两条路径，并给出最短提示词。
4. 用户在云端低代码平台提供 `CLINK_SECRET_KEY` 后，agent 不再要求用户手动提供 `CLINK_WEBHOOK_SIGNING_KEY`。
5. agent 能将接入网站的付费产品/订阅产品写入 `clink-catalog.json`，并通过 CLI 完成 product/price/image import。
6. agent 能使用 CLI 自动 ensure webhook endpoint，并同步 signing key 到运行时环境。
7. webhook handler 指南要求 `merchantReferenceId + sessionId` 双重匹配。
8. Elements 接入指南要求根据客户网站颜色和设计 token 生成 `presetOptions`，且不把 Secret Key 放到浏览器。
9. 验收报告必须区分 mock、签名模拟 webhook、真实 checkout session 和真实 sandbox payment。

## 12. 发布计划

### Phase 1：文案与入口更新

- 更新官网 AI 接入提示词。
- 更新 Developers 页面 Integration Skills 卡片和跳转。
- 更新 GitHub README 的最短提示词与能力清单。

### Phase 2：示例与验收强化

- 增加 `clink-catalog.json` 示例。
- 增加本地与低代码平台接入示例。
- 增加 Elements 风格自动匹配示例。
- 增加真实支付后验证清单。

### Phase 3：数据回收与体验优化

- 统计提示词复制、GitHub 点击、CLI 安装、catalog import、webhook ensure、smoke-test 成功率。
- 收集失败原因，优化官网提示词、skill 和 CLI 错误输出。

## 13. 风险与待确认

- 官网代码仓库和 Developers 页面归属需要确认，以便落地具体改动。
- 官方 GitHub 跳转目标应统一为 `clinkbillcom/clink-integ-skills`；个人仓库可作为开发或镜像来源，但不应作为官网主入口。
- 不同低代码平台对 Secret 写入和重新部署的 API 能力不同，agent 需要在无法自动写入时明确说明平台限制。
- Elements 可自动匹配的程度取决于当前 SDK 暴露的主题配置能力，PRD 不应承诺 SDK 尚未支持的细粒度样式 API。
- 生产环境不应默认完全自动化，需要独立的上线校验与审批流程。
