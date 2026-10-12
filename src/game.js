export const SIZE = 19;
export const CELLS = SIZE * SIZE;
export const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const COLS = 'ABCDEFGHJKLMNOPQRST';
export const opposite = color => 3 - color;
export const coordinate = index => `${COLS[index % SIZE]}${SIZE - Math.floor(index / SIZE)}`;
export const inside = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;

export function winningLine(board, index) {
  const color = board[index];
  if (!color) return [];
  const row = Math.floor(index / SIZE), col = index % SIZE;
  for (const [dr, dc] of DIRECTIONS) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (inside(r, c) && board[r * SIZE + c] === color) {
        sign === -1 ? line.unshift(r * SIZE + c) : line.push(r * SIZE + c);
        r += dr * sign; c += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function createGame(settings = {}) {
  return { board: Array(CELLS).fill(0), moves: [], turn: 1, status: 'playing', winner: 0, line: [], settings: { mode: 'ai', human: 1, level: 'normal', ...settings } };
}

export function play(game, index) {
  if (game.status !== 'playing' || !Number.isInteger(index) || index < 0 || index >= CELLS || game.board[index]) return false;
  const color = game.turn;
  game.board[index] = color;
  game.moves.push({ index, color });
  game.line = winningLine(game.board, index);
  if (game.line.length) { game.status = 'won'; game.winner = color; }
  else if (game.moves.length === CELLS) game.status = 'draw';
  game.turn = opposite(color);
  return true;
}

export function undo(game) {
  if (!game.moves.length) return 0;
  // In AI games return to the human's last decision, even while the AI is thinking.
  let count = 1;
  if (game.settings.mode === 'ai') {
    let lastHuman = -1;
    for (let i = game.moves.length - 1; i >= 0; i--) {
      if (game.moves[i].color === game.settings.human) { lastHuman = i; break; }
    }
    if (lastHuman === -1) return 0;
    count = game.moves.length - lastHuman;
  }
  for (let i = 0; i < count; i++) {
    const move = game.moves.pop(); game.board[move.index] = 0; game.turn = move.color;
  }
  game.status = 'playing'; game.winner = 0; game.line = [];
  return count;
}

export function resign(game, color = game.turn) {
  if (game.status !== 'playing' || ![1, 2].includes(color)) return false;
  game.status = 'resigned'; game.winner = opposite(color); game.line = []; return true;
}

export function restore(saved) {
  if (!saved || !Array.isArray(saved.moves) || saved.moves.length > CELLS) throw new Error('Invalid game');
  const s = saved.settings;
  if (!s || !['ai', 'local', 'online'].includes(s.mode) || ![1, 2].includes(s.human) || !['easy', 'normal', 'hard'].includes(s.level)) throw new Error('Invalid settings');
  const game = createGame(s);
  for (const m of saved.moves) if (m.color !== game.turn || !play(game, m.index)) throw new Error('Invalid move');
  if (saved.status === 'resigned') {
    if (![1, 2].includes(saved.winner) || !resign(game, opposite(saved.winner))) throw new Error('Invalid resignation');
  }
  return game;
}
