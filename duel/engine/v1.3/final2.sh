#!/bin/bash
# v1.3 final: search already done (deck-search-final.json) and starters re-picked from it.
set -x
cd /workspace/gameplay/duel/engine-v1.3
node build-cards.mjs && node build-cards-md.mjs
node opt-tri.mjs ../sims-v1.3/deck-search-final.json 2000 99 > ../sims-v1.3/opt-tri-final-cards.log 2>&1
node opt-tri.mjs ../sims-v1.3/deck-search-final.json 2000 6 >> ../sims-v1.3/opt-tri-final-cards.log 2>&1
[ -f ../sims-v1.3/gates-final.json ] || SLIP=300 node gates.mjs 1000 final > ../sims-v1.3/gates-final.log 2>&1
node analyze.mjs final > ../sims-v1.3/analysis-final.log 2>&1
node make-fixtures.mjs && node parity.mjs > ../sims-v1.3/parity.log 2>&1
echo PARITY_EXIT $?
[ -f ../sims-v1.3/gates-sv1.json ] || RULES='{"secondVerse":1}' SLIP=300 node gates.mjs 1000 sv1 > ../sims-v1.3/gates-sv1.log 2>&1
node analyze.mjs sv1 > ../sims-v1.3/analysis-sv1.log 2>&1
echo ALLDONE
