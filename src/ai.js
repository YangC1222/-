import { SIZE, CELLS, DIRECTIONS, inside, opposite, winningLine } from './game.js';

const WIN = 100_000_000;
const TIMEOUT = Symbol('search timeout');
const LEVELS = { easy: { depth: 2, width: 7, ms: 250 }, normal: { depth: 3, width: 9, ms: 750 }, hard: { depth: 4, width: 11, ms: 1600 } };

// Evaluate a hypothetical stone through contiguous and broken threats in all four axes.
export function pointScore(board, index, color) {
  if (board[index]) return -Infinity;
  const row = Math.floor(index / SIZE), col = index % SIZE;
  let score = 0, threes = 0, fours = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const line = [];
    for (let k = -5; k <= 5; k++) {
      const r = row + k * dr, c = col + k * dc;
      line.push(k === 0 ? 'X' : !inside(r, c) ? '#' : board[r * SIZE + c] === color ? 'X' : board[r * SIZE + c] === 0 ? '.' : '#');
    }
    const winningEmpties = new Set();
    for (let start = 1; start <= 5; start++) {
      const window = line.slice(start, start + 5);
      const stones = window.filter(x => x === 'X').length;
      if (stones === 5) return WIN;
      if (stones === 4 && !window.includes('#')) winningEmpties.add(start + window.indexOf('.'));
    }
    if (winningEmpties.size >= 2) { score += 800_000; fours++; continue; }
    if (winningEmpties.size === 1) { score += 90_000; fours++; continue; }
    const text = line.join('');
    let openThree = false;
    for (const pattern of ['.XXX.', '.XX.X.', '.X.XX.']) {
      let start = text.indexOf(pattern);
      while (start >= 0) {
        if (start < 5 && start + pattern.length > 5) openThree = true;
        start = text.indexOf(pattern, start + 1);
      }
    }
    if (openThree) { score += 12_000; threes++; }
    else {
      for (let start = 1; start <= 5; start++) {
        const window = line.slice(start, start + 5);
        if (!window.includes('#')) score += [0, 8, 65, 420, 0, 0][window.filter(x => x === 'X').length];
      }
    }
  }
  if (threes >= 2) score += 45_000;
  if (fours && threes) score += 250_000;
  return score;
}

export function candidates(board, color) {
  const cells = new Set();
  for (let i = 0; i < CELLS; i++) {
    if (!board[i]) continue;
    const r = Math.floor(i / SIZE), c = i % SIZE;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (inside(r + dr, c + dc)) {
        const j = (r + dr) * SIZE + c + dc;
        if (!board[j]) cells.add(j);
      }
    }
  }
  if (!cells.size && board.every(x => x === 0)) cells.add(180);
  return [...cells].map(index => {
    const attack = pointScore(board, index, color), defense = pointScore(board, index, opposite(color));
    const center = 18 - Math.abs(index % SIZE - 9) - Math.abs(Math.floor(index / SIZE) - 9);
    return { index, attack, defense, score: Math.max(attack, defense * 0.98) + Math.min(attack, defense) * 0.14 + center };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

function filtered(moves, width) {
  const wins = moves.filter(m => m.attack >= WIN);
  if (wins.length) return wins;
  const blocks = moves.filter(m => m.defense >= WIN);
  return blocks.length ? blocks : moves.slice(0, width);
}

function staticScore(moves) {
  const own = moves.map(m => m.attack).sort((a, b) => b - a);
  const other = moves.map(m => m.defense).sort((a, b) => b - a);
  return (own[0] || 0) * 1.08 + (own[1] || 0) * 0.25 + (own[2] || 0) * 0.1
    - (other[0] || 0) - (other[1] || 0) * 0.25 - (other[2] || 0) * 0.1;
}

export function analyze(input, turn, level = 'normal') {
  const board = Array.from(input);
  const settings = LEVELS[level] || LEVELS.normal;
  const start = performance.now(), deadline = start + settings.ms;
  let nodes = 0;
  const root = candidates(board, turn);
  if (!root.length) return { move: null, blackWin: 50, recommendations: [], nodes: 0, depth: 0, duration: 0, summary: '棋盘已满' };
  const options = filtered(root, settings.width);
  let best = options[0].index, value = staticScore(root), depth = 0;

  function search(color, remaining, alpha, beta, last) {
    nodes++;
    if (performance.now() >= deadline) throw TIMEOUT;
    if (last !== null && winningLine(board, last).length) return -WIN - remaining * 100;
    const moves = candidates(board, color);
    if (!moves.length) return 0;
    if (moves.some(m => m.attack >= WIN)) return WIN + remaining * 100;
    if (moves.filter(m => m.defense >= WIN).length > 1) return -WIN + 100;
    if (remaining === 0) return staticScore(moves);
    let top = -Infinity;
    for (const m of filtered(moves, Math.max(5, settings.width - 2))) {
      board[m.index] = color;
      let score;
      try { score = -search(opposite(color), remaining - 1, -beta, -alpha, m.index); }
      finally { board[m.index] = 0; }
      top = Math.max(top, score); alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return top;
  }

  const immediate = root.find(m => m.attack >= WIN);
  const opponentWins = root.filter(m => m.defense >= WIN);
  if (immediate) { best = immediate.index; value = WIN; depth = 1; }
  else if (opponentWins.length > 1) { best = opponentWins[0].index; value = -WIN; depth = 1; }
  else {
    for (let d = 1; d <= settings.depth; d++) {
      let localBest = best, localValue = -Infinity, alpha = -Infinity;
      const sorted = options.slice().sort((a, b) => (b.index === best ? 1 : 0) - (a.index === best ? 1 : 0));
      let complete = true;
      try {
        for (const m of sorted) {
          board[m.index] = turn;
          let v;
          try { v = -search(opposite(turn), d - 1, -Infinity, -alpha, m.index); }
          finally { board[m.index] = 0; }
          if (v > localValue) { localValue = v; localBest = m.index; }
          alpha = Math.max(alpha, v);
        }
      } catch (error) { if (error !== TIMEOUT) throw error; complete = false; }
      if (complete) { best = localBest; value = localValue; depth = d; }
      else break;
      if (Math.abs(value) >= WIN - 1000) break;
    }
  }
  const blackScore = turn === 1 ? value : -value;
  // This is an uncalibrated evaluation-to-probability mapping, not tournament statistics.
  const blackWin = input.every(x => x === 0) ? 50 : Math.max(1, Math.min(99, 100 / (1 + Math.exp(-blackScore / 95_000))));
  const recommendations = [root.find(m => m.index === best), ...root.filter(m => m.index !== best)].slice(0, 3)
    .filter(Boolean).map(m => ({ index: m.index, reason: m.attack >= WIN ? '五子制胜' : m.defense >= WIN ? '阻止对手连五' : m.attack >= 800_000 ? '制造活四' : m.defense >= 800_000 ? '防守活四' : m.attack >= 90_000 ? '冲四进攻' : m.attack >= 12_000 ? '创造连子威胁' : '攻守兼顾' }));
  const summary = immediate ? '当前有一步连五的制胜机会' : opponentWins.length ? '对手形成连五威胁，优先防守' : blackWin > 62 ? '黑棋占优，保持进攻节奏' : blackWin < 38 ? '白棋占优，留意防守连接' : '局势接近，关注连子与关键交点';
  return { move: best, blackWin, recommendations, nodes, depth, duration: Math.round(performance.now() - start), summary };
}
