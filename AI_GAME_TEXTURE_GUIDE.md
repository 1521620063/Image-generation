# 给其他 AI 的游戏贴图生成指南

这份文档可以直接交给能运行终端命令的 AI。服务目录为 `C:\project\image`，默认地址为 `http://127.0.0.1:3000`。服务使用本地 `.env` 中的中转站配置；不要输出、复制或提交其中的密钥。

## 1. 开始前确认

1. 明确游戏引擎、贴图用途、目标尺寸、美术风格、视角、是否需要透明背景，以及输出目录。
2. 在同一台电脑检查 `GET http://127.0.0.1:3000/health`。
3. 如果连接失败，在单独的终端运行：

```powershell
cd C:\project\image
npm start
```

保持该终端运行。修改 `.env` 后需要重启服务。`configured: true` 只表示配置已填写，不证明模型可用。

其他 AI 必须能访问这台电脑的本地端口；网页聊天中的 AI 或远程服务器上的 AI 通常无法直接访问你的 `127.0.0.1`。这种情况下，让它生成脚本，在本机运行。

## 2. 接口约定

- 方法：`POST`
- 地址：`http://127.0.0.1:3000/generate`
- 兼容地址：`http://127.0.0.1:3000/v1/images/generations`
- 请求头：`Content-Type: application/json`
- 如果配置了 `LOCAL_API_KEY`，增加 `Authorization: Bearer <本地密钥>`。无需向本地接口发送中转站密钥。
- 超时：客户端建议 200 秒，服务默认上游超时 180 秒。

建议先使用最小请求，不指定模型，让服务使用 `.env` 中已配置的模型：

```json
{
  "prompt": "Seamless tileable grass ground texture for a top-down 2D game, orthographic top view, hand-painted style, muted green palette, even diffuse lighting, no shadows, no objects, no text",
  "n": 1
}
```

可选字段 `size`、`quality`、`background`、`response_format`、`model` 会转发到中转站。支持的字段和值取决于模型，不能默认它们都有效。当前服务只校验非空 `prompt` 和 1 到 10 的整数 `n`。建议每次 `n: 1`，逐张生成。

此前成功测试过 `gpt-image-2.6-sunburst`，但以本机当前配置为准。生成结果可能是：

```json
{"data":[{"b64_json":"图片的 Base64 数据"}]}
```

或：

```json
{"data":[{"url":"https://example.com/generated-image.png"}]}
```

本地接口不会自动保存图片。调用方需要解码 Base64 或下载 URL，URL 可能过期。

## 3. 可直接执行的 Node.js 调用脚本

将下面内容保存为 `generate-texture.mjs`，需要 Node.js 22+，无需安装依赖。默认输出到运行目录下的 `assets/textures`；通过 `OUTPUT_DIR` 可指定游戏项目目录。可通过 `LOCAL_API_KEY` 环境变量传入本地访问密钥。不要把真实密钥写入代码。

```javascript
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const prompt = process.argv[2];
const name = process.argv[3] || 'grass_ground';
if (!prompt) throw new Error('用法：node generate-texture.mjs "提示词" grass_ground');
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('名称只能包含英文字母、数字、下划线和连字符');

const outputDir = path.resolve(process.env.OUTPUT_DIR || 'assets/textures');
const headers = { 'Content-Type': 'application/json' };
if (process.env.LOCAL_API_KEY) headers.Authorization = `Bearer ${process.env.LOCAL_API_KEY}`;
const response = await fetch('http://127.0.0.1:3000/generate', {
  method: 'POST',
  headers,
  body: JSON.stringify({ prompt, n: 1 }),
  signal: AbortSignal.timeout(200000),
});
const result = await response.json();
if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
const image = result.data?.[0];
let bytes;
if (image?.b64_json) {
  bytes = Buffer.from(image.b64_json, 'base64');
} else if (image?.url) {
  const downloaded = await fetch(image.url, { signal: AbortSignal.timeout(60000) });
  if (!downloaded.ok) throw new Error(`图片下载失败：HTTP ${downloaded.status}`);
  bytes = Buffer.from(await downloaded.arrayBuffer());
} else {
  throw new Error('响应没有 data[0].b64_json 或 data[0].url');
}
let ext;
if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ext = 'png';
else if (bytes[0] === 255 && bytes[1] === 216) ext = 'jpg';
else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
else throw new Error('返回内容不是支持的 PNG、JPEG 或 WebP 图片');
await mkdir(outputDir, { recursive: true });
// 使用时间戳保留每次生成结果，避免覆盖已有游戏资源。
const stem = `${name}_${Date.now()}`;
const imagePath = path.join(outputDir, `${stem}.${ext}`);
await writeFile(imagePath, bytes);
await writeFile(path.join(outputDir, `${stem}.json`), JSON.stringify({
  prompt, requested_n: 1, created_at: new Date().toISOString(),
  image: path.basename(imagePath), bytes: bytes.length,
}, null, 2));
console.log(`已保存：${imagePath}`);
```

PowerShell 调用：

