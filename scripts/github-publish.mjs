// Uses the existing Windows Git credential manager; never prints or saves credentials.
import { spawnSync } from 'node:child_process';
const auth = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
});
const fields = Object.fromEntries((auth.stdout || '').trim().split('\n').map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
}));
if (!fields.password) throw new Error('No existing GitHub credential found');
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method, headers: { Authorization: `Bearer ${fields.password}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yijian-gomoku-publish', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}
const base = '/repos/YangC1222/-';
if (process.argv[2] === 'inspect') {
  const repo = await api(base), pages = await api(base + '/pages');
  console.log(JSON.stringify({ repository: repo.status, branch: repo.data.default_branch, permissions: repo.data.permissions, private: repo.data.private, pages: pages.status, pagesUrl: pages.data.html_url, pagesStatus: pages.data.status }));
} else if (process.argv[2] === 'pages') {
  let pages = await api(base + '/pages');
  if (pages.status === 404) pages = await api(base + '/pages', 'POST', { build_type: 'legacy', source: { branch: 'main', path: '/' } });
  console.log(JSON.stringify({ status: pages.status, url: pages.data.html_url, buildStatus: pages.data.status, message: pages.data.message }));
  if (pages.status >= 400) process.exitCode = 1;
} else if (process.argv[2] === 'status') {
  const pages = await api(base + '/pages'), builds = await api(base + '/pages/builds/latest');
  console.log(JSON.stringify({ pages: pages.status, url: pages.data.html_url, status: pages.data.status, build: builds.status, buildStatus: builds.data.status, commit: builds.data.commit, error: builds.data.error?.message }));
} else throw new Error('Use inspect, pages, or status');
