// Pure game-logic engine. Host owns the authoritative state; clients only
// render snapshots received over the wire. Both run this same class — clients
// just don't call applyAction locally, they call sendAction() through Net.
(function () {
  'use strict';
  const { CLASSES, CLASS_LIST, ENEMIES, ENCOUNTERS, BOSS_ENCOUNTER, ITEMS } = window.DATA;
  const { rand, pick, rollDie, clamp, shuffle, deepClone } = window.U;

  const MAP_W = 6;
  const MAP_H = 6;
  const POTION_HEAL = 14;
  const BOMB_DAMAGE = 6;
  const FLEE_CHANCE = 0.55;

  class Game {
    constructor() {
      this.isHost = true;          // set by Net layer
      this.myId = 'p0';            // host = p0; assigned by Net when joining
      this.state = this._initialState();
      this.listeners = [];
      this.broadcastFn = null;     // host broadcasts; injected by main.js
    }

    _initialState() {
      return {
        phase: 'menu',             // menu | host-setup | join-setup | lobby | class-select | overworld | combat | event | victory | gameover
        players: [],
        hostId: 'p0',
        map: null,
        party: { x: 0, y: 0 },
        activeIdx: 0,
        round: 1,
        combat: null,
        event: null,
        log: [],
        lastRoll: null            // animation hint
      };
    }

    // --- subscription / mutation -------------------------------------------
    subscribe(fn) { this.listeners.push(fn); }
    _changed() { for (const fn of this.listeners) fn(); }

    // Replace local state (used by clients receiving a snapshot from host).
    setState(s) {
      this.state = s;
      this._changed();
    }

    // Broadcast the current state to all peers (host only).
    _broadcastState() {
      if (this.broadcastFn) this.broadcastFn({ t: 'state', s: this.state });
    }
    _broadcastEvent(ev) {
      if (this.broadcastFn) this.broadcastFn({ t: 'event', ev });
    }

    _log(msg) {
      this.state.log.push(msg);
      if (this.state.log.length > 40) this.state.log.shift();
    }

    // --- lobby management (host-side) --------------------------------------
    hostAddSelf(name) {
      this.state.players = [{
        id: 'p0', name: name || 'Ήρωας 1', isHost: true,
        classId: null, ready: false,
        hp: 0, maxHp: 0, gold: 0, items: [], alive: true
      }];
      this.state.phase = 'lobby';
      this._changed();
    }
    hostAddRemote(name) {
      // Pick first free pX id (p1, p2, …) so removed slots can be reused.
      const used = new Set(this.state.players.map(p => p.id));
      let id = null;
      for (let i = 1; i < 8; i++) {
        if (!used.has('p' + i)) { id = 'p' + i; break; }
      }
      if (!id) return null;
      const p = {
        id, name: name || ('Ήρωας ' + (this.state.players.length + 1)), isHost: false,
        classId: null, ready: false,
        hp: 0, maxHp: 0, gold: 0, items: [], alive: true
      };
      this.state.players.push(p);
      this._log(`Ο ${p.name} συνδέθηκε.`);
      this._broadcastState();
      this._changed();
      return id;
    }
    hostRemoveRemote(id) {
      const p = this.state.players.find(x => x.id === id);
      if (!p) return;
      this.state.players = this.state.players.filter(x => x.id !== id);
      this._log(`Ο ${p.name} αποσυνδέθηκε.`);
      this._broadcastState();
      this._changed();
    }

    // --- entrypoint: an action came in from a player -----------------------
    // Host validates and applies; clients should never call this directly.
    applyAction(action, fromId) {
      if (!this.isHost) return; // safety
      const p = this.state.players.find(x => x.id === fromId);
      if (!p) return;

      switch (action.type) {
        case 'setName':     this._actSetName(p, action); break;
        case 'pickClass':   this._actPickClass(p, action); break;
        case 'classReady':  this._actClassReady(p); break;
        case 'startAdventure': if (p.isHost) this._actStartAdventure(); break;
        case 'move':        this._actMove(p, action); break;
        case 'usePotionOverworld': this._actUsePotionOverworld(p); break;
        case 'attack':      this._actAttack(p, action); break;
        case 'useItem':     this._actUseItem(p, action); break;
        case 'flee':        this._actFlee(p); break;
        case 'eventChoice': this._actEventChoice(p, action); break;
        case 'eventDismiss': this._actEventDismiss(p); break;
        case 'restartFromMenu': if (p.isHost) this._actRestart(); break;
      }
      this._broadcastState();
      this._changed();
    }

    // --- lobby actions -----------------------------------------------------
    _actSetName(p, action) {
      if (typeof action.name === 'string' && action.name.trim()) {
        p.name = action.name.trim().slice(0, 16);
      }
    }
    _actPickClass(p, action) {
      if (this.state.phase !== 'class-select') return;
      const cid = action.classId;
      if (!CLASSES[cid]) return;
      // No two players may share a class.
      if (this.state.players.some(o => o !== p && o.classId === cid)) return;
      p.classId = cid;
      p.ready = false;
    }
    _actClassReady(p) {
      if (this.state.phase !== 'class-select') return;
      if (!p.classId) return;
      p.ready = true;
      // Apply class stats now.
      const c = CLASSES[p.classId];
      p.maxHp = c.maxHp;
      p.hp = c.maxHp;
      p.items = deepClone(c.startItems || []);
      // Auto-start when all players ready and at least one is ready.
      if (this.state.players.every(o => o.classId && o.ready)) {
        this._actStartAdventure();
      }
    }
    _actStartAdventure() {
      if (this.state.phase !== 'class-select') return;
      for (const o of this.state.players) {
        if (!o.classId) return;
        const c = CLASSES[o.classId];
        o.maxHp = c.maxHp;
        o.hp = c.maxHp;
        o.items = deepClone(c.startItems || []);
        o.alive = true;
        o.gold = 0;
      }
      this.state.map = this._generateMap();
      this.state.party = { x: 0, y: 0 };
      this.state.activeIdx = 0;
      this.state.round = 1;
      this.state.phase = 'overworld';
      this._log('Η αναζήτηση ξεκινά!');
    }

    // --- map generation ----------------------------------------------------
    _generateMap() {
      const tiles = [];
      const total = MAP_W * MAP_H;
      // Fill non-corner tiles with a weighted mix, then shuffle.
      const fillerTypes = [];
      const otherCount = total - 2; // minus start + boss
      // Guarantee at least 2 villages for healing.
      fillerTypes.push('village', 'village');
      for (let i = 0; i < otherCount - 2; i++) {
        const r = Math.random();
        if (r < 0.45)      fillerTypes.push('combat');
        else if (r < 0.65) fillerTypes.push('treasure');
        else if (r < 0.75) fillerTypes.push('village');
        else               fillerTypes.push('empty');
      }
      const mixed = shuffle(fillerTypes);

      let fi = 0;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          let t;
          if (x === 0 && y === 0) t = { type: 'start',   discovered: true,  cleared: true };
          else if (x === MAP_W - 1 && y === MAP_H - 1) t = { type: 'boss', discovered: false, cleared: false };
          else {
            const type = mixed[fi++];
            t = { type, discovered: false, cleared: false };
            if (type === 'combat') t.enemies = pick(ENCOUNTERS);
            if (type === 'treasure') t.loot = { gold: 5 + rand(8), item: Math.random() < 0.5 ? 'potion' : (Math.random() < 0.5 ? 'bomb' : null) };
          }
          tiles.push(t);
        }
      }
      return { w: MAP_W, h: MAP_H, tiles };
    }
    _tileAt(x, y) {
      if (x < 0 || y < 0 || x >= this.state.map.w || y >= this.state.map.h) return null;
      return this.state.map.tiles[y * this.state.map.w + x];
    }

    // --- overworld ---------------------------------------------------------
    _activePlayer() {
      return this.state.players[this.state.activeIdx];
    }
    _isAliveAny() {
      return this.state.players.some(p => p.alive && p.hp > 0);
    }
    _nextActive() {
      const n = this.state.players.length;
      const oldIdx = this.state.activeIdx;
      for (let i = 1; i <= n; i++) {
        const idx = (oldIdx + i) % n;
        const pp = this.state.players[idx];
        if (pp.alive && pp.hp > 0) {
          this.state.activeIdx = idx;
          if (idx <= oldIdx) this.state.round += 1;
          return;
        }
      }
      // No-one alive — defeat handled elsewhere.
    }
    _actMove(p, action) {
      if (this.state.phase !== 'overworld') return;
      if (this._activePlayer().id !== p.id) return;
      const { x, y } = action;
      const dx = Math.abs(x - this.state.party.x);
      const dy = Math.abs(y - this.state.party.y);
      if (dx + dy !== 1) return;            // only orthogonal neighbours
      const tile = this._tileAt(x, y);
      if (!tile) return;

      this.state.party = { x, y };
      tile.discovered = true;
      this._log(`${p.name} → (${x},${y})`);

      // Resolve tile content if not yet cleared.
      if (!tile.cleared) {
        switch (tile.type) {
          case 'combat':
            this._startCombat(tile, false);
            return; // phase changed, don't advance turn
          case 'boss':
            this._startCombat(tile, true);
            return;
          case 'village':
            this._enterEvent({
              kind: 'village',
              title: 'Χωριό',
              text: 'Φιλόξενοι χωρικοί προσφέρουν ξεκούραση. Όλη η ομάδα ανακτά πλήρη υγεία.',
              effect: { healAll: true }
            });
            tile.cleared = true;
            return;
          case 'treasure':
            this._enterEvent({
              kind: 'treasure',
              title: 'Θησαυρός!',
              text: `Βρήκατε ${tile.loot.gold} χρυσά${tile.loot.item ? ` και ${ITEMS[tile.loot.item].icon} ${ITEMS[tile.loot.item].name}!` : '.'}`,
              effect: { gold: tile.loot.gold, item: tile.loot.item }
            });
            tile.cleared = true;
            return;
          case 'empty':
            tile.cleared = true;
            break;
        }
      }
      this._nextActive();
    }
    _actUsePotionOverworld(p) {
      if (this.state.phase !== 'overworld') return;
      if (this._activePlayer().id !== p.id) return;
      const it = p.items.find(i => i.type === 'potion' && i.count > 0);
      if (!it) return;
      if (p.hp >= p.maxHp) return;
      it.count -= 1;
      p.items = p.items.filter(i => i.count > 0);
      const heal = Math.min(POTION_HEAL, p.maxHp - p.hp);
      p.hp += heal;
      this._log(`${p.name} πίνει φίλτρο (+${heal} HP).`);
      this._nextActive();
    }

    // --- events (village / treasure) ---------------------------------------
    _enterEvent(ev) {
      this.state.event = ev;
      this.state.phase = 'event';
    }
    _actEventDismiss(p) {
      if (this.state.phase !== 'event') return;
      if (this._activePlayer().id !== p.id && !p.isHost) return;
      const ev = this.state.event;
      if (ev.effect) {
        if (ev.effect.healAll) {
          for (const o of this.state.players) {
            if (o.alive) { o.hp = o.maxHp; }
          }
          this._log('Η ομάδα θεραπεύεται πλήρως.');
        }
        if (ev.effect.gold) {
          const ap = this._activePlayer();
          ap.gold += ev.effect.gold;
          this._log(`${ap.name} +${ev.effect.gold} χρυσά.`);
        }
        if (ev.effect.item) {
          const ap = this._activePlayer();
          const existing = ap.items.find(i => i.type === ev.effect.item);
          if (existing) existing.count += 1;
          else ap.items.push({ type: ev.effect.item, count: 1 });
          this._log(`${ap.name} παίρνει ${ITEMS[ev.effect.item].name}.`);
        }
      }
      this.state.event = null;
      this.state.phase = 'overworld';
      this._nextActive();
    }
    _actEventChoice(/*p, action*/) { /* reserved for branching events */ }

    // --- combat ------------------------------------------------------------
    _startCombat(tile, isBoss) {
      const ids = isBoss ? BOSS_ENCOUNTER : tile.enemies;
      const enemies = ids.map((eid, i) => {
        const def = ENEMIES[eid];
        return { idx: i, type: eid, name: def.name, icon: def.icon, hp: def.maxHp, maxHp: def.maxHp, alive: true };
      });
      this.state.combat = {
        enemies,
        isBoss,
        // Explicit per-round queue: indexes still to act this round.
        turn: { side: 'players', idx: -1 },
        playerQueue: [],
        enemyQueue: [],
        tileRef: { x: this.state.party.x, y: this.state.party.y },
        prevTile: { x: this.state.party.x, y: this.state.party.y }
      };
      this.state.phase = 'combat';
      this.state.lastRoll = null;
      this._beginPlayersRound();
      this._log(`Μάχη! ${enemies.map(e => e.icon + e.name).join(', ')}`);
    }
    _beginPlayersRound() {
      const c = this.state.combat;
      c.playerQueue = [];
      for (let i = 0; i < this.state.players.length; i++) {
        const p = this.state.players[i];
        if (p.alive && p.hp > 0) c.playerQueue.push(i);
      }
      this._takeNextPlayer();
    }
    _beginEnemiesRound() {
      const c = this.state.combat;
      c.enemyQueue = [];
      for (let i = 0; i < c.enemies.length; i++) {
        if (c.enemies[i].alive && c.enemies[i].hp > 0) c.enemyQueue.push(i);
      }
      this._takeNextEnemy();
    }
    _takeNextPlayer() {
      const c = this.state.combat;
      // Skip dead players in the queue.
      while (c.playerQueue.length) {
        const idx = c.playerQueue[0];
        const p = this.state.players[idx];
        if (p && p.alive && p.hp > 0) {
          c.turn = { side: 'players', idx };
          return;
        }
        c.playerQueue.shift();
      }
      // No more players this round → enemies act.
      this._beginEnemiesRound();
    }
    _takeNextEnemy() {
      const c = this.state.combat;
      while (c.enemyQueue.length) {
        const idx = c.enemyQueue[0];
        const e = c.enemies[idx];
        if (e && e.alive && e.hp > 0) {
          c.turn = { side: 'enemies', idx };
          this._scheduleEnemyTick();
          return;
        }
        c.enemyQueue.shift();
      }
      // Round over → players again.
      this._beginPlayersRound();
    }
    _activeCombatActor() {
      return this.state.players[this.state.combat.turn.idx];
    }
    _aliveEnemies() {
      return this.state.combat.enemies.filter(e => e.alive && e.hp > 0);
    }
    _alivePlayers() {
      return this.state.players.filter(p => p.alive && p.hp > 0);
    }

    _rollAttackDice(attacker) {
      const c = CLASSES[attacker.classId];
      const dice = [];
      let hits = 0, dmg = 0, gotCrit = false;
      for (let i = 0; i < c.dice; i++) {
        const v = rollDie();
        dice.push(v);
        if (v >= c.hitOn) {
          hits += 1;
          dmg += c.dmgPerHit;
          if (v === c.crit) {
            dmg += c.critBonus;
            gotCrit = true;
          }
        }
      }
      return { dice, hits, dmg, gotCrit };
    }

    _actAttack(p, action) {
      if (this.state.phase !== 'combat') return;
      const c = this.state.combat;
      if (c.turn.side !== 'players' || this._activeCombatActor().id !== p.id) return;
      const targetIdx = action.enemyIdx;
      const target = c.enemies[targetIdx];
      if (!target || !target.alive) return;

      const result = this._rollAttackDice(p);
      this.state.lastRoll = {
        actor: p.id, target: 'e' + target.idx,
        dice: result.dice, hits: result.hits, dmg: result.dmg,
        hitOn: CLASSES[p.classId].hitOn, crit: CLASSES[p.classId].crit
      };

      const cls = CLASSES[p.classId];
      if (cls.aoeOnCrit && result.gotCrit) {
        // Mage splash: deal base damage to all alive enemies.
        for (const e of c.enemies) {
          if (!e.alive) continue;
          const dealt = (e === target) ? result.dmg : Math.max(1, Math.floor(result.dmg / 2));
          e.hp -= dealt;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; }
        }
        this._log(`${p.name} ρίχνει ξόρκι! ${result.dmg} ζημιά + splash.`);
      } else {
        target.hp -= result.dmg;
        if (target.hp <= 0) { target.hp = 0; target.alive = false; }
        this._log(`${p.name} χτυπά ${target.icon}${target.name} για ${result.dmg}.`);
      }

      this._endCombatActorTurn();
    }
    _actUseItem(p, action) {
      if (this.state.phase !== 'combat') return;
      const c = this.state.combat;
      if (c.turn.side !== 'players' || this._activeCombatActor().id !== p.id) return;
      const it = p.items.find(i => i.type === action.itemType && i.count > 0);
      if (!it) return;
      if (action.itemType === 'potion') {
        const heal = Math.min(POTION_HEAL, p.maxHp - p.hp);
        p.hp += heal;
        this._log(`${p.name} πίνει φίλτρο (+${heal} HP).`);
      } else if (action.itemType === 'bomb') {
        for (const e of c.enemies) {
          if (!e.alive) continue;
          e.hp -= BOMB_DAMAGE;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; }
        }
        this._log(`${p.name} ρίχνει βόμβα! ${BOMB_DAMAGE} σε όλους.`);
        this.state.lastRoll = { actor: p.id, target: 'all', dice: [], hits: 0, dmg: BOMB_DAMAGE, special: 'bomb' };
      }
      it.count -= 1;
      p.items = p.items.filter(i => i.count > 0);
      this._endCombatActorTurn();
    }
    _actFlee(p) {
      if (this.state.phase !== 'combat') return;
      const c = this.state.combat;
      if (c.turn.side !== 'players' || this._activeCombatActor().id !== p.id) return;
      if (c.isBoss) {
        this._log('Δεν μπορείτε να ξεφύγετε από τον δράκο!');
        this._endCombatActorTurn();
        return;
      }
      if (Math.random() < FLEE_CHANCE) {
        this._log(`${p.name} ξεφεύγει! Η ομάδα οπισθοχωρεί.`);
        // End combat without clearing the tile.
        this.state.phase = 'overworld';
        this.state.combat = null;
        this.state.lastRoll = null;
        // Retreat one tile back toward (0,0) along nearest axis.
        const px = this.state.party.x, py = this.state.party.y;
        if (px > 0) this.state.party.x = px - 1;
        else if (py > 0) this.state.party.y = py - 1;
        this._nextActive();
      } else {
        this._log(`${p.name} αποτυγχάνει να ξεφύγει.`);
        this._endCombatActorTurn();
      }
    }

    _endCombatActorTurn() {
      // Victory / defeat checks first.
      if (this._aliveEnemies().length === 0) { this._endCombatVictory(); return; }
      if (this._alivePlayers().length === 0) { this._endCombatDefeat(); return; }
      const c = this.state.combat;
      if (c.turn.side === 'players') {
        c.playerQueue.shift();
        this._takeNextPlayer();
      } else {
        c.enemyQueue.shift();
        this._takeNextEnemy();
      }
    }
    _scheduleEnemyTick() {
      // Defer to next tick + small delay so UI animates between enemy actions.
      setTimeout(() => {
        if (this.state.phase !== 'combat') return;
        this._enemyAct();
        this._broadcastState();
        this._changed();
      }, 900);
    }
    _enemyAct() {
      const c = this.state.combat;
      if (!c || c.turn.side !== 'enemies') return;
      const e = c.enemies[c.turn.idx];
      if (!e || !e.alive) { c.enemyQueue.shift(); this._takeNextEnemy(); return; }
      const def = ENEMIES[e.type];
      const targets = this._alivePlayers();
      if (targets.length === 0) { this._endCombatDefeat(); return; }
      const target = pick(targets);

      const dice = [];
      let hits = 0, dmg = 0;
      for (let i = 0; i < def.dice; i++) {
        const v = rollDie();
        dice.push(v);
        if (v >= def.hitOn) { hits += 1; dmg += def.dmg; }
      }
      target.hp -= dmg;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; this._log(`${target.name} πεθαίνει!`); }
      this.state.lastRoll = { actor: 'e' + e.idx, target: target.id, dice, hits, dmg, hitOn: def.hitOn };
      this._log(`${e.icon}${e.name} χτυπά ${target.name} για ${dmg}.`);

      if (this._alivePlayers().length === 0) { this._endCombatDefeat(); return; }
      c.enemyQueue.shift();
      this._takeNextEnemy();
    }

    _endCombatVictory() {
      const c = this.state.combat;
      const isBoss = c.isBoss;
      this._log(isBoss ? 'Ο Δράκος έπεσε! Νίκη!' : 'Νικήσατε!');
      // Loot.
      if (!isBoss) {
        const gold = 4 + rand(10);
        const ap = this._activeCombatActor();
        if (ap) { ap.gold += gold; this._log(`+${gold} χρυσά στον ${ap.name}.`); }
        if (Math.random() < 0.35) {
          const itm = Math.random() < 0.6 ? 'potion' : 'bomb';
          const target = ap;
          const existing = target.items.find(i => i.type === itm);
          if (existing) existing.count += 1;
          else target.items.push({ type: itm, count: 1 });
          this._log(`${target.name} βρίσκει ${ITEMS[itm].name}.`);
        }
      }
      // Clear tile.
      const tile = this._tileAt(c.tileRef.x, c.tileRef.y);
      if (tile) tile.cleared = true;
      this.state.combat = null;
      this.state.lastRoll = null;
      if (isBoss) {
        this.state.phase = 'victory';
      } else {
        this.state.phase = 'overworld';
        this._nextActive();
      }
    }
    _endCombatDefeat() {
      this._log('Η ομάδα ηττήθηκε…');
      this.state.combat = null;
      this.state.lastRoll = null;
      this.state.phase = 'gameover';
    }

    _actRestart() {
      const names = this.state.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost }));
      const log = [];
      this.state = this._initialState();
      this.state.players = names.map(n => ({
        id: n.id, name: n.name, isHost: n.isHost,
        classId: null, ready: false, hp: 0, maxHp: 0, gold: 0, items: [], alive: true
      }));
      this.state.phase = 'class-select';
      this._log('Νέα αναζήτηση ξεκινά.');
    }

    // Convenience for entering class-select from lobby.
    hostStartLobby() {
      if (this.state.phase !== 'lobby') return;
      if (this.state.players.length < 1) return;
      this.state.phase = 'class-select';
      this._broadcastState();
      this._changed();
    }
  }

  window.Game = Game;
})();
