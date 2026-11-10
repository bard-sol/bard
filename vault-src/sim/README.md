# Launch simulations

`npm run sim` plays project teams, Bard and 5 to 50 holders through scripted scenarios on the
real code path: `platform.js` (the browser client, run in a sandbox per wallet), the worker
(`server/api.js`), every migration in `supabase/migrations` with its RLS and triggers, the real
Squads v4 program, and Chromium on the pages where the page is the journey.

```
npm run sim                          # all scenarios, fresh seed, s1 on devnet, the rest local
npm run sim -- --seed m1             # replay a run exactly
npm run sim -- --only s7,s9 --chain local --no-ui
npm run sim -- --repeat 3            # three runs, three seeds
npm run sim -- --list
```

Each step prints PASS, FAIL or KNOWN, and each scenario prints PASS or FAIL. The report goes
to `sim-reports/sim-<seed>-<time>.json` and includes a fingerprint: the same seed gives the same
fingerprint. The exit code is 1 on any failure or network violation.

A step marked KNOWN checks a bug that is filed but not fixed. It turns into a FAIL when the bug
stops reproducing, so remove its `known` marker in the same change as the fix.

## What it runs on

- **Database:** PGlite with every migration, served by `lib/postgrest.mjs`. The shim takes the
  role from the JWT, as PostgREST does: the service key is `service_role`, the anon key is
  `anon`, and a wallet session is `authenticated`. Each request runs in its own transaction
  with `SET LOCAL ROLE`.
- **Chain:** `--chain local` is LiteSVM with the real Squads program, behind a JSON-RPC shim.
  `--chain devnet` is Solana devnet with the throwaway keys in `~/.bard-devnet-rehearsal`
  (`BARD_REHEARSAL_KEY_DIR` overrides). `mixed`, the default, runs s1 on devnet and the rest
  locally. Devnet runs reclaim holder token accounts at the end.
- **Time:** campaigns and joins are backdated with SQL. Nothing waits on the clock.
- **Browser:** Playwright Chromium. Set `BARD_SIM_CHROMIUM` to a binary, or
  `PLAYWRIGHT_BROWSERS_PATH`. Use `--no-ui` to skip the browser.

## Guards

- Every fetch in the process, and every request from Chromium, goes through `classifyHost`.
  Only loopback and `https://api.devnet.solana.com` are allowed. Supabase, mainnet and any
  other host are refused and recorded as a violation, and a violation fails the run.
- The worker gets a sim Supabase URL and keys. The production project URL in `platform.js`
  is routed to the local shim.
- The run refuses to start if the Bard signer is the fee treasury or the cut wallet.
- No secrets: the JWT secret and service key are random for each run.

`tests/unit/sim_guard.test.js` pins the guards, the seeded randomness and the shim's filter
binding.
