const http = require('node:http');
const frontPort = Number(process.env.JDK_TV_FRONT_PORT || 8080);
const backendPort = Number(process.env.JDK_TV_BACKEND_PORT || 8081);
const sessionCookie = process.env.JDK_TV_SESSION_COOKIE;
if (!sessionCookie || !/^ltv_session=[^;]+$/.test(sessionCookie)) throw new Error('Local session missing');

http.createServer((request, response) => {
  const localHost = '127.0.0.1:' + frontPort;
  const origin = request.headers.origin;
  if (request.headers.host !== localHost ||
      (origin && origin !== `http://${localHost}`) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Local origin required');
    return;
  }
  const upstream = http.request({
    hostname: '127.0.0.1', port: backendPort, path: request.url,
    method: request.method,
    headers: { ...request.headers, cookie: sessionCookie },
  }, (result) => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end('JDK TV backend is unavailable');
  });
  request.pipe(upstream);
}).listen(frontPort, '127.0.0.1');
