# 本地生图接口

给其他 AI 使用、制作游戏贴图的完整教程见 [AI_GAME_TEXTURE_GUIDE.md](./AI_GAME_TEXTURE_GUIDE.md)，包含可执行脚本、提示词模板、图片保存和验收流程。

基于 Node.js 22+，无需安装依赖。适用于提供 OpenAI 兼容 `POST /v1/images/generations` 接口的中转站。若中转站只支持聊天生图或其他协议，需要另外适配。

## 配置和启动

编辑 `.env`：

- `RELAY_BASE_URL`：中转站 API 根地址，例如 `https://example.com/v1`，不要填完整生图路径。
- `RELAY_API_KEY`：中转站密钥。
- `IMAGE_MODEL`：中转站实际支持的生图模型名。
- `LOCAL_API_KEY`：可选，本地接口访问密钥。
- `RELAY_IMAGE_ENDPOINT`：可选，覆盖完整上游生图地址。

在本目录运行：

```sh
npm start
```

默认监听 `http://127.0.0.1:3000`。健康检查：`GET /health`。`configured` 仅表示填写了配置，不代表已验证中转站连接。

## 调用

Windows PowerShell：

```powershell
$body = @{ prompt = '一只坐在窗边的橘猫，水彩风格'; n = 1; size = '1024x1024' } | ConvertTo-Json
$result = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/generate' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$result | ConvertTo-Json -Depth 20
```

如果设置了 `LOCAL_API_KEY`，在调用中增加 `-Headers @{ Authorization = 'Bearer 你的本地密钥' }`。

也支持 OpenAI 路径 `POST /v1/images/generations`，请求示例：

```json
{
  "prompt": "一只坐在窗边的橘猫，水彩风格",
  "model": "gpt-image-1",
  "n": 1,
  "size": "1024x1024"
}
```

`model` 不填时使用环境配置。`quality`、`response_format` 等字段会原样转发，具体可用值取决于中转站和模型。响应也按中转站 JSON 原样返回，图片通常位于 `data[0].url` 或 `data[0].b64_json`，服务不会自动下载图片。

保存 Base64 图片（PowerShell）：

```powershell
[IO.File]::WriteAllBytes((Join-Path $PWD 'image.png'), [Convert]::FromBase64String($result.data[0].b64_json))
```

默认请求超时为 180 秒。错误状态：400 参数错误，401 本地鉴权失败，413 请求过大，502 连接异常或上游响应不是 JSON，503 缺少配置，504 超时；上游返回的 JSON 错误保留其 HTTP 状态码。服务默认仅供本机调用。
