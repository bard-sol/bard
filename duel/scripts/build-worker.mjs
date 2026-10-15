import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const proto = JSON.parse(readFileSync(new URL('engine/v1/cards-proto.json', root), 'utf8'));
const manifest = readFileSync(new URL('engine/v1/manifest.mjs', root), 'utf8');
const rules = manifest.match(/export const RULES_VERSION = '([^']+)'/);
if (!rules || typeof proto.version !== 'string') throw new Error('could not pin cards and rules versions');

mkdirSync(new URL('deploy/', root), { recursive: true });

await esbuild.build({
  entryPoints: [new URL('src/worker/index.ts', root).pathname],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: new URL('deploy/index.js', root).pathname,
  external: ['cloudflare:workers'],
  legalComments: 'none',
  sourcemap: false,
  plugins: [
    {
      name: 'pin-manifest',
      setup(build) {
        build.onLoad({ filter: /\/engine\/v1\/manifest\.mjs$/ }, () => ({
          contents: `export const CARDS_VERSION = ${JSON.stringify(proto.version)};\nexport const RULES_VERSION = ${JSON.stringify(rules[1])};\n`,
          loader: 'js',
        }));
        build.onLoad({ filter: /\/engine\/active\.mjs$/ }, () => {
          const source = readFileSync(new URL('engine/active.mjs', root), 'utf8').replace(/^export const FIXTURES = .*$/m, '');
          return { contents: source, loader: 'js' };
        });
      },
    },
  ],
});

const bundled = readFileSync(new URL('deploy/index.js', root), 'utf8');
if (bundled.includes('node:fs') || bundled.includes('node:crypto') || bundled.includes('readFileSync')) {
  throw new Error('worker bundle pulled in a Node builtin');
}
if (!bundled.includes('var DuelMatch = class') || !bundled.includes('DuelMatch,')) {
  throw new Error('worker bundle dropped the DuelMatch export');
}
if (!bundled.includes('cloudflare:workers')) throw new Error('worker bundle inlined cloudflare:workers');
