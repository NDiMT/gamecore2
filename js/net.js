// Networking via PeerJS — uses peerjs.com's free signaling server so peers
// only need to exchange a short 6-digit code, not an SDP blob. After the
// handshake everything flows P2P over an RTCDataChannel exactly like before.
(function () {
  'use strict';

  function makeCode() {
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  // Namespace IDs so two different deployments of the game can share the
  // public signaling server without colliding on a code.
  const ID_PREFIX = 'dqcoop-';

  class Net {
    constructor(game) {
      this.game = game;
      this.mode = null;          // 'solo' | 'host' | 'client'
      this.peer = null;          // PeerJS instance
      this.peers = [];           // host: list of { conn, playerId }; client: single entry
      this.onMessage = null;
      this.onStatus = null;
      this.onConnect = null;
      this.onDisconnect = null;
      this.myId = 'p0';
      this.clientName = null;
      this.hostCode = null;
    }

    _status(s) { if (this.onStatus) this.onStatus(s); }

    setMode(mode) {
      this.mode = mode;
      this.game.isHost = (mode !== 'client');
      if (mode === 'solo' || mode === 'host') { this.myId = 'p0'; this.game.myId = 'p0'; }
    }

    // --------- HOST -------------------------------------------------------
    hostOpenRoom() {
      if (this.mode !== 'host') this.setMode('host');
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const tryOnce = () => {
          attempts++;
          const code = makeCode();
          const fullId = ID_PREFIX + code;
          const peer = new Peer(fullId, { debug: 0 });
          let resolved = false;
          peer.on('open', (id) => {
            if (resolved) return;
            resolved = true;
            this.peer = peer;
            this.hostCode = code;
            peer.on('connection', (conn) => this._hostOnConn(conn));
            peer.on('disconnected', () => {
              // PeerJS server lost contact; try to reconnect.
              try { peer.reconnect(); } catch (e) {}
            });
            resolve(code);
          });
          peer.on('error', (err) => {
            if (err && err.type === 'unavailable-id' && attempts < 6) {
              try { peer.destroy(); } catch (e) {}
              tryOnce();
              return;
            }
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          });
        };
        tryOnce();
      });
    }

    _hostOnConn(conn) {
      const slot = { conn, playerId: null };
      conn.on('open', () => {
        if (this.peers.length >= 3) {
          try { conn.send({ t: 'reject', reason: 'Room full' }); } catch (e) {}
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 200);
          return;
        }
        // Assign next free player ID.
        const used = new Set(this.peers.map(p => p.playerId));
        let pid = null;
        for (let i = 1; i < 8; i++) if (!used.has('p' + i)) { pid = 'p' + i; break; }
        slot.playerId = pid;
        this.peers.push(slot);
        try { conn.send({ t: 'welcome', myId: pid, hostId: 'p0' }); } catch (e) {}
        const newId = this.game.hostAddRemote(null) || pid;
        if (newId !== pid) {
          slot.playerId = newId;
          try { conn.send({ t: 'welcome', myId: newId, hostId: 'p0' }); } catch (e) {}
        }
        try { conn.send({ t: 'state', s: this.game.state }); } catch (e) {}
        if (this.onConnect) this.onConnect(slot.playerId);
        this._status('connected');
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'action') {
          this.game.applyAction(msg.a, slot.playerId);
        } else if (msg.t === 'hello' && msg.name) {
          this.game.applyAction({ type: 'setName', name: msg.name }, slot.playerId);
        }
        if (this.onMessage) this.onMessage(msg, slot.playerId);
      });
      conn.on('close', () => this._hostOnDcClose(slot));
      conn.on('error', () => this._hostOnDcClose(slot));
    }
    _hostOnDcClose(slot) {
      if (!slot || !slot.playerId) return;
      const had = this.peers.includes(slot);
      this.peers = this.peers.filter(p => p !== slot);
      if (had) {
        this.game.hostRemoveRemote(slot.playerId);
        if (this.onDisconnect) this.onDisconnect(slot.playerId);
      }
    }

    // --------- CLIENT -----------------------------------------------------
    clientJoinRoom(code, name) {
      this.setMode('client');
      this.clientName = name || null;
      const cleaned = String(code || '').replace(/[^0-9]/g, '').slice(0, 6);
      if (cleaned.length !== 6) return Promise.reject(new Error('Code must be 6 digits.'));
      const fullId = ID_PREFIX + cleaned;
      return new Promise((resolve, reject) => {
        const peer = new Peer({ debug: 0 });
        let resolved = false;
        const failTimer = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          try { peer.destroy(); } catch (e) {}
          reject(new Error('Connection timeout. Check the code.'));
        }, 15000);
        peer.on('open', () => {
          const conn = peer.connect(fullId, { reliable: true });
          conn.on('open', () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(failTimer);
            this.peer = peer;
            this.peers = [{ conn, playerId: null }];
            this._status('connected');
            if (this.clientName) {
              try { conn.send({ t: 'hello', name: this.clientName }); } catch (e) {}
            }
            resolve();
          });
          conn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.t === 'welcome') {
              this.myId = msg.myId;
              this.game.myId = msg.myId;
            } else if (msg.t === 'state') {
              this.game.setState(msg.s);
            } else if (msg.t === 'reject') {
              this._status('rejected');
              try { conn.close(); } catch (e) {}
              if (this.onStatus) this.onStatus('rejected');
            }
            if (this.onMessage) this.onMessage(msg);
          });
          conn.on('close', () => this._clientOnDcClose());
          conn.on('error', (err) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(failTimer);
            reject(err);
          });
        });
        peer.on('error', (err) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(failTimer);
          let msg = err.message || String(err);
          if (err.type === 'peer-unavailable') msg = 'No room with that code. Check it and try again.';
          else if (err.type === 'network') msg = 'Network error — try again.';
          reject(new Error(msg));
        });
      });
    }
    _clientOnDcClose() {
      this._status('disconnected');
      this.peers = [];
    }

    // --------- send helpers -----------------------------------------------
    _sendTo(slot, msg) {
      if (!slot || !slot.conn) return;
      try { slot.conn.send(msg); } catch (e) {}
    }
    broadcast(msg) {
      if (this.mode === 'solo') return;
      if (this.mode === 'host') {
        for (const p of this.peers) this._sendTo(p, msg);
      } else if (this.mode === 'client') {
        if (this.peers[0]) this._sendTo(this.peers[0], msg);
      }
    }
    sendAction(action, asPlayerId) {
      const id = asPlayerId || this.game.myId;
      if (this.mode === 'solo' || this.mode === 'host') {
        this.game.applyAction(action, id);
      } else {
        this.broadcast({ t: 'action', a: action });
      }
    }

    closeAll() {
      for (const p of this.peers) {
        try { if (p.conn) p.conn.close(); } catch (e) {}
      }
      this.peers = [];
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.hostCode = null;
    }
  }

  window.Net = Net;
})();
