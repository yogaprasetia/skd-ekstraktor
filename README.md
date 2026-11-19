# Ekstraktor Nilai SKD CPNS

Web untuk mengubah PDF pengumuman hasil SKD dari SSCASN BKN menjadi Excel/CSV
(No, No Peserta, Nama, Pendidikan, TWK, TIU, TKP, Total, Keterangan, Instansi, Jabatan, Lokasi, Jenis Formasi, Halaman).

- Diproses sepenuhnya di browser (pdf.js); file tidak diunggah ke server.
- Progres tersimpan di IndexedDB, bisa dijeda dan dilanjutkan.
- UI mengikuti INA Digital Design System (IDDS).

Uji parser: `cd tools && npm i && node run_node.mjs file.pdf out.json` lalu bandingkan dengan `ref_notebook.py` (logika notebook Colab asli).
