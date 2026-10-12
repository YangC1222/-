import { SIZE, CELLS, COLS, createGame, play, undo, resign, restore, coordinate } from './game.js';
import { OnlineRoom, undoCount } from './online.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const STORAGE = 'yijian-gomoku-v1';
const LEVEL_NAMES = { easy: '轻松', normal: '标准', hard: '挑战' };
const PUBLIC_URL = 'https://yangc1222.github.io/-/';
let preferences = { numbers: false, coordinates: true, touchConfirm: true };
try {
  const savedPreferences = JSON.parse(localStorage.getItem('yijian-board-preferences'));
  for (const key of Object.keys(preferences)) if (typeof savedPreferences?.[key] === 'boolean') preferences[key] = savedPreferences[key];
} catch { /* Storage can be unavailable for a local file. */ }
let pendingMove = null;
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
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const labels = document.createElement('div'); labels.className = `board-coordinates coordinates-${side}`; labels.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < SIZE; i++) {
      const label = document.createElement('span'); label.textContent = side === 'top' || side === 'bottom' ? COLS[i] : SIZE - i; labels.append(label);
    }
    board.append(labels);
  }
  const grid = document.createElement('div'); grid.className = 'board-grid'; grid.setAttribute('role', 'presentation');
  for (let r = 0; r < SIZE; r++) {
    const row = document.createElement('div'); row.className = 'board-row'; row.setAttribute('role', 'row'); row.setAttribute('aria-rowindex', r + 1);
    for (let c = 0; c < SIZE; c++) {
      const index = r * SIZE + c;
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cell-target'; cell.dataset.index = index;
      cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-colindex', c + 1); cell.tabIndex = index === focusIndex ? 0 : -1;
      if (c === 0) cell.classList.add('edge-left'); if (c === 18) cell.classList.add('edge-right');
      if (r === 0) cell.classList.add('edge-top'); if (r === 18) cell.classList.add('edge-bottom');
      if ([3, 9, 15].includes(r) && [3, 9, 15].includes(c)) {
        const star = document.createElement('span'); star.className = 'star-point'; star.setAttribute('aria-hidden', 'true'); cell.append(star);
      }
      for (const name of ['ghost-stone', 'stone-piece', 'hint-marker']) {
        const span = document.createElement('span'); span.className = name; span.setAttribute('aria-hidden', 'true'); cell.append(span);
      }
      let pointerType = 'mouse';
      cell.addEventListener('pointerdown', event => { pointerType = event.pointerType; });
      cell.addEventListener('click', event => {
        if (event.detail > 0 && pointerType === 'touch' && preferences.touchConfirm && canHumanPlay() && !game.board[index]) {
          pendingMove = index; $('selected-point').textContent = coordinate(index); $('placement-confirm').hidden = false; renderBoard();
        } else humanMove(index);
      });
      cell.addEventListener('pointerenter', () => { $('point-readout').textContent = `${coordinate(index)}${game.board[index] ? ' · 已落子' : ' · 空交点'}`; });
      cell.addEventListener('focus', () => { cells[focusIndex]?.setAttribute('tabindex', -1); focusIndex = index; cell.tabIndex = 0; $('point-readout').textContent = coordinate(index); });
      row.append(cell); cells.push(cell);
    }
    grid.append(row);
  }
  board.append(grid);
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
  if (pendingMove !== null && (!canHumanPlay() || game.board[pendingMove])) clearPlacement();
  const board = $('board'), moves = new Map(game.moves.map((m, i) => [m.index, i + 1]));
  board.dataset.turn = game.turn; board.dataset.canPlay = canHumanPlay();
  board.classList.toggle('show-numbers', preferences.numbers); board.classList.toggle('hide-coordinates', !preferences.coordinates);
  cells.forEach((cell, i) => {
    const color = game.board[i], piece = cell.querySelector('.stone-piece');
    piece.classList.toggle('black', color === 1); piece.classList.toggle('white', color === 2);
    piece.hidden = !color; piece.textContent = moves.get(i) || '';
    cell.classList.toggle('occupied', !!color); cell.classList.toggle('last-move', game.moves.at(-1)?.index === i);
    cell.classList.toggle('winning-mark', game.line.includes(i)); cell.classList.toggle('marked', marked === i);
    cell.classList.toggle('pending-placement', pendingMove === i);
    cell.setAttribute('aria-label', `${coordinate(i)}，${color === 1 ? '黑棋' : color === 2 ? '白棋' : '空交点'}${color ? `，第 ${moves.get(i)} 手` : ''}`);
    cell.setAttribute('aria-disabled', !!color || !canHumanPlay());
  });
  renderHints();
}

function renderHints() {
  cells.forEach(cell => { cell.querySelector('.hint-marker').hidden = true; cell.classList.remove('recommended', 'best-recommendation'); });
  if (!$('show-hints').checked || busy || game.status !== 'playing') return;
  (analysis?.recommendations || []).forEach((m, i) => {
    if (game.board[m.index]) return;
    const cell = cells[m.index], marker = cell.querySelector('.hint-marker'); marker.hidden = false; marker.textContent = i + 1;
    cell.classList.add('recommended'); cell.classList.toggle('best-recommendation', i === 0);
  });
}

