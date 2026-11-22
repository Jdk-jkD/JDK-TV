import { describe, expect, it, vi } from 'vitest';
import { handleLiveStreamRequest, handleProxyRequest } from './proxy-handlers';
import { fetchWithSafeRedirects } from './fetch-utils';

vi.mock('./api-guard', () => ({ guardRequest: () => null, jsonError: () => new Response(null, { status: 400 }) }));
vi.mock('./ssrf', () => ({ isValidProxyUrl: () => true, isBlockedByDNS: async () => false,
  checkLiveUrlAllowed: async () => ({ ok: true }) }));
vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));

describe('代理响应的文档隔离', () => {
  it.each([
    ['HTML', 'text/html', '<h1>上游错误页面</h1>'],
    ['SVG', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'],
    ['视频分片', 'video/mp2t', 'segment'],
  ])('%s保持原始内容，同时阻止作为同源可执行文档使用', async (_name, type, body) => {
    for (const handler of [handleProxyRequest, handleLiveStreamRequest]) {
      vi.mocked(fetchWithSafeRedirects).mockResolvedValueOnce({
        res: new Response(body, { headers: { 'content-type': type } }), finalUrl: 'https://media.example/file',
      });
      const response = await handler(new Request('http://localhost/api/proxy'), 'https://media.example/file');
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
      expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
      expect(response.headers.get('content-security-policy')).not.toContain('allow-same-origin');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-type')).toBe(type);
      expect(await response.text()).toBe(body);
    }
  });
});
