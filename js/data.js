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

  const ENEMIES = {
    goblin:   { name: 'Goblin',   icon: '👺', maxHp: 8,  dice: 2, hitOn: 4, dmg: 2 },
    wolf:     { name: 'Wolf',     icon: '🐺', maxHp: 6,  dice: 2, hitOn: 4, dmg: 2 },
    orc:      { name: 'Orc',      icon: '👹', maxHp: 14, dice: 3, hitOn: 4, dmg: 2 },
    bandit:   { name: 'Bandit',   icon: '🗡️', maxHp: 10, dice: 2, hitOn: 3, dmg: 2 },
    skeleton: { name: 'Skeleton', icon: '💀', maxHp: 9,  dice: 2, hitOn: 4, dmg: 2 },
    dragon:   { name: 'Dragon',   icon: '🐉', maxHp: 50, dice: 5, hitOn: 4, dmg: 3 }
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

  // Terrain types — used for the open-world canvas tiles.
  const TERRAIN_TYPES = ['grass', 'forest', 'hills', 'water', 'path', 'sand'];

  // Features that sit on top of terrain. 'lair' is the boss location.
  const FEATURE_NAMES = {
    village: 'Village',
    ruins:   'Ruins',
    chest:   'Treasure',
    lair:    "Dragon's Lair"
  };

  window.DATA = { CLASSES, CLASS_LIST, ENEMIES, ENCOUNTERS, BOSS_ENCOUNTER, ITEMS, TERRAIN_TYPES, FEATURE_NAMES };
})();