```powershell
node .\generate-texture.mjs 'Seamless tileable grass ground texture, orthographic top view, hand-painted 2D game art, muted green palette, even lighting, no text' grass_ground
```

如果脚本在服务目录，想直接使用 `.env` 中的本地访问密钥：

```powershell
node --env-file=.env .\generate-texture.mjs 'Seamless tileable grass ground texture, orthographic top view, hand-painted 2D game art, no text' grass_ground
```

## 4. 游戏贴图提示词

同一项目固定风格描述、调色板、视角、光照和细节密度，只替换材质或物体名称。多次独立生成的结果仍可能不一致，需要人工或图像工具检查。

### 可平铺地面

```text
Seamless tileable stone floor texture for a top-down 2D fantasy game.
Orthographic top view, hand-painted style, muted cool gray palette.
Uniform scale, evenly distributed small stone tiles, subtle surface wear.
Even diffuse lighting, no directional shadows, no perspective.
Texture fills the entire canvas, matching opposite edges.
No border, no text, no characters, no props.
```

把 `stone floor` 换成 `grass ground`、`sand ground`、`wooden floor` 等可形成基础材质组。必须实际进行 3×3 平铺检查，提示词不能保证边缘无缝。

### 单个道具或角色精灵

```text
A single wooden treasure chest sprite for a 2D top-down fantasy game.
Three-quarter top-down view, hand-painted style, muted warm palette.
Centered full object, consistent upper-left lighting, clear silhouette.
Transparent background, no floor, no cast shadow, no text, no border.
```

“Transparent background” 只是生成要求，必须检查文件是否真的有透明通道；需要时使用抠图工具。不要只把白底或棋盘格图当作透明图。

### 像素风素材

```text
A single health potion icon for a pixel art RPG.
Front view, centered, clear silhouette, limited 16-color palette.
Crisp pixel clusters, no anti-aliasing, no gradients, no text.
Transparent background, generous empty margin.
```

模型不保证像素网格和目标尺寸。需要时用图像工具整理，并用最近邻缩放；用于像素游戏时设置 Point/Nearest 采样。

## 5. 推荐制作流程

1. 先列资源清单：文件名、用途、尺寸、视角、透明要求、风格和输出目录。
2. 先生成一张样图，保存文件并检查效果，再继续其他资源。
3. 顺序生成，默认单并发，避免一次发起大量计费请求。
4. 检查实际尺寸、格式、透明通道、边缘接缝、光照和风格。需要缩放、裁剪或抠图时使用图像工具；当前接口不提供这些处理。
5. 为地面贴图制作 3×3 平铺预览。精灵则检查轮廓、留白和落脚点。
6. 将验收后的素材导入游戏。2D 精灵、UI 和颜色贴图通常使用 sRGB；法线、粗糙度等数据贴图的色彩空间按引擎要求设置。
7. 保存提示词及资源元数据，方便后续修改。不要用尚未检查的生成图覆盖正式素材。

当前接口不提供参考图上传、图生图、局部编辑、精灵切片、PBR 通道生成或无缝处理。普通彩色图不能直接当作正确的法线图。角色动作帧、规则图集、严格无缝贴图和配套 PBR 材质需要额外工具与校验。

## 6. 错误处理

| 状态或错误 | 建议处理 |
| --- | --- |
| 连接被拒绝 | 检查服务是否启动，以及调用者是否在同一台电脑 |
| 400 | 检查 JSON、prompt 和模型可选参数 |
| 401 | 区分本地访问密钥错误与中转站密钥错误；不要反复重试 |
| 404 / model_not_found / 无可用渠道 | 检查模型名、密钥分组及中转站模型渠道 |
| 429 | 降低调用频率，按上游建议等待 |
| 502 | 检查网络、上游地址或非 JSON 响应 |
| 503 | 根据错误内容检查配置或模型渠道 |
| 504 / 超时 | 先检查中转站任务或账单；超时不代表上游没有生成，避免立即重复计费 |

服务会保留上游 JSON 错误及其 HTTP 状态码，所以应读取错误正文判断原因。不要在日志中输出 `.env`、Authorization 或 API 密钥。

## 7. 可以直接复制给其他 AI 的任务说明

```text
请在我的电脑上使用已有的本地生图服务为游戏生成贴图。
先阅读 C:\project\image\AI_GAME_TEXTURE_GUIDE.md。
接口为 POST http://127.0.0.1:3000/generate，JSON 请求包含 prompt 和 n:1。
不指定 model，使用服务当前配置。不要输出或传播任何密钥。
先检查 /health，服务未启动时在单独终端从 C:\project\image 运行 npm start。
先根据游戏项目确定用途、尺寸、风格、视角和透明要求，缺失关键需求时向我确认。
先生成一张样图检查，再按资源清单顺序生成；不要并发大量请求。
解析 data[0].b64_json 或下载 data[0].url，将图片保存到游戏项目 assets/textures，
保留提示词元数据并避免覆盖已有素材。检查实际尺寸、透明通道和接缝。
如果没有图像检查工具，请明确说明哪些视觉要求尚未验证。
最终报告生成文件路径、用途、检查结果和仍需处理的事项。
```
