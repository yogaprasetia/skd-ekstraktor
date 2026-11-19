// Uji scroll dengan keyboard: node tools/kbd.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const URL = process.env.URL || 'http://127.0.0.1:8765/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1440, height: 800 });
await pg.goto(URL, { waitUntil: 'networkidle0' });
await (await pg.$('#file-input')).uploadFile(path.resolve('../samples/blitar.pdf'));
await pg.waitForFunction(() => /halaman/.test(document.getElementById('fi-meta').textContent) && !/membaca/.test(document.getElementById('fi-meta').textContent));
await pg.click('#btn-start');
await pg.waitForFunction(() => !window.__skd.running && window.__skd.rows.length > 0, { timeout: 60000 });
await sleep(800);
const info = () => pg.evaluate(() => ({ y: Math.round(scrollY), h: document.documentElement.scrollHeight, active: document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className }));
const test = async (label, prep) => {
  await pg.evaluate(() => scrollTo(0, 0)); await prep(); await sleep(200);
  const a = await info();
  for (const k of ['PageDown', 'ArrowDown', 'ArrowDown', 'Space', 'End']) { await pg.keyboard.press(k); await sleep(250); }
  const z = await info();
  console.log(`${label}: fokus=${a.active} y ${a.y} -> ${z.y} (maks ${z.h - 800}) ${z.y > a.y ? 'OK' : 'GAGAL'}`);
};
await test('setelah klik tombol Mulai', async () => { await pg.focus('#btn-start'); });
await test('setelah klik area kosong', async () => { await pg.mouse.click(1400, 300); });
await test('fokus di body', async () => { await pg.evaluate(() => document.activeElement.blur()); });
await test('setelah Jeda (tombol disabled)', async () => { await pg.evaluate(() => { const bt = document.getElementById('btn-pause'); bt.disabled = false; bt.focus(); bt.disabled = true; }); });
await test('fokus di tabel', async () => { await pg.mouse.click(700, 1400 - 0); });
await b.close();
