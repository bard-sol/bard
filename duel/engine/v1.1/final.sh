#!/bin/bash
set -x
cd /workspace/gameplay/duel/engine-v1.1
node build-cards.mjs
[ -f ../sims-v1.1/deck-search-final.json ] || OUT=../sims-v1.1/deck-search-final.json node search.mjs 24 20 30 > ../sims-v1.1/search-final.log 2>&1
SRC=../sims-v1.1/deck-search-final.json node search-check.mjs > ../sims-v1.1/search-final-check.log 2>&1
{ node opt-tri.mjs ../sims-v1.1/deck-search-final.json 2000 99; node opt-tri.mjs ../sims-v1.1/deck-search-final.json 2000 6; } > ../sims-v1.1/opt-tri-final.log 2>&1
[ -f ../sims-v1.1/gates-final.json ] || SLIP=300 node gates.mjs 1000 final > ../sims-v1.1/gates-final.log 2>&1
node analyze.mjs final > ../sims-v1.1/analysis-final.log 2>&1
node make-fixtures.mjs && node parity.mjs > ../sims-v1.1/parity.log 2>&1
echo ALLDONE
