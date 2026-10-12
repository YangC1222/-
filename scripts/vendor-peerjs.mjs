import { mkdir, writeFile } from 'node:fs/promises';
const target = new URL('../vendor/', import.meta.url);
await mkdir(target, { recursive: true });
for (const [file, url] of [
  ['peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js'],
  ['peerjs-LICENSE.txt', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/LICENSE'],
]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dependency download failed: ${response.status}`);
  await writeFile(new URL(file, target), await response.text());
  console.log(`Vendored ${file}`);
}
