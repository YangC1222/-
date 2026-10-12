import { SIZE, CELLS, COLS, createGame, play, undo, resign, restore, coordinate } from './game.js';
import { OnlineRoom, undoCount } from './online.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const STORAGE = 'yijian-gomoku-v1';
const LEVEL_NAMES = { easy: '轻松', normal: '标准', hard: '挑战' };
const ORIGIN = 42, STEP = 32;
let game = createGame(), rates = [50], analysis = null, busy = false;
let worker = null, revision = 0, aiTimer = null, toastTimer = null, marked = null;
let focusIndex = 180, confirmAction = null, storageWarned = false;
let room = null, roomState = 'idle', activeRequest = null, lastOnlineVersion = -1;
const cells = [];

function svg(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== null) node.textContent = text;
  return node;
}
const point = index => [ORIGIN + index % SIZE * STEP, ORIGIN + Math.floor(index / SIZE) * STEP];
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function save() {
  if (game.settings.mode === 'online') return;
  try { localStorage.setItem(STORAGE, JSON.stringify({ game, rates, hints: $('show-hints').checked })); }
  catch { if (!storageWarned) { toast('浏览器无法保存对局，关闭页面前请保存棋谱'); storageWarned = true; } }
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved) {
    game = restore(saved.game);
    if (game.settings.mode === 'online') game.settings.mode = 'local';
    rates = Array.from({ length: game.moves.length + 1 }, (_, i) => i === 0 ? 50 : typeof saved.rates?.[i] === 'number' && saved.rates[i] >= 0 && saved.rates[i] <= 100 ? saved.rates[i] : null);
    if (typeof saved.hints === 'boolean') $('show-hints').checked = saved.hints;
  }
} catch { game = createGame(); rates = [50]; }

