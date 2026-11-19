// Ekstraktor Nilai SKD — logika halaman (browser). Parser ada di parser.js.
import * as pdfjs from './vendor/pdf.min.mjs';
import { COLUMNS, parsePage } from './parser.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('id-ID');
const NUM_COLS = new Set(['No', 'TWK', 'TIU', 'TKP', 'Total', 'Halaman']);

// ---------------- IndexedDB (progres & hasil) ----------------
const DB_NAME = 'skd-ekstraktor';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('meta', { keyPath: 'fp' });
      d.createObjectStore('pages'); // key: [fp, pageNo] -> rows[]
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const getMeta = (fp) => tx(['meta'], 'readonly', (t) => t.objectStore('meta').get(fp));
async function savePages(meta, pending) {
  await tx(['meta', 'pages'], 'readwrite', (t) => {
    const ps = t.objectStore('pages');
    for (const [p, rows] of pending) ps.put(rows, [meta.fp, p]);
    t.objectStore('meta').put(meta);
  });
}
async function loadRows(fp) {
  const range = IDBKeyRange.bound([fp, 0], [fp, Number.MAX_SAFE_INTEGER]);
  const lists = await tx(['pages'], 'readonly', (t) => t.objectStore('pages').getAll(range));
  return lists.flat();
}
async function clearFp(fp) {
  const range = IDBKeyRange.bound([fp, 0], [fp, Number.MAX_SAFE_INTEGER]);
  await tx(['meta', 'pages'], 'readwrite', (t) => {
    t.objectStore('pages').delete(range);
    t.objectStore('meta').delete(fp);
  });
}

