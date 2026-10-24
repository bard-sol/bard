import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  absWorkingDir: dir,
  entryPoints: ['src/browser.js'],
  bundle: true,
  format: 'iife',
  globalName: 'BardVault',
  outfile: path.resolve(dir, '../bard-vault.js'),
  platform: 'browser',
  target: ['es2022'],
  legalComments: 'none',
  minify: true,
  inject: [path.join(dir, 'src/buffer-shim.js')],
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
});
