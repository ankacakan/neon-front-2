#!/usr/bin/env node
/**
 * NEON FRONT 2.0 — bağımlılıksız statik geliştirme sunucusu
 * ---------------------------------------------------------------
 * .glb / .gltf / .wasm / doku dosyaları file:// altında CORS nedeniyle
 * bloklanır. Bu sunucu doğru MIME türlerini gönderir, böylece oyun
 * http://localhost:8123 üzerinden sorunsuz yüklenir.
 *
 * Kullanım:
 *   node tools/serve.mjs            (varsayılan port 8123)
 *   node tools/serve.mjs 9000
 *   PORT=9000 node tools/serve.mjs
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || process.argv[2] || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/aces',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function sendFile(res, filePath, status = 200) {
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  let st;
  try { st = statSync(filePath); } catch { return false; }
  if (st.isDirectory()) return false;
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
    // WASM/SharedArrayBuffer için gerekirse açılabilir:
    // 'Cross-Origin-Opener-Policy': 'same-origin',
    // 'Cross-Origin-Embedder-Policy': 'require-corp'
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  let filePath = normalize(join(ROOT, urlPath));
  // Dizin dışına çıkma koruması
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Dizin isteniyse index.html'e düş
  try {
    if (statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
  } catch { /* yok */ }

  if (!sendFile(res, filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + urlPath);
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  NEON FRONT 2.0 — geliştirme sunucusu çalışıyor');
  console.log('  ------------------------------------------------');
  console.log('  Klasör : ' + ROOT);
  console.log('  Adres  : ' + url);
  console.log('');
  console.log('  Durdurmak için Ctrl+C');
  console.log('');
});
