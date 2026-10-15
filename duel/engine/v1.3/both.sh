#!/bin/bash
node build-cards.mjs >/dev/null && RULES='{}' ./quick.sh $1 1000 && node opt-tri.mjs ${OPT:-../sims-v1.1/deck-search-final.json} 1000 99
