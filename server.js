import http from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 1024 * 1024;
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createServer(config = process.env) {
  const base = (config.RELAY_BASE_URL || '').replace(/\/+$/, '');
  const endpoint = config.RELAY_IMAGE_ENDPOINT || `${base}/images/generations`;
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') {
      return reply(res, 200, { status: 'ok', configured: Boolean(base && config.RELAY_API_KEY) });
    }
    if (req.method !== 'POST' || !['/generate', '/v1/images/generations'].includes(path)) {
      return reply(res, 404, { error: { message: '接口不存在' } });
    }
    if (config.LOCAL_API_KEY && req.headers.authorization !== `Bearer ${config.LOCAL_API_KEY}`) {
      return reply(res, 401, { error: { message: '本地 API Key 不正确' } });
    }
    if (!base || !config.RELAY_API_KEY) {
      return reply(res, 503, { error: { message: '请在 .env 配置 RELAY_BASE_URL 和 RELAY_API_KEY' } });
    }
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) {
          reply(res, 413, { error: { message: '请求体不能超过 1 MB' } });
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return reply(res, 400, { error: { message: '请求体必须是有效 JSON' } }); }
      if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        return reply(res, 400, { error: { message: 'prompt 必须是非空字符串' } });
      }
      if (body.n !== undefined && (!Number.isInteger(body.n) || body.n < 1 || body.n > 10)) {
        return reply(res, 400, { error: { message: 'n 必须是 1 至 10 的整数' } });
      }
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.RELAY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.IMAGE_MODEL || 'gpt-image-1', ...body }),
        signal: AbortSignal.timeout(Number(config.REQUEST_TIMEOUT_MS) || 180000),
        redirect: 'error',
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); }
      catch { return reply(res, 502, { error: { message: '中转站返回了非 JSON 响应', upstream_status: upstream.status } }); }
      reply(res, upstream.status, data);
    } catch (error) {
      const timeout = error.name === 'TimeoutError';
      reply(res, timeout ? 504 : 502, { error: { message: timeout ? '生图请求超时，请稍后重试' : '无法连接中转站，请检查地址和网络' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.requestTimeout = 200000;
  server.listen(port, host, () => console.log(`生图接口已启动：http://${host}:${port}`));
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
