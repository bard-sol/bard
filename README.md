# Bard

UX fix pass in progress — admin.html, admin_app.js, dashboard.html.

Season 0 trial balance, including the round 6 ally rule, is locked in `season0/trial-content.md`. The play app is `/play/`.

Sealed Annotations are devnet-only. Public commits live in `season0/data/annotation-seals.js`. Generate salts locally with `node season0/scripts/seal-annotations.mjs`. Salts and annotation text stay in `season0/.secrets/` and are not committed. Fire rates are a read-only sim: `node season0/scripts/annotation-sim.mjs`.
