// Pixel-art sprite library. Sprites are authored as ASCII grids and baked
// into offscreen canvases at boot so per-frame rendering is just drawImage().
//
// Convention:
//   - '.' = transparent
//   - any other character = palette lookup
//   - frames is an array of grids (same size, same palette)
(function () {
  'use strict';

  // Shared palette — used across all sprites unless overridden per-sprite.
  const P = {
    // outline
    '#': '#0a0608',
    // skin
    's': '#b07c50', S: '#7a4a28',
    // hair / blonde / brown
    'h': '#3a2410', H: '#5a3818',
    'y': '#d4a040', Y: '#f8d870',
    // metals: steel, gold
    'm': '#4a4a5a', M: '#9a9aaa', n: '#c0c0d0',
    'g': '#9a7020', G: '#f8c850',
    // reds/blood
    'r': '#7a1818', R: '#c43b3b', q: '#f06464',
    // leather/brown
    'l': '#3a2418', L: '#6a3a18',
    // greens
    'e': '#1a4020', E: '#3a7a3a', x: '#6aa84a',
    // blues / cloth
    'b': '#1a2a5a', B: '#3a5a9a', c: '#6a8acc',
    // purples / mage cloth
    'p': '#2a1850', P_: '#5a30a0', u: '#9a60d0',
    // bone / white
    'w': '#f0e8d8', W: '#fffdf0',
    // earth / dirt
    'd': '#5a3a20', D: '#8a6a40',
    // shadow
    'k': '#1a1018',
  };

  // ---- character sprites: 16x16 -----------------------------------------
  // Tip when authoring: outline ('#') around silhouette gives chunky feel.

  const WARRIOR_IDLE = [
    "................",
    "....#####.......",
    "...#YYYYY#......",
    "...#YyyyyY#.....",
    "...#sssss#......",
    "..##sSsSs##.....",
    "..#nMnMnMn#.....",
    ".#MnMnMnMnM#....",
    ".#MnnMMnnMM#....",
    "..#MMMMMMM#.....",
    "..#sSsSsSs#.....",
    "..#sSsSsSs#.....",
    "..#LLLLLLL#.....",
    "..#ll...ll#.....",
    "...##...##......",
    "................",
  ];
  const WARRIOR_WALK = [
    "................",
    "....#####.......",
    "...#YYYYY#......",
    "...#YyyyyY#.....",
    "...#sssss#......",
    "..##sSsSs##.....",
    ".#nMnMnMnM#.....",
    ".#MnMnMnMnM#....",
    "..#MnnMMnn#.....",
    "..#MMMMMMM#.....",
    "..#sSsSsSs#.....",
    ".#sSsSsSsS#.....",
    "..#LLLLLLL#.....",
    "..#ll....##.....",
    "...##......#....",
    "................",
  ];
  const WARRIOR_ATTACK = [
    "................",
    "....#####...n...",
    "...#YYYYY#.M#...",
    "...#YyyyyYnM#...",
    "...#sssss##M#...",
    "..##sSsSs#nM#...",
    "..#nMnMnMnM#....",
    ".#MnMnMnMnM#....",
    ".#MnnMMnnMM#....",
    ".#nMMMMMMMn#....",
    "..#sSsSsSs#.....",
    "..#sSsSsSs#.....",
    "..#LLLLLLL#.....",
    "..#ll...ll#.....",
    "...##...##......",
    "................",
  ];

  const HUNTER_IDLE = [
    "................",
    "....#####.......",
    "...#HHHHH#......",
    "..#HhhhhhH#.....",
    "..#HssssH#......",
    "..##sSsSs##.....",
    "..#EexxxEe#.....",
    ".#ExeEExeEx#....",
    ".#ExxEEExxE#....",
    "..#EExxxEE#.....",
    "..#sSsSsSs#.....",
    "..#sSsSsSs#.....",
    "..#LLLLLLL#.....",
    "..#ll...ll#.....",
    "...##...##......",
    "................",
  ];
  const HUNTER_WALK = [
    "................",
    "....#####.......",
    "...#HHHHH#......",
    "..#HhhhhhH#.....",
    "..#HssssH#......",
    "..##sSsSs##.....",
    ".#EexxxEeE#.....",
    ".#ExeEExeEx#....",
    "..#ExxEEEx#.....",
    "..#EExxxEE#.....",
    "..#sSsSsSs#.....",
    ".#sSsSsSsS#.....",
    "..#LLLLLLL#.....",
    "..#ll....##.....",
    "...##......#....",
    "................",
  ];
  const HUNTER_ATTACK = [
    "................",
    "....#####.......",
    "...#HHHHH#......",
    "..#HhhhhhH#.....",
    "..#HssssH#......",
    "..##sSsSs##.....",
    "..#Eexxx##wwwww#",
    ".#ExeEExE#......",
    ".#ExxEEEx#......",
    "..#EExxxE#......",
    "..#sSsSsS#......",
    "..#sSsSsSs#....",
    "..#LLLLLLL#.....",
    "..#ll...ll#.....",
    "...##...##......",
    "................",
  ];

  const MAGE_IDLE = [
    "................",
    "....#####.......",
    "...#WWWWW#......",
    "..#W##W##W#.....",
    "..#sssssss#.....",
    "..##sSsSs##.....",
    "..#uPPPPPu#.....",
    ".#uPpPPPpPu#....",
    ".#uPPPPPPPPu#...",
    "..#uPPPPPPu#....",
    "..#uPPPPPu#.....",
    "..#uPPPPu#......",
    "..#uPPPu#.......",
    "...#ll#.........",
    "...##.##........",
    "................",
  ];
  const MAGE_WALK = [
    "................",
    "....#####.......",
    "...#WWWWW#......",
    "..#W##W##W#.....",
    "..#sssssss#.....",
    "..##sSsSs##.....",
    "..#uPPPPPu#.....",
    ".#uPpPPPpPu#....",
    ".#uPPPPPPPPu#...",
    "..#uPPPPPPu#....",
    "..#uPPPPPu#.....",
    "..#uPPPPu#......",
    "..#uPPPu#.......",
    "..#ll..ll#......",
    ".##......##.....",
    "................",
  ];
  const MAGE_ATTACK = [
    "................",
    "....#####...uu..",
    "...#WWWWW#.uPPu.",
    "..#W##W##W#PPp..",
    "..#sssssss#Pu...",
    "..##sSsSs##.....",
    "..#uPPPPPu#.....",
    ".#uPpPPPpPu#....",
    ".#uPPPPPPPPu#...",
    "..#uPPPPPPu#....",
    "..#uPPPPPu#.....",
    "..#uPPPPu#......",
    "..#uPPPu#.......",
    "...#ll#.........",
    "...##.##........",
    "................",
  ];

  // ---- enemy sprites ----------------------------------------------------

  const GOBLIN_IDLE = [
    "................",
    "....#####.......",
    "...#xExxx#......",
    "..#xxExxEx#.....",
    "..#xExxxEx#.....",
    "..#qxqxqxq#.....",
    "..##exExe##.....",
    "...#lLLLl#......",
    "..#lLLLLLl#.....",
    ".#lLLrLLLl#.....",
    ".#lLLLLLLLl#....",
    "..#xExxxEx#.....",
    "..#xxxxxxx#.....",
    "..#xx...xx#.....",
    "...##...##......",
    "................",
  ];

  const WOLF_IDLE = [
    "................",
    ".....#####......",
    "....#nMnMn#.....",
    "....#nrnrn#.....",
    "....#nnnnn#.....",
    ".########MM#....",
    "#MnnnnnnnnMM#...",
    "#MnnnnnnnnnM#...",
    "#MnnnnnnnnnM#...",
    "#nMnnnnnnnnM#...",
    "##MnnnnnnnnM#...",
    ".#MnnnnnnnnM#...",
    "..#MM###MM#.....",
    "...##...##......",
    "................",
    "................",
  ];

  const ORC_IDLE = [
    "................",
    "...#######......",
    "..#eExxxxEe#....",
    ".#exExxxxxEe#...",
    ".#exxxxxxxxe#...",
    ".#qxRxqxqxRe#...",
    "..##exxxxe##....",
    "..#lLLrLLLL#....",
    ".#lLLLLLLLLl#...",
    ".#lLLrrLLLLl#...",
    ".#lLLLLLLLLl#...",
    "..#xExxxxxEx#...",
    "..#xxxxxxxx#....",
    "..#xx....xx#....",
    "..##......##....",
    "................",
  ];

  const BANDIT_IDLE = [
    "................",
    "....#####.......",
    "...#kkkkk#......",
    "..#ksssssk#.....",
    "..#wwsswww#.....",
    "..##sSsSs##.....",
    "..#lLLLLLl#.....",
    ".#lLLnMnLLl#....",
    ".#lLnMnMnLl#....",
    "..#lLnMnLl#.....",
    "..#sSsSsSs#.....",
    "..#sSsSsSs#.....",
    "..#LLLLLLL#.....",
    "..#ll...ll#.....",
    "...##...##......",
    "................",
  ];

  const SKELETON_IDLE = [
    "................",
    "....#####.......",
    "...#WWWWW#......",
    "..#W#W#W#W#.....",
    "..#WWWWWWW#.....",
    "..##W###W##.....",
    "..#nMnMnMn#.....",
    ".#MMMMMMMMM#....",
    ".#MnMnMnMnM#....",
    "..#nMnMnMn#.....",
    "..#WWWWWWW#.....",
    "..#WWWWWWW#.....",
    "..#W#W#W#W#.....",
    "..#W#...#W#.....",
    "...##...##......",
    "................",
  ];

  const DRAGON_IDLE = [
    "................",
    "..##.....##.....",
    ".#RR#...#RR#....",
    "#RqRR###RqRR#...",
    "#RRRRRRRRRRR#...",
    "#RRRYYYYRRRR#...",
    ".#RRY#Y#YRR#....",
    "..#RRYYYRR#.....",
    "..##RRRRR##.....",
    "...#RrRrR#......",
    "..#RrRrRrR#.....",
    ".#RrRrRrRrR#....",
    ".#RR..#..RR#....",
    "..##..#..##.....",
    "...##.#.##......",
    "................",
  ];
  const DRAGON_ATTACK = [
    "................",
    "..##.....##.....",
    ".#RR#...#RR#....",
    "#RqRR###RqRR#YY.",
    "#RRRRRRRRRRRYYYY",
    "#RRRYYYYRRRGGGGG",
    ".#RRY#Y#YRRGYYG.",
    "..#RRYYYRR#YGY..",
    "..##RRRRR##.....",
    "...#RrRrR#......",
    "..#RrRrRrR#.....",
    ".#RrRrRrRrR#....",
    ".#RR..#..RR#....",
    "..##..#..##.....",
    "...##.#.##......",
    "................",
  ];

  // ---- feature tiles: 32x32 (built from 16x16 base, scaled in art) -----
  // Authored at 16x16 for compactness; drawn 2x size on tile canvas.

  const TILE_VILLAGE = [
    "................",
    "....###..###....",
    "...#RRR##RRR#...",
    "..#RrRRRRrRR#...",
    ".#RrRrRRrRrRR#..",
    "#LLLLLL##LLLLL#.",
    "#LdDdL#cb#LdDL#.",
    "#LdddL#bb#LddL#.",
    "#LdddL#cb#LddL#.",
    "#LLLLL####LLLL#.",
    "#dDdDdDdDdDdDd#.",
    ".#dDdDdDdDdDd#..",
    "..#dDdDdDdDd#...",
    "...#dDdDdDd#....",
    "....#######.....",
    "................",
  ];

  const TILE_RUINS = [
    "................",
    "................",
    ".#kk#.......#k#.",
    ".#dd#.#kk#..#d#.",
    ".#dd#.#dd#..#d#.",
    ".#dd#.#dd#..#d#.",
    ".#dDddddDddddDk.",
    ".#DdkkddkkDddDk.",
    ".dDkkkddkkdkkdk.",
    ".kkkdkkddkkdkkk.",
    ".kdkkkdkkkdkkdk.",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];

  const TILE_CHEST = [
    "................",
    "................",
    "................",
    "................",
    "....########....",
    "...#LDDDDDDDL#..",
    "..#LDDDDDDDDDL#.",
    "..#LDyYYYYYyDL#.",
    "..#LDyYGGGYyDL#.",
    "..#LDyYG#GYyDL#.",
    "..#LDyYGGGYyDL#.",
    "..#LDyYYYYYyDL#.",
    "..#LLLLLLLLLLL#.",
    "...############.",
    "................",
    "................",
  ];

  const TILE_LAIR = [
    "................",
    "....######......",
    "..##kkkkkk##....",
    ".#kkkkRkkRkk#...",
    "#kkkRRRkRkkkk#..",
    "#kkRrRkkkkrRk#..",
    "#kRRRkkkkkkkR#..",
    "#kkkkkkRkkkkk#..",
    "#kkRkkkkkkRkk#..",
    ".#kkkkkkkkkk#...",
    "..##kkkkkkk##...",
    "....#######.....",
    "................",
    "................",
    "................",
    "................",
  ];

  // ---------------------------------------------------------------------
  // Build sprite registry. Each sprite is an offscreen canvas (faster than
  // re-parsing pixel grids every frame).
  // ---------------------------------------------------------------------

  function paintFrame(grid, palette) {
    const h = grid.length;
    const w = grid[0].length;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const px = palette || P;
    for (let y = 0; y < h; y++) {
      const row = grid[y];
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        const i = (y * w + x) * 4;
        if (ch === '.' || ch === undefined) {
          img.data[i + 3] = 0;
        } else {
          const c = px[ch];
          if (!c) { img.data[i + 3] = 0; continue; }
          const r = parseInt(c.slice(1, 3), 16);
          const g = parseInt(c.slice(3, 5), 16);
          const b = parseInt(c.slice(5, 7), 16);
          img.data[i]     = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function mirror(cv) {
    const out = document.createElement('canvas');
    out.width = cv.width;
    out.height = cv.height;
    const ctx = out.getContext('2d');
    ctx.translate(cv.width, 0);
    ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 0, 0);
    return out;
  }

  // Procedurally generated terrain tiles (32x32). Use simple noise patterns
  // baked once at boot.
  function buildTerrain(seedColors) {
    const size = 32;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    // Base fill.
    ctx.fillStyle = seedColors.base;
    ctx.fillRect(0, 0, size, size);
    // Speckle pattern from a deterministic pseudo-random function.
    const accent = seedColors.accent;
    const hi = seedColors.hi;
    const dark = seedColors.dark;
    let s = seedColors.seed || 12345;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    for (let i = 0; i < (seedColors.speckles || 80); i++) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      const r = rand();
      ctx.fillStyle = (r < 0.33) ? accent : (r < 0.66 ? hi : dark);
      const sz = 1 + Math.floor(rand() * (seedColors.maxSize || 2));
      ctx.fillRect(x, y, sz, sz);
    }
    if (seedColors.extras) seedColors.extras(ctx, rand, size);
    return cv;
  }

  const TERRAIN = {
    grass: buildTerrain({ base: '#3a7a3a', accent: '#4a8a4a', hi: '#5aaa5a', dark: '#2a5a2a', seed: 1, speckles: 100 }),
    forest: buildTerrain({
      base: '#1a4020', accent: '#2a5a2a', hi: '#3a6a3a', dark: '#0a2810', seed: 7, speckles: 60,
      extras: (ctx, rand) => {
        // a few "trees" — dark triangles
        for (let i = 0; i < 4; i++) {
          const x = 3 + Math.floor(rand() * 24);
          const y = 4 + Math.floor(rand() * 22);
          ctx.fillStyle = '#0a2810';
          ctx.fillRect(x, y, 5, 5);
          ctx.fillStyle = '#2a5a2a';
          ctx.fillRect(x + 1, y + 1, 3, 3);
          ctx.fillStyle = '#5a3a18';
          ctx.fillRect(x + 2, y + 5, 1, 2);
        }
      }
    }),
    hills: buildTerrain({
      base: '#7a6a3a', accent: '#9a8a4a', hi: '#b09a5a', dark: '#5a4a28', seed: 11, speckles: 70,
      extras: (ctx, rand) => {
        for (let i = 0; i < 3; i++) {
          const x = 2 + Math.floor(rand() * 22);
          const y = 8 + Math.floor(rand() * 18);
          ctx.fillStyle = '#5a4a28';
          ctx.fillRect(x, y, 8, 4);
          ctx.fillStyle = '#b09a5a';
          ctx.fillRect(x + 2, y, 4, 2);
        }
      }
    }),
    water: buildTerrain({
      base: '#1a3a7a', accent: '#2a4a9a', hi: '#3a5aba', dark: '#0a2a5a', seed: 5, speckles: 50,
      extras: (ctx, rand) => {
        // Wave lines.
        ctx.fillStyle = '#5a7adc';
        for (let i = 0; i < 6; i++) {
          const x = Math.floor(rand() * 28);
          const y = Math.floor(rand() * 32);
          ctx.fillRect(x, y, 4, 1);
        }
      }
    }),
    path: buildTerrain({
      base: '#8a6a40', accent: '#a07a50', hi: '#b08a60', dark: '#6a5028', seed: 3, speckles: 90, maxSize: 1
    }),
    sand: buildTerrain({
      base: '#d4b870', accent: '#e0c87a', hi: '#f0d890', dark: '#a08a50', seed: 9, speckles: 80
    }),
  };

  // ----- Register all sprites --------------------------------------------
  const SPRITES = {};
  function reg(name, frames, opts) {
    opts = opts || {};
    const built = frames.map(f => paintFrame(f, opts.palette || P));
    SPRITES[name] = { frames: built };
    if (opts.mirror) {
      SPRITES[name + '_l'] = { frames: built.map(mirror) };
    }
  }

  reg('warrior_idle', [WARRIOR_IDLE]);
  reg('warrior_walk', [WARRIOR_WALK, WARRIOR_IDLE]);
  reg('warrior_attack', [WARRIOR_ATTACK]);
  reg('hunter_idle', [HUNTER_IDLE]);
  reg('hunter_walk', [HUNTER_WALK, HUNTER_IDLE]);
  reg('hunter_attack', [HUNTER_ATTACK]);
  reg('mage_idle', [MAGE_IDLE]);
  reg('mage_walk', [MAGE_WALK, MAGE_IDLE]);
  reg('mage_attack', [MAGE_ATTACK]);

  reg('goblin_idle', [GOBLIN_IDLE]);
  reg('wolf_idle', [WOLF_IDLE]);
  reg('orc_idle', [ORC_IDLE]);
  reg('bandit_idle', [BANDIT_IDLE]);
  reg('skeleton_idle', [SKELETON_IDLE]);
  reg('dragon_idle', [DRAGON_IDLE]);
  reg('dragon_attack', [DRAGON_ATTACK]);

  reg('feature_village', [TILE_VILLAGE]);
  reg('feature_ruins', [TILE_RUINS]);
  reg('feature_chest', [TILE_CHEST]);
  reg('feature_lair', [TILE_LAIR]);

  // Map data.* class id → idle/walk/attack sprite key
  const CLASS_SPRITE = {
    warrior: 'warrior',
    hunter:  'hunter',
    mage:    'mage',
  };
  // Map enemy type → sprite key
  const ENEMY_SPRITE = {
    goblin: 'goblin_idle',
    wolf:   'wolf_idle',
    orc:    'orc_idle',
    bandit: 'bandit_idle',
    skeleton: 'skeleton_idle',
    dragon: 'dragon_idle',
  };

  window.SPRITES = SPRITES;
  window.TERRAIN = TERRAIN;
  window.CLASS_SPRITE = CLASS_SPRITE;
  window.ENEMY_SPRITE = ENEMY_SPRITE;
})();
