import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 8765);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.zmx': 'application/octet-stream', '.len': 'application/octet-stream' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Invalid path');
    let path = resolve(root, '.' + pathname);
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(path));
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo: http://127.0.0.1:${port}/examples/browser/`);
  console.log(`Browser tests: http://127.0.0.1:${port}/test/browser.html`);
});
