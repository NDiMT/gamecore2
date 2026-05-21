// Game data tables — class/enemy/item/tile definitions. Pure data, no logic.
(function () {
  'use strict';

  const CLASSES = {
    warrior: {
      id: 'warrior',
      name: 'Warrior',
      icon: '⚔️',
      desc: 'Heavy melee fighter. Rolls 4 dice each attack.',
      maxHp: 28,
      dice: 4,
      hitOn: 4,
      dmgPerHit: 2,
      crit: 6,
      critBonus: 1,
      startItems: [{ type: 'potion', count: 2 }]
    },
    hunter: {
      id: 'hunter',
      name: 'Hunter',
      icon: '🏹',
      desc: 'Precise ranger. Easier hits — counts on 3+.',
      maxHp: 22,
      dice: 3,
      hitOn: 3,
      dmgPerHit: 2,
      crit: 6,
      critBonus: 2,
      startItems: [{ type: 'potion', count: 1 }, { type: 'bomb', count: 1 }]
    },
    mage: {
      id: 'mage',
      name: 'Mage',
      icon: '🔮',
      desc: 'Arcane caster. A 6 splashes damage to every enemy.',
      maxHp: 18,
      dice: 3,
      hitOn: 4,
      dmgPerHit: 3,
      crit: 6,
      critBonus: 0,
      aoeOnCrit: true,
      startItems: [{ type: 'potion', count: 1 }]
    }
  };
  const CLASS_LIST = ['warrior', 'hunter', 'mage'];

  // Per-class legendary items — rare drops (3% normal, 100% from dragon).
  // Stack additively: every duplicate gives a smaller cumulative bonus.
  const CLASS_ITEMS = {
    warrior: { id: 'sword',  name: 'Steel Sword',  icon: '🗡️', effect: 'bonusDmg',   value: 1, desc: '+1 damage per successful die' },
    hunter:  { id: 'quiver', name: 'Lucky Quiver', icon: '🎯', effect: 'bonusHit',   value: 1, desc: 'Dice hit at -1 threshold' },
    mage:    { id: 'tome',   name: 'Arcane Tome',  icon: '📕', effect: 'bonusDice',  value: 1, desc: '+1 attack die' }
  };

  const ENEMIES = {
    goblin:   { name: 'Goblin',   icon: '👺', maxHp: 8,  dice: 2, hitOn: 4, dmg: 2,
                xp: 5,  loot: { gold: [1, 4],  potion: 0.05, bomb: 0.00 } },
    wolf:     { name: 'Wolf',     icon: '🐺', maxHp: 6,  dice: 2, hitOn: 4, dmg: 2,
                xp: 4,  loot: { gold: [1, 3],  potion: 0.03, bomb: 0.00 } },
    orc:      { name: 'Orc',      icon: '👹', maxHp: 14, dice: 3, hitOn: 4, dmg: 2,
                xp: 12, loot: { gold: [3, 9],  potion: 0.10, bomb: 0.05 } },
    bandit:   { name: 'Bandit',   icon: '🗡️', maxHp: 10, dice: 2, hitOn: 3, dmg: 2,
                xp: 9,  loot: { gold: [5, 12], potion: 0.08, bomb: 0.08 } },
    skeleton: { name: 'Skeleton', icon: '💀', maxHp: 9,  dice: 2, hitOn: 4, dmg: 2,
                xp: 7,  loot: { gold: [2, 7],  potion: 0.05, bomb: 0.00 } },
    dragon:   { name: 'Dragon',   icon: '🐉', maxHp: 50, dice: 5, hitOn: 4, dmg: 3,
                xp: 80, loot: { gold: [80, 120], potion: 0.6, bomb: 0.6 }, classItemGuaranteed: true }
  };

  const ENCOUNTERS = [
    ['goblin', 'goblin'],
    ['goblin', 'goblin', 'goblin'],
    ['wolf', 'wolf'],
    ['orc'],
    ['orc', 'goblin'],
    ['bandit', 'bandit'],
    ['skeleton', 'skeleton'],
    ['skeleton', 'skeleton', 'skeleton'],
    ['orc', 'orc'],
    ['wolf', 'goblin', 'goblin']
  ];
  const BOSS_ENCOUNTER = ['dragon'];

  const ITEMS = {
    potion: { name: 'Health Potion', icon: '🧪', desc: 'Restores 14 HP.' },
    bomb:   { name: 'Bomb',          icon: '💣', desc: 'Deals 6 damage to every enemy.' }
  };

  // XP thresholds for each level. Index = next level's requirement.
  // i.e. XP_FOR_LEVEL[2] = XP needed to reach level 2.
  const XP_FOR_LEVEL = [0, 0, 20, 50, 100, 180, 300, 480];
  const MAX_LEVEL = 7;

  // Quest catalogue. The state picks a few at game start.
  const QUEST_POOL = [
    { type: 'kill',     enemy: 'goblin',   count: 3, reward: { gold: 20 },                  text: (q) => `Slay ${q.count} goblins` },
    { type: 'kill',     enemy: 'wolf',     count: 3, reward: { gold: 20 },                  text: (q) => `Hunt ${q.count} wolves` },
    { type: 'kill',     enemy: 'orc',      count: 2, reward: { gold: 30, item: 'potion' }, text: (q) => `Defeat ${q.count} orcs` },
    { type: 'kill',     enemy: 'bandit',   count: 2, reward: { gold: 25, item: 'bomb' },   text: (q) => `Bring ${q.count} bandits to justice` },
    { type: 'kill',     enemy: 'skeleton', count: 3, reward: { gold: 25 },                 text: (q) => `Banish ${q.count} skeletons` },
    { type: 'gold',                       count: 60, reward: { item: 'bomb' },             text: (q) => `Collect ${q.count} gold` },
    { type: 'village',                    count: 2,  reward: { gold: 20, item: 'potion' }, text: (q) => `Visit ${q.count} villages` },
    { type: 'treasure',                   count: 3,  reward: { gold: 25 },                 text: (q) => `Find ${q.count} treasures` }
  ];

  const TERRAIN_TYPES = ['grass', 'forest', 'hills', 'water', 'path', 'sand'];
  const FEATURE_NAMES = {
    village: 'Village',
    ruins:   'Ruins',
    chest:   'Treasure',
    lair:    "Dragon's Lair"
  };

  window.DATA = {
    CLASSES, CLASS_LIST, CLASS_ITEMS, ENEMIES, ENCOUNTERS, BOSS_ENCOUNTER,
    ITEMS, XP_FOR_LEVEL, MAX_LEVEL, QUEST_POOL, TERRAIN_TYPES, FEATURE_NAMES
  };
})();
