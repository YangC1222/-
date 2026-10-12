import { createGame, restore, play, resign, undo } from './game.js';

export function applyAction(game, action, color, version) {
  if (!action || action.version !== version || ![1, 2].includes(color)) return false;
  if (action.type === 'move') return game.turn === color && play(game, action.index);
  if (action.type === 'resign') return resign(game, color);
  return false;
}

export function undoCount(game, color) {
  for (let i = game.moves.length - 1; i >= 0; i--) if (game.moves[i].color === color) return game.moves.length - i;
  return 0;
}

export class OnlineRoom {
  constructor(callbacks, PeerClass = globalThis.Peer) {
    this.callbacks = callbacks; this.PeerClass = PeerClass; this.peer = null; this.conn = null;
    this.isHost = false; this.id = ''; this.version = 0; this.connected = false; this.pending = null;
    this.hostGame = null; this.guestToken = null; this.destroyed = false; this.signalTimer = null; this.pendingTimer = null;
  }
  get color() { return this.isHost ? 1 : 2; }
  get ready() { return this.connected && !this.pending; }
  status(state, message) { this.callbacks.onStatus?.({ state, message, connected: this.connected, pending: this.pending }); }
  async start(host, roomId = '') {
    this.isHost = host; this.id = roomId;
    if (!this.PeerClass) throw new Error('联机组件未能加载，请刷新页面');
    if (!globalThis.RTCPeerConnection && this.PeerClass === globalThis.Peer) throw new Error('当前浏览器不支持联机，请使用新版 Chrome、Edge 或 Safari');
    this.hostGame = host ? createGame({ mode: 'online', human: 1 }) : null;
    this.status('connecting', host ? '正在创建联机房间…' : '正在加入好友的房间…');
    this.peer = new this.PeerClass(undefined, { secure: true, debug: 0 });
    this.signalTimer = setTimeout(() => {
      if (!this.connected && !this.destroyed) this.status('error', '连接超时，请重试；网络需要能够访问联机服务');
    }, 20000);
    this.peer.on('open', id => {
      if (this.destroyed) return;
      if (host) { this.id = id; clearTimeout(this.signalTimer); this.status('waiting', '房间已创建，复制链接邀请好友'); this.callbacks.onInvite?.(id); }
      else {
        let token;
        try { token = sessionStorage.getItem(`yijian-player-${roomId}`); if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(`yijian-player-${roomId}`, token); } }
        catch { token = crypto.randomUUID(); }
        this.attach(this.peer.connect(roomId, { reliable: true, serialization: 'json', metadata: { protocol: 'yijian-v1', token } }));
      }
    });
    this.peer.on('connection', conn => {
      const token = conn.metadata?.token;
      const reject = !host || this.connected || conn.metadata?.protocol !== 'yijian-v1' || typeof token !== 'string' || token.length > 64 || (this.guestToken && token !== this.guestToken);
      if (reject) { conn.on('open', () => { conn.send({ type: 'rejected', message: '房间已满，或该对局正在等待原玩家重连' }); setTimeout(() => conn.close(), 300); }); return; }
      // Reserve the seat immediately, including during the WebRTC handshake.
      if (this.conn && this.conn !== conn) this.conn.close();
      this.guestToken = token; this.attach(conn);
    });
    this.peer.on('error', error => {
      if (this.destroyed) return;
      clearTimeout(this.signalTimer);
      const message = error.type === 'peer-unavailable' ? '房间不存在或房主已离开，请联系好友重新邀请' : '联机连接失败，请检查网络后重试';
      this.status('error', message);
    });
    this.peer.on('disconnected', () => {
      if (!this.destroyed && !this.peer.destroyed) this.peer.reconnect();
    });
  }
  attach(conn) {
    this.conn = conn;
    conn.on('open', () => {
      if (this.destroyed || conn !== this.conn) return;
      clearTimeout(this.signalTimer); this.connected = true;
      this.status('connected', this.isHost ? '好友已加入，你执黑先行' : '已加入对局，你执白后行');
      if (this.isHost) this.broadcast();
    });
    conn.on('data', data => {
      if (this.destroyed || conn !== this.conn || !data || typeof data !== 'object') return;
      this.receive(data);
    });
    conn.on('close', () => {
      if (this.destroyed || conn !== this.conn) return;
      if (this.rejected) return;
      this.connected = false; this.clearPending(); this.status('disconnected', this.isHost ? '好友已断线，棋局暂停，等待原玩家重连' : '连接已断开，请重连；房主需保持页面打开');
    });
    conn.on('error', () => { if (!this.destroyed && conn === this.conn) { this.connected = false; this.clearPending(); this.status('error', '连接出现问题，棋局已暂停，请重连'); } });
  }
  send(data) { if (this.conn?.open) { this.conn.send(data); return true; } return false; }
  broadcast() {
    this.callbacks.onState?.(restore(this.hostGame), this.version, this.pending);
    this.send({ type: 'state', game: this.hostGame, version: this.version, pending: this.pending });
  }
  receive(data) {
    if (data.type === 'rejected') { this.rejected = true; this.connected = false; clearTimeout(this.signalTimer); this.status('error', String(data.message).slice(0, 120)); return; }
    if (this.isHost) {
      if (data.type === 'action') this.commit(data.action, 2);
      if (data.type === 'request') this.makeRequest(data.kind, 2, data.version);
      if (data.type === 'reply') this.resolveRequest(data.id, !!data.accepted, 2);
    } else {
      if (data.type === 'state' && Number.isInteger(data.version) && data.version >= this.version) {
        try {
          const game = restore(data.game);
          if (game.settings.mode !== 'online') return;
          this.version = data.version; this.pending = data.pending || null; game.settings.human = 2;
          this.callbacks.onState?.(game, this.version, this.pending);
          this.status('connected', this.pending ? '等待对方处理申请，棋局暂时暂停' : '已连接，你执白后行');
        } catch { this.callbacks.onNotice?.('收到无效棋局，已忽略'); }
      }
      if (data.type === 'ask' && data.request && typeof data.request.id === 'string') {
        this.pending = data.request; this.status('connected', '对方发来申请，等待你的答复');
        this.callbacks.onRequest?.(this.pending);
      }
      if (data.type === 'notice' && typeof data.message === 'string') this.callbacks.onNotice?.(data.message.slice(0, 120));
    }
  }
  action(type, index) {
    if (!this.ready) return false;
    const action = { type, index, version: this.version };
    if (this.isHost) return this.commit(action, 1);
    return this.send({ type: 'action', action });
  }
  commit(action, color) {
    if (!this.ready || !applyAction(this.hostGame, action, color, this.version)) { this.broadcast(); return false; }
    this.version++; this.broadcast(); return true;
  }
  request(kind) {
    if (!this.ready || !['undo', 'restart'].includes(kind)) return false;
    if (this.isHost) return this.makeRequest(kind, 1, this.version);
    // Lock locally before the host acknowledges so no following move races this request.
    const sent = this.send({ type: 'request', kind, version: this.version });
    if (sent) { this.pending = { kind, requester: 2 }; this.status('connected', '已发送申请，等待对方同意'); }
    return sent;
  }
  makeRequest(kind, color, version) {
    if (!this.ready || version !== this.version || !['undo', 'restart'].includes(kind)) { this.broadcast(); return false; }
    const count = kind === 'undo' ? undoCount(this.hostGame, color) : 0;
    if (kind === 'undo' && !count) { this.broadcast(); this.send({ type: 'notice', message: '尚无你的落子可以悔棋' }); return false; }
    this.pending = { id: crypto.randomUUID(), kind, requester: color, count, version: this.version };
    this.broadcast(); this.status('connected', '申请已发送，等待对方同意');
    if (color === 1) this.send({ type: 'ask', request: this.pending }); else this.callbacks.onRequest?.(this.pending);
    this.pendingTimer = setTimeout(() => this.finishRequest(false, '申请超时，棋局恢复'), 30000);
    return true;
  }
  reply(id, accepted) {
    if (this.isHost) this.resolveRequest(id, accepted, 1);
    else this.send({ type: 'reply', id, accepted });
  }
  resolveRequest(id, accepted, color) {
    if (!this.pending || this.pending.id !== id || this.pending.requester === color) return;
    this.finishRequest(accepted, accepted ? '对方已同意申请' : '申请已拒绝，继续对弈');
  }
  finishRequest(accepted, message) {
    const request = this.pending;
    if (!request) return;
    if (accepted && request.version === this.version) {
      if (request.kind === 'restart') this.hostGame = createGame({ mode: 'online', human: 1 });
      else for (let i = 0; i < request.count; i++) undo(this.hostGame);
      this.version++;
    }
    this.clearPending(); this.broadcast(); this.status('connected', '双方已连接，继续对弈');
    this.callbacks.onNotice?.(message); this.send({ type: 'notice', message });
  }
  clearPending() { clearTimeout(this.pendingTimer); this.pendingTimer = null; this.pending = null; }
  destroy() {
    this.destroyed = true; clearTimeout(this.signalTimer); this.clearPending(); this.conn?.close(); this.peer?.destroy(); this.connected = false;
  }
}
