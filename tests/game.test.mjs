import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, play, undo, resign, restore, winningLine, coordinate, CELLS } from '../src/game.js';
const at = (r, c) => r * 19 + c;

test('19×19 board, alternating turns and illegal moves', () => {
  const game = createGame(); assert.equal(game.board.length, 361); assert.equal(game.turn, 1);
  for (const bad of [-1, 361, 1.5, NaN, '0']) assert.equal(play(game, bad), false);
  assert.ok(play(game, 180)); assert.equal(game.turn, 2);
  assert.equal(play(game, 180), false); assert.equal(game.moves.length, 1);
  assert.ok(play(game, 181)); assert.equal(game.turn, 1);
  assert.equal(coordinate(0), 'A19'); assert.equal(coordinate(360), 'T1');
});
for (const [name, dr, dc] of [['horizontal', 0, 1], ['vertical', 1, 0], ['diagonal', 1, 1], ['anti diagonal', 1, -1]]) {
  test(`winning line ${name}, including the board edges`, () => {
    const game = createGame({ mode: 'local' }); const c = dc < 0 ? 18 : 0;
    for (let i = 0; i < 5; i++) {
      assert.ok(play(game, at(dr * i, c + dc * i)));
      if (i < 4) assert.ok(play(game, at(18, i * 2)));
    }
    assert.equal(game.status, 'won'); assert.equal(game.winner, 1); assert.equal(game.line.length, 5);
    assert.equal(play(game, 150), false);
    assert.equal(undo(game), 1); assert.equal(game.status, 'playing'); assert.equal(game.turn, 1);
  });
}
test('freestyle overlines win and row wrapping does not', () => {
  const board = Array(CELLS).fill(0);
  for (let c = 4; c < 10; c++) board[at(8, c)] = 2;
  assert.equal(winningLine(board, at(8, 6)).length, 6);
  const wrapped = Array(CELLS).fill(0); [17, 18, 19, 20, 21].forEach(i => wrapped[i] = 1);
  assert.deepEqual(winningLine(wrapped, 19), []);
});
test('AI undo restores human turn, including pending response and white first game', () => {
  const game = createGame(); play(game, 180); assert.equal(undo(game), 1); assert.equal(game.turn, 1);
  play(game, 180); play(game, 181); assert.equal(undo(game), 2); assert.equal(game.moves.length, 0);
  const white = createGame({ human: 2 }); play(white, 180); assert.equal(undo(white), 0);
  play(white, 181); play(white, 182); assert.equal(undo(white), 2); assert.equal(white.moves.length, 1); assert.equal(white.turn, 2);
});
test('resignation, restart and validated persistence', () => {
  const game = createGame(); play(game, 180); resign(game, 1);
  assert.equal(game.winner, 2); assert.equal(game.status, 'resigned'); assert.equal(resign(game, 2), false);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(game))), game);
  const bad = JSON.parse(JSON.stringify(game)); bad.moves.push({ index: 180, color: 2 }); assert.throws(() => restore(bad));
  assert.throws(() => restore({ moves: [{ index: 0, color: 2 }], settings: game.settings }));
  assert.throws(() => restore({ moves: [], settings: { ...game.settings, mode: 'bogus' } }));
});
test('full legal board without a line is a draw', () => {
  const game = createGame({ mode: 'local' }), black = [], white = [];
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) ((r + 2 * c) % 4 < 2 ? black : white).push(at(r, c));
  for (let i = 0; i < black.length; i++) { assert.ok(play(game, black[i])); if (i < white.length) assert.ok(play(game, white[i])); }
  assert.equal(game.status, 'draw'); assert.equal(game.moves.length, 361); assert.equal(game.winner, 0);
});
