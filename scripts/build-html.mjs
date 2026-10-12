import { readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [template, css, boardCss, gameSource, onlineSource, aiSource, appSource, workerSource, peerSource, favicon, peerLicense] = await Promise.all([
  'index.html', 'styles.css', 'board.css', 'src/game.js', 'src/online.js', 'src/ai.js', 'src/app.js', 'src/ai-worker.js', 'vendor/peerjs.min.js', 'favicon.svg', 'vendor/peerjs-LICENSE.txt',
].map(read));
const flatten = source => source.replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+/gm, '');
const worker = [flatten(gameSource), flatten(aiSource), flatten(workerSource)].join('\n');
const app = appSource.replace("new URL('./ai-worker.js', import.meta.url)", 'null');
const bundle = `(() => {\n'use strict';\nglobalThis.__GOMOKU_WORKER_URL__ = URL.createObjectURL(new Blob([${JSON.stringify(worker).replace(/</g, '\\u003c')}], { type: 'text/javascript' }));\n${flatten(gameSource)}\n${flatten(onlineSource)}\n${flatten(app)}\n})();`;
new Script(worker, { filename: 'embedded-worker.js' });
new Script(bundle, { filename: 'embedded-app.js' });
const inlineSafe = source => source.replace(/<\/script/gi, '<\\/script');
const icon = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`;
const html = template
  .replace(/[ \t]*<link rel="stylesheet" href="\.\/(styles|board)\.css(?:\?[^\"]*)?">/g, '')
  .replace('  <link rel="icon"', `  <style>\n${css}\n${boardCss}\n</style>\n  <link rel="icon"`)
  .replaceAll('./favicon.svg', icon)
  .replace('  <script src="./vendor/peerjs.min.js"></script>', `  <!-- PeerJS 1.5.5\n${peerLicense}\n-->\n  <script>\n${inlineSafe(peerSource.replace(/\/\/# sourceMappingURL=.*$/gm, ''))}\n</script>`)
  .replace(/<script type="module" src="\.\/src\/app\.js(?:\?[^\"]*)?"><\/script>/, `<script>\n${inlineSafe(bundle)}\n</script>`);
if (/\bimport\.meta\b/.test(html) || /<script[^>]+src=/.test(html) || /<link rel="stylesheet"/.test(html)) throw new Error('Standalone HTML still references external code');
await writeFile(new URL('弈间-五子棋.html', root), html);
console.log(`Built standalone interactive HTML (${Buffer.byteLength(html).toLocaleString()} bytes)`);
