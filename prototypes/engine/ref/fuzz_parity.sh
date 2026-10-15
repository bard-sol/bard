#!/bin/sh
# Python-vs-JS parity fuzz: 3000 random fights must produce identical logs.
cd "$(dirname "$0")"
python3 - <<'PY'
import json,random
from resolver import resolve
U=json.load(open('../units-s0.json')); ids=[u['id'] for u in U['units']]; r=random.Random(5); out=[]
for k in range(3000):
    a=[{"id":r.choice(ids),"copies":r.choice([1,1,2,3])} for _ in range(r.randint(1,5))]
    b=[{"id":r.choice(ids),"copies":r.choice([1,1,2,3])} for _ in range(r.randint(1,5))]
    s=r.getrandbits(32); res=resolve(a,b,s,U); out.append({"a":a,"b":b,"s":s,"log":res["log"],"st":res["stats"]})
json.dump(out,open('/tmp/bard-fuzz.json','w'))
PY
node --input-type=module -e "
import fs from 'fs'; import {resolve} from './resolver.mjs';
const U=JSON.parse(fs.readFileSync('../units-s0.json')); const F=JSON.parse(fs.readFileSync('/tmp/bard-fuzz.json'));
const canon=v=>JSON.stringify(v,(k,x)=>(x&&typeof x==='object'&&!Array.isArray(x))?Object.fromEntries(Object.keys(x).sort().map(k2=>[k2,x[k2]])):x);
let bad=0; for(const f of F){const r=resolve(f.a,f.b,f.s,U); if(canon(r.log)!==canon(f.log)||canon(r.stats)!==canon(f.st)) bad++;}
console.log(F.length+' fuzz fights, mismatches: '+bad); process.exit(bad?1:0);"
