# CMCC Message Gateway

将中国移动“新消息 ClawBot”接入 Cloudflare Workers 的轻量消息网关。项目使用 Hono 提供 HTTP API，并通过 Durable Object 维护与中国移动服务端的 WebSocket 连接，可把 Bark 风格的推送请求转发到手机“新消息”，也可接收入站消息。

> 本项目为非官方开源实现，与中国移动无隶属关系。使用前请确认你的号码和终端能够使用“新消息 ClawBot”，并遵守相关服务条款。

## 功能

- 发送文本、图片、音频、视频和文件
- 支持 `GET /push/...`、`POST /push` 和结构化消息接口
- 自动记录最近一次入站消息的发送方，作为默认接收人
- 在 Durable Object 中保留最近 100 条入站消息
- 可将入站消息转发到自定义 Webhook
- 使用独立的 `API_TOKEN` 保护公开 API
- WebSocket 心跳、断线重连和连接状态检查

## 获取 `CMCC_API_KEY`

`CMCC_API_KEY` 是中国移动为“新消息 ClawBot”分配的通信凭证，不是 Cloudflare API Token，也不是本项目公开接口使用的 `API_TOKEN`。

1. 使用手机打开中国移动官方文档：[中国移动新消息“养龙虾”使用指南](https://f.10086.cn/s/s/msgNotice/?infoId=oGaKNuZqtg6KbLn9OyRceA%3d%3d)。
2. 按文档说明进入“新消息 ClawBot”应用号：
   - 已支持“新消息”的终端可通过官方文档中的链接或二维码进入；
   - 其他终端可使用官方文档提供的 CH5 入口。
3. 在应用号底部选择 **绑定/解绑 → 立即授权**。
4. 按页面提示完成认证，取得专属 API Key。
5. 单独保存 API Key，部署时通过 Wrangler Secret 写入：

   ```bash
   npx wrangler secret put CMCC_API_KEY
   ```

   命令提示输入时，仅粘贴 API Key 本身。

不要把 API Key 写入 `wrangler.jsonc`、README、Issue、日志或提交到 Git。若怀疑密钥泄露，请在中国移动服务端解绑或重新申领，并立即更新 Worker Secret。

## 部署到 Cloudflare Workers

### 准备条件

- 中国移动“新消息 ClawBot”的 `CMCC_API_KEY`
- 已开通 Workers 的 Cloudflare 账号
- Node.js 22 或更高版本
- npm

### 命令行部署

进入项目目录后执行：

```bash
npm ci
npx wrangler login
```

写入中国移动 API Key：

```bash
npx wrangler secret put CMCC_API_KEY
```

再创建一个足够长、不可猜测的随机字符串，用作本项目 HTTP API 的访问令牌，并写入 Secret：

```bash
npx wrangler secret put API_TOKEN
```

最后检查类型并部署：

```bash
npm run typecheck
npm run deploy
```

Wrangler 会在部署完成后输出 Worker 地址，例如：

```text
https://cmcc-message-gateway.<你的-workers-subdomain>.workers.dev
```

项目已在 `wrangler.jsonc` 中声明 `CMCC_GATEWAY` Durable Object，首次部署时会一并创建所需绑定和 SQLite 存储。

### 使用 GitHub Actions 部署

仓库中的 `.github/workflows/deploy.yml` 会在推送到 `main` 分支或手动触发时执行类型检查和部署。请先在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 具有目标账号 Workers 部署权限的 Cloudflare Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CMCC_API_KEY` | 中国移动“新消息 ClawBot”API Key |
| `API_TOKEN` | 调用本项目 HTTP API 的自定义访问令牌 |

工作流不会自动创建或申领 `CMCC_API_KEY`。

## 部署后初始化

以下示例中的地址和令牌均需替换成你自己的值。

先检查 Worker 是否可访问；`/` 和 `/health` 是公开的，不需要鉴权：

```bash
curl 'https://YOUR_DOMAIN/health'
```

然后主动建立并验证 CMCC WebSocket 连接：

```bash
curl 'https://YOUR_DOMAIN/connect' \
  -H 'Authorization: Bearer YOUR_API_TOKEN'
```

成功时应看到 `connected: true` 和 `authenticated: true`。

如果尚未设置默认接收人，请先在手机“新消息 ClawBot”中向该应用号发送一条消息。Worker 收到入站消息后会自动保存发送方标识，后续推送便可省略 `to`。也可以在每次请求中显式传入 `to`，或将 `DEFAULT_RECIPIENT` 配置为 Secret：

```bash
npx wrangler secret put DEFAULT_RECIPIENT
```

查看当前接收人：

```bash
curl 'https://YOUR_DOMAIN/api/recipient' \
  -H 'Authorization: Bearer YOUR_API_TOKEN'
```

## 发送消息

### POST JSON

```bash
curl -X POST 'https://YOUR_DOMAIN/push' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "服务器通知",
    "body": "任务已执行完成"
  }'
