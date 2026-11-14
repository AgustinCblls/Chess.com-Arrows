// Prepara los dos archivos que pide addons.mozilla.org (AMO):
//   dist/chesscom-arrows-firefox-<v>.zip  → el complemento (manifest.json en la raíz)
//   dist/chesscom-arrows-source-<v>.zip   → el código fuente y cómo compilarlo (AMO lo exige porque
//                                            content.js sale de un empaquetador)
// La versión para tiendas no descarga nada de fuera: usa el Stockfish de chess.com o el incluido en engine/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { bundle, root, version } from './build.mjs';

const ROOT = fileURLToPath(root);
const p = (...a) => join(ROOT, ...a);

// ID permanente del complemento en Firefox: no cambiarlo nunca (Firefox lo usa para las actualizaciones)
const GECKO_ID = '{d7fabdd1-56fc-418b-8e7e-59fcb3ea5fe5}';
const ENGINE_FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

// Los archivos de Stockfish deben ser los publicados en npm (stockfish@19.0.1), sin tocar
const EXPECTED_SRI = {
  'stockfish-19-lite-single.js': 'sha384-pClHpoYzU9B1wX2kT00j+V2XlzmcDQIcmB3Nd52uMUM9kTU7s6Uu3t5MxVO7sQcv',
  'stockfish-19-lite-single.wasm': 'sha384-DvvftEPxgCzGbRwiixCoW4FasRWXnos4yh1FKhm4JUE3SPhNfpMEE1lVCBV0wlVf'
};
for (const f of ENGINE_FILES) {
  const sri = 'sha384-' + createHash('sha384').update(readFileSync(p('vendor', 'stockfish', f))).digest('base64');
  if (sri !== EXPECTED_SRI[f]) throw new Error(f + ' no coincide con stockfish@19.0.1 (' + sri + ')');
}

const base = JSON.parse(readFileSync(p('chrome-extension', 'manifest.json'), 'utf8'));
const matches = ['https://www.chess.com/*'];
const manifest = {
  manifest_version: 3,
  name: base.name,
  version,
  description: base.description,
  default_locale: base.default_locale,
  icons: base.icons,
  content_scripts: [
    // Contexto aislado de la extensión: dice a content.js dónde está engine/
    { matches, js: ['bridge.js'], run_at: 'document_start' },
    { matches, js: ['content.js'], run_at: 'document_idle', world: 'MAIN' }
  ],
  web_accessible_resources: [
    { resources: ENGINE_FILES.map(f => 'engine/' + f), matches }
  ],
  browser_specific_settings: {
    // data_collection_permissions (obligatorio en AMO) existe desde Firefox 140 y Firefox para Android 142
    gecko: {
      id: GECKO_ID,
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] }
    },
    gecko_android: {
      strict_min_version: '142.0'
    }
  }
};

const notices = `Chess.com - Analysis Arrows ${version}

This add-on includes Stockfish 19 lite (engine/stockfish-19-lite-single.js and
engine/stockfish-19-lite-single.wasm), unmodified, from the npm package stockfish@19.0.1
(https://www.npmjs.com/package/stockfish, https://github.com/nmrugg/stockfish.js).
Stockfish is free software under the GNU General Public License version 3; see
engine/Copying.txt. Its source code is available at https://github.com/official-stockfish/Stockfish
and https://github.com/nmrugg/stockfish.js.
`;

const enc = s => new TextEncoder().encode(s);
const file = (...a) => new Uint8Array(readFileSync(p(...a)));

// ── Complemento ──
const addon = {
  'manifest.json': enc(JSON.stringify(manifest, null, 2) + '\n'),
  'content.js': enc('// Generated from src/ by scripts/package-firefox.mjs (store build: no remote code).\n' + await bundle({ store: true })),
  'bridge.js': file('src', 'bridge.js'),
  'THIRD_PARTY_NOTICES.txt': enc(notices),
  'engine/Copying.txt': file('vendor', 'stockfish', 'Copying.txt')
};
ENGINE_FILES.forEach(f => { addon['engine/' + f] = file('vendor', 'stockfish', f); });
for (const dir of ['_locales', 'icons']) {
  (function walk(d) {
    for (const n of readdirSync(p('chrome-extension', d))) {
      const rel = d + '/' + n;
      if (statSync(p('chrome-extension', rel)).isDirectory()) walk(rel); else addon[rel] = file('chrome-extension', rel);
    }
  })(dir);
}

// ── Código fuente ──
const SOURCE_DIRS = ['src', 'scripts', 'test', 'vendor', 'chrome-extension/_locales', 'chrome-extension/icons'];
const SOURCE_FILES = ['package.json', 'package-lock.json', 'vitest.config.js', 'README.md', '.gitignore', 'chrome-extension/manifest.json'];
const source = {};
for (const d of SOURCE_DIRS) {
  (function walk(abs) {
    for (const n of readdirSync(abs)) {
      const a = join(abs, n);
      if (statSync(a).isDirectory()) walk(a); else source[relative(ROOT, a).split(sep).join('/')] = new Uint8Array(readFileSync(a));
    }
  })(p(...d.split('/')));
}
SOURCE_FILES.filter(f => existsSync(p(f))).forEach(f => { source[f] = file(...f.split('/')); });
source['BUILD.md'] = enc(`# Building the Firefox add-on from source

Requirements: Node.js 20 or newer and npm (tested with Node ${process.versions.node}). Any OS.

\`\`\`
npm ci
npm test
npm run package:firefox
\`\`\`

The add-on is written to \`dist/chesscom-arrows-firefox-${version}.zip\`. Its \`content.js\` is built from
\`src/\` with esbuild (\`scripts/build.mjs\`, store build: not minified, no remote code).
\`bridge.js\` is \`src/bridge.js\` as is. \`engine/\` holds Stockfish 19 lite exactly as published in
the npm package stockfish@19.0.1 (\`bin/stockfish-19-lite-single.js\` and \`.wasm\`), copied to
\`vendor/stockfish/\`; the packaging script checks their SHA-384 hashes.
`);

mkdirSync(p('dist'), { recursive: true });
const addonZip = p('dist', `chesscom-arrows-firefox-${version}.zip`);
const sourceZip = p('dist', `chesscom-arrows-source-${version}.zip`);
rmSync(addonZip, { force: true }); rmSync(sourceZip, { force: true });
writeFileSync(addonZip, zipSync(addon, { level: 9 }));
writeFileSync(sourceZip, zipSync(source, { level: 9 }));

// Copia sin comprimir, para cargarla en about:debugging o pasarle el linter
const unpacked = p('dist', 'firefox');
rmSync(unpacked, { recursive: true, force: true });
for (const [rel, data] of Object.entries(addon)) {
  const out = join(unpacked, ...rel.split('/'));
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, data);
}

const kb = f => Math.round(statSync(f).size / 1024) + ' KB';
console.log('add-on: ' + relative(ROOT, addonZip) + ' (' + kb(addonZip) + ', ' + Object.keys(addon).length + ' files)');
console.log('source: ' + relative(ROOT, sourceZip) + ' (' + kb(sourceZip) + ', ' + Object.keys(source).length + ' files)');
