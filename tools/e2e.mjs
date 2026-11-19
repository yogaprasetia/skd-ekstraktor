// Uji end-to-end UI di Chromium headless: node tools/e2e.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.URL || 'http://127.0.0.1:8765/';
const PDF = path.resolve('../samples/mari.pdf');
const OUT = '/data/home/.hermes/cache/scratch/skd_e2e';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'], userDataDir: OUT + '/profile' });
const pg = await browser.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ext = [];
pg.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) ext.push(r.url()); });
await pg.setViewport({ width: 1440, height: 900 });
await pg.goto(URL, { waitUntil: 'networkidle0' });
await pg.screenshot({ path: OUT + '/1_awal.png', fullPage: true });
console.log('Inter loaded:', await pg.evaluate(() => document.fonts.check('16px Inter')));

async function pick() {
  const input = await pg.$('#file-input');
  await input.uploadFile(PDF);
  await pg.waitForFunction(() => /halaman/.test(document.getElementById('fi-meta').textContent) && !/membaca/.test(document.getElementById('fi-meta').textContent), { timeout: 60000 });
}

// 1) mulai, jeda di tengah, muat ulang halaman, lanjutkan
await pick();
await pg.screenshot({ path: OUT + '/2_file.png', fullPage: true });
await pg.click('#btn-start');
await pg.waitForFunction(() => window.__skd.rows.length > 3000, { timeout: 120000 });
await pg.click('#btn-pause');
await pg.waitForFunction(() => !window.__skd.running, { timeout: 30000 });
const pausedRows = await pg.evaluate(() => window.__skd.rows.length);
console.log('jeda di', await pg.$eval('#prog-text', (e) => e.textContent), 'baris', pausedRows);
await pg.screenshot({ path: OUT + '/3_jeda.png', fullPage: true });

await pg.reload({ waitUntil: 'networkidle0' });
await pick();
console.log('resume box:', await pg.$eval('#resume-text', (e) => e.textContent), '| tombol:', await pg.$eval('#btn-start-label', (e) => e.textContent));
await pg.screenshot({ path: OUT + '/4_resume.png', fullPage: true });
const t0 = Date.now();
await pg.click('#btn-start');
await pg.waitForFunction(() => !window.__skd.running && /Selesai/.test(document.getElementById('prog-text').textContent), { timeout: 600000 });
console.log('selesai dalam', ((Date.now() - t0) / 1000).toFixed(1), 's');
const rows = await pg.evaluate(() => window.__skd.rows);
fs.writeFileSync(OUT + '/rows.json', JSON.stringify(rows));
console.log('baris total:', rows.length, '| metrik:', await pg.$eval('#m-rows', (e) => e.textContent), await pg.$eval('#m-formasi', (e) => e.textContent), await pg.$eval('#m-pl', (e) => e.textContent));
await pg.screenshot({ path: OUT + '/5_hasil.png', fullPage: true });

// 2) cari + filter
await pg.type('#q', 'dokter gigi');
await sleep(500);
console.log('cari "dokter gigi":', await pg.$eval('#pg-info', (e) => e.textContent));
await pg.select('#f-ket', 'P/L');
await sleep(300);
console.log('+ filter P/L:', await pg.$eval('#pg-info', (e) => e.textContent));
await pg.screenshot({ path: OUT + '/6_filter.png', fullPage: false });
await pg.$eval('#q', (e) => { e.value = 'zzzxxq'; e.dispatchEvent(new Event('input')); });
await sleep(400);
console.log('kosong tampil:', await pg.$eval('#empty', (e) => !e.hidden));
await pg.$eval('#q', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
await pg.select('#f-ket', '');
await sleep(300);

// 3) unduh
const cdp = await pg.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
await pg.click('#btn-xlsx');
await pg.click('#btn-csv');
for (let i = 0; i < 60; i++) {
  const f = fs.readdirSync(OUT);
  if (f.some((x) => x.endsWith('.xlsx')) && f.some((x) => x.endsWith('.csv')) && !f.some((x) => x.endsWith('.crdownload'))) break;
  await sleep(500);
}
console.log('unduhan:', fs.readdirSync(OUT).filter((x) => /\.(xlsx|csv)$/.test(x)).map((x) => `${x} ${fs.statSync(OUT + '/' + x).size}`));

// 4) mobile
await pg.setViewport({ width: 390, height: 844, isMobile: true });
await pg.reload({ waitUntil: 'networkidle0' });
await pick();
await sleep(500);
const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
console.log('mobile scrollWidth/innerWidth:', sw);
await pg.screenshot({ path: OUT + '/7_mobile.png', fullPage: true });

console.log('request eksternal:', ext.length ? ext : 'tidak ada');
console.log('error:', errors.length ? errors : 'tidak ada');
await browser.close();
