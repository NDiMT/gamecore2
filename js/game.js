// Pure game-logic engine. Host owns the authoritative state; clients only
// render snapshots received over the wire.
(function () {
  'use strict';
  const {
    CLASSES, CLASS_ITEMS, ENEMIES, ENCOUNTERS, BOSS_ENCOUNTER, ITEMS,
    XP_FOR_LEVEL, MAX_LEVEL, QUEST_POOL
  } = window.DATA;
  const { rand, pick, rollDie, shuffle, deepClone } = window.U;

  const MAP_W = 14;
  const MAP_H = 10;
  const POTION_HEAL = 14;
  const BOMB_DAMAGE = 6;
  const FLEE_CHANCE = 0.55;
  const CLASS_ITEM_DROP_CHANCE = 0.035;

  class Game {
    constructor() {
      this.isHost = true;
      this.myId = 'p0';
      this.state = this._initialState();
      this.listeners = [];
      this.broadcastFn = null;
    }

    _initialState() {
      return {
        phase: 'menu',
        players: [],
        hostId: 'p0',
        map: null,
        activeIdx: 0,
        round: 1,
        combat: null,
        event: null,
        quests: [],
        log: [],
        lastRoll: null
      };
    }

    subscribe(fn) { this.listeners.push(fn); }
    _changed() { for (const fn of this.listeners) fn(); }

    setState(s) { this.state = s; this._changed(); }
    _broadcastState() { if (this.broadcastFn) this.broadcastFn({ t: 'state', s: this.state }); }
    _log(msg) {
      this.state.log.push(msg);
      if (this.state.log.length > 50) this.state.log.shift();
    }

    // ---- lobby management -------------------------------------------------
    _blankPlayer(id, name, isHost, isLocal) {
      return {
        id, name, isHost: !!isHost, isLocal: !!isLocal,
        classId: null, ready: false,
        hp: 0, maxHp: 0, gold: 0, items: [], alive: true,
        x: 0, y: 0,
        xp: 0, level: 1,
        bonusDice: 0, bonusHit: 0, bonusDmg: 0,
        classItem: null, classItemStacks: 0
      };
    }
    hostAddSelf(name) {
      this.state.players = [this._blankPlayer('p0', name || 'Hero 1', true, true)];
      this.state.phase = 'lobby';
      this._changed();
    }
    hostAddRemote(name) {
      const used = new Set(this.state.players.map(p => p.id));
      let id = null;
      for (let i = 1; i < 8; i++) if (!used.has('p' + i)) { id = 'p' + i; break; }
      if (!id) return null;
      const p = this._blankPlayer(id, name || ('Hero ' + (this.state.players.length + 1)), false, false);
      this.state.players.push(p);
      this._log(`${p.name} joined.`);
      this._broadcastState();
      this._changed();
      return id;
    }
    hostRemoveRemote(id) {
      const p = this.state.players.find(x => x.id === id);
      if (!p) return;
      this.state.players = this.state.players.filter(x => x.id !== id);
      this._log(`${p.name} disconnected.`);
      this._broadcastState();
      this._changed();
    }

    applyAction(action, fromId) {
      if (!this.isHost) return;
      const p = this.state.players.find(x => x.id === fromId);
      if (!p) return;
      switch (action.type) {
        case 'setName':            this._actSetName(p, action); break;
        case 'pickClass':          this._actPickClass(p, action); break;
        case 'classReady':         this._actClassReady(p); break;
        case 'startAdventure':     if (p.isHost) this._actStartAdventure(); break;
        case 'move':               this._actMove(p, action); break;
        case 'usePotionOverworld': this._actUsePotionOverworld(p); break;
        case 'attack':             this._actAttack(p, action); break;
        case 'useItem':            this._actUseItem(p, action); break;
        case 'flee':               this._actFlee(p); break;
        case 'eventDismiss':       this._actEventDismiss(p); break;
        case 'restartFromMenu':    if (p.isHost) this._actRestart(); break;
      }
      this._broadcastState();
      this._changed();
    }

    _actSetName(p, action) {
      if (typeof action.name === 'string' && action.name.trim()) {
        p.name = action.name.trim().slice(0, 16);
      }
    }
    _actPickClass(p, action) {
      if (this.state.phase !== 'class-select') return;
      const cid = action.classId;
      if (!CLASSES[cid]) return;
      if (this.state.players.some(o => o !== p && o.classId === cid)) return;
      p.classId = cid;
      p.ready = false;
    }
    _actClassReady(p) {
      if (this.state.phase !== 'class-select') return;
      if (!p.classId) return;
      p.ready = true;
      const c = CLASSES[p.classId];
      p.maxHp = c.maxHp;
      p.hp = c.maxHp;
      p.items = deepClone(c.startItems || []);
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
        o.xp = 0;
        o.level = 1;
        o.bonusDice = 0; o.bonusHit = 0; o.bonusDmg = 0;
        o.classItem = null; o.classItemStacks = 0;
      }
      this.state.map = this._generateMap();
      const start = this._findStart();
      // All players spawn on the start tile; they'll diverge as they move.
      for (const o of this.state.players) {
        o.x = start.x; o.y = start.y;
      }
      this.state.map.tiles[start.y * MAP_W + start.x].discovered = true;
      this.state.map.tiles[start.y * MAP_W + start.x].cleared = true;
      this.state.activeIdx = 0;
      this.state.round = 1;
      this.state.quests = this._generateQuests();
      this.state.phase = 'overworld';
      this._log('The quest begins!');
    }

    // ---- quest generation -------------------------------------------------
    _generateQuests() {
      const pool = QUEST_POOL.slice();
      shuffle(pool);
      const picks = pool.slice(0, 3);
      return picks.map((q, i) => ({
        id: 'q' + i,
        type: q.type,
        enemy: q.enemy,
        target: q.count,
        progress: 0,
        reward: q.reward,
        text: typeof q.text === 'function' ? q.text(q) : q.text,
        complete: false
      }));
    }
    _trackQuest(type, value, payload) {
      // value = count to add (usually 1); payload may include enemy type or gold amount.
      for (const q of this.state.quests) {
        if (q.complete) continue;
        if (q.type !== type) continue;
        if (q.type === 'kill' && payload && payload.enemy !== q.enemy) continue;
        q.progress += value;
        if (q.progress >= q.target) {
          q.progress = q.target;
          q.complete = true;
          this._giveQuestReward(q);
        }
      }
    }
    _giveQuestReward(quest) {
      // Reward goes to the active player.
      const ap = this._activePlayer() || this.state.players[0];
      if (!ap) return;
      this._log(`✦ Quest complete: ${quest.text}`);
      if (quest.reward) {
        if (quest.reward.gold) {
          ap.gold += quest.reward.gold;
          this._log(`  +${quest.reward.gold} gold to ${ap.name}.`);
        }
        if (quest.reward.item) {
          this._giveItem(ap, quest.reward.item);
        }
      }
    }

    // ---- map generation ---------------------------------------------------
    _generateMap() {
      const tiles = [];
      const smoothed = new Array(MAP_W * MAP_H);
      const noise = new Array(MAP_W * MAP_H);
      for (let i = 0; i < noise.length; i++) noise[i] = Math.random();
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            let s = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
                s += noise[ny * MAP_W + nx]; n += 1;
              }
            }
            smoothed[y * MAP_W + x] = s / n;
          }
        }
        for (let i = 0; i < noise.length; i++) noise[i] = smoothed[i];
      }
      const terrainAt = (x, y) => {
        const v = smoothed[y * MAP_W + x];
        if (v < 0.32) return 'water';
        if (v < 0.40) return 'sand';
        if (v < 0.58) return 'grass';
        if (v < 0.72) return 'forest';
        return 'hills';
      };
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          tiles.push({
            terrain: terrainAt(x, y),
            feature: null, discovered: false, cleared: false,
            enemies: null, loot: null
          });
        }
      }
      const bossX = MAP_W - 2, bossY = 1;
      tiles[bossY * MAP_W + bossX] = {
        terrain: 'hills', feature: 'lair', discovered: false, cleared: false, enemies: null, loot: null
      };
      for (let y = MAP_H - 3; y < MAP_H; y++) {
        for (let x = 0; x < 3; x++) {
          const t = tiles[y * MAP_W + x];
          if (t.terrain === 'water') t.terrain = 'sand';
        }
      }
      const features = [];
      for (let i = 0; i < 3; i++) features.push('village');
      for (let i = 0; i < 5; i++) features.push('chest');
      for (let i = 0; i < 3; i++) features.push('ruins');
      const placeFeature = (f) => {
        for (let tries = 0; tries < 60; tries++) {
          const x = rand(MAP_W);
          const y = rand(MAP_H);
          const t = tiles[y * MAP_W + x];
          if (t.feature || t.terrain === 'water' || (x === bossX && y === bossY)) continue;
          if (x < 2 && y > MAP_H - 3) continue;
          t.feature = f;
          if (f === 'chest') t.loot = { gold: 6 + rand(10), item: Math.random() < 0.6 ? 'potion' : (Math.random() < 0.5 ? 'bomb' : null) };
          return true;
        }
        return false;
      };
      for (const f of features) placeFeature(f);
      const walkable = [];
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const t = tiles[y * MAP_W + x];
          if (t.terrain === 'water' || t.feature) continue;
          if (x < 2 && y > MAP_H - 3) continue;
          if (x === bossX && y === bossY) continue;
          walkable.push([x, y]);
        }
      }
      shuffle(walkable);
      const combatCount = Math.floor(walkable.length * 0.22);
      for (let i = 0; i < combatCount; i++) {
        const [x, y] = walkable[i];
        tiles[y * MAP_W + x].enemies = pick(ENCOUNTERS);
      }
      return { w: MAP_W, h: MAP_H, tiles };
    }
    _findStart() {
      for (let y = MAP_H - 1; y >= 0; y--) {
        for (let x = 0; x < MAP_W; x++) {
          const t = this.state.map.tiles[y * MAP_W + x];
          if (t.terrain !== 'water' && !t.feature && !t.enemies) return { x, y };
        }
      }
      return { x: 0, y: MAP_H - 1 };
    }
    _tileAt(x, y) {
      if (!this.state.map) return null;
      if (x < 0 || y < 0 || x >= this.state.map.w || y >= this.state.map.h) return null;
      return this.state.map.tiles[y * this.state.map.w + x];
    }

    // ---- overworld --------------------------------------------------------
    _activePlayer() { return this.state.players[this.state.activeIdx]; }
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
    }
    _actMove(p, action) {
      if (this.state.phase !== 'overworld') return;
      if (this._activePlayer().id !== p.id) return;
      const { x, y } = action;
      const dx = Math.abs(x - p.x);
      const dy = Math.abs(y - p.y);
      if (dx + dy !== 1) return;
      const tile = this._tileAt(x, y);
      if (!tile) return;
      if (tile.terrain === 'water') return;

      p.x = x; p.y = y;
      tile.discovered = true;
      this._log(`${p.name} → (${x},${y})`);

      if (!tile.cleared) {
        if (tile.feature === 'lair') { this._startCombat(tile, true, p); return; }
        if (tile.enemies) { this._startCombat(tile, false, p); return; }
        if (tile.feature === 'village') {
          this._enterEvent({
            kind: 'village', title: 'Village',
            text: 'Friendly villagers welcome the party. Everyone rests and recovers to full health.',
            effect: { healAll: true, quest: 'village' }
          });
          tile.cleared = true;
          return;
        }
        if (tile.feature === 'chest') {
          const loot = tile.loot || { gold: 5, item: null };
          this._enterEvent({
            kind: 'chest', title: 'Treasure!',
            text: `You found ${loot.gold} gold` + (loot.item ? ` and a ${ITEMS[loot.item].name} ${ITEMS[loot.item].icon}.` : '.'),
            effect: { gold: loot.gold, item: loot.item, quest: 'treasure' }
          });
          tile.cleared = true;
          return;
        }
        if (tile.feature === 'ruins') {
          if (Math.random() < 0.5) {
            const gold = 3 + rand(6);
            this._enterEvent({
              kind: 'ruins', title: 'Ancient Ruins',
              text: `You scavenge ${gold} gold among the stones.`,
              effect: { gold }
            });
          } else {
            this._enterEvent({
              kind: 'ruins', title: 'Ancient Ruins',
              text: 'A trap! The active hero takes 4 damage.',
              effect: { damage: 4 }
            });
          }
          tile.cleared = true;
          return;
        }
        tile.cleared = true;
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
      this._log(`${p.name} drinks a potion (+${heal} HP).`);
      this._nextActive();
    }

    // ---- events -----------------------------------------------------------
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
            if (o.alive) o.hp = o.maxHp;
          }
          this._log('The party is fully healed.');
        }
        if (ev.effect.gold) {
          const ap = this._activePlayer();
          ap.gold += ev.effect.gold;
          this._log(`${ap.name} +${ev.effect.gold} gold.`);
          this._trackQuest('gold', ev.effect.gold);
        }
        if (ev.effect.item) {
          this._giveItem(this._activePlayer(), ev.effect.item);
        }
        if (ev.effect.damage) {
          const ap = this._activePlayer();
          ap.hp -= ev.effect.damage;
          if (ap.hp <= 0) { ap.hp = 0; ap.alive = false; this._log(`${ap.name} died!`); }
          else this._log(`${ap.name} takes ${ev.effect.damage} damage.`);
        }
        if (ev.effect.quest) this._trackQuest(ev.effect.quest, 1);
      }
      this.state.event = null;
      this.state.phase = 'overworld';
      if (!this._alivePlayers().length) { this.state.phase = 'gameover'; return; }
      this._nextActive();
    }

    _giveItem(player, itemType) {
      if (!player || !itemType) return;
      const existing = player.items.find(i => i.type === itemType);
      if (existing) existing.count += 1;
      else player.items.push({ type: itemType, count: 1 });
      const it = ITEMS[itemType];
      this._log(`${player.name} picks up ${it ? it.name : itemType}.`);
    }

    // ---- combat -----------------------------------------------------------
    _startCombat(tile, isBoss, initiator) {
      const ids = isBoss ? BOSS_ENCOUNTER : tile.enemies;
      const enemies = ids.map((eid, i) => {
        const def = ENEMIES[eid];
        return { idx: i, type: eid, name: def.name, icon: def.icon, hp: def.maxHp, maxHp: def.maxHp, alive: true };
      });
      this.state.combat = {
        enemies, isBoss,
        turn: { side: 'players', idx: -1 },
        playerQueue: [],
        enemyQueue: [],
        tileRef: { x: initiator.x, y: initiator.y },
        prevTile: { x: initiator.x, y: initiator.y }
      };
      this.state.phase = 'combat';
      this.state.lastRoll = null;
      this._beginPlayersRound();
      this._log(`Battle! ${enemies.map(e => e.icon + e.name).join(', ')}`);
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
      while (c.playerQueue.length) {
        const idx = c.playerQueue[0];
        const p = this.state.players[idx];
        if (p && p.alive && p.hp > 0) { c.turn = { side: 'players', idx }; return; }
        c.playerQueue.shift();
      }
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
      this._beginPlayersRound();
    }
    _activeCombatActor() { return this.state.players[this.state.combat.turn.idx]; }
    _aliveEnemies() { return this.state.combat.enemies.filter(e => e.alive && e.hp > 0); }
    _alivePlayers() { return this.state.players.filter(p => p.alive && p.hp > 0); }

    _rollAttackDice(attacker) {
      const c = CLASSES[attacker.classId];
      const dice = [];
      let dmg = 0, gotCrit = false;
      const total = c.dice + (attacker.bonusDice || 0);
      const hitOn = Math.max(2, c.hitOn - (attacker.bonusHit || 0));
      const dmgPerHit = c.dmgPerHit + (attacker.bonusDmg || 0);
      for (let i = 0; i < total; i++) {
        const v = rollDie();
        dice.push(v);
        if (v >= hitOn) {
          dmg += dmgPerHit;
          if (v === c.crit) { dmg += c.critBonus; gotCrit = true; }
        }
      }
      return { dice, dmg, gotCrit, hitOn };
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
        dice: result.dice, dmg: result.dmg,
        hitOn: result.hitOn, crit: CLASSES[p.classId].crit,
        ts: Date.now()
      };
      const cls = CLASSES[p.classId];
      const killed = [];
      if (cls.aoeOnCrit && result.gotCrit) {
        for (const e of c.enemies) {
          if (!e.alive) continue;
          const dealt = (e === target) ? result.dmg : Math.max(1, Math.floor(result.dmg / 2));
          e.hp -= dealt;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; killed.push(e); }
        }
        this._log(`${p.name} casts a spell! ${result.dmg} dmg + splash.`);
      } else {
        target.hp -= result.dmg;
        if (target.hp <= 0) { target.hp = 0; target.alive = false; killed.push(target); }
        this._log(`${p.name} hits ${target.icon}${target.name} for ${result.dmg}.`);
      }
      for (const e of killed) this._onEnemyKilled(e, p);
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
        this._log(`${p.name} drinks a potion (+${heal} HP).`);
        this.state.lastRoll = { actor: p.id, target: p.id, dice: [], dmg: 0, special: 'heal', ts: Date.now() };
      } else if (action.itemType === 'bomb') {
        const killed = [];
        for (const e of c.enemies) {
          if (!e.alive) continue;
          e.hp -= BOMB_DAMAGE;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; killed.push(e); }
        }
        for (const e of killed) this._onEnemyKilled(e, p);
        this._log(`${p.name} throws a bomb! ${BOMB_DAMAGE} to all.`);
        this.state.lastRoll = { actor: p.id, target: 'all', dice: [], dmg: BOMB_DAMAGE, special: 'bomb', ts: Date.now() };
      }
      it.count -= 1;
      p.items = p.items.filter(i => i.count > 0);
      this._endCombatActorTurn();
    }
    _actFlee(p) {
      if (this.state.phase !== 'combat') return;
      const c = this.state.combat;
      if (c.turn.side !== 'players' || this._activeCombatActor().id !== p.id) return;
      if (c.isBoss) { this._log("You can't flee from the dragon!"); this._endCombatActorTurn(); return; }
      if (Math.random() < FLEE_CHANCE) {
        this._log(`${p.name} flees! The party scatters.`);
        this.state.phase = 'overworld';
        this.state.combat = null;
        this.state.lastRoll = null;
        // The initiator retreats one walkable tile back.
        const px = p.x, py = p.y;
        const candidates = [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]
          .filter(([x,y]) => { const t = this._tileAt(x, y); return t && t.terrain !== 'water'; });
        if (candidates.length) {
          const [nx, ny] = candidates[0];
          p.x = nx; p.y = ny;
        }
        this._nextActive();
      } else {
        this._log(`${p.name} fails to escape.`);
        this._endCombatActorTurn();
      }
    }

    _endCombatActorTurn() {
      if (this._aliveEnemies().length === 0) { this._endCombatVictory(); return; }
      if (this._alivePlayers().length === 0) { this._endCombatDefeat(); return; }
      const c = this.state.combat;
      if (c.turn.side === 'players') { c.playerQueue.shift(); this._takeNextPlayer(); }
      else { c.enemyQueue.shift(); this._takeNextEnemy(); }
    }
    _scheduleEnemyTick() {
      setTimeout(() => {
        if (this.state.phase !== 'combat') return;
        this._enemyAct();
        this._broadcastState();
        this._changed();
      }, 1000);
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
      let dmg = 0;
      for (let i = 0; i < def.dice; i++) {
        const v = rollDie(); dice.push(v);
        if (v >= def.hitOn) dmg += def.dmg;
      }
      target.hp -= dmg;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; this._log(`${target.name} fell!`); }
      this.state.lastRoll = { actor: 'e' + e.idx, target: target.id, dice, dmg, hitOn: def.hitOn, ts: Date.now() };
      this._log(`${e.icon}${e.name} hits ${target.name} for ${dmg}.`);
      if (this._alivePlayers().length === 0) { this._endCombatDefeat(); return; }
      c.enemyQueue.shift();
      this._takeNextEnemy();
    }

    // ---- progression / loot ----------------------------------------------
    _onEnemyKilled(enemy, killer) {
      const def = ENEMIES[enemy.type];
      if (!def) return;
      this._gainXP(killer, def.xp || 0);
      this._dropLoot(enemy.type, killer);
      this._trackQuest('kill', 1, { enemy: enemy.type });
    }
    _gainXP(player, amount) {
      if (!amount) return;
      player.xp = (player.xp || 0) + amount;
      while (player.level < MAX_LEVEL && player.xp >= XP_FOR_LEVEL[player.level + 1]) {
        player.level += 1;
        player.maxHp += 5;
        player.hp = Math.min(player.hp + 5, player.maxHp);
        this._log(`★ ${player.name} reached level ${player.level}! +5 max HP`);
        // Bonus die at even levels.
        if (player.level % 2 === 0) {
          player.bonusDice = (player.bonusDice || 0) + 1;
          this._log(`  +1 attack die for ${player.name}`);
        }
      }
    }
    _dropLoot(enemyType, killer) {
      const def = ENEMIES[enemyType];
      if (!def || !def.loot) return;
      const tbl = def.loot;
      if (tbl.gold) {
        const [lo, hi] = tbl.gold;
        const gold = lo + rand(hi - lo + 1);
        killer.gold += gold;
        this._log(`  ${killer.name} +${gold} gold`);
        this._trackQuest('gold', gold);
      }
      if (tbl.potion && Math.random() < tbl.potion) this._giveItem(killer, 'potion');
      if (tbl.bomb && Math.random() < tbl.bomb)   this._giveItem(killer, 'bomb');
      // Class item drop.
      const dropClassItem = def.classItemGuaranteed || Math.random() < CLASS_ITEM_DROP_CHANCE;
      if (dropClassItem) this._dropClassItem(killer);
    }
    _dropClassItem(player) {
      const ci = CLASS_ITEMS[player.classId];
      if (!ci) return;
      player.classItem = ci.id;
      player.classItemStacks = (player.classItemStacks || 0) + 1;
      // Apply effect.
      if (ci.effect === 'bonusDice') player.bonusDice = (player.bonusDice || 0) + ci.value;
      if (ci.effect === 'bonusDmg')  player.bonusDmg  = (player.bonusDmg  || 0) + ci.value;
      if (ci.effect === 'bonusHit')  player.bonusHit  = (player.bonusHit  || 0) + ci.value;
      this._log(`✦ ${player.name} obtained ${ci.icon} ${ci.name}!`);
    }

    _endCombatVictory() {
      const c = this.state.combat;
      const isBoss = c.isBoss;
      this._log(isBoss ? 'The dragon falls! Victory!' : 'Victory!');
      // (Loot drops happen per-enemy at kill time; no extra reward here.)
      const tile = this._tileAt(c.tileRef.x, c.tileRef.y);
      if (tile) tile.cleared = true;
      this.state.combat = null;
      this.state.lastRoll = null;
      if (isBoss) this.state.phase = 'victory';
      else { this.state.phase = 'overworld'; this._nextActive(); }
    }
    _endCombatDefeat() {
      this._log('The party has fallen…');
      this.state.combat = null;
      this.state.lastRoll = null;
      this.state.phase = 'gameover';
    }

    _actRestart() {
      const names = this.state.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, isLocal: p.isLocal }));
      this.state = this._initialState();
      this.state.players = names.map(n => this._blankPlayer(n.id, n.name, n.isHost, n.isLocal));
      this.state.phase = 'class-select';
      this._log('A new quest begins.');
    }

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
