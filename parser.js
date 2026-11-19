// Parser halaman PDF hasil SKD BKN (format "HASIL / REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR").
// Masukan: item teks pdf.js (getTextContent) satu halaman. Keluaran: baris peserta + konteks formasi.
// Murni (tanpa DOM) supaya bisa dites di Node.

export const COLUMNS = [
  'No', 'No Peserta', 'Nama', 'Pendidikan', 'TWK', 'TIU', 'TKP', 'Total', 'Keterangan',
  'Instansi', 'Jabatan Formasi', 'Lokasi Formasi', 'Jenis Formasi', 'Halaman',
];

const ANCHOR_RE = /^\d{12,20}$/; // No Peserta (17 digit)

// Pecah item pdf.js menjadi kata dengan perkiraan posisi x per kata.
export function toWords(items, pageHeight) {
  const words = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const x = it.transform[4];
    const y = pageHeight - it.transform[5]; // y dari atas (baseline)
    const w = it.width || 0;
    const cw = s.length ? w / s.length : 0;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(s))) {
      const x0 = x + m.index * cw;
      words.push({ t: m[0], x0, x1: x0 + m[0].length * cw, y });
    }
  }
  return words;
}

function groupLines(words, tol = 2.5) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.y - last.y) <= tol) last.words.push(w);
    else lines.push({ y: w.y, words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

const center = (w) => (w.x0 + w.x1) / 2;
const joinWords = (ws) => ws.map((w) => w.t).join(' ').replace(/\s+/g, ' ').trim();

// Cari model kolom dari judul tabel ("No Peserta", "Nama", ... "Keterangan").
function findColumnModel(words) {
  const peserta = words.filter((w) => w.t === 'Peserta');
  for (const p of peserta) {
    const near = (t, dy = 14) => words.filter((w) => w.t === t && Math.abs(w.y - p.y) <= dy);
    const nama = near('Nama', 3)[0];
    const pend = near('Pendidikan', 3).find((w) => w.x0 > p.x1);
    const ket = near('Keterangan', 10)[0];
    const twk = near('TWK')[0], tiu = near('TIU')[0], tkp = near('TKP')[0], tot = near('Total')[0];
    const tahun = near('Tahun', 3)[0];
    const noP = words.filter((w) => w.t === 'No' && Math.abs(w.y - p.y) <= 3 && w.x1 <= p.x0 + 1)
      .sort((a, b) => b.x0 - a.x0);
    if (!nama || !pend || !twk || !tiu || !tkp || !tot || !ket || noP.length === 0) continue;
    const npLeft = noP[0].x0; // "No" milik "No Peserta"
    return {
      headerY: Math.max(twk.y, tiu.y, tkp.y, tot.y, p.y),
      cNoPeserta: (npLeft + p.x1) / 2,
      cNama: center(nama),
      cPend: center(pend),
      right: [
        ['tahun', tahun ? center(tahun) + 6 : (center(pend) + center(twk)) / 2],
        ['TWK', center(twk)], ['TIU', center(tiu)], ['TKP', center(tkp)],
        ['Total', center(tot)], ['Keterangan', center(ket)],
      ],
    };
  }
  return null;
}

// Nilai sebuah baris header (Instansi/Jabatan/Jenis): kata setelah label & ':' , tanpa kolom "Jumlah".
function headerValue(line, labelWords, jumlahX) {
  const lastLabel = labelWords[labelWords.length - 1];
  let ws = line.words.filter((w) => w.x0 > lastLabel.x1 - 0.5);
  if (jumlahX != null) ws = ws.filter((w) => w.x0 < jumlahX - 8);
  while (ws.length && /^:+$/.test(ws[0].t)) ws.shift();
  if (ws.length && ws[0].t.startsWith(':')) ws[0] = { ...ws[0], t: ws[0].t.replace(/^:+/, '') };
  let v = joinWords(ws);
  if (jumlahX == null) v = v.replace(/\s+\d+$/, '');
  return v;
}

function findLabelLine(lines, first, second) {
  for (const l of lines) {
    for (let i = 0; i < l.words.length; i++) {
      if (l.words[i].t !== first) continue;
      if (!second) return { line: l, label: [l.words[i]] };
      const n = l.words[i + 1];
      if (n && n.t.replace(/:$/, '') === second) return { line: l, label: [l.words[i], n] };
    }
  }
  return null;
}

// state: {instansi, jabatan, lokasi, jenis, model} — dibawa antar halaman.
export function parsePage(items, pageHeight, pageNo, state) {
  const words = toWords(items, pageHeight);
  const model = findColumnModel(words) || state.model;
  if (findColumnModel(words)) state.model = model;

  // ---------- header formasi (di atas tabel) ----------
  const topWords = model ? words.filter((w) => w.y < model.headerY - 25) : words;
  const lines = groupLines(topWords);
  const jumlah = topWords.find((w) => w.t === 'Jumlah');
  const jumlahX = jumlah ? jumlah.x0 : null;

  const ins = findLabelLine(lines, 'Instansi');
  if (ins) state.instansi = headerValue(ins.line, ins.label, jumlahX);
  const jab = findLabelLine(lines, 'Jabatan', 'Formasi');
  const jen = findLabelLine(lines, 'Jenis', 'Formasi');
  if (jab) state.jabatan = headerValue(jab.line, jab.label, jumlahX);
  if (jen) state.jenis = headerValue(jen.line, jen.label, jumlahX);
  if (jab && jen && jab.line.y < jen.line.y) {
    const block = lines.filter((l) => l.y > jab.line.y + 0.5 && l.y < jen.line.y - 0.5);
    const parts = [];
    let prefix = '';
    for (const l of block) {
      let ws = l.words.filter((w) => !(w.t === 'Lokasi' || /^Formasi:?$/.test(w.t) || /^:+$/.test(w.t)));
      if (jumlahX != null) ws = ws.filter((w) => w.x0 < jumlahX - 8);
      let s = joinWords(ws);
      if (jumlahX == null) s = s.replace(/\s+\d+$/, '');
      if (!s) continue;
      if (/^\d+\s*-/.test(s) && !prefix) prefix = s; else parts.push(s);
    }
    state.lokasi = [prefix, ...parts].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  if (!model) return [];

  // ---------- tabel peserta ----------
  const body = words.filter((w) => w.y > model.headerY + 2);
  const anchors = body
    .filter((w) => ANCHOR_RE.test(w.t) && Math.abs(center(w) - model.cNoPeserta) < 45)
    .sort((a, b) => a.y - b.y);
  if (anchors.length === 0) return [];

  const gaps = anchors.slice(1).map((a, i) => a.y - anchors[i].y).sort((a, b) => a - b);
  const half = gaps.length ? Math.min(gaps[Math.floor(gaps.length / 2)] / 2, 16) : 14;
  const bands = anchors.map((a, i) => ({
    top: i === 0 ? Math.max(model.headerY + 2, a.y - half - 6) : (anchors[i - 1].y + a.y) / 2,
    bottom: i === anchors.length - 1 ? a.y + half : (a.y + anchors[i + 1].y) / 2,
    a,
  }));

  // batas Nama | Pendidikan | kolom kanan (sel teks rata kiri, judul di tengah sel)
  let nameLeft = Infinity;
  for (const b of bands) {
    const after = body.filter((w) => w.y > b.top && w.y <= b.bottom && w.x0 > b.a.x1 + 1 && center(w) < model.cNama + 10);
    for (const w of after) nameLeft = Math.min(nameLeft, w.x0);
  }
  if (!isFinite(nameLeft)) nameLeft = model.cNoPeserta + (model.cNama - model.cNoPeserta) / 2;
  const cellL = nameLeft - 2;
  const bNamaPend = 2 * model.cNama - cellL;
  const bPendRight = 2 * model.cPend - bNamaPend;

  const rows = [];
  for (const b of bands) {
    const ws = body.filter((w) => w.y > b.top && w.y <= b.bottom && w !== b.a)
      .sort((p, q) => p.y - q.y || p.x0 - q.x0);
    const cell = { no: [], nama: [], pend: [], tahun: [], TWK: [], TIU: [], TKP: [], Total: [], Keterangan: [] };
    for (const w of ws) {
      const c = center(w);
      if (w.x1 <= b.a.x0 + 0.5) cell.no.push(w);
      else if (c < bNamaPend) cell.nama.push(w);
      else if (c < bPendRight) cell.pend.push(w);
      else {
        let best = null, bd = Infinity;
        for (const [k, cx] of model.right) { const d = Math.abs(c - cx); if (d < bd) { bd = d; best = k; } }
        cell[best].push(w);
      }
    }
    // Footer / teks di luar tabel jangan ikut (mis. "Laporan digenerate ...")
    if (cell.nama.some((w) => w.t === 'Laporan')) cell.nama = cell.nama.filter((w) => Math.abs(w.y - b.a.y) < 12);
    rows.push({
      'No': joinWords(cell.no.filter((w) => /^\d+$/.test(w.t))),
      'No Peserta': b.a.t,
      'Nama': joinWords(cell.nama),
      'Pendidikan': joinWords(cell.pend),
      'TWK': joinWords(cell.TWK), 'TIU': joinWords(cell.TIU), 'TKP': joinWords(cell.TKP),
      'Total': joinWords(cell.Total), 'Keterangan': joinWords(cell.Keterangan),
      'Instansi': state.instansi || '', 'Jabatan Formasi': state.jabatan || '',
      'Lokasi Formasi': state.lokasi || '', 'Jenis Formasi': state.jenis || '',
      'Halaman': pageNo,
    });
  }
  return rows;
}
