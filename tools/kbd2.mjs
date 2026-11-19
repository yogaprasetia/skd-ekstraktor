import puppeteer from 'puppeteer-core';
import path from 'node:path';
const URL = process.env.URL || 'http://127.0.0.1:8765/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errs = [];
for (const [w, h] of [[1440, 800], [390, 844]]) {
  const pg = await b.newPage();
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.setViewport({ width: w, height: h });
  await pg.goto(URL, { waitUntil: 'networkidle0' });
  await (await pg.$('#file-input')).uploadFile(path.resolve('../samples/blitar.pdf'));
  await pg.waitForFunction(() => /halaman/.test(document.getElementById('fi-meta').textContent) && !/membaca/.test(document.getElementById('fi-meta').textContent));
  await pg.click('#btn-start');
  await pg.waitForFunction(() => !window.__skd.running && window.__skd.rows.length > 0, { timeout: 60000 });
  await sleep(500);
  const sl = () => pg.evaluate(() => Math.round(document.getElementById('table-scroll').scrollLeft));
  const sy = () => pg.evaluate(() => Math.round(scrollY));
  // A) klik sel tabel lalu panah kanan
  const cell = await pg.$('#tbody tr:nth-child(3) td:nth-child(3)');
  await cell.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await cell.click(); await sleep(100);
  const act = await pg.evaluate(() => document.activeElement.id);
  const a0 = await sl(); for (let i = 0; i < 5; i++) { await pg.keyboard.press('ArrowRight'); await sleep(80); } await sleep(400); const a1 = await sl();
  await pg.keyboard.press('End'); await sleep(500); const aEnd = await sl();
  await pg.keyboard.press('Home'); await sleep(500); const aHome = await sl();
  // B) panah bawah/PageDown tetap menggulir halaman saat tabel terfokus
  const y0 = await sy(); await pg.keyboard.press('PageDown'); await sleep(300); await pg.keyboard.press('ArrowDown'); await sleep(300); const y1 = await sy();
  // C) Tab sampai tabel
  await pg.evaluate(() => { scrollTo(0, 0); document.activeElement.blur(); });
  let n = 0, reached = false;
  for (; n < 40; n++) { await pg.keyboard.press('Tab'); if (await pg.evaluate(() => document.activeElement.id === 'table-scroll')) { reached = true; break; } }
  const ring = await pg.evaluate(() => getComputedStyle(document.getElementById('table-scroll')).outlineStyle);
  const hint = await pg.evaluate(() => !document.getElementById('scroll-hint').hidden);
  console.log(`${w}px | klik sel -> fokus ${act}, kanan ${a0}->${a1}, End ${aEnd}, Home ${aHome} | PageDown/ArrowDown halaman ${y0}->${y1} | Tab ke tabel: ${reached} (${n + 1}x), outline ${ring} | petunjuk tampil ${hint}`);
  if (w === 1440) { await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight'); await sleep(400);
    await pg.evaluate(() => { const c = document.querySelector('.card--flush'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 16); }); await sleep(300); await pg.screenshot({ path: '/data/home/.hermes/cache/scratch/skd_kbd.png' }); }
  await pg.close();
}
console.log('error:', errs.length ? errs : 'tidak ada');
await b.close();
