#!/bin/bash
# v1.3 final: package B (secondVerse 1), r1 cards, v1.2 starters; search done (sims-v1.3/deck-search-final.json)
set -x
cd /workspace/gameplay/duel/engine-v1.3
node build-cards.mjs && node build-cards-md.mjs
{ node opt-tri.mjs ../sims-v1.3/deck-search-final.json 2000 99; node opt-tri.mjs ../sims-v1.3/deck-search-final.json 2000 6; } > ../sims-v1.3/opt-tri-final.log 2>&1
SLIP=250 node gates.mjs 1000 final > ../sims-v1.3/gates-final.log 2>&1
node analyze.mjs final > ../sims-v1.3/analysis-final.log 2>&1
node make-fixtures.mjs && node parity.mjs > ../sims-v1.3/parity.log 2>&1
echo PARITY_EXIT $?
echo ALLDONE