function buildBoard() {
  const board = $('board');
  const defs = svg('defs');
  for (const [id, stops] of [['black-stone', [['0%', '#626660'], ['48%', '#2c302d'], ['100%', '#141a15']]], ['white-stone', [['0%', '#fff'], ['60%', '#fdfdf8'], ['100%', '#dfe3d9']]]]) {
    const gradient = svg('radialGradient', { id, cx: '32%', cy: '25%', r: '80%' });
    stops.forEach(([offset, color]) => gradient.append(svg('stop', { offset, 'stop-color': color })));
    defs.append(gradient);
  }
  const filter = svg('filter', { id: 'stone-shadow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
  filter.append(svg('feDropShadow', { dx: 0.8, dy: 1.7, stdDeviation: 1.4, 'flood-color': '#574019', 'flood-opacity': 0.32 }));
  defs.append(filter); board.append(defs);
  const grid = svg('g', { 'aria-hidden': true });
  for (let i = 0; i < SIZE; i++) {
    const p = ORIGIN + i * STEP;
    const cls = `grid-line ${i === 0 || i === SIZE - 1 ? 'grid-edge' : ''}`;
    grid.append(svg('line', { x1: ORIGIN, y1: p, x2: 618, y2: p, class: cls }));
    grid.append(svg('line', { x1: p, y1: ORIGIN, x2: p, y2: 618, class: cls }));
    for (const y of [24, 641]) grid.append(svg('text', { x: p, y, class: 'coordinate-label', 'text-anchor': 'middle' }, COLS[i]));
    for (const x of [21, 640]) grid.append(svg('text', { x, y: p + 3, class: 'coordinate-label', 'text-anchor': 'middle' }, String(SIZE - i)));
  }
  for (const r of [3, 9, 15]) for (const c of [3, 9, 15]) grid.append(svg('circle', { cx: ORIGIN + c * STEP, cy: ORIGIN + r * STEP, r: 3, class: 'star-point' }));
  board.append(grid, svg('g', { id: 'hints-layer', 'aria-hidden': true }), svg('g', { id: 'stones-layer', 'aria-hidden': true }));
  for (let r = 0; r < SIZE; r++) {
    const row = svg('g', { role: 'row', 'aria-rowindex': r + 1 });
    for (let c = 0; c < SIZE; c++) {
      const index = r * SIZE + c, [x, y] = point(index);
      const cell = svg('rect', { x: x - 16, y: y - 16, width: 32, height: 32, class: 'cell-target', role: 'gridcell', 'aria-colindex': c + 1, 'data-index': index, tabindex: index === focusIndex ? 0 : -1 });
      cell.addEventListener('click', () => humanMove(index));
      cell.addEventListener('focus', () => { cells[focusIndex]?.setAttribute('tabindex', -1); focusIndex = index; cell.setAttribute('tabindex', 0); });
      row.append(cell); cells.push(cell);
    }
    board.append(row);
  }
  board.addEventListener('keydown', event => {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const r = Math.floor(index / SIZE), c = index % SIZE;
    const moves = { ArrowLeft: [r, Math.max(0, c - 1)], ArrowRight: [r, Math.min(18, c + 1)], ArrowUp: [Math.max(0, r - 1), c], ArrowDown: [Math.min(18, r + 1), c] };
    if (moves[event.key]) { event.preventDefault(); const [nr, nc] = moves[event.key]; cells[nr * SIZE + nc].focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); humanMove(index); }
  });
}

function renderBoard() {
  const layer = $('stones-layer'); layer.replaceChildren();
  game.moves.forEach((m, i) => {
    const [x, y] = point(m.index);
    layer.append(svg('circle', { cx: x, cy: y, r: 14, fill: `url(#${m.color === 1 ? 'black' : 'white'}-stone)`, class: 'stone-svg' }));
    if (i === game.moves.length - 1) layer.append(svg('circle', { cx: x, cy: y, r: 4, stroke: m.color === 1 ? '#dbcba1' : '#8a986f', class: 'last-ring' }));
    if (marked === m.index) layer.append(svg('circle', { cx: x, cy: y, r: 17, stroke: '#d29c59', 'stroke-width': 2, fill: 'none', 'pointer-events': 'none' }));
  });
  for (const index of game.line) { const [x, y] = point(index); layer.append(svg('circle', { cx: x, cy: y, r: 16, class: 'winning-mark' })); }
  cells.forEach((cell, i) => {
    cell.setAttribute('aria-label', `${coordinate(i)}，${game.board[i] === 1 ? '黑棋' : game.board[i] === 2 ? '白棋' : '空交点'}`);
    cell.setAttribute('aria-disabled', !!game.board[i] || game.status !== 'playing' || (game.settings.mode !== 'local' && game.turn !== game.settings.human) || (game.settings.mode === 'online' && !room?.ready));
  });
  renderHints();
}

function renderHints() {
  const layer = $('hints-layer'); layer.replaceChildren();
  if (!$('show-hints').checked || busy || game.status !== 'playing') return;
  (analysis?.recommendations || []).forEach((m, i) => {
    if (game.board[m.index]) return;
    const [x, y] = point(m.index), group = svg('g', { class: 'hint-marker' });
    group.append(svg('circle', { cx: x, cy: y, r: marked === m.index ? 13 : 10, fill: i === 0 ? '#5e7c55' : '#648157', 'fill-opacity': i === 0 ? 0.85 : 0.38, stroke: marked === m.index ? '#fff7da' : 'none', 'stroke-width': 2 }));
    group.append(svg('text', { x, y: y + 0.5, fill: '#fff9df' }, String(i + 1))); layer.append(group);
  });
}

function renderHistory() {
  const history = $('move-history'); history.replaceChildren(); $('history-count').textContent = `${game.moves.length} 手`;
  if (!game.moves.length) {
    const empty = document.createElement('div'); empty.className = 'history-empty';
    empty.innerHTML = '<span aria-hidden="true">⠿</span><p>每一步，都是新的开始</p><small>落子后，棋谱将在这里记录</small>'; history.append(empty); return;
  }
  for (let i = 0; i < game.moves.length; i += 2) {
    const row = document.createElement('div'); row.className = 'history-row';
    const number = document.createElement('span'); number.textContent = String(i / 2 + 1).padStart(2, '0'); row.append(number);
    for (const m of game.moves.slice(i, i + 2)) {
      const button = document.createElement('button'); button.className = `history-move ${m === game.moves.at(-1) ? 'last' : ''}`;
      const stone = document.createElement('i'); stone.className = `mini-stone ${m.color === 1 ? 'black' : 'white'}`;
      const label = document.createElement('span'); label.textContent = coordinate(m.index); button.append(stone, label);
      button.setAttribute('aria-label', `第 ${game.moves.indexOf(m) + 1} 手，${m.color === 1 ? '黑棋' : '白棋'} ${coordinate(m.index)}`);
      button.onclick = () => { marked = m.index; renderBoard(); toast(`第 ${game.moves.indexOf(m) + 1} 手：${coordinate(m.index)}`); };
      row.append(button);
    }
    history.append(row);
  }
  history.scrollTop = history.scrollHeight;
}

function render() {
  const ai = game.settings.mode === 'ai', online = game.settings.mode === 'online', active = game.status === 'playing';
  document.querySelector('.gentle-note small').textContent = online ? '联机对局请保持双方页面打开' : '对局自动保存在此浏览器';
  const humanTurn = !(ai || online) || game.turn === game.settings.human;
  for (const [color, name] of [[1, 'black'], [2, 'white']]) {
    $(`${name}-name`).textContent = `${ai || online ? color === game.settings.human ? '你' : online ? '好友' : 'AI' : color === 1 ? '玩家一' : '玩家二'} · ${color === 1 ? '黑棋' : '白棋'}`;
    $(`${name}-role`).textContent = online ? color === 1 ? '房主 · 先手' : '好友 · 后手' : ai && color !== game.settings.human ? `${LEVEL_NAMES[game.settings.level]}难度` : color === 1 ? '先手' : '后手';
    $(`${name}-turn`).hidden = !active || game.turn !== color;
    $(`${name}-turn`).textContent = ai && !humanTurn ? '思考中' : '落子中';
  }
  const colorName = game.turn === 1 ? '黑棋' : '白棋';
  let text = ai || online ? humanTurn ? `轮到你了，请执${colorName}落子` : online ? '等待好友落子…' : 'AI 正在思考下一步…' : `轮到${colorName}落子`;
  if (online && !room?.ready) text = room?.pending ? '等待对方处理申请，棋局暂停' : '等待好友连接，棋局暂停';
  if (!game.moves.length && game.turn === 1 && humanTurn && (!online || room?.ready)) text = '轮到你了，黑棋先行';
  if (game.status === 'won') text = `${game.winner === 1 ? '黑棋' : '白棋'}五子连珠，获胜！`;
  if (game.status === 'resigned') text = `对局结束，${game.winner === 1 ? '黑棋' : '白棋'}获胜（对手认输）`;
  if (game.status === 'draw') text = '棋盘已满，本局和棋';
  $('game-status').textContent = text;
  $('move-count').textContent = active ? `第 ${game.moves.length + 1} 手` : `共 ${game.moves.length} 手`;
  $('undo-button').disabled = online ? !room?.ready || !undoCount(game, game.settings.human) : ai ? !game.moves.some(m => m.color === game.settings.human) : !game.moves.length;
  $('resign-button').disabled = !active || (online && !room?.ready);
  $('pass-hint').disabled = !active || !humanTurn || (online && !room?.ready);
  $('export-button').disabled = !game.moves.length;
  renderBoard(); renderHistory();
}

function renderChart() {
  const chart = $('trend-chart'); chart.replaceChildren();
  for (const y of [11, 52, 93]) chart.append(svg('line', { x1: 0, x2: 300, y1: y, y2: y, stroke: '#e7ecdf', 'stroke-width': 0.8, 'stroke-dasharray': y === 52 ? '3 4' : 'none' }));
  const values = rates.map((value, i) => ({ value, i })).filter(x => typeof x.value === 'number');
  const max = Math.max(10, game.moves.length);
  const coords = values.map(({ value, i }) => [i / max * 294 + 3, 101 - value * 0.98]);
  let path = '';
  coords.forEach(([x, y], i) => { path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `; });
  if (coords.length > 1) {
    chart.append(svg('path', { d: `${path}L${coords.at(-1)[0]},105 L${coords[0][0]},105 Z`, fill: '#7f9b6312' }));
    chart.append(svg('path', { d: path, fill: 'none', stroke: '#819a68', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
  }
  if (coords.length) {
    const [x, y] = coords.at(-1); chart.append(svg('circle', { cx: x, cy: y, r: 3, fill: '#5f7f4d', stroke: '#fff', 'stroke-width': 1.5 }));
    if (values.at(-1).i < game.moves.length) chart.append(svg('line', { x1: x, y1: y, x2: 3 + game.moves.length / max * 294, y2: y, stroke: '#a7b896', 'stroke-dasharray': '3 3' }));
  }
  $('chart-last').textContent = game.moves.length ? `第 ${game.moves.length} 手` : '当前';
}

function updateAnalysis(result) {
  analysis = result;
  const black = result.blackWin, white = 100 - black;
  $('black-percent').innerHTML = `${black.toFixed(1)}<span>%</span>`;
  $('white-percent').innerHTML = `${white.toFixed(1)}<span>%</span>`;
  $('black-bar').style.width = `${black}%`;
  $('win-bar').setAttribute('aria-label', `黑棋预计胜率 ${black.toFixed(1)}%，白棋 ${white.toFixed(1)}%`);
  $('advantage-text').textContent = game.status === 'draw' ? '本局和棋' : game.status !== 'playing' ? `${game.winner === 1 ? '黑棋' : '白棋'}获胜` : black > 62 ? '黑棋占优' : black < 38 ? '白棋占优' : '双方势均力敌';
  $('analysis-summary').textContent = result.summary;
  $('search-meta').textContent = result.depth ? `搜索 ${result.depth} 层 · ${result.nodes.toLocaleString()} 节点` : game.status === 'playing' ? '本地 AI 搜索' : '对局已结束';
  const container = $('recommendations'); container.replaceChildren();
  if (game.status !== 'playing' || !result.recommendations?.length) {
    const note = document.createElement('div'); note.className = 'empty-note'; note.textContent = game.status !== 'playing' ? '本局已结束，开启下一场挑战吧' : '暂时没有推荐落点'; container.append(note);
  } else result.recommendations.forEach((m, i) => {
    const button = document.createElement('button'); button.className = 'recommendation';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
    const location = document.createElement('strong'); location.textContent = coordinate(m.index);
    const reason = document.createElement('span'); reason.className = 'reason'; reason.textContent = m.reason;
    button.append(rank, location, reason);
    button.onclick = () => { marked = m.index; $('show-hints').checked = true; renderHints(); cells[m.index].focus({ preventScroll: true }); toast(`推荐 ${coordinate(m.index)}：${m.reason}`); save(); };
    container.append(button);
  });
  rates[game.moves.length] = black;
  renderChart(); renderHints(); save();
}

function cancelAnalysis() {
  revision++; worker?.terminate(); worker = null; clearTimeout(aiTimer); aiTimer = null;
}

function setBusy(value, failed = false) {
  busy = value;
  $('analysis-status').classList.toggle('busy', value);
  $('analysis-status').innerHTML = `<span></span>${value ? '分析中' : failed ? '点击重试' : '实时'}`;
  $('analysis-status').setAttribute('aria-label', value ? '正在分析，显示的百分比为上次结果' : failed ? '分析失败，点击重试' : '实时分析已完成');
  $('analysis-status').style.cursor = failed ? 'pointer' : 'default';
  if (value) {
    const pending = document.createElement('div'); pending.className = 'empty-note'; pending.textContent = 'AI 正在搜索当前局势…';
    $('recommendations').replaceChildren(pending);
    $('analysis-summary').textContent = '正在分析当前局面，百分比暂为上次结果…';
  }
  renderHints();
}

function requestAnalysis() {
  cancelAnalysis(); analysis = null;
  if (game.status !== 'playing') {
    setBusy(false);
    updateAnalysis({ blackWin: game.status === 'draw' ? 50 : game.winner === 1 ? 100 : 0, recommendations: [], summary: game.status === 'draw' ? '本局和棋，双方势均力敌。' : `${game.winner === 1 ? '黑棋' : '白棋'}${game.status === 'resigned' ? '因对手认输' : '连成五子'}获胜。` }); return;
  }
  const id = revision; setBusy(true); renderChart();
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.revision !== revision) return;
      worker?.terminate(); worker = null;
      if (data.error) { failed(data.error); return; }
      setBusy(false); updateAnalysis(data);
      if (game.settings.mode === 'ai' && game.turn !== game.settings.human) {
        aiTimer = setTimeout(() => {
          if (revision !== id || game.status !== 'playing') return;
          if (play(game, data.move)) afterMove(); else failed('AI 无法落子，请点击分析状态重试');
        }, 320);
      }
    };
    worker.onerror = () => { if (id === revision) failed('AI 未能启动，请点击分析状态重试'); };
    worker.postMessage({ board: game.board, turn: game.turn, level: game.settings.level, revision: id });
  } catch { failed('浏览器未能启动 AI，请通过网页服务器打开后重试'); }
}

function failed(message) {
  cancelAnalysis(); setBusy(false, true); $('analysis-summary').textContent = message; toast(message);
}
function afterMove() {
  marked = null; rates.length = game.moves.length + 1; rates[game.moves.length] = null;
  render(); save(); requestAnalysis();
}
function humanMove(index) {
  if (game.status !== 'playing') { toast('对局已结束，可以开始新对局或悔棋'); return; }
  if (game.settings.mode === 'ai' && game.turn !== game.settings.human) { toast('AI 正在思考，请稍候'); return; }
  if (game.settings.mode === 'online') {
    if (!room?.ready) { toast('等待好友连接或处理申请后再落子'); return; }
    if (game.turn !== room.color) { toast('现在轮到好友落子'); return; }
    if (game.board[index]) { toast('这个交点已经有棋子了'); return; }
    room.action('move', index); return;
  }
  if (game.board[index]) { toast('这个交点已经有棋子了'); return; }
  if (play(game, index)) afterMove();
}

$('undo-button').onclick = () => {
  if (game.settings.mode === 'online') { if (room?.request('undo')) toast('已发出悔棋申请，等待好友同意'); return; }
  const count = undo(game); if (!count) return;
  cancelAnalysis(); rates.length = game.moves.length + 1; marked = null; render(); save(); requestAnalysis(); toast(`已退回 ${count} 手`);
};
$('resign-button').onclick = () => {
  if (game.status !== 'playing') return;
  const color = game.settings.mode !== 'local' ? game.settings.human : game.turn;
  $('confirm-title').textContent = '确认认输？'; $('confirm-text').textContent = `${color === 1 ? '黑棋' : '白棋'}认输，本局将结束，${color === 1 ? '白棋' : '黑棋'}获胜。`;
  confirmAction = () => {
    if (game.settings.mode === 'online') { if (!room?.action('resign')) toast('连接已断开，无法认输'); return; }
    cancelAnalysis(); resign(game, color); render(); save(); requestAnalysis();
  };
  $('confirm-dialog').showModal();
};
$('confirm-ok').onclick = () => { const action = confirmAction; confirmAction = null; $('confirm-dialog').close(); action?.(); };
$('confirm-cancel').onclick = () => { confirmAction = null; $('confirm-dialog').close(); };
$('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });
$('pass-hint').onclick = () => {
  if (busy) { toast('AI 正在分析，请稍候'); return; }
  const recommendation = analysis?.recommendations?.[0];
  if (!recommendation) { requestAnalysis(); return; }
  $('show-hints').checked = true; marked = recommendation.index; renderHints(); cells[marked].focus({ preventScroll: true }); toast(`建议落在 ${coordinate(marked)}：${recommendation.reason}`); save();
};
$('show-hints').onchange = () => { renderHints(); save(); };
$('analysis-status').onclick = () => { if (!busy && !analysis) requestAnalysis(); };

function showSettings() {
  const form = $('settings-form');
  form.elements.mode.value = game.settings.mode === 'online' ? 'local' : game.settings.mode; form.elements.human.value = game.settings.human; form.elements.level.value = game.settings.level;
  $('new-game-note').textContent = game.moves.length ? '开始新对局将结束当前棋局，请先保存需要的棋谱。' : '自由五子棋：无禁手，连续五子或以上获胜。';
  syncMode(); $('settings-dialog').showModal();
}
function syncMode() { const ai = $('settings-form').elements.mode.value === 'ai'; $('side-field').hidden = !ai; $('level-field').hidden = !ai; }
$('new-game').onclick = () => { if (room?.connected) { if (room.request('restart')) toast('已邀请好友开始新一局'); else toast('请先处理当前申请'); } else showSettings(); }; $('settings-button').onclick = showSettings;
$('settings-form').addEventListener('change', syncMode);
$('settings-cancel').onclick = () => $('settings-dialog').close();
$('settings-form').onsubmit = event => {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  leaveOnline();
  cancelAnalysis(); game = createGame({ mode: data.get('mode'), human: Number(data.get('human')), level: data.get('level') });
  rates = [50]; marked = null; analysis = null; $('settings-dialog').close(); render(); save();
  updateAnalysis({ blackWin: 50, recommendations: [], summary: '新的对局，新的可能。' }); requestAnalysis(); toast('新对局已开始');
};
$('rules-button').onclick = () => $('rules-dialog').showModal(); $('rules-close').onclick = () => $('rules-dialog').close();

$('export-button').onclick = () => {
  const result = game.status === 'playing' ? '对弈中' : game.status === 'draw' ? '和棋' : `${game.winner === 1 ? '黑棋' : '白棋'}胜${game.status === 'resigned' ? '（认输）' : ''}`;
  const contents = ['弈间 · 五子棋棋谱', '棋盘：19×19；规则：自由五子棋，连续五子及以上获胜', `模式：${game.settings.mode === 'ai' ? `人机对弈（${LEVEL_NAMES[game.settings.level]}）` : game.settings.mode === 'online' ? '远程联机' : '同屏双人'}`, `结果：${result}`, `导出时间：${new Date().toLocaleString('zh-CN')}`, '', '手数\t执子\t坐标\t黑棋预估胜率', ...game.moves.map((m, i) => `${i + 1}\t${m.color === 1 ? '黑' : '白'}\t${coordinate(m.index)}\t${typeof rates[i + 1] === 'number' ? rates[i + 1].toFixed(1) + '%' : '未完成分析'}`), '', '胜率为本地搜索评分的估算映射，未经实战校准。'].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', contents], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `弈间-五子棋-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('棋谱已保存');
};

function leaveOnline() {
  room?.destroy(); room = null; roomState = 'idle'; activeRequest = null; lastOnlineVersion = -1;
  $('online-strip').hidden = true; $('invite-link').value = ''; $('copy-invite').disabled = true; $('leave-room').hidden = true; $('reconnect-room').hidden = true;
  $('create-room').hidden = false; $('room-status').textContent = '准备好，与好友来一局。';
  $('request-dialog').close();
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
}

async function startOnline(host, id = '') {
  leaveOnline(); cancelAnalysis(); game = createGame({ mode: 'online', human: host ? 1 : 2 });
  rates = [50]; marked = null; analysis = null; $('online-strip').hidden = false;
  $('leave-room').hidden = false; $('create-room').hidden = true;
  if (!host) { const url = new URL(location.href); url.searchParams.set('room', id); history.replaceState(null, '', url); }
  room = new OnlineRoom({
    onInvite: roomId => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room', roomId); url.hash = '';
      $('invite-link').value = url.href; $('copy-invite').disabled = false;
    },
    onStatus: status => {
      roomState = status.state;
      $('online-message').textContent = status.message; $('room-status').textContent = status.message;
      $('reconnect-room').hidden = !['error', 'disconnected'].includes(status.state);
      $('online-strip').classList.toggle('connected', status.connected);
      if (!status.pending && activeRequest) { activeRequest = null; $('request-dialog').close(); }
      render();
    },
    onState: (next, version, pending) => {
      const changed = version !== lastOnlineVersion;
      game = next; game.settings.human = room.color;
      if (!pending && activeRequest) { activeRequest = null; $('request-dialog').close(); }
      if (changed) {
        lastOnlineVersion = version;
        if (!game.moves.length) rates = [50];
        else { rates.length = game.moves.length + 1; rates[game.moves.length] = null; }
        marked = null; render(); requestAnalysis();
      } else render();
    },
    onRequest: request => {
      activeRequest = request;
      $('request-title').textContent = request.kind === 'undo' ? '好友申请悔棋' : '好友邀请再来一局';
      $('request-text').textContent = request.kind === 'undo' ? `同意后将退回 ${request.count} 手，回到好友上次落子前。` : '同意后当前棋局将结束，双方重新开局，房主仍执黑。';
      $('room-dialog').close(); $('confirm-dialog').close(); $('settings-dialog').close(); $('request-dialog').showModal();
    },
    onNotice: toast,
  });
  render(); updateAnalysis({ blackWin: 50, recommendations: [], summary: '等待好友，一起开始这场对局。' }); requestAnalysis();
  try { await room.start(host, id); } catch (error) { $('room-status').textContent = error.message; $('online-message').textContent = error.message; $('reconnect-room').hidden = false; toast(error.message); }
}

$('invite-button').onclick = () => $('room-dialog').showModal();
$('room-info').onclick = () => $('room-dialog').showModal();
$('room-close').onclick = () => $('room-dialog').close();
$('create-room').onclick = () => startOnline(true);
$('reconnect-room').onclick = () => {
  if (!room) return;
  if (room.isHost) { startOnline(true); toast('已重新创建房间，请发送新的邀请链接'); }
  else startOnline(false, room.id);
};
$('copy-invite').onclick = async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); toast('邀请链接已复制，发给好友即可加入'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('请手动复制已选中的邀请链接'); }
};
$('join-room').onclick = () => {
  const text = $('join-link').value.trim(); let id = text;
  try { id = new URL(text).searchParams.get('room') || ''; } catch { /* Accept a direct room ID. */ }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) { toast('请粘贴有效的邀请链接或房间号'); return; }
  startOnline(false, id);
};
$('leave-room').onclick = () => {
  leaveOnline(); cancelAnalysis(); game = createGame(); rates = [50]; analysis = null; render(); save(); requestAnalysis(); $('room-dialog').close(); toast('已离开联机房间');
};
function replyRequest(accepted) {
  if (activeRequest) room?.reply(activeRequest.id, accepted);
  activeRequest = null; $('request-dialog').close();
}
$('request-accept').onclick = () => replyRequest(true); $('request-decline').onclick = () => replyRequest(false);
$('request-dialog').addEventListener('cancel', event => { event.preventDefault(); replyRequest(false); });

buildBoard(); render(); renderChart();
window.addEventListener('pagehide', () => { save(); cancelAnalysis(); room?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) requestAnalysis(); });
requestAnalysis();
const invitedRoom = new URL(location.href).searchParams.get('room');
if (invitedRoom) {
  if (/^[A-Za-z0-9_-]{8,80}$/.test(invitedRoom)) { $('room-dialog').showModal(); startOnline(false, invitedRoom); }
  else toast('邀请链接中的房间号无效');
}
