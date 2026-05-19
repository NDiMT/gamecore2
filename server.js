// Co-op turn-based RPG server.
// Static file server + WebSocket protocol with authoritative game state.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const {
  CLASSES, ITEMS, ENEMIES, EVENTS,
  rng, rollDie, rollMany,
  generateMap, neighborsOffset, tilesWithinRange,
  randomEncounter, generateShopStock,
} = require('./gamedata');

const PORT = process.env.PORT || 3000;
const SAVE_DIR = path.join(__dirname, 'saves');
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR);

// --- Static HTTP server ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const file = path.join(__dirname, 'public', url);
  const safe = path.normalize(file);
  if (!safe.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(safe, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(safe);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// --- State ---
const rooms = new Map(); // code -> room

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload = {}) {
  for (const p of room.players) send(p.ws, type, payload);
}

// --- Game logic ---

function createRoom(hostName, hostWs) {
  const code = genCode();
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const room = {
    code,
    phase: 'lobby', // lobby | overworld | combat | event | shop | victory | defeat
    seed,
    rand: rng(seed),
    players: [],
    hostId: null,
    map: null,
    activeIdx: 0,         // whose overworld turn
    round: 1,
    log: [],
    pendingMoves: 0,      // current player's remaining moves
    pendingMoveTiles: [], // reachable tiles cached for client
    combat: null,
    event: null,
    shop: null,
    lastInteract: Date.now(),
  };
  rooms.set(code, room);
  const player = addPlayer(room, hostName, hostWs);
  room.hostId = player.id;
  return room;
}

function addPlayer(room, name, ws) {
  if (room.players.length >= 4) throw new Error('room full');
  if (room.phase !== 'lobby') throw new Error('game in progress');
  const id = Math.random().toString(36).slice(2, 10);
  const player = {
    id, name: name.slice(0, 16) || `Player${room.players.length + 1}`, ws,
    classId: null, ready: false,
    stats: null, equip: { weapon: null, armor: null },
    inventory: [], gold: 30, focus: 2, hp: 0, maxHp: 0,
    pos: { q: 0, r: 0 }, alive: true, xp: 0,
  };
  room.players.push(player);
  return player;
}

function logMsg(room, msg) {
  room.log.push(msg);
  if (room.log.length > 80) room.log.shift();
}

function computeStats(player) {
  const cls = CLASSES[player.classId];
  const s = { ...cls.baseStats };
  for (const slot of ['weapon', 'armor']) {
    const id = player.equip[slot];
    if (!id) continue;
    const it = ITEMS[id];
    for (const k of ['atk', 'def', 'spd', 'mag']) if (it[k]) s[k] += it[k];
  }
  player.stats = s;
  player.maxHp = s.hp;
  return s;
}

function startGame(room) {
  if (room.phase !== 'lobby') return;
  if (room.players.length < 1) return;
  if (!room.players.every(p => p.classId)) return;
  room.map = generateMap(room.rand);
  for (const p of room.players) {
    const cls = CLASSES[p.classId];
    p.equip.weapon = cls.startWeapon;
    p.equip.armor = cls.startArmor;
    computeStats(p);
    p.hp = p.maxHp;
    p.pos = { q: 0, r: 0 };
    p.inventory = [{ id: 'potion' }, { id: 'potion' }];
    p.focus = 2;
  }
  // Mark start tile explored
  const start = room.map.tiles.find(t => t.q === 0 && t.r === 0);
  start.explored = true;
  room.phase = 'overworld';
  room.activeIdx = 0;
  room.round = 1;
  logMsg(room, `Adventure begins! ${room.players[0].name}'s turn.`);
  startOverworldTurn(room);
}

function startOverworldTurn(room) {
  const p = room.players[room.activeIdx];
  if (!p.alive) {
    // Skip dead players (could revive in shop)
    advanceTurn(room);
    return;
  }
  // Movement = 1d6 capped 1..4 to keep map traversal reasonable
  const roll = rollDie(room.rand);
  const moves = Math.min(4, Math.max(1, Math.ceil(roll / 2)));
  room.pendingMoves = moves;
  const reach = tilesWithinRange(room.map, p.pos.q, p.pos.r, moves);
  room.pendingMoveTiles = reach;
  logMsg(room, `${p.name} rolled ${roll}, can move up to ${moves}.`);
}

function advanceTurn(room) {
  room.activeIdx = (room.activeIdx + 1) % room.players.length;
  if (room.activeIdx === 0) room.round++;
  // If all players dead, defeat
  if (!room.players.some(p => p.alive)) {
    room.phase = 'defeat';
    logMsg(room, `The party has fallen. Game over.`);
    return;
  }
  startOverworldTurn(room);
}

function movePlayer(room, playerId, q, r) {
  if (room.phase !== 'overworld') return;
  const p = room.players[room.activeIdx];
  if (p.id !== playerId) return;
  const dest = room.pendingMoveTiles.find(t => t.q === q && t.r === r);
  if (!dest) return;
  p.pos = { q, r };
  const tile = room.map.tiles.find(t => t.q === q && t.r === r);
  tile.explored = true;
  logMsg(room, `${p.name} moved to (${q},${r}) [${tile.type}].`);
  // Trigger tile effect
  triggerTile(room, tile);
}

function triggerTile(room, tile) {
  if (tile.type === 'boss') {
    startCombat(room, ['dragon']);
    return;
  }
  if (tile.type === 'town') {
    enterShop(room);
    return;
  }
  if (tile.type === 'dungeon' && !tile.cleared) {
    const partySize = room.players.filter(p => p.alive).length;
    startCombat(room, randomEncounter(room.rand, 'dungeon', partySize), tile);
    return;
  }
  // Plains/forest/mountain: 50% event, 30% encounter, 20% nothing
  const roll = room.rand();
  if (roll < 0.5) {
    startEvent(room);
  } else if (roll < 0.8) {
    const partySize = room.players.filter(p => p.alive).length;
    startCombat(room, randomEncounter(room.rand, tile.type, partySize));
  } else {
    logMsg(room, `The path is quiet.`);
    advanceTurn(room);
  }
}

// --- Events ---
function startEvent(room) {
  const event = EVENTS[Math.floor(room.rand() * EVENTS.length)];
  room.event = { id: event.id, text: event.text, choices: event.choices };
  room.phase = 'event';
  logMsg(room, `Event: ${event.text}`);
}

function resolveEventChoice(room, playerId, idx) {
  if (room.phase !== 'event') return;
  const p = room.players[room.activeIdx];
  if (p.id !== playerId) return;
  const event = EVENTS.find(e => e.id === room.event.id);
  if (!event) return;
  const choice = event.choices[idx];
  if (!choice) return;
  const o = choice.outcome;
  logMsg(room, `${p.name} chose "${choice.label}": ${o.text}`);
  if (o.gold) { p.gold = Math.max(0, p.gold + o.gold); }
  if (o.hp)   { p.hp = Math.max(0, Math.min(p.maxHp, p.hp + o.hp)); if (p.hp === 0) { p.alive = false; logMsg(room, `${p.name} has fallen!`); } }
  if (o.focus) { p.focus = Math.max(0, Math.min(6, p.focus + o.focus)); }
  if (o.item)  { p.inventory.push({ id: o.item }); logMsg(room, `${p.name} gained ${ITEMS[o.item].name}.`); }
  room.event = null;
  if (o.combat) {
    startCombat(room, o.combat);
  } else {
    room.phase = 'overworld';
    advanceTurn(room);
  }
}

// --- Shop ---
function enterShop(room) {
  room.shop = { stock: generateShopStock(room.rand) };
  room.phase = 'shop';
  logMsg(room, `You enter a town. Shop is open.`);
}

function shopBuy(room, playerId, idx) {
  if (room.phase !== 'shop') return;
  const buyer = room.players.find(p => p.id === playerId);
  if (!buyer || !buyer.alive) return;
  const slot = room.shop.stock[idx];
  if (!slot) return;
  const item = ITEMS[slot.id];
  if (buyer.gold < item.price) return;
  buyer.gold -= item.price;
  buyer.inventory.push({ id: slot.id });
  room.shop.stock.splice(idx, 1);
  logMsg(room, `${buyer.name} bought ${item.name} for ${item.price}g.`);
}

function shopRest(room, playerId) {
  if (room.phase !== 'shop') return;
  const p = room.players.find(pp => pp.id === playerId);
  if (!p) return;
  if (p.gold < 15) return;
  p.gold -= 15;
  // Heal all alive party? Per For-the-King-ish: only the resting player, but let's heal whole party.
  for (const pl of room.players) {
    if (pl.alive) { pl.hp = pl.maxHp; pl.focus = Math.min(6, pl.focus + 2); }
  }
  logMsg(room, `${p.name} paid 15g for the inn. Party fully rested.`);
}

function shopRevive(room, playerId, targetId) {
  if (room.phase !== 'shop') return;
  const p = room.players.find(pp => pp.id === playerId);
  const t = room.players.find(pp => pp.id === targetId);
  if (!p || !t || t.alive) return;
  if (p.gold < 50) return;
  p.gold -= 50;
  t.alive = true;
  t.hp = Math.floor(t.maxHp / 2);
  logMsg(room, `${p.name} revived ${t.name} for 50g!`);
}

function shopLeave(room, playerId) {
  if (room.phase !== 'shop') return;
  const p = room.players[room.activeIdx];
  if (p.id !== playerId) return;
  room.shop = null;
  room.phase = 'overworld';
  advanceTurn(room);
}

// --- Combat ---
function startCombat(room, enemyIds, tile = null) {
  const enemies = enemyIds.map((eid, i) => {
    const e = ENEMIES[eid];
    return {
      idx: i, id: eid, name: e.name + (enemyIds.filter(x => x === eid).length > 1 ? ` ${i + 1}` : ''),
      hp: e.hp, maxHp: e.hp,
      atk: e.atk, def: e.def, spd: e.spd, mag: e.mag,
      ai: e.ai, boss: !!e.boss, alive: true,
      gold: e.gold, xp: e.xp, breathCD: e.ai === 'boss' ? 2 : 0,
    };
  });
  const order = buildTurnOrder(room.players, enemies);
  room.combat = {
    enemies, order, turn: 0, round: 1, tile,
    pendingItem: null, lastDamage: [],
    statusByPlayerId: {}, // for taunt/defend bonus this round
  };
  room.phase = 'combat';
  logMsg(room, `Combat! Enemies: ${enemies.map(e => e.name).join(', ')}.`);
  processCombatTurn(room);
}

function buildTurnOrder(players, enemies) {
  const order = [];
  for (const p of players) if (p.alive) order.push({ side: 'player', id: p.id, spd: p.stats.spd + Math.random() * 0.1 });
  for (const e of enemies) order.push({ side: 'enemy', idx: e.idx, spd: e.spd + Math.random() * 0.1 });
  order.sort((a, b) => b.spd - a.spd);
  return order;
}

function processCombatTurn(room) {
  const c = room.combat;
  if (!c) return;
  // Check victory/defeat
  if (c.enemies.every(e => !e.alive)) { combatVictory(room); return; }
  if (room.players.every(p => !p.alive)) { combatDefeat(room); return; }
  // Find next valid actor
  let safety = c.order.length + 1;
  while (safety-- > 0) {
    const cur = c.order[c.turn];
    if (cur.side === 'player') {
      const p = room.players.find(pp => pp.id === cur.id);
      if (p && p.alive) return; // wait for player input
    } else {
      const e = c.enemies[cur.idx];
      if (e && e.alive) { enemyAct(room, e); c.turn = (c.turn + 1) % c.order.length; if (c.turn === 0) c.round++; continue; }
    }
    c.turn = (c.turn + 1) % c.order.length;
    if (c.turn === 0) c.round++;
  }
}

function damageRoll(rand, atk, def) {
  const r = rollDie(rand);
  let dmg = Math.max(1, atk + r - def);
  let crit = false;
  if (r === 6) { dmg *= 2; crit = true; }
  return { dmg, roll: r, crit };
}

function alivePlayers(room) { return room.players.filter(p => p.alive); }

function attackEnemy(room, attacker, target, isMagic = false, mult = 1) {
  const atk = isMagic ? attacker.stats.mag : attacker.stats.atk;
  const { dmg, roll, crit } = damageRoll(room.rand, atk, target.def);
  const final = Math.max(1, Math.floor(dmg * mult));
  target.hp -= final;
  if (target.hp <= 0) { target.hp = 0; target.alive = false; }
  logMsg(room, `${attacker.name} hit ${target.name} for ${final}${crit ? ' (CRIT!)' : ''} [d6=${roll}]${target.alive ? '' : ` — defeated!`}`);
}

function attackPlayer(room, enemy, target, isMagic = false) {
  const status = room.combat.statusByPlayerId[target.id] || {};
  const defBonus = (status.defendBonus || 0) + (status.tauntBonus || 0);
  const atk = isMagic ? enemy.mag : enemy.atk;
  const { dmg, roll, crit } = damageRoll(room.rand, atk, target.stats.def + defBonus);
  target.hp -= dmg;
  if (target.hp <= 0) { target.hp = 0; target.alive = false; }
  logMsg(room, `${enemy.name} hit ${target.name} for ${dmg}${crit ? ' (CRIT!)' : ''} [d6=${roll}]${target.alive ? '' : ` — fallen!`}`);
}

function chooseEnemyTarget(room) {
  // Prefer taunting player if any
  const taunters = alivePlayers(room).filter(p => (room.combat.statusByPlayerId[p.id] || {}).taunt);
  const pool = taunters.length ? taunters : alivePlayers(room);
  return pool[Math.floor(room.rand() * pool.length)];
}

function enemyAct(room, enemy) {
  if (room.players.every(p => !p.alive)) return;
  if (enemy.ai === 'caster' && room.rand() < 0.4) {
    const target = chooseEnemyTarget(room);
    if (!target) return;
    logMsg(room, `${enemy.name} casts a hex!`);
    attackPlayer(room, enemy, target, true);
  } else if (enemy.ai === 'boss') {
    enemy.breathCD--;
    if (enemy.breathCD <= 0) {
      logMsg(room, `${enemy.name} unleashes fire breath!`);
      for (const p of alivePlayers(room)) attackPlayer(room, enemy, p, true);
      enemy.breathCD = 3;
    } else {
      const target = chooseEnemyTarget(room);
      attackPlayer(room, enemy, target);
    }
  } else {
    const target = chooseEnemyTarget(room);
    if (!target) return;
    attackPlayer(room, enemy, target);
  }
}

function playerAction(room, playerId, action) {
  if (room.phase !== 'combat') return;
  const c = room.combat;
  const cur = c.order[c.turn];
  if (cur.side !== 'player' || cur.id !== playerId) return;
  const p = room.players.find(pp => pp.id === playerId);
  if (!p || !p.alive) return;
  // Resolve action
  if (action.kind === 'attack') {
    const target = c.enemies.find(e => e.idx === action.targetIdx);
    if (!target || !target.alive) return;
    attackEnemy(room, { name: p.name, stats: p.stats }, target);
  } else if (action.kind === 'skill') {
    const cls = CLASSES[p.classId];
    if (p.focus < cls.skill.cost) return;
    p.focus -= cls.skill.cost;
    if (cls.skill.id === 'taunt') {
      c.statusByPlayerId[p.id] = { ...(c.statusByPlayerId[p.id] || {}), taunt: true, tauntBonus: 2 };
      logMsg(room, `${p.name} taunts! Enemies focus on them.`);
    } else if (cls.skill.id === 'multishot') {
      const targets = c.enemies.filter(e => e.alive);
      if (!targets.length) return;
      const t1 = c.enemies.find(e => e.idx === action.targetIdx) || targets[0];
      attackEnemy(room, { name: p.name, stats: p.stats }, t1);
      const t2 = (t1.alive ? t1 : targets.find(e => e.alive));
      if (t2) attackEnemy(room, { name: p.name + ' (2nd shot)', stats: p.stats }, t2);
    } else if (cls.skill.id === 'fireball') {
      logMsg(room, `${p.name} hurls a fireball!`);
      for (const e of c.enemies.filter(en => en.alive)) attackEnemy(room, { name: p.name, stats: p.stats }, e, true, 0.9);
    } else if (cls.skill.id === 'heal') {
      const target = room.players.find(pp => pp.id === action.targetId && pp.alive);
      if (!target) return;
      const heal = p.stats.mag + rollDie(room.rand);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      logMsg(room, `${p.name} healed ${target.name} for ${heal}.`);
    }
  } else if (action.kind === 'item') {
    const slot = p.inventory[action.itemIdx];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (it.slot !== 'consumable') return;
    if (it.heal) {
      const target = room.players.find(pp => pp.id === action.targetId && pp.alive);
      if (!target) return;
      target.hp = Math.min(target.maxHp, target.hp + it.heal);
      logMsg(room, `${p.name} used ${it.name} on ${target.name} (+${it.heal} HP).`);
    } else if (it.focus) {
      p.focus = Math.min(6, p.focus + it.focus);
      logMsg(room, `${p.name} used ${it.name} (+${it.focus} focus).`);
    } else if (it.damage) {
      for (const e of c.enemies.filter(en => en.alive)) {
        e.hp -= it.damage; if (e.hp <= 0) { e.hp = 0; e.alive = false; }
      }
      logMsg(room, `${p.name} tossed a Bomb! ${it.damage} dmg to all enemies.`);
    }
    p.inventory.splice(action.itemIdx, 1);
  } else if (action.kind === 'defend') {
    c.statusByPlayerId[p.id] = { ...(c.statusByPlayerId[p.id] || {}), defendBonus: 3 };
    p.focus = Math.min(6, p.focus + 1);
    logMsg(room, `${p.name} braces. +3 DEF, +1 focus.`);
  } else if (action.kind === 'flee') {
    if (room.combat.enemies.some(e => e.boss)) {
      logMsg(room, `${p.name} can't flee a boss!`);
      return;
    }
    if (rollDie(room.rand) >= 4) {
      logMsg(room, `${p.name} signals retreat — the party flees!`);
      room.combat = null;
      room.phase = 'overworld';
      advanceTurn(room);
      return;
    } else {
      logMsg(room, `${p.name} failed to flee!`);
    }
  } else {
    return;
  }
  // Advance turn
  // regen +1 focus end of turn except if skill used
  if (action.kind === 'attack' || action.kind === 'defend') p.focus = Math.min(6, p.focus + 1);
  c.turn = (c.turn + 1) % c.order.length;
  if (c.turn === 0) {
    c.round++;
    // Reset per-round buffs
    for (const id in c.statusByPlayerId) {
      c.statusByPlayerId[id].defendBonus = 0;
      c.statusByPlayerId[id].tauntBonus = 0;
    }
  }
  processCombatTurn(room);
}

function combatVictory(room) {
  // Loot
  let totalGold = 0, totalXp = 0;
  for (const e of room.combat.enemies) {
    const g = e.gold[0] + Math.floor(room.rand() * (e.gold[1] - e.gold[0] + 1));
    totalGold += g; totalXp += e.xp;
  }
  // Item drop chance
  const drops = [];
  if (room.rand() < 0.4) {
    const pool = ['potion', 'potion', 'focus', 'greatpotion', 'bomb'];
    drops.push(pool[Math.floor(room.rand() * pool.length)]);
  }
  if (room.combat.enemies.some(e => e.boss)) {
    drops.push('greatpotion');
    totalGold += 200;
  }
  const alive = alivePlayers(room);
  const share = Math.ceil(totalGold / Math.max(1, alive.length));
  for (const p of alive) { p.gold += share; p.xp += totalXp; }
  for (const d of drops) {
    const target = alive[Math.floor(room.rand() * alive.length)];
    if (target) target.inventory.push({ id: d });
  }
  logMsg(room, `Victory! +${totalGold}g (${share}g each), +${totalXp} XP${drops.length ? `, drops: ${drops.map(d => ITEMS[d].name).join(', ')}` : ''}.`);
  // Mark dungeon cleared
  if (room.combat.tile) room.combat.tile.cleared = true;
  const wasBoss = room.combat.enemies.some(e => e.boss);
  room.combat = null;
  if (wasBoss) { room.phase = 'victory'; logMsg(room, `The Ancient Dragon is slain! The realm is saved.`); return; }
  room.phase = 'overworld';
  advanceTurn(room);
}

function combatDefeat(room) {
  room.combat = null;
  room.phase = 'defeat';
  logMsg(room, `The party has fallen in battle.`);
}

// --- Equip / Inventory management (any phase except combat resolves) ---
function equipItem(room, playerId, idx) {
  const p = room.players.find(pp => pp.id === playerId);
  if (!p) return;
  const slot = p.inventory[idx];
  if (!slot) return;
  const it = ITEMS[slot.id];
  if (it.slot !== 'weapon' && it.slot !== 'armor') return;
  const prev = p.equip[it.slot];
  p.equip[it.slot] = slot.id;
  p.inventory.splice(idx, 1);
  if (prev) p.inventory.push({ id: prev });
  computeStats(p);
  // Clamp HP to new max
  p.hp = Math.min(p.hp, p.maxHp);
  logMsg(room, `${p.name} equipped ${it.name}.`);
}

function dropItem(room, playerId, idx) {
  const p = room.players.find(pp => pp.id === playerId);
  if (!p) return;
  if (!p.inventory[idx]) return;
  const it = ITEMS[p.inventory[idx].id];
  p.inventory.splice(idx, 1);
  logMsg(room, `${p.name} dropped ${it.name}.`);
}

function usePotion(room, playerId, idx, targetId) {
  // Only outside combat. In combat use playerAction.
  if (room.phase === 'combat') return;
  const p = room.players.find(pp => pp.id === playerId);
  if (!p) return;
  const slot = p.inventory[idx];
  if (!slot) return;
  const it = ITEMS[slot.id];
  if (it.slot !== 'consumable') return;
  // Bombs only work in combat.
  if (it.damage) { logMsg(room, `${p.name} can only use ${it.name} in combat.`); return; }
  const target = room.players.find(pp => pp.id === (targetId || playerId));
  if (!target || !target.alive) return;
  if (it.heal) target.hp = Math.min(target.maxHp, target.hp + it.heal);
  if (it.focus) p.focus = Math.min(6, p.focus + it.focus);
  p.inventory.splice(idx, 1);
  logMsg(room, `${p.name} used ${it.name}${it.heal ? ` on ${target.name}` : ''}.`);
}

// --- Save / Load ---
function saveRoom(room, name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || room.code;
  // Serialize only persistent state
  const data = {
    version: 1,
    code: room.code,
    seed: room.seed,
    phase: room.phase,
    activeIdx: room.activeIdx,
    round: room.round,
    map: room.map,
    log: room.log.slice(-40),
    players: room.players.map(p => ({
      name: p.name, classId: p.classId, equip: p.equip,
      inventory: p.inventory, gold: p.gold, focus: p.focus,
      hp: p.hp, maxHp: p.maxHp, pos: p.pos, alive: p.alive, xp: p.xp, stats: p.stats,
    })),
  };
  fs.writeFileSync(path.join(SAVE_DIR, `${safeName}.json`), JSON.stringify(data, null, 2));
  return safeName;
}

function listSaves() {
  return fs.readdirSync(SAVE_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

function loadIntoRoom(name) {
  const file = path.join(SAVE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const code = genCode();
  const room = {
    code, phase: 'lobby', // host re-fills players before resuming
    seed: data.seed, rand: rng(data.seed + Date.now()),
    players: [], hostId: null, map: data.map,
    activeIdx: data.activeIdx, round: data.round,
    log: data.log, pendingMoves: 0, pendingMoveTiles: [],
    combat: null, event: null, shop: null,
    savedPlayers: data.players,  // template to apply when players join
    resumePhase: data.phase,
    lastInteract: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function resumeSavedRoom(room) {
  // Apply saved player slots to current players in order joined.
  // Players are matched by class first available, but UI typically lets host control.
  // Here we just take saved player state and copy to current player slots up to count.
  const tmpl = room.savedPlayers || [];
  for (let i = 0; i < room.players.length && i < tmpl.length; i++) {
    const p = room.players[i];
    const s = tmpl[i];
    p.classId = s.classId;
    p.equip = s.equip;
    p.inventory = s.inventory;
    p.gold = s.gold;
    p.focus = s.focus;
    p.stats = s.stats;
    p.hp = s.hp;
    p.maxHp = s.maxHp;
    p.pos = s.pos;
    p.alive = s.alive;
    p.xp = s.xp;
    p.ready = true;
  }
  room.savedPlayers = null;
  room.phase = room.resumePhase === 'combat' ? 'overworld' : (room.resumePhase || 'overworld');
  room.resumePhase = null;
  logMsg(room, `Game resumed.`);
  startOverworldTurn(room);
}

// --- State snapshot to client ---
function publicState(room, forPlayerId) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    activeId: room.players[room.activeIdx]?.id,
    hostId: room.hostId,
    log: room.log.slice(-30),
    map: room.map ? {
      width: room.map.width, height: room.map.height,
      tiles: room.map.tiles.map(t => ({ q: t.q, r: t.r, type: t.type, explored: t.explored, cleared: t.cleared })),
      boss: room.map.boss,
    } : null,
    pendingMoves: room.pendingMoves,
    moveTiles: room.pendingMoveTiles,
    players: room.players.map(p => ({
      id: p.id, name: p.name, classId: p.classId,
      hp: p.hp, maxHp: p.maxHp, focus: p.focus, gold: p.gold,
      pos: p.pos, alive: p.alive, xp: p.xp,
      stats: p.stats, equip: p.equip,
      inventory: p.inventory,
      isYou: p.id === forPlayerId,
    })),
    combat: room.combat ? {
      round: room.combat.round,
      turn: room.combat.turn,
      order: room.combat.order,
      enemies: room.combat.enemies.map(e => ({
        idx: e.idx, name: e.name, hp: e.hp, maxHp: e.maxHp, alive: e.alive, boss: e.boss,
      })),
    } : null,
    event: room.event,
    shop: room.shop ? { stock: room.shop.stock.map(s => ({ id: s.id, item: ITEMS[s.id] })) } : null,
    saves: listSaves(),
    classes: CLASSES,
    items: ITEMS,
  };
}

function pushState(room) {
  for (const p of room.players) {
    send(p.ws, 'state', { state: publicState(room, p.id) });
  }
}

// --- WS connection ---
wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      handleMessage(ws, msg);
    } catch (e) {
      send(ws, 'error', { message: e.message });
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === ws.playerId);
    if (idx === -1) return;
    const removed = room.players[idx];
    room.players.splice(idx, 1);
    logMsg(room, `${removed.name} disconnected.`);
    if (!room.players.length) {
      rooms.delete(room.code);
    } else {
      if (room.hostId === removed.id) room.hostId = room.players[0].id;
      if (room.activeIdx >= room.players.length) room.activeIdx = 0;
      pushState(room);
    }
  });
});

