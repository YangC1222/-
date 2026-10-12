import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, undoCount, OnlineRoom } from '../src/online.js';
import { createGame, play } from '../src/game.js';

test('authority rejects out-of-turn, stale, duplicate and invalid remote actions', () => {
  const game = createGame({ mode: 'online' });
  assert.equal(applyAction(game, { type: 'move', index: 180, version: 0 }, 2, 0), false);
  assert.equal(applyAction(game, { type: 'move', index: 180, version: 1 }, 1, 0), false);
  assert.ok(applyAction(game, { type: 'move', index: 180, version: 0 }, 1, 0));
  assert.equal(applyAction(game, { type: 'move', index: 180, version: 1 }, 2, 1), false);
  assert.equal(applyAction(game, { type: 'move', index: 361, version: 1 }, 2, 1), false);
  assert.ok(applyAction(game, { type: 'move', index: 181, version: 1 }, 2, 1));
  assert.equal(applyAction(game, { type: 'replace-state', version: 2 }, 2, 2), false);
  assert.ok(applyAction(game, { type: 'resign', version: 2 }, 2, 2)); assert.equal(game.winner, 1);
});
test('network undo restores requester decision only after opponent approval', () => {
  const states = [], requests = [];
  const room = new OnlineRoom({ onState: (g, version) => states.push({ g, version }), onRequest: r => requests.push(r) });
  room.isHost = true; room.connected = true; room.hostGame = createGame({ mode: 'online' }); room.conn = { open: true, send() {}, close() {} };
  room.commit({ type: 'move', index: 180, version: 0 }, 1);
  room.commit({ type: 'move', index: 181, version: 1 }, 2);
  room.commit({ type: 'move', index: 182, version: 2 }, 1);
  assert.equal(undoCount(room.hostGame, 2), 2);
  assert.ok(room.makeRequest('undo', 2, 3)); assert.equal(room.hostGame.moves.length, 3); assert.equal(room.ready, false);
  const request = requests[0]; room.resolveRequest(request.id, true, 2); assert.equal(room.hostGame.moves.length, 3);
  room.resolveRequest('wrong-request', true, 1); assert.equal(room.hostGame.moves.length, 3);
  room.resolveRequest(request.id, true, 1); assert.equal(room.hostGame.moves.length, 1); assert.equal(room.hostGame.turn, 2); assert.equal(room.version, 4); assert.equal(room.pending, null);
  room.destroy();
});
test('rejected requests preserve board; mutually approved restart clears board', () => {
  const room = new OnlineRoom({}); room.isHost = true; room.connected = true; room.hostGame = createGame({ mode: 'online' }); room.conn = { open: true, send() {}, close() {} };
  play(room.hostGame, 180); room.version = 1;
  room.makeRequest('undo', 1, 1); room.resolveRequest(room.pending.id, false, 2); assert.equal(room.hostGame.moves.length, 1);
  room.makeRequest('restart', 1, 1); room.resolveRequest(room.pending.id, true, 2); assert.equal(room.hostGame.moves.length, 0); assert.equal(room.version, 2);
  room.destroy();
});
