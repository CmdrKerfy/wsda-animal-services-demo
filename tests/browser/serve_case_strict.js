#!/usr/bin/env node
'use strict';
// A local static server for site/ that is as strict about letter case as GitHub Pages. This
// Mac's disk ignores case, so a reference to "App/ui.js" for the file "app/ui.js" works in every local test and
// fails only once hosted. Use it in place of `python3 -m http.server` for the hosted-mode (http) browser runs.
//
//   - Serves site/ on 127.0.0.1 (port 8765, or the first argument), GET and HEAD only.
//   - Answers 404, and logs it as a case miss, when a request's path differs in case from the files on disk.
//   - Refuses to start when two paths under site/ differ only in case.
//   - Prints every case miss when it stops (Ctrl+C or SIGTERM), and "case misses: 0" when there were none.
//
// Usage (repository root): node tests/browser/serve_case_strict.js [port]   (SITE_ROOT=<folder> serves another copy)
// Then, for example: S7_PAGE_URL=http://127.0.0.1:8765/cvi/index.html node tests/browser/run_s7_browser.js
// Nothing is installed; no files are written. Stop it when the run is over.
const http = require('http');
const fs = require('fs');
const path = require('path');

// SITE_ROOT: another copy of site/ to serve (for example a public copy's site/ folder).
const SITE = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.resolve(__dirname, '..', '..', 'site');
const PORT = Number(process.argv[2] || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.zip': 'application/zip',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

// Every file and folder under site/, with its exact spelling, relative to site/ with "/" separators.
function listAll(dir, prefix, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    out.push(rel);
    if (e.isDirectory()) listAll(path.join(dir, e.name), rel, out);
  }
  return out;
}
const exact = new Set(listAll(SITE, '', []));
const byLower = new Map();
for (const p of exact) {
  const k = p.toLowerCase();
  if (byLower.has(k)) {
    console.error('Refusing to start: "' + byLower.get(k) + '" and "' + p + '" differ only in letter case.');
    process.exit(2);
  }
  byLower.set(k, p);
}

const misses = [];
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  } catch (e) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  rel = rel.replace(/\/+$/, '');
  if (rel.split('/').some(part => part === '..' || part === '.')) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!exact.has(rel)) {
    const other = byLower.get(rel.toLowerCase());
    if (other) {
      misses.push(rel + ' (on disk: ' + other + ')');
      console.log('case miss: /' + rel + ' (on disk: /' + other + ')');
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const file = path.join(SITE, rel);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
});

function stop() {
  console.log('case misses: ' + misses.length);
  misses.forEach(m => console.log('  ' + m));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + SITE + ' on http://127.0.0.1:' + PORT + '/ (case-strict; ' + exact.size + ' paths)');
});
