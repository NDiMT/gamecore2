// Game data tables. Pure definitions — no logic.
(function () {
  'use strict';

  const CLASSES = {
    warrior: {
      id: 'warrior',
      name: 'Πολεμιστής',
      icon: '⚔️',
      desc: 'Σκληρός μαχητής. Επιθέσεις από κοντά με 4 ζάρια.',
      maxHp: 28,
      dice: 4,        // number of dice on attack
      hitOn: 4,       // a die >= hitOn is a hit
      dmgPerHit: 2,   // damage per successful die
      crit: 6,        // a die == crit deals extra damage
      critBonus: 1,   // extra damage on crit
      startItems: [{ type: 'potion', count: 2 }]
    },
    hunter: {
      id: 'hunter',
      name: 'Κυνηγός',
      icon: '🏹',
      desc: 'Ακριβής τοξότης. Λιγότερη ζημιά αλλά πετυχαίνει με 3+.',
      maxHp: 22,
      dice: 3,
      hitOn: 3,       // easier to hit
      dmgPerHit: 2,
      crit: 6,
      critBonus: 2,
      startItems: [{ type: 'potion', count: 1 }, { type: 'bomb', count: 1 }]
    },
    mage: {
      id: 'mage',
      name: 'Μάγος',
      icon: '🔮',
      desc: 'Μαγικές επιθέσεις. Σε κρίσιμη ζημιά πλήττει όλους τους εχθρούς.',
      maxHp: 18,
      dice: 3,
      hitOn: 4,
      dmgPerHit: 3,   // big damage
      crit: 6,
      critBonus: 0,
      aoeOnCrit: true,  // any 6 → damage splashes to all enemies
      startItems: [{ type: 'potion', count: 1 }]
    }
  };
  const CLASS_LIST = ['warrior', 'hunter', 'mage'];

  const ENEMIES = {
    goblin:    { name: 'Καλικάντζαρος', icon: '👺', maxHp: 8,  dice: 2, hitOn: 4, dmg: 2 },
    wolf:      { name: 'Λύκος',         icon: '🐺', maxHp: 6,  dice: 2, hitOn: 4, dmg: 2 },
    orc:       { name: 'Ορκ',           icon: '👹', maxHp: 14, dice: 3, hitOn: 4, dmg: 2 },
    bandit:    { name: 'Ληστής',        icon: '🗡️', maxHp: 10, dice: 2, hitOn: 3, dmg: 2 },
    skeleton:  { name: 'Σκελετός',      icon: '💀', maxHp: 9,  dice: 2, hitOn: 4, dmg: 2 },
    dragon:    { name: 'Δράκος',        icon: '🐉', maxHp: 45, dice: 5, hitOn: 4, dmg: 3 }
  };

  // Combat encounters: groups of enemies.
  const ENCOUNTERS = [
    ['goblin', 'goblin'],
    ['goblin', 'goblin', 'goblin'],
    ['wolf', 'wolf'],
    ['orc'],
    ['orc', 'goblin'],
    ['bandit', 'bandit'],
    ['skeleton', 'skeleton'],
    ['orc', 'orc']
  ];
  const BOSS_ENCOUNTER = ['dragon'];

  const ITEMS = {
    potion: { name: 'Φίλτρο Ζωής', icon: '🧪', desc: 'Θεραπεύει 14 HP.' },
    bomb:   { name: 'Βόμβα',       icon: '💣', desc: 'Προκαλεί 6 ζημιά σε όλους τους εχθρούς.' }
  };

  const TILE_ICONS = {
    start:    '🏰',
    empty:    '·',
    combat:   '⚔️',
    village:  '🏘️',
    treasure: '💰',
    boss:     '🐉'
  };

  const TILE_NAMES = {
    start:    'Πύλη',
    empty:    'Άδειο πεδίο',
    combat:   'Επικίνδυνη περιοχή',
    village:  'Χωριό',
    treasure: 'Θησαυρός',
    boss:     'Φωλιά Δράκου'
  };

  window.DATA = { CLASSES, CLASS_LIST, ENEMIES, ENCOUNTERS, BOSS_ENCOUNTER, ITEMS, TILE_ICONS, TILE_NAMES };
})();