// ---------------- keadaan ----------------
let file = null, fp = null, meta = null, doc = null;
let rows = [];          // semua baris hasil
let running = false, pauseReq = false;
let view = [], page = 1;

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4000);
}
function setError(msg) {
  const el = $('file-error');
  el.textContent = msg || ''; el.hidden = !msg;
  $('dropzone').setAttribute('aria-invalid', msg ? 'true' : 'false');
}
const sizeTxt = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(b / 1024)} KB`;
function etaTxt(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `sisa sekitar ${Math.ceil(sec)} detik`;
  return `sisa sekitar ${Math.ceil(sec / 60)} menit`;
}

// ---------------- pilih file ----------------
async function pickFile(f) {
  setError('');
  if (!f) return;
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
    setError('File harus berformat PDF. Pilih file pengumuman hasil SKD berekstensi .pdf.');
    return;
  }
  if (running) { setError('Proses masih berjalan. Jeda dulu sebelum memilih file lain.'); return; }
  file = f; fp = `${f.name}|${f.size}|${f.lastModified}`; doc = null; rows = [];
  $('fi-name').textContent = f.name;
  $('fi-meta').textContent = `${sizeTxt(f.size)} · membaca jumlah halaman…`;
  $('fileinfo').hidden = false;
  $('sec-result').hidden = true; $('sec-progress').hidden = true;

  try {
    const data = new Uint8Array(await f.arrayBuffer());
    doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  } catch (e) {
    console.error(e);
    $('fileinfo').hidden = true; file = null;
    setError('File PDF tidak bisa dibaca. Pastikan file tidak rusak atau terkunci kata sandi, lalu coba lagi.');
    return;
  }
  $('fi-meta').textContent = `${sizeTxt(f.size)} · ${fmt.format(doc.numPages)} halaman`;

  meta = await getMeta(fp);
  $('start-actions').hidden = false;
  if (meta && meta.nextPage > 1) {
    const done = meta.nextPage > meta.numPages;
    $('resume-box').hidden = done;
    $('btn-restart').hidden = false;
    if (done) {
      $('btn-start-label').textContent = 'Ekstrak ulang';
      $('btn-start').classList.replace('ina-button--primary', 'ina-button--secondary');
      $('btn-restart').hidden = true;
      rows = await loadRows(fp);
      showResult();
      toast('Hasil tersimpan untuk file ini ditampilkan.');
    } else {
      $('resume-text').textContent = `Terakhir sampai halaman ${fmt.format(meta.nextPage - 1)} dari ${fmt.format(meta.numPages)} (${fmt.format(meta.rowCount)} peserta).`;
      $('btn-start-label').textContent = `Lanjutkan dari halaman ${fmt.format(meta.nextPage)}`;
      $('btn-start').classList.replace('ina-button--secondary', 'ina-button--primary');
    }
  } else {
    meta = null;
    $('resume-box').hidden = true; $('btn-restart').hidden = true;
    $('btn-start-label').textContent = 'Mulai ekstrak';
    $('btn-start').classList.replace('ina-button--secondary', 'ina-button--primary');
  }
}

// ---------------- proses ----------------
async function run(fromStart) {
  if (!doc || running) return;
  if (fromStart || !meta || meta.nextPage > meta.numPages) {
    if (meta) await clearFp(fp);
    meta = { fp, name: file.name, numPages: doc.numPages, nextPage: 1, state: {}, rowCount: 0, updated: Date.now() };
    rows = [];
  } else if (rows.length === 0 && meta.rowCount > 0) {
    rows = await loadRows(fp);
  }
  running = true; pauseReq = false;
  $('resume-box').hidden = true; $('start-actions').hidden = true;
  $('sec-progress').hidden = false; $('sec-result').hidden = true;
  $('btn-pause').disabled = false;
  $('sec-progress').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  const n = doc.numPages, start = meta.nextPage, t0 = performance.now();
  const state = meta.state || {};
  let pending = [], lastFlush = performance.now(), lastUi = 0;
  try {
    for (let i = start; i <= n; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const r = parsePage(tc.items, vp.height, i, state);
      pg.cleanup();
      if (r.length) { rows.push(...r); pending.push([i, r]); }
      meta.nextPage = i + 1; meta.state = state; meta.rowCount = rows.length;
      const now = performance.now();
      if (now - lastFlush > 1500 || i === n || pauseReq) {
        meta.updated = Date.now();
        await savePages(meta, pending); pending = []; lastFlush = now;
      }
      if (now - lastUi > 150 || i === n) {
        lastUi = now;
        const doneN = i - start + 1, pct = Math.floor((i / n) * 100);
        const rate = (now - t0) / doneN;
        $('prog-text').textContent = `Halaman ${fmt.format(i)} dari ${fmt.format(n)}`;
        $('prog-pct').textContent = `${pct}%`;
        $('prog-fill').style.width = `${(i / n) * 100}%`;
        $('prog-bar').setAttribute('aria-valuenow', String(pct));
        $('prog-rows').textContent = `${fmt.format(rows.length)} peserta ditemukan`;
        $('prog-eta').textContent = etaTxt(((n - i) * rate) / 1000);
      }
      if (pauseReq) break;
    }
  } catch (e) {
    console.error(e);
    if (pending.length) await savePages(meta, pending).catch(() => {});
    running = false;
    $('prog-text').textContent = `Proses berhenti di halaman ${fmt.format(meta.nextPage)}.`;
    setError('Terjadi kendala saat membaca halaman. Pilih file yang sama lagi untuk melanjutkan dari progres terakhir.');
    $('start-actions').hidden = false; $('btn-start-label').textContent = `Lanjutkan dari halaman ${fmt.format(meta.nextPage)}`;
    return;
  }
  running = false;
  if (meta.nextPage <= n) {
    $('prog-text').textContent = `Dijeda di halaman ${fmt.format(meta.nextPage - 1)} dari ${fmt.format(n)}`;
    $('prog-eta').textContent = 'Progres tersimpan';
    $('btn-pause').disabled = true;
    $('start-actions').hidden = false; $('btn-restart').hidden = false;
    $('btn-start-label').textContent = `Lanjutkan dari halaman ${fmt.format(meta.nextPage)}`;
    showResult(true);
  } else {
    $('prog-text').textContent = 'Selesai';
    $('prog-eta').textContent = `${((performance.now() - t0) / 1000).toFixed(0)} detik`;
    $('btn-pause').disabled = true;
    $('start-actions').hidden = false; $('btn-restart').hidden = true;
    $('btn-start-label').textContent = 'Ekstrak ulang';
    $('btn-start').classList.replace('ina-button--primary', 'ina-button--secondary');
    showResult();
    toast(`Selesai. ${fmt.format(rows.length)} peserta berhasil diekstrak.`);
  }
}

// ---------------- hasil ----------------
function showResult(partial = false) {
  $('sec-result').hidden = false;
  const n = meta ? meta.numPages : (doc ? doc.numPages : 0);
  const done = meta ? Math.min(meta.nextPage - 1, n) : n;
  $('result-sub').textContent = partial
    ? `Hasil sementara sampai halaman ${fmt.format(done)} dari ${fmt.format(n)}. Lanjutkan proses untuk data lengkap.`
    : `${file ? file.name : ''}`;
  $('m-rows').textContent = fmt.format(rows.length);
  const formasi = new Set(rows.map((r) => `${r['Jabatan Formasi']}|${r['Lokasi Formasi']}|${r['Jenis Formasi']}`));
  $('m-formasi').textContent = fmt.format(formasi.size);
  const pl = rows.filter((r) => r['Keterangan'] === 'P/L').length;
  $('m-pl').textContent = fmt.format(pl);
  $('m-pl-note').textContent = rows.length ? `${(pl / rows.length * 100).toFixed(1).replace('.', ',')}% dari seluruh peserta` : '-';
  $('m-pages').textContent = fmt.format(done);
  $('m-pages-note').textContent = `dari ${fmt.format(n)} halaman PDF`;

  const kets = [...new Set(rows.map((r) => r['Keterangan']).filter(Boolean))].sort();
  const sel = $('f-ket'), cur = sel.value;
  sel.innerHTML = '<option value="">Semua</option>' + kets.map((k) => `<option>${esc(k)}</option>`).join('');
  if (kets.includes(cur)) sel.value = cur;
  page = 1; applyFilter();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ketBadge(k) {
  if (!k) return '';
  const tone = { 'P/L': 'success', 'P': 'info', 'TL': 'warning', 'TH': 'neutral' }[k] || 'neutral';
  return `<span class="ina-badge ina-badge--soft ina-badge--${tone} ina-badge--sm ina-badge--rounded-full">${esc(k)}</span>`;
}

function applyFilter() {
  const q = $('q').value.trim().toLowerCase();
  const k = $('f-ket').value;
  view = rows.filter((r) => (!k || r['Keterangan'] === k) && (!q ||
    `${r['Nama']} ${r['No Peserta']} ${r['Jabatan Formasi']} ${r['Lokasi Formasi']} ${r['Pendidikan']}`.toLowerCase().includes(q)));
  render();
}

function render() {
  const size = +$('pg-size').value;
  const pages = Math.max(1, Math.ceil(view.length / size));
  page = Math.min(Math.max(1, page), pages);
  const slice = view.slice((page - 1) * size, page * size);
  $('tbody').innerHTML = slice.map((r) => `<tr class="ina-table__row">
    <td class="ina-table__cell num">${esc(r['No'])}</td>
    <td class="ina-table__cell nowrap">${esc(r['No Peserta'])}</td>
    <td class="ina-table__cell cell-wrap">${esc(r['Nama'])}</td>
    <td class="ina-table__cell cell-wrap">${esc(r['Pendidikan'])}</td>
    <td class="ina-table__cell num">${esc(r['TWK'])}</td>
    <td class="ina-table__cell num">${esc(r['TIU'])}</td>
    <td class="ina-table__cell num">${esc(r['TKP'])}</td>
    <td class="ina-table__cell num"><b>${esc(r['Total'])}</b></td>
    <td class="ina-table__cell">${ketBadge(r['Keterangan'])}</td>
    <td class="ina-table__cell cell-wrap">${esc(r['Jabatan Formasi'])}</td>
    <td class="ina-table__cell cell-wrap">${esc(r['Lokasi Formasi'])}</td>
    <td class="ina-table__cell nowrap">${esc(r['Jenis Formasi'])}</td></tr>`).join('');
  $('empty').hidden = view.length > 0;
  updHint();
  $('pg-info').textContent = `Halaman ${fmt.format(page)} dari ${fmt.format(pages)} · ${fmt.format(view.length)} baris`;
  const setBtn = (id, dis) => { const b = $(id); b.disabled = dis; b.classList.toggle('ina-pagination__nav-button--disabled', dis); };
  setBtn('pg-first', page <= 1); setBtn('pg-prev', page <= 1);
  setBtn('pg-next', page >= pages); setBtn('pg-last', page >= pages);
}

// ---------------- unduh ----------------
function baseName() { return 'hasil_ekstrak_' + (file ? file.name.replace(/\.pdf$/i, '') : 'skd'); }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function exportCsv() {
  if (!rows.length) { toast('Belum ada data untuk diunduh.'); return; }
  const q = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => q(r[c])).join(','));
  download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), baseName() + '.csv');
  toast('File CSV sedang diunduh.');
}
async function exportXlsx() {
  if (!rows.length) { toast('Belum ada data untuk diunduh.'); return; }
  if (!window.XLSX) { toast('Modul Excel belum termuat. Muat ulang halaman, lalu coba lagi.'); return; }
  const btn = $('btn-xlsx'); btn.disabled = true;
  toast('Menyiapkan file Excel…');
  await new Promise((r) => setTimeout(r, 30));
  try {
    const aoa = [COLUMNS];
    for (const r of rows) aoa.push(COLUMNS.map((c) => {
      const v = r[c];
      return NUM_COLS.has(c) && /^\d+$/.test(String(v)) ? Number(v) : (v ?? '');
    }));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [6, 20, 30, 30, 6, 6, 6, 7, 11, 40, 50, 60, 18, 8].map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: COLUMNS.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nilai SKD');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), baseName() + '.xlsx');
    toast('File Excel sedang diunduh.');
  } catch (e) {
    console.error(e);
    toast('File Excel gagal dibuat. Coba unduh CSV sebagai gantinya.');
  } finally { btn.disabled = false; }
}

// ---------------- event ----------------
const dz = $('dropzone'), input = $('file-input');
$('file-btn').addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
dz.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('click', (e) => e.stopPropagation());
input.addEventListener('change', () => { pickFile(input.files[0]); input.value = ''; });
['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
dz.addEventListener('drop', (e) => pickFile(e.dataTransfer.files[0]));

$('btn-start').addEventListener('click', () => run(false));
$('btn-restart').addEventListener('click', () => run(true));
$('btn-pause').addEventListener('click', () => { pauseReq = true; $('btn-pause').disabled = true; $('prog-eta').textContent = 'Menyimpan progres…'; });
$('btn-csv').addEventListener('click', exportCsv);
$('btn-xlsx').addEventListener('click', exportXlsx);
$('btn-clear').addEventListener('click', async () => {
  if (running) { toast('Jeda proses dulu sebelum menghapus data.'); return; }
  if (!fp) return;
  if (!confirm('Hapus progres dan hasil yang tersimpan untuk file ini? Tindakan ini tidak bisa dibatalkan.')) return;
  await clearFp(fp); meta = null; rows = [];
  $('sec-result').hidden = true; $('sec-progress').hidden = true;
  $('btn-restart').hidden = true; $('btn-start-label').textContent = 'Mulai ekstrak';
  $('btn-start').classList.replace('ina-button--secondary', 'ina-button--primary');
  $('start-actions').hidden = !doc;
  toast('Data tersimpan sudah dihapus.');
});

// ---------------- geser tabel dengan keyboard ----------------
// Kontainer tabel bisa difokus (Tab atau klik). Panah kiri/kanan menggeser ke samping, Home/End ke ujung kiri/kanan;
// panah atas/bawah, PageUp/PageDown, dan spasi tetap menggulir halaman.
const ts = $('table-scroll');
ts.addEventListener('mousedown', (e) => {
  if (e.target.closest('a,button,input,select,textarea')) return;
  setTimeout(() => { ts.focus({ preventScroll: true }); ts.classList.add('is-focus'); }, 0);
});
ts.addEventListener('blur', () => ts.classList.remove('is-focus'));
ts.addEventListener('keydown', (e) => {
  if (e.target !== ts || e.altKey || e.ctrlKey || e.metaKey) return;
  const step = e.shiftKey ? ts.clientWidth * 0.8 : 80;
  const smooth = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const by = { ArrowRight: step, ArrowLeft: -step }[e.key];
  if (by) { e.preventDefault(); ts.scrollBy({ left: by, behavior: smooth }); return; }
  if (e.key === 'Home' && ts.scrollLeft > 0) { e.preventDefault(); ts.scrollTo({ left: 0, behavior: smooth }); }
  else if (e.key === 'End' && ts.scrollLeft < ts.scrollWidth - ts.clientWidth - 1) { e.preventDefault(); ts.scrollTo({ left: ts.scrollWidth, behavior: smooth }); }
});
const updHint = () => { $('scroll-hint').hidden = ts.scrollWidth <= ts.clientWidth + 1; };
new ResizeObserver(updHint).observe(ts);

let qt;
$('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { page = 1; applyFilter(); }, 200); });
$('f-ket').addEventListener('change', () => { page = 1; applyFilter(); });
$('pg-size').addEventListener('change', () => { page = 1; render(); });
$('pg-first').addEventListener('click', () => { page = 1; render(); });
$('pg-prev').addEventListener('click', () => { page--; render(); });
$('pg-next').addEventListener('click', () => { page++; render(); });
$('pg-last').addEventListener('click', () => { page = Infinity; render(); });
window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });

// untuk pengujian otomatis
window.__skd = { pickFile, run, get rows() { return rows; }, get running() { return running; }, pause: () => { pauseReq = true; } };
