#!/bin/sh
# Python-vs-JS parity fuzz v2: N random fights (default 5000) must produce identical logs + stats.
cd "$(dirname "$0")"; N=${1:-5000}
python3 - "$N" <<'PY'
import json,random,sys
from resolver_v2 import resolve
U=json.load(open('../../units-s0-v2.json')); ids=[u['id'] for u in U['units']]; r=random.Random(5); out=[]
for k in range(int(sys.argv[1])):
    a=[{"id":r.choice(ids),"copies":r.choice([1,1,2,3])} for _ in range(r.randint(1,5))]
    b=[{"id":r.choice(ids),"copies":r.choice([1,1,2,3])} for _ in range(r.randint(1,5))]
    s=r.getrandbits(32); res=resolve(a,b,s,U); out.append({"a":a,"b":b,"s":s,"log":res["log"],"st":res["stats"]})
json.dump(out,open('/tmp/bard-fuzz-v2.json','w'))
PY
node --input-type=module -e "
import fs from 'fs'; import {resolve} from './resolver_v2.mjs';
const U=JSON.parse(fs.readFileSync('../../units-s0-v2.json')); const F=JSON.parse(fs.readFileSync('/tmp/bard-fuzz-v2.json'));
const canon=v=>JSON.stringify(v,(k,x)=>(x&&typeof x==='object'&&!Array.isArray(x))?Object.fromEntries(Object.keys(x).sort().map(k2=>[k2,x[k2]])):x);
let bad=0, first=null; for(const f of F){const r=resolve(f.a,f.b,f.s,U); if(canon(r.log)!==canon(f.log)||canon(r.stats)!==canon(f.st)){bad++; if(!first){first=f; let i=0; while(i<r.log.length&&canon(r.log[i])===canon(f.log[i]))i++; console.log('first diff', JSON.stringify(f.a), JSON.stringify(f.b), f.s, 'event', i, canon(r.log[i]), canon(f.log[i]));}}}
console.log(F.length+' fuzz fights, mismatches: '+bad); process.exit(bad?1:0);"
