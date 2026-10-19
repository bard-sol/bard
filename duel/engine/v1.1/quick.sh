#!/bin/bash
# usage: RULES='{}' ./quick.sh tag N
FILTER='^ss:' node gates.mjs ${2:-500} $1 >/dev/null 2>&1; node -e "
const g=JSON.parse(require('fs').readFileSync('../sims-v1.1/gates-$1-games.json'));const all=g.flatMap(x=>x.games);
const r=k=>(all.filter(x=>x.reason===k).length/all.length).toFixed(3);
const by={};for(const x of g)by[x.name]=x.games;const pr=(a,b)=>{const x=by['ss:'+a+'-'+b],y=by['ss:'+b+'-'+a];return ((x.filter(q=>q.w===0).length+y.filter(q=>q.w===1).length)/(x.length+y.length)).toFixed(3)};
console.log('first',(all.filter(x=>x.w===x.first).length/all.length).toFixed(3),'8V',r('verses'),'bh',r('board_health'),'| C>F',pr('candle','fold'),'F>T',pr('fold','tidewrack'),'T>C',pr('tidewrack','candle'),'| mirrors',['candle','fold','tidewrack'].map(h=>(by['ss:'+h+'-'+h].filter(q=>q.w===0).length/by['ss:'+h+'-'+h].length).toFixed(3)).join(' '))"
