# Logika notebook asli (pdfplumber) sebagai pembanding. python ref_notebook.py in.pdf out.json [maxPages]
import pdfplumber, re, json, sys
inp, out = sys.argv[1], sys.argv[2]
maxp = int(sys.argv[3]) if len(sys.argv) > 3 else None
rows = []; ci = cj = cl = cn = ""
with pdfplumber.open(inp) as pdf:
    for i, page in enumerate(pdf.pages):
        if maxp and i >= maxp: break
        if i == 0: continue
        text = page.extract_text(layout=True)
        if not text: page.flush_cache(); continue
        m = re.search(r"Instansi\s*:\s*(.*?)\s*\d+\s*\n", text); ci = m.group(1).strip() if m else ci
        jm = re.search(r"Jabatan Formasi\s*:\s*(.*?)\s*\d+\s*\n", text); cj = jm.group(1).strip() if jm else cj
        nm = re.search(r"Jenis Formasi\s*:\s*(.*?)\s*\d+\s*\n", text); cn = nm.group(1).strip() if nm else cn
        if jm and nm:
            a = text.find('\n', text.find("Jabatan Formasi")); b = text.find("Jenis Formasi")
            if a != -1 and b != -1 and a < b:
                blk = re.sub(r"Lokasi Formasi\s*:", "", text[a:b]); cle = []
                for line in blk.split('\n'):
                    c = re.sub(r'\s*\d+\s*$', '', line).strip()
                    if c: cle.append(c)
                pre = ""; oth = []
                for line in cle:
                    if re.match(r'^\d+\s*-', line): pre = line
                    else: oth.append(line)
                cl = (pre + " " + " ".join(oth)).strip()
        for t in page.extract_tables():
            for r in t:
                if not r or not str(r[0]).isdigit() or len(r) < 10: continue
                if not r[1] or len(str(r[1])) < 10: continue
                rows.append({'No': r[0], 'No Peserta': r[1], 'Nama': (r[2] or '').replace('\n', ' '),
                             'Pendidikan': (r[3] or '').replace('\n', ' '), 'TWK': r[5], 'TIU': r[6], 'TKP': r[7],
                             'Total': r[8], 'Keterangan': r[9], 'Instansi': ci, 'Jabatan Formasi': cj,
                             'Lokasi Formasi': cl, 'Jenis Formasi': cn, 'Halaman': i + 1})
        page.flush_cache()
json.dump(rows, open(out, 'w'))
print(inp, len(rows), 'baris')
