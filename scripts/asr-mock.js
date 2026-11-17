const http = require('http');
const srv = http.createServer((req, res) => {
  let size = 0;
  req.on('data', (c) => { size += c.length; });
  req.on('end', () => {
    console.log('[asr-mock]', req.method, req.url, 'bytes=', size, 'auth=', req.headers.authorization || '-', 'ctype=', (req.headers['content-type'] || '').slice(0, 40));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: '这是模拟转写：周五前把埋点方案评审掉' }));
  });
});
srv.listen(8799, '127.0.0.1', () => console.log('[asr-mock] listening 8799'));