function canHumanPlay() {
  return game.status === 'playing' && (game.settings.mode === 'local' || game.turn === game.settings.human)
    && (game.settings.mode !== 'online' || !!room?.ready);
}
function clearPlacement() {
  if (pendingMove !== null) cells[pendingMove]?.classList.remove('pending-placement');
  pendingMove = null; $('placement-confirm').hidden = true;
}
function savePreferences() {
  try { localStorage.setItem('yijian-board-preferences', JSON.stringify(preferences)); } catch { /* The settings still apply in this session. */ }
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
    $(`${name}-turn`).hidden = !active || game.turn !== color || (online && !room?.ready);
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
    button.onclick = () => { marked = m.index; $('show-hints').checked = true; renderBoard(); cells[m.index].focus({ preventScroll: true }); toast(`推荐 ${coordinate(m.index)}：${m.reason}`); save(); };
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
    worker = new Worker(globalThis.__GOMOKU_WORKER_URL__ || new URL('./ai-worker.js', import.meta.url), { type: globalThis.__GOMOKU_WORKER_URL__ ? 'classic' : 'module' });
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
  clearPlacement();
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
    clearPlacement(); room.action('move', index); return;
  }
  if (game.board[index]) { toast('这个交点已经有棋子了'); return; }
  clearPlacement(); if (play(game, index)) afterMove();
}

$('undo-button').onclick = () => {
  clearPlacement();
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
  $('show-hints').checked = true; marked = recommendation.index; renderBoard(); cells[marked].focus({ preventScroll: true }); toast(`建议落在 ${coordinate(marked)}：${recommendation.reason}`); save();
};
$('show-hints').onchange = () => { renderHints(); save(); };
$('analysis-status').onclick = () => { if (!busy && !analysis) requestAnalysis(); };

$('confirm-placement').onclick = () => { if (pendingMove !== null) humanMove(pendingMove); };
$('cancel-placement').onclick = () => { clearPlacement(); renderBoard(); };
for (const [id, key] of [['toggle-numbers', 'numbers'], ['toggle-coordinates', 'coordinates'], ['toggle-touch', 'touchConfirm']]) {
  $(id).setAttribute('aria-pressed', preferences[key]);
  $(id).onclick = () => {
    preferences[key] = !preferences[key]; $(id).setAttribute('aria-pressed', preferences[key]);
    if (key === 'touchConfirm') { clearPlacement(); toast(preferences[key] ? '触屏先选点，再确认落子' : '触屏点击交点即可落子'); }
    renderBoard(); savePreferences();
  };
}
$('zoom-board').onclick = () => {
  const zoomed = $('board-viewport').classList.toggle('zoomed'); $('zoom-board').setAttribute('aria-pressed', zoomed);
  $('zoom-board').textContent = zoomed ? '还原' : '放大';
  if (zoomed) {
    const viewport = $('board-viewport');
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2; viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
    toast('棋盘已放大，可拖动或滚动查看各处');
  }
};
function toggleFocus(force) {
  const focused = typeof force === 'boolean' ? (document.body.classList.toggle('focus-mode', force), force) : document.body.classList.toggle('focus-mode');
  $('focus-board').setAttribute('aria-pressed', focused); $('focus-board').textContent = focused ? '退出专注' : '专注';
}
$('focus-board').onclick = () => toggleFocus();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { clearPlacement(); if (document.body.classList.contains('focus-mode')) toggleFocus(false); }
});
if (location.protocol === 'file:') $('download-html').href = location.href;

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
  clearPlacement();
  room?.destroy(); room = null; roomState = 'idle'; activeRequest = null; lastOnlineVersion = -1;
  $('online-strip').hidden = true; $('invite-link').value = ''; $('copy-invite').disabled = true; $('leave-room').hidden = true; $('reconnect-room').hidden = true;
  $('create-room').hidden = false; $('room-status').textContent = '准备好，与好友来一局。';
  $('request-dialog').close();
  setRoomParameter(null);
}

function setRoomParameter(id) {
  if (location.protocol === 'file:') return;
  const url = new URL(location.href);
  if (id) url.searchParams.set('room', id); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

async function startOnline(host, id = '') {
  leaveOnline(); cancelAnalysis(); game = createGame({ mode: 'online', human: host ? 1 : 2 });
  rates = [50]; marked = null; analysis = null; $('online-strip').hidden = false;
  $('leave-room').hidden = false; $('create-room').hidden = true;
  if (!host) setRoomParameter(id);
  room = new OnlineRoom({
    onInvite: roomId => {
      const url = new URL(location.protocol === 'file:' ? PUBLIC_URL : location.href); url.search = ''; url.searchParams.set('room', roomId); url.hash = '';
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
        clearPlacement();
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
