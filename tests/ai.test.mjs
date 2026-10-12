import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, pointScore } from '../src/ai.js';
import { winningLine } from '../src/game.js';
const at = (r, c) => r * 19 + c;

test('AI opening chooses center and gives honest neutral initial estimate', () => {
  const board = Array(361).fill(0), result = analyze(board, 1, 'easy');
  assert.equal(result.move, 180); assert.equal(result.blackWin, 50); assert.equal(result.recommendations[0].index, 180);
  assert.deepEqual(board, Array(361).fill(0));
});
for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
  test(`AI takes immediate win along ${dr},${dc}`, () => {
    const board = Array(361).fill(0);
    for (let i = 0; i < 4; i++) board[at(7 + i * dr, 9 + i * dc)] = 2;
    const result = analyze(board, 2, 'easy'); board[result.move] = 2;
    assert.ok(winningLine(board, result.move).length >= 5); assert.equal(result.blackWin, 1);
  });
}
test('AI blocks a closed four and finds a broken-four gap', () => {
  const board = Array(361).fill(0); board[at(9, 3)] = 2;
  for (let c = 4; c < 8; c++) board[at(9, c)] = 1;
  const original = board.slice(); const result = analyze(board, 2, 'easy');
  assert.equal(result.move, at(9, 8)); assert.deepEqual(board, original);
  const broken = Array(361).fill(0); [4, 5, 7, 8].forEach(c => broken[at(9, c)] = 1);
  assert.equal(analyze(broken, 2, 'easy').move, at(9, 6));
});
test('AI prefers its win over defense and never suggests occupied cells', () => {
  const board = Array(361).fill(0);
  for (let c = 4; c < 8; c++) { board[at(4, c)] = 1; board[at(12, c)] = 2; }
  const result = analyze(board, 1, 'normal'); assert.ok(result.recommendations.every(m => !board[m.index]));
  board[result.move] = 1; assert.ok(winningLine(board, result.move).length >= 5);
});
test('search returns a legal result within bounded time without modifying input', () => {
  const board = Array(361).fill(0); [180, 181, 160, 199, 161, 179, 200, 162].forEach((i, k) => board[i] = k % 2 + 1);
  const snapshot = board.slice(); const start = performance.now(), result = analyze(board, 1, 'normal');
  assert.ok(performance.now() - start < 3000); assert.equal(board[result.move], 0);
  assert.ok(result.blackWin >= 1 && result.blackWin <= 99); assert.ok(result.nodes > 0); assert.deepEqual(board, snapshot);
  assert.equal(pointScore(board, 180, 1), -Infinity);
});
