// Jalankan parser.js di Node pada PDF: node tools/run_node.mjs in.pdf out.json [maxPages]
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePage } from '../parser.js';
const [,, inp, out, maxP] = process.argv;
const data = new Uint8Array(fs.readFileSync(inp));
const doc = await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
const n = Math.min(doc.numPages, maxP ? +maxP : Infinity);
const state = {}; const rows = []; const t0 = Date.now();
for (let i = 1; i <= n; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  rows.push(...parsePage(tc.items, vp.height, i, state));
  page.cleanup();
}
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`${inp}: ${n} halaman, ${rows.length} baris, ${((Date.now() - t0) / n).toFixed(1)} ms/halaman`);
