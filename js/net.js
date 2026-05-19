// WebRTC peer-to-peer networking using manual offer/answer signaling.
// No server required: host generates an "offer" string, joiner pastes it and
// returns an "answer" string. After exchange both peers are connected via
// RTCDataChannel.
//
// MVP: 1 host + up to 2 remote players (so up to 3 heroes total). Each remote
// joiner needs its own offer/answer round, because manual signaling is
// strictly point-to-point.
(function () {
  'use strict';
  const { waitIceComplete, encodeSignal, decodeSignal } = window.U;

  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  class Net {
    constructor(game) {
      this.game = game;
      this.mode = null;          // 'solo' | 'host' | 'client'
      this.peers = [];           // host: list of { pc, dc, playerId }; client: single entry
      this.onMessage = null;     // (msg, fromId) => void
      this.onStatus = null;      // (status) => void
      this.onConnect = null;     // host: (playerId) => void
      this.onDisconnect = null;  // (playerId) => void
      this.pendingSlot = null;   // host: { pc, dc, idx } while awaiting answer
      this.myId = 'p0';          // assigned by host; default = solo/host
    }

    _status(s) { if (this.onStatus) this.onStatus(s); }

    setMode(mode) {
      this.mode = mode;
      this.game.isHost = (mode !== 'client');
      if (mode === 'solo' || mode === 'host') { this.myId = 'p0'; this.game.myId = 'p0'; }
    }

    // --------- HOST: prepare a new outgoing slot --------------------------
    async hostCreateOffer() {
      if (this.mode !== 'host') this.setMode('host');
      // Close any abandoned pending slot so only one offer is in-flight.
      if (this.pendingSlot) {
        try { this.pendingSlot.pc.close(); } catch (e) {}
        this.pendingSlot = null;
      }
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const dc = pc.createDataChannel('game', { ordered: true });
      this.pendingSlot = { pc, dc, idx: this.peers.length };

      dc.onopen = () => this._hostOnDcOpen(this.pendingSlot);
      dc.onmessage = (e) => this._hostOnMessage(e, this.pendingSlot);
      dc.onclose = () => this._hostOnDcClose(this.pendingSlot);
      pc.oniceconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState)) {
          this._hostOnDcClose(this.pendingSlot);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      return encodeSignal(pc.localDescription);
    }

    async hostAcceptAnswer(answerStr) {
      if (!this.pendingSlot) throw new Error('no pending slot');
      const desc = decodeSignal(answerStr);
      if (!desc) throw new Error('Μη έγκυρος κωδικός απάντησης.');
      await this.pendingSlot.pc.setRemoteDescription(desc);
      // The slot is "active" once dc.onopen fires.
    }

    _hostOnDcOpen(slot) {
      // Assign a player id; first free p1, p2, …
      const used = new Set(this.peers.filter(p => p).map(p => p.playerId));
      let pid = null;
      for (let i = 1; i < 8; i++) if (!used.has('p' + i)) { pid = 'p' + i; break; }
      slot.playerId = pid;
      this.peers.push(slot);
      this.pendingSlot = null;
      // Greet client with its id, then send current state.
      this._sendTo(slot, { t: 'welcome', myId: pid, hostId: 'p0' });
      const newId = this.game.hostAddRemote(null) || pid;
      // hostAddRemote returns the id it assigned; make sure they match.
      if (newId !== pid) {
        slot.playerId = newId;
        this._sendTo(slot, { t: 'welcome', myId: newId, hostId: 'p0' });
      }
      this._sendTo(slot, { t: 'state', s: this.game.state });
      if (this.onConnect) this.onConnect(slot.playerId);
      this._status('connected');
    }
    _hostOnMessage(e, slot) {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'action') {
        this.game.applyAction(msg.a, slot.playerId);
      } else if (msg.t === 'hello' && msg.name) {
        // Optional rename from client.
        this.game.applyAction({ type: 'setName', name: msg.name }, slot.playerId);
      }
      if (this.onMessage) this.onMessage(msg, slot.playerId);
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

    // --------- CLIENT: accept host offer and produce answer ---------------
    async clientAcceptOffer(offerStr, name) {
      this.setMode('client');
      this.clientName = name || null;
      const desc = decodeSignal(offerStr);
      if (!desc) throw new Error('Μη έγκυρος κωδικός πρόσκλησης.');
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const slot = { pc, dc: null };
      this.peers = [slot];

      pc.ondatachannel = (e) => {
        slot.dc = e.channel;
        slot.dc.onopen = () => this._clientOnDcOpen(slot);
        slot.dc.onmessage = (ev) => this._clientOnMessage(ev, slot);
        slot.dc.onclose = () => this._clientOnDcClose(slot);
      };
      pc.oniceconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.iceConnectionState)) this._clientOnDcClose(slot);
      };

      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      return encodeSignal(pc.localDescription);
    }
    _clientOnDcOpen(slot) {
      this._status('connected');
      if (this.clientName) this._sendTo(slot, { t: 'hello', name: this.clientName });
    }
    _clientOnMessage(e, slot) {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'welcome') {
        this.myId = msg.myId;
        this.game.myId = msg.myId;
      } else if (msg.t === 'state') {
        this.game.setState(msg.s);
      } else if (msg.t === 'event') {
        // hook for ephemeral events (animations etc.)
      }
      if (this.onMessage) this.onMessage(msg);
    }
    _clientOnDcClose(/*slot*/) {
      this._status('disconnected');
      this.peers = [];
    }

    // --------- send helpers -----------------------------------------------
    _sendTo(slot, msg) {
      if (!slot || !slot.dc) return;
      if (slot.dc.readyState !== 'open') return;
      try { slot.dc.send(JSON.stringify(msg)); } catch (e) {}
    }
    broadcast(msg) {
      if (this.mode === 'solo') return;
      if (this.mode === 'host') {
        for (const p of this.peers) this._sendTo(p, msg);
      } else if (this.mode === 'client') {
        if (this.peers[0]) this._sendTo(this.peers[0], msg);
      }
    }
    // Clients use this to send an action; host uses applyAction directly.
    // `asPlayerId` lets a solo host issue actions on behalf of any local hero.
    // The remote host ignores claimed ids and uses the channel's slot.playerId.
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
        try { if (p.dc) p.dc.close(); } catch (e) {}
        try { if (p.pc) p.pc.close(); } catch (e) {}
      }
      this.peers = [];
      if (this.pendingSlot) {
        try { this.pendingSlot.pc.close(); } catch (e) {}
        this.pendingSlot = null;
      }
    }
  }

  window.Net = Net;
})();
