// Static game data: classes, enemies, items, events, map generation.
// Pure data + small helpers. No state lives here.
// Browser global: window.GameData
(function (root) {
'use strict';
var module = { exports: {} };

const CLASSES = {
  knight: {
    name: 'Knight',
    desc: 'Heavy melee. Soaks damage, taunts foes.',
    baseStats: { hp: 28, atk: 7, def: 5, spd: 3, mag: 1 },
    startWeapon: 'longsword',
    startArmor: 'chainmail',
    skill: { id: 'taunt', name: 'Taunt', cost: 2, desc: 'All enemies target you next round. +2 DEF this round.' },
  },
  hunter: {
    name: 'Hunter',
    desc: 'Ranged DPS. Multi-shot on focus.',
    baseStats: { hp: 22, atk: 6, def: 3, spd: 6, mag: 2 },
    startWeapon: 'shortbow',
    startArmor: 'leather',
    skill: { id: 'multishot', name: 'Multi-shot', cost: 3, desc: 'Attack twice this turn.' },
  },
  wizard: {
    name: 'Wizard',
    desc: 'Glass cannon. AoE magic.',
    baseStats: { hp: 18, atk: 3, def: 2, spd: 4, mag: 8 },
    startWeapon: 'staff',
    startArmor: 'robe',
    skill: { id: 'fireball', name: 'Fireball', cost: 3, desc: 'Magic damage to ALL enemies.' },
  },
  cleric: {
    name: 'Cleric',
    desc: 'Support. Heals the party.',
    baseStats: { hp: 24, atk: 4, def: 4, spd: 4, mag: 6 },
    startWeapon: 'mace',
    startArmor: 'chainmail',
    skill: { id: 'heal', name: 'Heal', cost: 2, desc: 'Restore HP to one ally.' },
  },
};

const ITEMS = {
  // Weapons (slot=weapon, atk bonus, sometimes mag)
  longsword:    { name: 'Longsword',    slot: 'weapon', atk: 4, price: 40 },
  shortbow:     { name: 'Shortbow',     slot: 'weapon', atk: 3, spd: 1, price: 35 },
  staff:        { name: 'Staff',        slot: 'weapon', atk: 1, mag: 3, price: 35 },
  mace:         { name: 'Mace',         slot: 'weapon', atk: 3, mag: 1, price: 30 },
  greatsword:   { name: 'Greatsword',   slot: 'weapon', atk: 7, spd: -1, price: 110 },
  longbow:      { name: 'Longbow',      slot: 'weapon', atk: 5, spd: 1, price: 100 },
  arcanestaff:  { name: 'Arcane Staff', slot: 'weapon', atk: 2, mag: 6, price: 120 },
  warhammer:    { name: 'Warhammer',    slot: 'weapon', atk: 6, mag: 2, price: 105 },

  // Armor (slot=armor, def bonus)
  leather:      { name: 'Leather',      slot: 'armor', def: 2, price: 25 },
  chainmail:    { name: 'Chainmail',    slot: 'armor', def: 4, spd: -1, price: 60 },
  robe:         { name: 'Robe',         slot: 'armor', def: 1, mag: 1, price: 20 },
  platemail:    { name: 'Platemail',    slot: 'armor', def: 7, spd: -1, price: 140 },
  enchantedrobe:{ name: 'Enchanted Robe',slot:'armor', def: 3, mag: 3, price: 130 },

  // Consumables
  potion:       { name: 'Healing Potion', slot: 'consumable', heal: 14, price: 18 },
  greatpotion:  { name: 'Greater Potion', slot: 'consumable', heal: 30, price: 40 },
  focus:        { name: 'Focus Brew',     slot: 'consumable', focus: 3, price: 22 },
  bomb:         { name: 'Bomb',           slot: 'consumable', damage: 16, aoe: true, price: 35 },
};

const ENEMIES = {
  goblin:   { name: 'Goblin',   hp: 12, atk: 4,  def: 1, spd: 4, mag: 0, gold: [4, 9],   xp: 5,  ai: 'basic' },
  wolf:     { name: 'Wolf',     hp: 14, atk: 5,  def: 2, spd: 7, mag: 0, gold: [3, 8],   xp: 6,  ai: 'basic' },
  bandit:   { name: 'Bandit',   hp: 20, atk: 6,  def: 3, spd: 4, mag: 0, gold: [10, 20], xp: 9,  ai: 'basic' },
  orc:      { name: 'Orc',      hp: 30, atk: 8,  def: 4, spd: 3, mag: 0, gold: [12, 25], xp: 13, ai: 'basic' },
  skeleton: { name: 'Skeleton', hp: 22, atk: 6,  def: 5, spd: 3, mag: 2, gold: [8, 16],  xp: 10, ai: 'basic' },
  shaman:   { name: 'Shaman',   hp: 18, atk: 3,  def: 2, spd: 4, mag: 7, gold: [14, 22], xp: 12, ai: 'caster' },
  dragon:   { name: 'Ancient Dragon', hp: 140, atk: 12, def: 7, spd: 5, mag: 8, gold: [200, 300], xp: 100, ai: 'boss', boss: true },
};

// Events: each has choices that resolve to outcomes.
// outcomes: { text, hp?, gold?, focus?, item?, damageRoll?: {atk,def}, combat?: [enemyIds] }
const EVENTS = [
  {
    id: 'merchant',
    text: 'A traveling merchant offers a mysterious potion for 25 gold.',
    choices: [
      { label: 'Buy it', outcome: { text: 'You drink it. Refreshing!', gold: -25, hp: 20 } },
      { label: 'Pass',    outcome: { text: 'You wave him off.' } },
    ],
  },
  {
    id: 'shrine',
    text: 'You find an ancient shrine. Pray?',
    choices: [
      { label: 'Pray',  outcome: { text: 'A warm light fills you.', hp: 12, focus: 1 } },
      { label: 'Leave', outcome: { text: 'You leave it untouched.' } },
    ],
  },
  {
    id: 'ambush',
    text: 'Bandits leap from the bushes!',
    choices: [
      { label: 'Fight!', outcome: { text: 'Steel rings out!', combat: ['bandit', 'bandit'] } },
      { label: 'Flee',   outcome: { text: 'You flee but take wounds.', hp: -8 } },
    ],
  },
  {
    id: 'chest',
    text: 'A wooden chest sits on the path.',
    choices: [
      { label: 'Open it', outcome: { text: 'Gold inside!', gold: 30 } },
      { label: 'Trapped?', outcome: { text: 'You disarm a needle. Cautious win.', gold: 15, focus: 1 } },
      { label: 'Leave',    outcome: { text: 'Better safe.' } },
    ],
  },
  {
    id: 'beggar',
    text: 'A hungry beggar asks for 10 gold.',
    choices: [
      { label: 'Give',   outcome: { text: 'He blesses you.', gold: -10, focus: 2 } },
      { label: 'Refuse', outcome: { text: 'He curses your steps.' } },
    ],
  },
  {
    id: 'spring',
    text: 'A clear spring bubbles up from the rocks.',
    choices: [
      { label: 'Drink',  outcome: { text: 'Refreshing!', hp: 8 } },
      { label: 'Bottle', outcome: { text: 'You bottle some for later.', item: 'potion' } },
    ],
  },
  {
    id: 'wolfhowl',
    text: 'Howls in the distance. Wolves approach!',
    choices: [
      { label: 'Stand',  outcome: { text: 'They lunge!', combat: ['wolf', 'wolf'] } },
      { label: 'Hide',   outcome: { text: 'They pass by.', focus: -1 } },
    ],
  },
  {
    id: 'wanderer',
    text: 'A wanderer shares a tale and a coin.',
    choices: [
      { label: 'Listen', outcome: { text: 'Wise words.', gold: 8, focus: 1 } },
    ],
  },
];

// --- Helpers ---
function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollDie(rand, sides = 6) {
  return 1 + Math.floor(rand() * sides);
}

function rollMany(rand, n, sides = 6) {
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(rollDie(rand, sides));
  return rolls;
}

// Generate hex map. Axial coords. Returns array of tile objects.
// Tile types: plains, forest, mountain, town, dungeon, boss
function generateMap(rand) {
  const W = 9; // cols
  const H = 7; // rows
  const tiles = [];
  // Decide town positions, dungeons, boss tile
  // Boss far corner
  const bossQ = W - 1;
  const bossR = H - 1;
  // Towns: 2 random tiles not corner
  const used = new Set([`0,0`, `${bossQ},${bossR}`]);
  function pick() {
    while (true) {
      const q = Math.floor(rand() * W);
      const r = Math.floor(rand() * H);
      const k = `${q},${r}`;
      if (!used.has(k)) { used.add(k); return [q, r]; }
    }
  }
  const towns = [pick(), pick()];
  const dungeons = [pick(), pick(), pick()];

  for (let r = 0; r < H; r++) {
    for (let q = 0; q < W; q++) {
      const k = `${q},${r}`;
      let type = 'plains';
      const roll = rand();
      if (roll < 0.22) type = 'forest';
      else if (roll < 0.36) type = 'mountain';
      if (towns.some(([tq, tr]) => tq === q && tr === r)) type = 'town';
      if (dungeons.some(([tq, tr]) => tq === q && tr === r)) type = 'dungeon';
      if (q === bossQ && r === bossR) type = 'boss';
      if (q === 0 && r === 0) type = 'plains'; // start
      tiles.push({ q, r, type, explored: false, cleared: type !== 'dungeon' && type !== 'boss' });
    }
  }
  return { width: W, height: H, tiles, start: { q: 0, r: 0 }, boss: { q: bossQ, r: bossR } };
}

// Axial neighbors (pointy-top, odd-r offset). We use offset coords directly.
function neighborsOffset(q, r) {
  // odd-r offset hex neighbors
  const evenRow = (r % 2 === 0);
  const dirs = evenRow
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
  return dirs.map(([dq, dr]) => [q + dq, r + dr]);
}

function tilesWithinRange(map, q0, r0, range) {
  // BFS up to `range` steps
  const key = (q, r) => `${q},${r}`;
  const visited = new Map();
  visited.set(key(q0, r0), 0);
  const queue = [[q0, r0, 0]];
  const inBounds = (q, r) => q >= 0 && q < map.width && r >= 0 && r < map.height;
  while (queue.length) {
    const [q, r, d] = queue.shift();
    if (d === range) continue;
    for (const [nq, nr] of neighborsOffset(q, r)) {
      if (!inBounds(nq, nr)) continue;
      const k = key(nq, nr);
      if (visited.has(k)) continue;
      visited.set(k, d + 1);
      queue.push([nq, nr, d + 1]);
    }
  }
  // Exclude the origin tile
  visited.delete(key(q0, r0));
  return [...visited.keys()].map(k => {
    const [q, r] = k.split(',').map(Number);
    return { q, r, dist: visited.get(k) };
  });
}

// Choose a random encounter for a tile type.
function randomEncounter(rand, tileType, partySize) {
  const pools = {
    forest:   ['wolf', 'wolf', 'goblin', 'bandit'],
    mountain: ['orc', 'skeleton', 'shaman'],
    plains:   ['goblin', 'bandit'],
    dungeon:  ['skeleton', 'orc', 'shaman', 'bandit'],
  };
  const pool = pools[tileType] || pools.plains;
  const count = tileType === 'dungeon' ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * partySize);
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(pool[Math.floor(rand() * pool.length)]);
  }
  return list;
}

// Random shop inventory: rotating list
function generateShopStock(rand) {
  const weapons = ['greatsword', 'longbow', 'arcanestaff', 'warhammer', 'longsword', 'shortbow', 'staff', 'mace'];
  const armors  = ['leather', 'chainmail', 'robe', 'platemail', 'enchantedrobe'];
  const consums = ['potion', 'potion', 'greatpotion', 'focus', 'bomb'];
  const stock = [];
  // 2 weapons, 2 armors, 3 consumables
  const pick = (arr, n) => {
    const copy = [...arr];
    const out = [];
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(rand() * copy.length);
      out.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return out;
  };
  for (const w of pick(weapons, 2)) stock.push({ id: w });
  for (const a of pick(armors, 2)) stock.push({ id: a });
  for (const c of pick(consums, 3)) stock.push({ id: c });
  return stock;
}

module.exports = {
  CLASSES, ITEMS, ENEMIES, EVENTS,
  rng, rollDie, rollMany,
  generateMap, neighborsOffset, tilesWithinRange,
  randomEncounter, generateShopStock,
};

root.GameData = module.exports;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