function handleMessage(ws, msg) {
  if (msg.type === 'create_room') {
    const room = createRoom(msg.name, ws);
    ws.playerId = room.players[0].id;
    ws.roomCode = room.code;
    send(ws, 'joined', { code: room.code, playerId: ws.playerId });
    pushState(room);
    return;
  }
  if (msg.type === 'join_room') {
    const room = rooms.get((msg.code || '').toUpperCase());
    if (!room) { send(ws, 'error', { message: 'No such room.' }); return; }
    const p = addPlayer(room, msg.name, ws);
    ws.playerId = p.id;
    ws.roomCode = room.code;
    send(ws, 'joined', { code: room.code, playerId: p.id });
    logMsg(room, `${p.name} joined.`);
    pushState(room);
    return;
  }
  if (msg.type === 'load_room') {
    const room = loadIntoRoom(msg.save);
    if (!room) { send(ws, 'error', { message: 'No such save.' }); return; }
    const p = addPlayer(room, msg.name, ws);
    room.hostId = p.id;
    ws.playerId = p.id;
    ws.roomCode = room.code;
    send(ws, 'joined', { code: room.code, playerId: p.id });
    pushState(room);
    return;
  }
  // All subsequent require an active player
  const room = rooms.get(ws.roomCode);
  if (!room) { send(ws, 'error', { message: 'Not in a room.' }); return; }
  const player = room.players.find(p => p.id === ws.playerId);
  if (!player) return;

  switch (msg.type) {
    case 'pick_class': {
      if (room.phase !== 'lobby') return;
      if (!CLASSES[msg.classId]) return;
      player.classId = msg.classId;
      break;
    }
    case 'start_game': {
      if (player.id !== room.hostId) return;
      if (room.savedPlayers && room.savedPlayers.length) {
        resumeSavedRoom(room);
      } else {
        startGame(room);
      }
      break;
    }
    case 'move': {
      movePlayer(room, player.id, msg.q, msg.r);
      break;
    }
    case 'event_choice': {
      resolveEventChoice(room, player.id, msg.idx);
      break;
    }
    case 'combat_action': {
      playerAction(room, player.id, msg.action);
      break;
    }
    case 'shop_buy': {
      shopBuy(room, player.id, msg.idx);
      break;
    }
    case 'shop_rest': {
      shopRest(room, player.id);
      break;
    }
    case 'shop_revive': {
      shopRevive(room, player.id, msg.targetId);
      break;
    }
    case 'shop_leave': {
      shopLeave(room, player.id);
      break;
    }
    case 'equip': {
      equipItem(room, player.id, msg.idx);
      break;
    }
    case 'drop': {
      dropItem(room, player.id, msg.idx);
      break;
    }
    case 'use_item': {
      usePotion(room, player.id, msg.idx, msg.targetId);
      break;
    }
    case 'save_game': {
      if (player.id !== room.hostId) return;
      const name = saveRoom(room, msg.name || room.code);
      logMsg(room, `Game saved as "${name}".`);
      break;
    }
    case 'chat': {
      const text = String(msg.text || '').slice(0, 200);
      if (text) logMsg(room, `[${player.name}] ${text}`);
      break;
    }
    default:
      return;
  }
  room.lastInteract = Date.now();
  pushState(room);
}

server.listen(PORT, () => {
  console.log(`Game server listening on http://localhost:${PORT}`);
});
