import json, sys, collections
S='/data/home/.hermes/cache/scratch/'
for f in sys.argv[1:]:
    js=json.load(open(S+'js_'+f+'.json')); py=json.load(open(S+'py_'+f+'.json'))
    print('=====', f, 'js', len(js), 'py', len(py))
    dj={r['No Peserta']+'|'+str(r['Halaman']):r for r in js}; dp={r['No Peserta']+'|'+str(r['Halaman']):r for r in py}
    print(' hanya js', len(set(dj)-set(dp)), list(set(dj)-set(dp))[:3], ' hanya py', len(set(dp)-set(dj)), list(set(dp)-set(dj))[:3])
    diff=collections.Counter(); ex={}
    for k in set(dj)&set(dp):
        for c in ['No','Nama','Pendidikan','TWK','TIU','TKP','Total','Keterangan','Instansi','Jabatan Formasi','Lokasi Formasi','Jenis Formasi']:
            a=str(dj[k][c]).strip(); b=' '.join(str(dp[k][c] or '').split())
            if a!=b:
                diff[c]+=1; ex.setdefault(c,[]).append((k,a,b))
    for c,n in diff.items():
        print(f'  {c}: {n} beda'); [print('     js=',repr(e[1]),'\n     py=',repr(e[2])) for e in ex[c][:3]]
