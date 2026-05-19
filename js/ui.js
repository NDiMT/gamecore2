// DOM-based UI. Re-renders the whole #app on every state change. The game is
// small enough that this is fast and bug-free; no need for a diffing layer.
(function () {
  'use strict';
  const { el, toast, copyToClipboard } = window.U;
  const { CLASSES, CLASS_LIST, ENEMIES, ITEMS, TILE_ICONS, TILE_NAMES } = window.DATA;

  class UI {
    constructor(game, net) {
      this.game = game;
      this.net = net;
      this.root = document.getElementById('app');
      this.combatTargeting = null;  // 'attack' | 'bomb' | null
      this.lastRollSig = '';        // detect new rolls for animation
      this.diceAnimUntil = 0;
      this.soloHeroCount = 2;
      this.offerStr = '';           // host's offer being shown
      this.answerStr = '';          // client's answer being shown
      this.heroNameDraft = this._suggestName();
    }
    _suggestName() {
      const names = ['Αλέξιος', 'Έλενα', 'Δημήτρης', 'Κασσάνδρα', 'Νίκος', 'Άρτεμις', 'Λεωνίδας', 'Σοφία'];
      return names[Math.floor(Math.random() * names.length)];
    }

    render() {
      // Detect new dice roll → trigger animation hint.
      const lr = this.game.state.lastRoll;
      const sig = lr ? `${lr.actor}-${(lr.dice||[]).join(',')}-${lr.dmg}` : '';
      if (sig && sig !== this.lastRollSig) {
        this.lastRollSig = sig;
        this.diceAnimUntil = Date.now() + 400;
      }

      this.root.innerHTML = '';
      const s = this.game.state;
      switch (s.phase) {
        case 'menu':         this._renderMenu(); break;
        case 'host-setup':   this._renderHostSetup(); break;
        case 'join-setup':   this._renderJoinSetup(); break;
        case 'join-waiting': this._renderJoinWaiting(); break;
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

    // ---------------- MENU ------------------------------------------------
    _renderMenu() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Η Αναζήτηση του Δράκου' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Roguelike περιπέτεια για κινητό · 1-3 παίκτες coop' }));

      const namePanel = el('div', { class: 'panel' });
      namePanel.appendChild(el('h3', { text: 'Το όνομά σου' }));
      const nameInput = el('input', { attrs: { type: 'text', maxlength: 16, value: this.heroNameDraft }, oninput: (e) => { this.heroNameDraft = e.target.value; } });
      nameInput.style.width = '100%';
      namePanel.appendChild(nameInput);
      screen.appendChild(namePanel);

      const heroPanel = el('div', { class: 'panel' });
      heroPanel.appendChild(el('h3', { text: 'Παίξε Μόνος' }));
      heroPanel.appendChild(el('p', { text: 'Διάλεξε πόσους ήρωες θα ελέγχεις:' }));
      const row = el('div', { class: 'btn-row' });
      for (const n of [1, 2, 3]) {
        const b = el('button', {
          class: 'btn ghost' + (this.soloHeroCount === n ? ' gold' : ''),
          text: n + ' Ήρω' + (n === 1 ? 'ας' : 'ες'),
          onclick: () => { this.soloHeroCount = n; this.render(); }
        });
        row.appendChild(b);
      }
      heroPanel.appendChild(row);
      heroPanel.appendChild(el('div', { style: { height: '8px' } }));
      heroPanel.appendChild(el('button', {
        class: 'btn gold',
        text: '▶ Έναρξη Solo',
        onclick: () => this._startSolo()
      }));
      screen.appendChild(heroPanel);

      const coopPanel = el('div', { class: 'panel' });
      coopPanel.appendChild(el('h3', { text: 'Coop (WebRTC)' }));
      coopPanel.appendChild(el('p', { text: 'Παίξτε με φίλους χωρίς server: ένας φτιάχνει δωμάτιο και μοιράζεται έναν κωδικό μέσω chat/μηνύματος.' }));
      const coopRow = el('div', { class: 'menu-buttons' });
      coopRow.appendChild(el('button', { class: 'btn', text: '🏰 Φιλοξενία Δωματίου', onclick: () => this._startHost() }));
      coopRow.appendChild(el('button', { class: 'btn', text: '🚪 Σύνδεση σε Δωμάτιο', onclick: () => this._startJoin() }));
      coopPanel.appendChild(coopRow);
      screen.appendChild(coopPanel);

      const help = el('div', { class: 'panel' });
      help.appendChild(el('h3', { text: 'Πώς παίζεται' }));
      help.appendChild(el('p', { text: '• Σε turn-based εξερεύνηση 6×6 χάρτη.\n• Κάθε ήρωας ρίχνει ζάρια στις μάχες — πετυχημένα ζάρια = ζημιά.\n• Στόχος: νικήστε τον Δράκο στο τέλος του χάρτη.' }));
      screen.appendChild(help);

      this.root.appendChild(screen);
    }

    // ---------------- HOST SETUP -----------------------------------------
    _startSolo() {
      // Build host as a solo player with N local heroes.
      const g = this.game;
      this.net.setMode('solo');
      g.state.players = [];
      for (let i = 0; i < this.soloHeroCount; i++) {
        g.state.players.push({
          id: 'p' + i,
          name: i === 0 ? (this.heroNameDraft || 'Ήρωας 1') : ('Ήρωας ' + (i + 1)),
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
      // Hook host events back to UI.
      this.net.onConnect = () => this.render();
      this.net.onDisconnect = () => this.render();
      this.game.state.phase = 'host-setup';
      try {
        this.offerStr = await this.net.hostCreateOffer();
      } catch (e) {
        toast('Σφάλμα WebRTC: ' + e.message);
      }
      this.game._changed();
    }
    _startJoin() {
      this.net.setMode('client');
      this.game.state.phase = 'join-setup';
      this.game._changed();
    }

    _renderHostSetup() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Φιλοξενία Δωματίου' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Μοιράσου τον κωδικό πρόσκλησης. Έπειτα επικόλλησε την απάντηση.' }));

      const offerPanel = el('div', { class: 'panel signaling-block' });
      offerPanel.appendChild(el('h3', { text: '1) Κωδικός Πρόσκλησης' }));
      offerPanel.appendChild(el('p', { class: 'small', text: 'Στείλε αυτόν τον κωδικό στον φίλο σου (chat, SMS, email).' }));
      const offerTa = el('textarea', { readonly: true, attrs: { readonly: 'true' }, value: this.offerStr || '...' });
      offerPanel.appendChild(offerTa);
      offerPanel.appendChild(el('button', {
        class: 'btn gold', text: '📋 Αντιγραφή κωδικού',
        onclick: async () => {
          if (!this.offerStr) return;
          const ok = await copyToClipboard(this.offerStr);
          toast(ok ? 'Αντιγράφηκε!' : 'Αποτυχία αντιγραφής');
        }
      }));
      screen.appendChild(offerPanel);

      const ansPanel = el('div', { class: 'panel signaling-block' });
      ansPanel.appendChild(el('h3', { text: '2) Κωδικός Απάντησης' }));
      ansPanel.appendChild(el('p', { class: 'small', text: 'Όταν ο φίλος σου σου στείλει τη δική του απάντηση, επικόλλησέ την εδώ.' }));
      let pasteVal = '';
      const pasteTa = el('textarea', { placeholder: 'Επικόλλησε εδώ τον κωδικό απάντησης...', oninput: (e) => { pasteVal = e.target.value; } });
      ansPanel.appendChild(pasteTa);
      ansPanel.appendChild(el('button', {
        class: 'btn', text: '🔗 Σύνδεση Παίκτη',
        onclick: async () => {
          if (!pasteVal.trim()) { toast('Επικόλλησε τον κωδικό πρώτα.'); return; }
          try {
            await this.net.hostAcceptAnswer(pasteVal);
            toast('Συνδέεται...');
          } catch (e) {
            toast('Σφάλμα: ' + e.message);
          }
        }
      }));
      screen.appendChild(ansPanel);

      const playersPanel = el('div', { class: 'panel' });
      playersPanel.appendChild(el('h3', { text: 'Παίκτες (' + this.game.state.players.length + ')' }));
      const list = el('div', { class: 'player-list' });
      for (const p of this.game.state.players) {
        const row = el('div', { class: 'player-row' + (p.id === this.game.myId ? ' me' : '') });
        row.appendChild(el('span', { text: (p.isHost ? '👑 ' : '🛡 ') + p.name }));
        if (p.isHost) row.appendChild(el('span', { class: 'badge', text: 'Host' }));
        list.appendChild(row);
      }
      playersPanel.appendChild(list);
      screen.appendChild(playersPanel);

      const actionPanel = el('div', { class: 'panel' });
      const canStart = this.game.state.players.length >= 1;
      const addBtn = el('button', {
        class: 'btn ghost', text: '➕ Δημιουργία νέου κωδικού για επόμενο παίκτη',
        disabled: this.game.state.players.length >= 3,
        onclick: async () => {
          try {
            this.offerStr = await this.net.hostCreateOffer();
            this.game._changed();
          } catch (e) { toast('Σφάλμα: ' + e.message); }
        }
      });
      actionPanel.appendChild(addBtn);
      actionPanel.appendChild(el('div', { style: { height: '8px' } }));
      actionPanel.appendChild(el('button', {
        class: 'btn gold', text: '▶ Έναρξη Λόμπι',
        disabled: !canStart,
        onclick: () => { this.game.hostStartLobby(); }
      }));
      actionPanel.appendChild(el('div', { style: { height: '6px' } }));
      actionPanel.appendChild(el('button', { class: 'btn ghost small', text: '← Πίσω', onclick: () => this._backToMenu() }));
      screen.appendChild(actionPanel);

      this.root.appendChild(screen);
    }

    // ---------------- JOIN SETUP -----------------------------------------
    _renderJoinSetup() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Σύνδεση σε Δωμάτιο' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Επικόλλησε τον κωδικό πρόσκλησης που έλαβες.' }));

      const namePanel = el('div', { class: 'panel' });
      namePanel.appendChild(el('h3', { text: 'Το όνομά σου' }));
      const nameInput = el('input', { attrs: { type: 'text', maxlength: 16, value: this.heroNameDraft }, oninput: (e) => { this.heroNameDraft = e.target.value; } });
      nameInput.style.width = '100%';
      namePanel.appendChild(nameInput);
      screen.appendChild(namePanel);

      let pasteVal = '';
      const offerPanel = el('div', { class: 'panel signaling-block' });
      offerPanel.appendChild(el('h3', { text: '1) Κωδικός Πρόσκλησης' }));
      const offerTa = el('textarea', { placeholder: 'Επικόλλησε εδώ...', oninput: (e) => { pasteVal = e.target.value; } });
      offerPanel.appendChild(offerTa);
      offerPanel.appendChild(el('button', {
        class: 'btn gold', text: '⚙️ Δημιουργία Απάντησης',
        onclick: async () => {
          if (!pasteVal.trim()) { toast('Επικόλλησε τον κωδικό πρώτα.'); return; }
          try {
            const ans = await this.net.clientAcceptOffer(pasteVal, this.heroNameDraft);
            this.answerStr = ans;
            this.game.state.phase = 'join-waiting';
            this.game._changed();
          } catch (e) {
            toast('Σφάλμα: ' + e.message);
          }
        }
      }));
      screen.appendChild(offerPanel);

      screen.appendChild(el('button', { class: 'btn ghost small', text: '← Πίσω', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
    }

    _renderJoinWaiting() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Απάντηση' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Στείλε αυτή την απάντηση στον host. Αναμονή σύνδεσης...' }));

      const panel = el('div', { class: 'panel signaling-block' });
      panel.appendChild(el('h3', { text: '2) Κωδικός Απάντησης' }));
      const ta = el('textarea', { readonly: true, attrs: { readonly: 'true' }, value: this.answerStr || '...' });
      panel.appendChild(ta);
      panel.appendChild(el('button', {
        class: 'btn gold', text: '📋 Αντιγραφή',
        onclick: async () => {
          const ok = await copyToClipboard(this.answerStr);
          toast(ok ? 'Αντιγράφηκε!' : 'Αποτυχία.');
        }
      }));
      screen.appendChild(panel);
      screen.appendChild(el('button', { class: 'btn ghost small', text: '← Πίσω', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
    }

    _backToMenu() {
      this.net.closeAll();
      this.net.setMode(null);
      this.game.state = this.game._initialState();
      this.offerStr = ''; this.answerStr = '';
      this.game._changed();
    }

    // ---------------- LOBBY -----------------------------------------------
    _renderLobby() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Λόμπι' }));
      screen.appendChild(el('p', { class: 'subtitle', text: 'Περιμένοντας τους παίκτες...' }));

      const panel = el('div', { class: 'panel' });
      panel.appendChild(el('h3', { text: 'Παίκτες' }));
      const list = el('div', { class: 'player-list' });
      for (const p of this.game.state.players) {
        const row = el('div', { class: 'player-row' + (p.id === this.game.myId ? ' me' : '') });
        row.appendChild(el('span', { text: (p.isHost ? '👑 ' : '🛡 ') + p.name }));
        if (p.isHost) row.appendChild(el('span', { class: 'badge', text: 'Host' }));
        list.appendChild(row);
      }
      panel.appendChild(list);
      screen.appendChild(panel);

      if (this.game.isHost) {
        screen.appendChild(el('button', {
          class: 'btn gold', text: '▶ Έναρξη Παιχνιδιού',
          disabled: this.game.state.players.length < 1,
          onclick: () => {
            this.game.state.phase = 'class-select';
            this.game.state.activeIdx = 0;
            this.game._broadcastState();
            this.game._changed();
          }
        }));
        screen.appendChild(el('button', {
          class: 'btn ghost', text: '➕ Πρόσθεση παίκτη',
          disabled: this.game.state.players.length >= 3,
          onclick: async () => {
            try {
              this.offerStr = await this.net.hostCreateOffer();
              this.game.state.phase = 'host-setup';
              this.game._changed();
            } catch (e) { toast('Σφάλμα: ' + e.message); }
          }
        }));
      } else {
        screen.appendChild(el('p', { class: 'small center', text: 'Αναμονή να ξεκινήσει ο host...' }));
      }
      this.root.appendChild(screen);
    }

    // ---------------- CLASS SELECT ----------------------------------------
    _renderClassSelect() {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: 'Διάλεξε Κλάση' }));

      for (const p of this.game.state.players) {
        const heroPanel = el('div', { class: 'panel' });
        const head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } });
        head.appendChild(el('h3', { text: (p.isHost ? '👑 ' : '🛡 ') + p.name, style: { margin: 0 } }));
        if (p.ready) head.appendChild(el('span', { class: 'badge', text: '✓ Έτοιμος' }));
        heroPanel.appendChild(head);

        const canEdit = this._canControlPlayer(p) && !p.ready;
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
              if (isTaken && !isSelected) { toast('Πιάστηκε ήδη.'); return; }
              this.net.sendAction({ type: 'pickClass', classId: cid }, p.id);
            }
          });
          card.appendChild(el('div', { class: 'icon', text: c.icon }));
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
            class: 'btn gold', text: '✓ Έτοιμος',
            onclick: () => this.net.sendAction({ type: 'classReady' }, p.id)
          }));
        }
        screen.appendChild(heroPanel);
      }

      // Host shortcut: force-start when all chose a class.
      if (this.game.isHost) {
        const allChose = this.game.state.players.every(p => p.classId);
        if (allChose) {
          screen.appendChild(el('button', {
            class: 'btn', text: '▶ Ξεκίνα την Περιπέτεια',
            onclick: () => this.game.applyAction({ type: 'startAdventure' }, 'p0')
          }));
        }
      }
      this.root.appendChild(screen);
    }

    _canControlPlayer(p) {
      // Solo host: controls all players. Coop host: only itself. Client: only myId.
      if (this.net.mode === 'solo') return true;
      if (this.net.mode === 'host') return p.id === this.game.myId;
      if (this.net.mode === 'client') return p.id === this.game.myId;
      return p.id === this.game.myId;
    }

    // ---------------- OVERWORLD -------------------------------------------
    _renderOverworld() {
      const screen = el('div', { class: 'screen' });
      const s = this.game.state;
      const active = s.players[s.activeIdx];
      const myTurn = active && this._canControlPlayer(active);

      const head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
      head.appendChild(el('h2', { style: { margin: 0, fontSize: '18px', color: '#ffd770' }, text: 'Χάρτης · Γύρος ' + s.round }));
      head.appendChild(el('button', { class: 'btn ghost small', text: '☰', onclick: () => this._showMenu() }));
      screen.appendChild(head);

      screen.appendChild(this._renderPartyBar());

      // Map.
      const wrap = el('div', { class: 'map-wrap' });
      const map = el('div', { class: 'map', style: { gridTemplateColumns: `repeat(${s.map.w}, minmax(0, 1fr))` } });
      for (let y = 0; y < s.map.h; y++) {
        for (let x = 0; x < s.map.w; x++) {
          const tile = s.map.tiles[y * s.map.w + x];
          const isParty = (s.party.x === x && s.party.y === y);
          const isAdj = (Math.abs(s.party.x - x) + Math.abs(s.party.y - y) === 1);
          const movable = myTurn && isAdj && s.phase === 'overworld';
          const cl = ['tile'];
          if (tile.discovered || isAdj) cl.push('discovered');
          if (tile.cleared) cl.push('cleared');
          if (tile.type === 'boss') cl.push('boss');
          if (isParty) cl.push('party');
          if (movable) cl.push('movable');
          const t = el('div', {
            class: cl.join(' '),
            text: (tile.discovered || isAdj || isParty) ? TILE_ICONS[tile.type] : '?',
            onclick: movable ? () => this.net.sendAction({ type: 'move', x, y }, active.id) : null
          });
          map.appendChild(t);
        }
      }
      wrap.appendChild(map);
      screen.appendChild(wrap);

      // Turn prompt.
      if (s.phase === 'overworld') {
        const here = s.map.tiles[s.party.y * s.map.w + s.party.x];
        const prompt = el('div', { class: 'turn-prompt' });
        if (myTurn) {
          prompt.textContent = `${active.name}: επίλεξε γειτονικό κελί στον χάρτη.`;
        } else if (active) {
          prompt.textContent = `Σειρά του ${active.name}...`;
        }
        screen.appendChild(prompt);
      }

      // Overworld actions (active player only).
      if (s.phase === 'overworld' && myTurn) {
        const potion = active.items.find(i => i.type === 'potion' && i.count > 0);
        if (potion && active.hp < active.maxHp) {
          screen.appendChild(el('button', {
            class: 'btn ghost', text: `🧪 Πιες φίλτρο (x${potion.count})`,
            onclick: () => this.net.sendAction({ type: 'usePotionOverworld' }, active.id)
          }));
        }
      }

      // Log.
      screen.appendChild(this._renderLog());
      this.root.appendChild(screen);
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
        head.appendChild(el('span', { class: 'icon', text: c ? c.icon : '?' }));
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

    // ---------------- EVENT MODAL -----------------------------------------
    _renderEventModal() {
      const ev = this.game.state.event;
      if (!ev) return;
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal' });
      modal.appendChild(el('h3', { text: ev.title }));
      modal.appendChild(el('p', { text: ev.text }));
      const active = this.game.state.players[this.game.state.activeIdx];
      const canAck = this._canControlPlayer(active) || (this.net.mode === 'host' || this.net.mode === 'solo');
      if (canAck) {
        modal.appendChild(el('button', {
          class: 'btn gold', text: 'Συνέχεια',
          onclick: () => this.net.sendAction({ type: 'eventDismiss' }, active.id)
        }));
      } else {
        modal.appendChild(el('p', { class: 'small', text: 'Αναμονή...' }));
      }
      overlay.appendChild(modal);
      this.root.appendChild(overlay);
    }

    // ---------------- COMBAT ----------------------------------------------
    _renderCombat() {
      const s = this.game.state;
      const c = s.combat;
      const screen = el('div', { class: 'screen combat-screen' });
      screen.appendChild(el('h2', { style: { margin: 0, fontSize: '18px', color: '#ffd770', textAlign: 'center' }, text: c.isBoss ? '🐉 ΜΑΧΗ ΜΕ ΤΟΝ ΔΡΑΚΟ 🐉' : '⚔ Μάχη' }));

      // Enemies.
      const enemyList = el('div', { class: 'enemy-list' });
      const targeting = this.combatTargeting; // 'attack' | 'bomb' | null
      for (const e of c.enemies) {
        const cl = ['enemy-card'];
        if (!e.alive || e.hp <= 0) cl.push('dead');
        if (targeting === 'attack' || targeting === 'bomb') cl.push('selectable');
        const card = el('div', {
          class: cl.join(' '),
          onclick: e.alive && e.hp > 0 && targeting ? () => this._fireTargetedAction(e.idx) : null
        });
        card.appendChild(el('div', { class: 'icon', text: e.icon }));
        const info = el('div', { class: 'info' });
        info.appendChild(el('div', { class: 'name', text: e.name + (e.alive ? '' : ' †') }));
        const hpBar = el('div', { class: 'hp-bar' });
        const hpFill = el('div', { class: 'hp-fill' });
        hpFill.style.width = e.maxHp ? ((e.hp / e.maxHp) * 100) + '%' : '0%';
        hpBar.appendChild(hpFill);
        info.appendChild(hpBar);
        info.appendChild(el('div', { class: 'small', text: e.hp + '/' + e.maxHp + ' HP' }));
        card.appendChild(info);
        enemyList.appendChild(card);
      }
      screen.appendChild(enemyList);

      // Dice tray with most recent roll.
      const tray = el('div', { class: 'dice-tray' });
      const lr = s.lastRoll;
      if (lr && lr.dice && lr.dice.length) {
        const animating = Date.now() < this.diceAnimUntil;
        for (const v of lr.dice) {
          const dcl = ['die'];
          if (v >= (lr.hitOn || 4)) dcl.push('hit');
          if (lr.crit && v === lr.crit) dcl.push('crit');
          if (animating) dcl.push('rolling');
          tray.appendChild(el('div', { class: dcl.join(' '), text: String(v) }));
        }
        if (lr.dmg != null) tray.appendChild(el('span', { class: 'small', text: `→ ${lr.dmg} ζημιά` }));
      } else if (lr && lr.special === 'bomb') {
        tray.appendChild(el('span', { text: `💣 ${lr.dmg} σε όλους` }));
      } else {
        tray.appendChild(el('span', { class: 'small', text: 'Κανένα ζάρι ακόμα' }));
      }
      screen.appendChild(tray);

      // Party bar.
      screen.appendChild(this._renderPartyBar());

      // Turn prompt + actions.
      const active = (c.turn.side === 'players') ? s.players[c.turn.idx] : null;
      if (active && this._canControlPlayer(active) && c.turn.side === 'players') {
        if (targeting === 'attack') {
          screen.appendChild(el('div', { class: 'turn-prompt', text: `${active.name}: επίλεξε στόχο για επίθεση` }));
          screen.appendChild(el('button', { class: 'btn ghost', text: 'Άκυρο', onclick: () => { this.combatTargeting = null; this.render(); } }));
        } else {
          screen.appendChild(el('div', { class: 'turn-prompt', text: `Σειρά: ${active.name}` }));
          const bar = el('div', { class: 'action-bar' });
          bar.appendChild(el('button', {
            class: 'btn', text: '⚔ Επίθεση',
            onclick: () => { this.combatTargeting = 'attack'; this.render(); }
          }));
          const potion = (active.items || []).find(i => i.type === 'potion' && i.count > 0);
          const bomb = (active.items || []).find(i => i.type === 'bomb' && i.count > 0);
          bar.appendChild(el('button', {
            class: 'btn ghost', text: '🧪 Φίλτρο' + (potion ? ` x${potion.count}` : ''),
            disabled: !potion || active.hp >= active.maxHp,
            onclick: () => this.net.sendAction({ type: 'useItem', itemType: 'potion' }, active.id)
          }));
          bar.appendChild(el('button', {
            class: 'btn ghost', text: '💣 Βόμβα' + (bomb ? ` x${bomb.count}` : ''),
            disabled: !bomb,
            onclick: () => this.net.sendAction({ type: 'useItem', itemType: 'bomb' }, active.id)
          }));
          screen.appendChild(bar);
          screen.appendChild(el('button', {
            class: 'btn danger small', text: c.isBoss ? '🚫 (δεν μπορείς να ξεφύγεις)' : '🏃 Φυγή',
            disabled: c.isBoss,
            onclick: () => this.net.sendAction({ type: 'flee' }, active.id)
          }));
        }
      } else if (active) {
        screen.appendChild(el('div', { class: 'turn-prompt', text: `Σειρά: ${active.name}...` }));
      } else {
        screen.appendChild(el('div', { class: 'turn-prompt warn', text: 'Σειρά εχθρών...' }));
      }

      screen.appendChild(this._renderLog());
      this.root.appendChild(screen);
    }

    _fireTargetedAction(enemyIdx) {
      const s = this.game.state;
      const c = s.combat;
      if (!c || c.turn.side !== 'players') return;
      const active = s.players[c.turn.idx];
      if (!active || !this._canControlPlayer(active)) return;
      const mode = this.combatTargeting;
      this.combatTargeting = null;
      if (mode === 'attack') this.net.sendAction({ type: 'attack', enemyIdx }, active.id);
    }

    // ---------------- END SCREEN ------------------------------------------
    _renderEnd(victory) {
      const screen = el('div', { class: 'screen' });
      screen.appendChild(el('h1', { class: 'title', text: victory ? '🏆 Νίκη!' : '☠ Ηττηθήκατε' }));
      screen.appendChild(el('p', { class: 'subtitle', text: victory ? 'Ο δράκος έπεσε. Το βασίλειο σωτηρώθηκε.' : 'Η ομάδα έπεσε στην προσπάθεια.' }));
      // Stats.
      const panel = el('div', { class: 'panel' });
      panel.appendChild(el('h3', { text: 'Ομάδα' }));
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
          class: 'btn gold', text: '🔄 Νέα Περιπέτεια',
          onclick: () => this.game.applyAction({ type: 'restartFromMenu' }, 'p0')
        }));
      }
      screen.appendChild(el('button', { class: 'btn ghost', text: '← Στο Μενού', onclick: () => this._backToMenu() }));
      this.root.appendChild(screen);
    }

    _showMenu() {
      // Quick exit modal.
      const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
      const modal = el('div', { class: 'modal' });
      modal.appendChild(el('h3', { text: 'Μενού' }));
      modal.appendChild(el('button', { class: 'btn ghost', text: 'Συνέχεια', onclick: () => overlay.remove() }));
      modal.appendChild(el('button', { class: 'btn danger', text: 'Έξοδος στο κύριο μενού', onclick: () => { overlay.remove(); this._backToMenu(); } }));
      overlay.appendChild(modal);
      this.root.appendChild(overlay);
    }
  }

  window.UI = UI;
})();
