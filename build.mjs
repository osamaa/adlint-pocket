// Build the unpacked extension into dist/.
// Optional: local.config.json (git-ignored) with { "firebase": {...}, "appCheckDebugToken": "...", "cloudModel": "..." }
// pre-fills Settings in your own build. Never commit it.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const local = !process.env.ADLINT_PUBLIC && existsSync('local.config.json') ? JSON.parse(readFileSync('local.config.json', 'utf8')) : {};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/sidepanel.js', 'src/background.js'],
  bundle: true,
  format: 'esm',
  target: 'chrome139',
  outdir: 'dist',
  minify: false,
  sourcemap: true,
  loader: { '.json': 'json' },
  define: { __LOCAL_CONFIG__: JSON.stringify(local) },
  logLevel: 'info',
});

for (const f of ['manifest.json', 'sidepanel.html', 'sidepanel.css', 'icons', 'samples']) {
  cpSync(`src/${f}`, `dist/${f}`, { recursive: true });
}
console.log(`dist/ ready${local.firebase ? ' (with local Firebase config)' : ''}. Load it at chrome://extensions > Load unpacked.`);
