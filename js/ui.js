// DOM-based UI for menus, lobby, HUD and action bars. World/combat scenes are
// drawn by Renderer onto an inserted canvas — UI sets up the host container
// and hooks tap callbacks. Re-renders on every state change.
(function () {
  'use strict';
  const { el, toast, copyToClipboard } = window.U;
  const { CLASSES, CLASS_LIST, ITEMS } = window.DATA;

  class UI {
    constructor(game, net) {
      this.game = game;
      this.net = net;
      this.root = document.getElementById('app');
      this.renderer = new window.Renderer(game);
      this.combatTargeting = null;       // 'attack' | null
      this.soloHeroCount = 2;
      this.offerStr = '';
      this.answerStr = '';
      this.heroNameDraft = this._suggestName();
      this._setupRenderer();
    }
    _suggestName() {
      const names = ['Alex', 'Elena', 'Kai', 'Cassandra', 'Niko', 'Artemis', 'Leon', 'Sophia'];
      return names[Math.floor(Math.random() * names.length)];
    }
    _setupRenderer() {
      this.renderer.onTileTap = (x, y, tile) => {
        const s = this.game.state;
        if (s.phase !== 'overworld') return;
        const active = s.players[s.activeIdx];
        if (!active || !this._canControl(active)) return;
        const dx = Math.abs(x - s.party.x);
        const dy = Math.abs(y - s.party.y);
        if (dx + dy !== 1) return;
        if (tile.terrain === 'water') { toast('Impassable water.'); return; }
        this.net.sendAction({ type: 'move', x, y }, active.id);
      };
      this.renderer.onEnemyTap = (enemyIdx) => {
        if (this.combatTargeting !== 'attack') return;
        const s = this.game.state;
        const c = s.combat;
        if (!c) return;
        const enemy = c.enemies[enemyIdx];
        if (!enemy || !enemy.alive) return;
        const active = s.players[c.turn.idx];
        if (!active || !this._canControl(active)) return;
        this.combatTargeting = null;
        this.renderer.setCombatTargetMode(false);
        this.net.sendAction({ type: 'attack', enemyIdx }, active.id);
      };
    }

    render() {
      this.root.innerHTML = '';
      const s = this.game.state;
      switch (s.phase) {
        case 'menu':         this._renderMenu(); break;
        case 'join-setup':   this._renderJoinSetup(); break;
        case 'lobby':        this._renderLobby(); break;
        case 'class-select': this._renderClassSelect(); break;
        case 'overworld':    this._renderOverworld(); break;
        case 'combat':       this._renderCombat(); break;
        case 'event':        this._renderOverworld(); this._renderEventModal(); break;
        case 'victory':      this._renderEnd(true); break;
        case 'gameover':     this._renderEnd(false); break;
        default:             this._renderMenu();
      }
    }

    _canControl(p) {
      if (!p) return false;
      if (this.net.mode === 'solo') return true;
      if (this.net.mode === 'host') return p.id === this.game.myId || p.isLocal;
      return p.id === this.game.myId;
    }

    // ---------------- MENU ------------------------------------------------
    _renderMenu() {
      this.renderer.stop();
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Dragon Quest Co-op' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Roguelike dungeon crawler · 1-3 players coop' }));

      const namePanel = el('div', { class: 'panel' });
      namePanel.appendChild(el('h3', { text: 'Your Name' }));
      const nameInput = el('input', { attrs: { type: 'text', maxlength: 16, value: this.heroNameDraft }, oninput: (e) => { this.heroNameDraft = e.target.value; } });
      nameInput.style.width = '100%';
      namePanel.appendChild(nameInput);
      screen.appendChild(namePanel);

      const heroPanel = el('div', { class: 'panel' });
      heroPanel.appendChild(el('h3', { text: 'Solo Play' }));
      heroPanel.appendChild(el('p', { text: 'How many heroes will you control?' }));
      const row = el('div', { class: 'btn-row' });
      for (const n of [1, 2, 3]) {
        const b = el('button', {
          class: 'btn ghost' + (this.soloHeroCount === n ? ' gold' : ''),
          text: n + (n === 1 ? ' Hero' : ' Heroes'),
          onclick: () => { this.soloHeroCount = n; this.render(); }
        });
        row.appendChild(b);
      }
      heroPanel.appendChild(row);
      heroPanel.appendChild(el('div', { style: { height: '8px' } }));
      heroPanel.appendChild(el('button', {
        class: 'btn gold', text: '▶ Start Solo',
        onclick: () => this._startSolo()
      }));
      screen.appendChild(heroPanel);

      const coopPanel = el('div', { class: 'panel' });
      coopPanel.appendChild(el('h3', { text: 'Co-op (WebRTC)' }));
      coopPanel.appendChild(el('p', { text: 'Play with friends with no server: the host shares an invite code via chat/SMS.' }));
      const coopRow = el('div', { class: 'menu-buttons' });
      coopRow.appendChild(el('button', { class: 'btn', text: '🏰 Host a Room', onclick: () => this._startHost() }));
      coopRow.appendChild(el('button', { class: 'btn', text: '🚪 Join a Room', onclick: () => this._startJoin() }));
      coopPanel.appendChild(coopRow);
      screen.appendChild(coopPanel);

      const help = el('div', { class: 'panel' });
      help.appendChild(el('h3', { text: 'How to Play' }));
      help.appendChild(el('p', { text: '• Tap an adjacent tile to move the party (turn-based).\n• Combat is dice-driven — successful rolls deal damage.\n• Defeat the dragon at the marked lair to win.' }));
      screen.appendChild(help);

      this.root.appendChild(screen);
    }

    // ---------------- HOST/JOIN SETUP -------------------------------------
    _startSolo() {
      this.renderer.stop();
      const g = this.game;
      this.net.setMode('solo');
      g.state.players = [];
      for (let i = 0; i < this.soloHeroCount; i++) {
        g.state.players.push({
          id: 'p' + i,
          name: i === 0 ? (this.heroNameDraft || 'Hero 1') : ('Hero ' + (i + 1)),
          isHost: i === 0, isLocal: true,
          classId: null, ready: false,
          hp: 0, maxHp: 0, gold: 0, items: [], alive: true
        });
      }
      g.state.phase = 'class-select';
      g.state.activeIdx = 0;
      g._changed();
    }
    async _startHost() {
      this.net.setMode('host');
      this.game.hostAddSelf(this.heroNameDraft);
      this.net.onConnect = () => this.render();
      this.net.onDisconnect = () => this.render();
      // Lobby covers both "waiting for room code" and "waiting for players".
      this.game.state.phase = 'lobby';
      this.hostingError = null;
      this.game._changed();
      try {
        await this.net.hostOpenRoom();
        this.game._changed();
      } catch (e) {
        this.hostingError = e.message || String(e);
        this.game._changed();
      }
    }
    _startJoin() {
      this.net.setMode('client');
      this.game.state.phase = 'join-setup';
      this.joinError = null;
      this.joinCodeDraft = '';
      this.joining = false;
      this.game._changed();
    }


    _renderJoinSetup() {
      this.renderer.stop();
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Join a Room' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Enter the 6-digit code from the host.' }));

      const namePanel = el('div', { class: 'panel' });
      namePanel.appendChild(el('h3', { text: 'Your Name' }));
      const nameInput = el('input', { attrs: { type: 'text', maxlength: 16, value: this.heroNameDraft }, oninput: (e) => { this.heroNameDraft = e.target.value; } });
      nameInput.style.width = '100%';
      namePanel.appendChild(nameInput);
      screen.appendChild(namePanel);

      const codePanel = el('div', { class: 'panel' });
      codePanel.appendChild(el('h3', { text: 'Room Code' }));
      const codeInput = el('input', {
        class: 'code-input',
        attrs: { type: 'tel', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', placeholder: '000000', value: this.joinCodeDraft || '' },
        oninput: (e) => {
          this.joinCodeDraft = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
          e.target.value = this.joinCodeDraft;
        }
      });
      codePanel.appendChild(codeInput);
      if (this.joinError) {
        codePanel.appendChild(el('p', { class: 'small', style: { color: '#f4a0a0' }, text: this.joinError }));
      }
      codePanel.appendChild(el('button', {
        class: 'btn gold', text: this.joining ? 'Connecting...' : '🔗 Join',
        disabled: this.joining || (this.joinCodeDraft || '').length !== 6,
        onclick: async () => {
          this.joinError = null;
          this.joining = true;
          this.game._changed();
          try {
            await this.net.clientJoinRoom(this.joinCodeDraft, this.heroNameDraft);
            // After connect, host will push state and overwrite phase.
            this.joining = false;
          } catch (e) {
            this.joining = false;
            this.joinError = e.message || String(e);
            this.game._changed();
          }
        }
      }));
      screen.appendChild(codePanel);

      screen.appendChild(el('button', { class: 'btn ghost small', text: '← Back', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
      // autofocus the code input on mobile keyboards
      setTimeout(() => { try { codeInput.focus(); } catch (e) {} }, 50);
    }

    _backToMenu() {
      this.renderer.stop();
      this.net.closeAll();
      this.net.setMode(null);
      this.game.state = this.game._initialState();
      this.offerStr = ''; this.answerStr = '';
      this.game._changed();
    }

    // ---------------- LOBBY (host & client) -------------------------------
    _renderLobby() {
      this.renderer.stop();
      const screen = el('div', { class: 'screen' });
      const isHost = this.game.isHost && this.net.mode === 'host';

      screen.appendChild(el('h1', { class: 'title', text: isHost ? 'Host a Room' : 'Connected' }));

      // Code panel — for host show their hosting code; for client show the
      // code they joined with.
      const codePanel = el('div', { class: 'panel' });
      if (isHost) {
        codePanel.appendChild(el('h3', { text: 'Room Code' }));
        const code = this.net.hostCode;
        if (this.hostingError) {
          codePanel.appendChild(el('p', { class: 'small', style: { color: '#f4a0a0' }, text: 'Could not open a room: ' + this.hostingError }));
          codePanel.appendChild(el('button', { class: 'btn', text: '↻ Retry', onclick: () => this._startHost() }));
        } else if (!code) {
          codePanel.appendChild(el('p', { class: 'small', text: 'Generating room...' }));
          codePanel.appendChild(el('div', { class: 'code-display loading', text: '------' }));
        } else {
          codePanel.appendChild(el('p', { class: 'small', text: 'Share this code with up to 2 friends. They open the app and tap "Join a Room".' }));
          codePanel.appendChild(el('div', { class: 'code-display', text: code }));
          codePanel.appendChild(el('button', {
            class: 'btn gold', text: '📋 Copy code',
            onclick: async () => {
              const ok = await copyToClipboard(code);
              toast(ok ? 'Copied!' : 'Copy failed');
            }
          }));
        }
      } else {
        codePanel.appendChild(el('h3', { text: 'Joined' }));
        codePanel.appendChild(el('p', { class: 'small', text: 'You are in the host\'s room. Waiting for them to start the game.' }));
      }
      screen.appendChild(codePanel);

      const playersPanel = el('div', { class: 'panel' });
      playersPanel.appendChild(el('h3', { text: `Players (${this.game.state.players.length}/3)` }));
      const list = el('div', { class: 'player-list' });
      for (const p of this.game.state.players) {
        const row = el('div', { class: 'player-row' + (p.id === this.game.myId ? ' me' : '') });
        row.appendChild(el('span', { text: (p.isHost ? '👑 ' : '🛡 ') + p.name }));
        if (p.isHost) row.appendChild(el('span', { class: 'badge', text: 'Host' }));
        list.appendChild(row);
      }
      if (isHost && this.game.state.players.length < 2) {
        list.appendChild(el('div', { class: 'player-row', style: { opacity: 0.5, fontStyle: 'italic' }, text: 'Waiting for players...' }));
      }
      playersPanel.appendChild(list);
      screen.appendChild(playersPanel);

      if (isHost) {
        screen.appendChild(el('button', {
          class: 'btn gold', text: '▶ Start Game',
          disabled: this.game.state.players.length < 1 || !this.net.hostCode,
          onclick: () => {
            this.game.state.phase = 'class-select';
            this.game.state.activeIdx = 0;
            this.game._broadcastState();
            this.game._changed();
          }
        }));
      } else {
        screen.appendChild(el('p', { class: 'small center', text: 'Waiting for the host to start...' }));
      }
      screen.appendChild(el('button', { class: 'btn ghost small', text: '← Back', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
    }

    // ---------------- CLASS SELECT ----------------------------------------
    _renderClassSelect() {
      this.renderer.stop();
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Choose Your Class' }));

      for (const p of this.game.state.players) {
        const heroPanel = el('div', { class: 'panel' });
        const head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } });
        head.appendChild(el('h3', { text: (p.isHost ? '👑 ' : '🛡 ') + p.name, style: { margin: 0 } }));
        if (p.ready) head.appendChild(el('span', { class: 'badge', text: '✓ Ready' }));
        heroPanel.appendChild(head);

        const canEdit = this._canControl(p) && !p.ready;
        const taken = new Set(this.game.state.players.filter(o => o !== p).map(o => o.classId).filter(Boolean));

        const grid = el('div', { class: 'class-grid' });
        for (const cid of CLASS_LIST) {
          const c = CLASSES[cid];
          const isSelected = p.classId === cid;
          const isTaken = taken.has(cid);
          const card = el('div', {
            class: 'class-card' + (isSelected ? ' selected' : '') + (isTaken && !isSelected ? ' taken' : ''),
            onclick: () => {
              if (!canEdit) return;
              if (isTaken && !isSelected) { toast('Already taken.'); return; }
              this.net.sendAction({ type: 'pickClass', classId: cid }, p.id);
            }
          });
          card.appendChild(this._classIcon(cid, 36));
          card.appendChild(el('div', { class: 'name', text: c.name }));
          card.appendChild(el('div', { class: 'stats', text: `HP ${c.maxHp} · ${c.dice}d` }));
          grid.appendChild(card);
        }
        heroPanel.appendChild(grid);

        if (p.classId) {
          heroPanel.appendChild(el('p', { class: 'class-detail', text: CLASSES[p.classId].desc }));
        }
        if (canEdit && p.classId) {
          heroPanel.appendChild(el('button', {
            class: 'btn gold', text: '✓ Ready',
            onclick: () => this.net.sendAction({ type: 'classReady' }, p.id)
          }));
        }
        screen.appendChild(heroPanel);
      }

      if (this.game.isHost) {
        const allChose = this.game.state.players.every(p => p.classId);
        if (allChose) {
          screen.appendChild(el('button', {
            class: 'btn', text: '▶ Start Adventure',
            onclick: () => this.game.applyAction({ type: 'startAdventure' }, 'p0')
          }));
        }
      }
      this.root.appendChild(screen);
    }

    // Tiny preview canvas for a class. Internal resolution stays at 32
    // (2x sprite source) for crispness; CSS scales it to the requested
    // display size with `image-rendering: pixelated`.
    _classIcon(classId, displaySize) {
      const sp = window.SPRITES[classId + '_idle'];
      const cv = el('canvas', { class: 'sprite-icon' });
      cv.width = 32; cv.height = 32;
      cv.style.width = displaySize + 'px';
      cv.style.height = displaySize + 'px';
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (sp && sp.frames[0]) {
        ctx.drawImage(sp.frames[0], 0, 0, 16, 16, 0, 0, 32, 32);
      }
      return cv;
    }

    // ---------------- OVERWORLD -------------------------------------------
    _renderOverworld() {
      const screen = el('div', { class: 'screen' });
      const s = this.game.state;
      const active = s.players[s.activeIdx];
      const myTurn = active && this._canControl(active);

      // Header
      const head = el('div', { class: 'world-head' });
      head.appendChild(el('h2', { text: 'Round ' + s.round, style: { margin: 0, fontSize: '15px', color: '#ffd770' } }));
      const tile = s.map ? s.map.tiles[s.party.y * s.map.w + s.party.x] : null;
      if (tile) {
        const label = (tile.feature ? window.DATA.FEATURE_NAMES[tile.feature] : tile.terrain.charAt(0).toUpperCase() + tile.terrain.slice(1));
        head.appendChild(el('span', { class: 'small', text: label }));
      }
      head.appendChild(el('button', { class: 'btn ghost small', text: '☰', onclick: () => this._showQuitModal() }));
      screen.appendChild(head);

      // Canvas container
      const canvasWrap = el('div', { class: 'canvas-wrap' });
      screen.appendChild(canvasWrap);
      this.root.appendChild(screen);   // append first so parent has size
      this.renderer.attach(canvasWrap);
      this.renderer.resize();
      this.renderer.start();

      // Party bar
      screen.appendChild(this._renderPartyBar());

      // Turn prompt + actions
      if (s.phase === 'overworld') {
        const prompt = el('div', { class: 'turn-prompt' });
        if (myTurn) prompt.textContent = `${active.name}: tap a glowing tile to move.`;
        else if (active) prompt.textContent = `${active.name}'s turn...`;
        screen.appendChild(prompt);

        if (myTurn) {
          const potion = active.items.find(i => i.type === 'potion' && i.count > 0);
          if (potion && active.hp < active.maxHp) {
            screen.appendChild(el('button', {
              class: 'btn ghost', text: `🧪 Drink potion (x${potion.count})`,
              onclick: () => this.net.sendAction({ type: 'usePotionOverworld' }, active.id)
            }));
          }
        }
      }

      // Log
      screen.appendChild(this._renderLog());
    }

    _renderPartyBar() {
      const bar = el('div', { class: 'party-bar' });
      const s = this.game.state;
      for (let i = 0; i < s.players.length; i++) {
        const p = s.players[i];
        const c = p.classId ? CLASSES[p.classId] : null;
        const cl = ['hero-card'];
        const inCombat = s.phase === 'combat' && s.combat;
        const activeIdx = inCombat ? (s.combat.turn.side === 'players' ? s.combat.turn.idx : -1) : s.activeIdx;
        if (i === activeIdx) cl.push('active');
        if (!p.alive || p.hp <= 0) cl.push('dead');
        const card = el('div', { class: cl.join(' ') });
        const head = el('div', { class: 'hero-head' });
        head.appendChild(this._classIcon(p.classId || 'warrior', 18));
        head.appendChild(el('span', { class: 'hero-name', text: p.name }));
        card.appendChild(head);
        const hpBar = el('div', { class: 'hp-bar' });
        const hpFill = el('div', { class: 'hp-fill' });
        const pct = p.maxHp ? Math.max(0, (p.hp / p.maxHp) * 100) : 0;
        hpFill.style.width = pct + '%';
        hpBar.appendChild(hpFill);
        card.appendChild(hpBar);
        card.appendChild(el('div', { class: 'hp-text', text: p.hp + '/' + p.maxHp }));
        const items = (p.items || []).reduce((a, it) => a + it.count, 0);
        card.appendChild(el('div', { class: 'gold-text', text: `💰${p.gold} 🎒${items}` }));
        bar.appendChild(card);
      }
      return bar;
    }
    _renderLog() {
      const log = el('div', { class: 'log' });
      const entries = (this.game.state.log || []).slice(-8).reverse();
      for (const e of entries) log.appendChild(el('div', { class: 'entry', text: e }));
      return log;
    }

    _renderEventModal() {
      const ev = this.game.state.event;
      if (!ev) return;
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal' });
      modal.appendChild(el('h3', { text: ev.title }));
      modal.appendChild(el('p', { text: ev.text }));
      const active = this.game.state.players[this.game.state.activeIdx];
      if (this._canControl(active) || this.net.mode === 'host' || this.net.mode === 'solo') {
        modal.appendChild(el('button', {
          class: 'btn gold', text: 'Continue',
          onclick: () => this.net.sendAction({ type: 'eventDismiss' }, active.id)
        }));
      } else {
        modal.appendChild(el('p', { class: 'small', text: 'Waiting...' }));
      }
      overlay.appendChild(modal);
      this.root.appendChild(overlay);
    }

    // ---------------- COMBAT ----------------------------------------------
    _renderCombat() {
      const s = this.game.state;
      const c = s.combat;
      const screen = el('div', { class: 'screen combat-screen' });

      const head = el('div', { class: 'world-head' });
      head.appendChild(el('h2', { text: c.isBoss ? '🐉 BOSS · The Dragon' : '⚔ Battle', style: { margin: 0, fontSize: '15px', color: '#ffd770' } }));
      head.appendChild(el('button', { class: 'btn ghost small', text: '☰', onclick: () => this._showQuitModal() }));
      screen.appendChild(head);

      const canvasWrap = el('div', { class: 'canvas-wrap' });
      screen.appendChild(canvasWrap);
      this.root.appendChild(screen);
      this.renderer.attach(canvasWrap);
      this.renderer.resize();
      this.renderer.start();
      this.renderer.setCombatTargetMode(this.combatTargeting === 'attack');

      screen.appendChild(this._renderPartyBar());

      const active = (c.turn.side === 'players') ? s.players[c.turn.idx] : null;
      if (active && this._canControl(active)) {
        if (this.combatTargeting === 'attack') {
          screen.appendChild(el('div', { class: 'turn-prompt', text: `${active.name}: tap an enemy to attack` }));
          screen.appendChild(el('button', { class: 'btn ghost small', text: 'Cancel', onclick: () => { this.combatTargeting = null; this.renderer.setCombatTargetMode(false); this.render(); } }));
        } else {
          screen.appendChild(el('div', { class: 'turn-prompt', text: `${active.name}'s turn` }));
          const bar = el('div', { class: 'action-bar' });
          bar.appendChild(el('button', {
            class: 'btn', text: '⚔ Attack',
            onclick: () => { this.combatTargeting = 'attack'; this.renderer.setCombatTargetMode(true); this.render(); }
          }));
          const potion = (active.items || []).find(i => i.type === 'potion' && i.count > 0);
          const bomb = (active.items || []).find(i => i.type === 'bomb' && i.count > 0);
          bar.appendChild(el('button', {
            class: 'btn ghost', text: '🧪 Potion' + (potion ? ` x${potion.count}` : ''),
            disabled: !potion || active.hp >= active.maxHp,
            onclick: () => this.net.sendAction({ type: 'useItem', itemType: 'potion' }, active.id)
          }));
          bar.appendChild(el('button', {
            class: 'btn ghost', text: '💣 Bomb' + (bomb ? ` x${bomb.count}` : ''),
            disabled: !bomb,
            onclick: () => this.net.sendAction({ type: 'useItem', itemType: 'bomb' }, active.id)
          }));
          screen.appendChild(bar);
          screen.appendChild(el('button', {
            class: 'btn danger small', text: c.isBoss ? "🚫 Can't flee" : '🏃 Flee',
            disabled: c.isBoss,
            onclick: () => this.net.sendAction({ type: 'flee' }, active.id)
          }));
        }
      } else if (active) {
        screen.appendChild(el('div', { class: 'turn-prompt', text: `${active.name}'s turn...` }));
      } else {
        screen.appendChild(el('div', { class: 'turn-prompt warn', text: 'Enemies attack...' }));
      }
      screen.appendChild(this._renderLog());
    }

    _renderEnd(victory) {
      this.renderer.stop();
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: victory ? '🏆 Victory!' : '☠ Defeat' }));
      screen.appendChild(el('p', { class: 'subtitle', text: victory ? 'The dragon has fallen. The realm is safe.' : 'The party perished on their quest.' }));
      const panel = el('div', { class: 'panel' });
      panel.appendChild(el('h3', { text: 'Party' }));
      for (const p of this.game.state.players) {
        const cls = p.classId ? CLASSES[p.classId] : null;
        const row = el('div', { class: 'player-row' });
        row.appendChild(el('span', { text: (cls ? cls.icon : '?') + ' ' + p.name }));
        row.appendChild(el('span', { class: 'small', text: `💰${p.gold} · ${p.hp}/${p.maxHp} HP` }));
        panel.appendChild(row);
      }
      screen.appendChild(panel);
      screen.appendChild(this._renderLog());

      if (this.game.isHost) {
        screen.appendChild(el('button', {
          class: 'btn gold', text: '🔄 New Quest',
          onclick: () => this.game.applyAction({ type: 'restartFromMenu' }, 'p0')
        }));
      }
      screen.appendChild(el('button', { class: 'btn ghost', text: '← Main Menu', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
    }

    _showQuitModal() {
      const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
      const modal = el('div', { class: 'modal' });
      modal.appendChild(el('h3', { text: 'Menu' }));
      modal.appendChild(el('button', { class: 'btn ghost', text: 'Resume', onclick: () => overlay.remove() }));
      modal.appendChild(el('button', { class: 'btn danger', text: 'Quit to main menu', onclick: () => { overlay.remove(); this._backToMenu(); } }));
      overlay.appendChild(modal);
      this.root.appendChild(overlay);
    }
  }

  window.UI = UI;
})();