```

可选字段 `to` 用于覆盖自动记录的接收人：

```json
{
  "to": "RECIPIENT_ID",
  "title": "服务器通知",
  "body": "任务已执行完成"
}
```

`body` 也兼容使用 `content` 或 `message` 字段。`POST /api/messages/send` 与 `POST /push` 的文本发送行为相同。

### GET / Bark 风格调用

```bash
curl 'https://YOUR_DOMAIN/push/服务器通知/任务已执行完成' \
  -H 'Authorization: Bearer YOUR_API_TOKEN'
```

调用方应对路径中的标题和正文进行 URL 编码。也可以使用查询参数：

```bash
curl --get 'https://YOUR_DOMAIN/push' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  --data-urlencode 'title=服务器通知' \
  --data-urlencode 'body=任务已执行完成'
```

### 上传并发送媒体

```bash
curl -X POST 'https://YOUR_DOMAIN/api/media/upload-send' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -F 'file=@./example.png' \
  -F 'content=图片说明' \
  -F 'mediaType=IMAGE'
```

`mediaType` 可使用 `IMAGE`、`VIDEO`、`AUDIO`、`TEXT` 或 `FILE`；省略时会根据文件 MIME 类型推断。

也可以用已公开可访问的媒体 URL 发送：

```bash
curl -X POST 'https://YOUR_DOMAIN/api/media/send' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "mediaType": "IMAGE",
    "content": "图片说明",
    "mediaUrl": "https://example.com/example.png"
  }'
```

发送接口返回的 `status: "ws_written"` 表示消息已写入 WebSocket，不等同于手机端已经送达或已读。

## 接收入站消息

查看 Worker 保存的入站消息，`limit` 范围为 1～100：

```bash
curl 'https://YOUR_DOMAIN/api/inbox?limit=20' \
  -H 'Authorization: Bearer YOUR_API_TOKEN'
```

如需把消息转发到其他服务，可配置：

```bash
npx wrangler secret put INBOUND_WEBHOOK_URL
npx wrangler secret put INBOUND_WEBHOOK_TOKEN
```

配置后，Worker 会向 `INBOUND_WEBHOOK_URL` 发送 JSON `POST` 请求；若设置了 `INBOUND_WEBHOOK_TOKEN`，请求会携带 `Authorization: Bearer <token>`。

## 鉴权

除 `/` 和 `/health` 外，所有公开接口都需要 `API_TOKEN`。推荐使用请求头：

```http
Authorization: Bearer YOUR_API_TOKEN
```

同时兼容 `X-API-Key` 请求头，以及 `?token=` / `?key=` 查询参数。查询参数可能被浏览器历史、代理或访问日志记录，不建议在生产环境使用。

## 本地开发

复制本地变量示例并填写测试凭证：

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

`.dev.vars` 已被 `.gitignore` 忽略，请勿提交。Wrangler 启动后会在终端显示本地访问地址。

## 配置项

| 名称 | 必需 | 默认值 / 说明 |
| --- | --- | --- |
| `CMCC_API_KEY` | 是 | 中国移动“新消息 ClawBot”凭证，必须作为 Secret 保存 |
| `API_TOKEN` | 是 | 本项目 HTTP API 访问令牌，必须作为 Secret 保存 |
| `DEFAULT_RECIPIENT` | 否 | 未从入站消息识别到接收人时使用的默认接收人 |
| `INBOUND_WEBHOOK_URL` | 否 | 入站消息转发地址 |
| `INBOUND_WEBHOOK_TOKEN` | 否 | 入站 Webhook 的 Bearer Token |
| `CMCC_SERVER_URL` | 否 | CMCC WebSocket 地址，已在 `wrangler.jsonc` 配置 |
| `CMCC_UPLOAD_URL` | 否 | CMCC 文件上传服务地址，已在 `wrangler.jsonc` 配置 |
| `CMCC_VERSION` | 否 | 协议版本，默认 `2.0` |

## 常用命令

```bash
npm run dev        # 本地开发
npm run typecheck  # TypeScript 类型检查
npm run deploy     # 部署到 Cloudflare Workers
npm run tail       # 查看 Worker 实时日志
```

查看实时日志时注意脱敏，不要在 Issue 或聊天记录中粘贴 API Key、API Token、完整手机号、接收人标识或包含隐私的消息正文。
