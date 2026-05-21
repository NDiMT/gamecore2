// Voxel 3D world renderer built on top of Three.js. The 2D pixel sprites
// are still used for HUD/class icons; in-world everything is composed of
// stacked boxes for a Minecraft-style aesthetic.
//
// External API mirrors the previous 2D renderer so ui.js doesn't change:
//   attach(container) / detach() / resize() / start() / stop()
//   setCombatTargetMode(bool)
//   onTileTap(x, y, tile), onEnemyTap(enemyIdx)
(function () {
  'use strict';

  // ---- visual palettes -------------------------------------------------
  const TERRAIN_COLOR = {
    grass:  { top: 0x4a8a3a, side: 0x3a6a2a, height: 0.20 },
    forest: { top: 0x2a5a2a, side: 0x1a3a1a, height: 0.30 },
    hills:  { top: 0x8a7044, side: 0x5a4a28, height: 0.55 },
    water:  { top: 0x2a5aa0, side: 0x1a3a7a, height: 0.06 },
    path:   { top: 0xb08a60, side: 0x6a5028, height: 0.18 },
    sand:   { top: 0xe0c87a, side: 0xa08a50, height: 0.16 }
  };

  const CLASS_VISUAL = {
    warrior: {
      skin:  0xc89a72, hair: 0xf8d870,
      body:  0x6a6a8a, accent: 0xc43b3b,
      arms:  0x6a6a8a, legs:  0x5a3a18
    },
    hunter: {
      skin:  0xc89a72, hair: 0x3a2410,
      body:  0x3a7a3a, accent: 0xd4a040,
      arms:  0x6a4a28, legs:  0x4a3018
    },
    mage: {
      skin:  0xc89a72, hair: 0xf0e8d8,
      body:  0x5a30a0, accent: 0xffd770,
      arms:  0x5a30a0, legs:  0x3a1850
    }
  };

  const ENEMY_VISUAL = {
    goblin:   { body: 0x6aa84a, head: 0x4a8a4a, accent: 0xc43b3b, scale: 0.85 },
    wolf:     { body: 0x6a6a78, head: 0x8a8a98, accent: 0xc43b3b, scale: 0.7, prone: true },
    orc:      { body: 0x3a6a3a, head: 0x2a5a2a, accent: 0x7a1818, scale: 1.1 },
    bandit:   { body: 0x3a2418, head: 0xb07c50, accent: 0xffd770, scale: 1.0 },
    skeleton: { body: 0xe0d8c0, head: 0xfffdf0, accent: 0x4a4a5a, scale: 1.0 },
    dragon:   { body: 0xc43b3b, head: 0x7a1818, accent: 0xf8d870, scale: 1.6, prone: true }
  };

  const TILE_SIZE = 1;            // world units per tile
  const VIEW_DISTANCE = 6;        // camera offset back
  const VIEW_HEIGHT = 7;          // camera offset up
  const WALK_MS = 320;            // walk anim per tile
  const CAM_LERP_MS = 480;        // camera follow lerp
  const ATTACK_MS = 480;          // attack anim duration

  function tileTopY(terrain) {
    const t = TERRAIN_COLOR[terrain] || TERRAIN_COLOR.grass;
    return t.height;
  }
  function tileCenter(x, y, terrain) {
    return new THREE.Vector3(x * TILE_SIZE, tileTopY(terrain), y * TILE_SIZE);
  }

  // Tilted limb pivot — origin at top so rotation swings the limb naturally.
  function makeLimb(w, h, d, color) {
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.y = -h / 2;
    grp.add(mesh);
    return grp;
  }

  function buildCharacter(visual) {
    const grp = new THREE.Group();
    const v = visual;
    // legs (pivot at hip y=0.5)
    const leftLeg  = makeLimb(0.22, 0.5, 0.22, v.legs); leftLeg.position.set(-0.13, 0.5, 0);
    const rightLeg = makeLimb(0.22, 0.5, 0.22, v.legs); rightLeg.position.set(0.13, 0.5, 0);
    grp.add(leftLeg, rightLeg);
    // body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.55, 0.3),
      new THREE.MeshLambertMaterial({ color: v.body })
    );
    body.position.set(0, 0.78, 0);
    grp.add(body);
    // accent stripe on chest
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.55, 0.32),
      new THREE.MeshLambertMaterial({ color: v.accent })
    );
    stripe.position.set(0, 0.78, 0.005);
    grp.add(stripe);
    // arms (pivot at shoulder y=1.05)
    const leftArm  = makeLimb(0.18, 0.5, 0.18, v.arms); leftArm.position.set(-0.34, 1.05, 0);
    const rightArm = makeLimb(0.18, 0.5, 0.18, v.arms); rightArm.position.set(0.34, 1.05, 0);
    grp.add(leftArm, rightArm);
    // head
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: v.skin })
    );
    head.position.set(0, 1.32, 0);
    grp.add(head);
    // hair tuft
    const hair = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.12, 0.46),
      new THREE.MeshLambertMaterial({ color: v.hair })
    );
    hair.position.set(0, 1.58, 0);
    grp.add(hair);

    grp.userData = { leftLeg, rightLeg, leftArm, rightArm, body, head, hair, baseY: 0 };
    return grp;
  }

  function buildEnemy(type) {
    const v = ENEMY_VISUAL[type] || ENEMY_VISUAL.goblin;
    const grp = new THREE.Group();
    const scl = v.scale || 1;
    if (v.prone) {
      // Quadruped (wolf, dragon).
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.4, 0.4),
        new THREE.MeshLambertMaterial({ color: v.body })
      );
      body.position.set(0, 0.3, 0);
      grp.add(body);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, 0.36),
        new THREE.MeshLambertMaterial({ color: v.head })
      );
      head.position.set(0.45, 0.5, 0);
      grp.add(head);
      const legGeo = new THREE.BoxGeometry(0.14, 0.3, 0.14);
      const legMat = new THREE.MeshLambertMaterial({ color: v.body });
      const positions = [[-0.25, 0.15, -0.15], [-0.25, 0.15, 0.15], [0.25, 0.15, -0.15], [0.25, 0.15, 0.15]];
      const legs = [];
      for (const [x, y, z] of positions) {
        const l = new THREE.Mesh(legGeo, legMat);
        l.position.set(x, y, z);
        grp.add(l);
        legs.push(l);
      }
      // dragon: add wings + horns
      if (type === 'dragon') {
        const wingL = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.06, 0.4),
          new THREE.MeshLambertMaterial({ color: 0x7a1818 })
        );
        wingL.position.set(-0.05, 0.7, 0.4);
        wingL.rotation.z = 0.3;
        grp.add(wingL);
        const wingR = wingL.clone();
        wingR.position.z = -0.4;
        wingR.rotation.z = -0.3;
        grp.add(wingR);
        const hornL = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.2, 0.08),
          new THREE.MeshLambertMaterial({ color: v.accent })
        );
        hornL.position.set(0.6, 0.78, -0.12);
        grp.add(hornL);
        const hornR = hornL.clone();
        hornR.position.z = 0.12;
        grp.add(hornR);
      }
      grp.userData = { head, body, legs };
    } else {
      // Bipedal enemy.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.55, 0.3),
        new THREE.MeshLambertMaterial({ color: v.body })
      );
      body.position.set(0, 0.78, 0);
      grp.add(body);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.46, 0.46),
        new THREE.MeshLambertMaterial({ color: v.head })
      );
      head.position.set(0, 1.34, 0);
      grp.add(head);
      const leftLeg  = makeLimb(0.22, 0.5, 0.22, v.body); leftLeg.position.set(-0.13, 0.5, 0);
      const rightLeg = makeLimb(0.22, 0.5, 0.22, v.body); rightLeg.position.set(0.13, 0.5, 0);
      const leftArm  = makeLimb(0.18, 0.5, 0.18, v.body); leftArm.position.set(-0.34, 1.05, 0);
      const rightArm = makeLimb(0.18, 0.5, 0.18, v.body); rightArm.position.set(0.34, 1.05, 0);
      // weapon hint via accent block in right hand
      const wpn = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.25, 0.08),
        new THREE.MeshLambertMaterial({ color: v.accent })
      );
      wpn.position.set(0, -0.4, 0.1);
      rightArm.add(wpn);
      grp.add(leftLeg, rightLeg, leftArm, rightArm);
      grp.userData = { body, head, leftLeg, rightLeg, leftArm, rightArm };
    }
    grp.scale.setScalar(scl);
    return grp;
  }

  function buildFeature(type) {
    const grp = new THREE.Group();
    if (type === 'village') {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.45, 0.55),
        new THREE.MeshLambertMaterial({ color: 0xa05a3a })
      );
      wall.position.y = 0.225;
      grp.add(wall);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.18, 0.65),
        new THREE.MeshLambertMaterial({ color: 0x5a1818 })
      );
      roof.position.y = 0.54;
      grp.add(roof);
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.28, 0.04),
        new THREE.MeshLambertMaterial({ color: 0x3a2410 })
      );
      door.position.set(0, 0.18, 0.29);
      grp.add(door);
    } else if (type === 'ruins') {
      const colors = [0x6a6a6a, 0x5a5a5a, 0x787878];
      for (let i = 0; i < 4; i++) {
        const s = 0.18 + Math.random() * 0.18;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(s, s, s),
          new THREE.MeshLambertMaterial({ color: colors[i % colors.length] })
        );
        m.position.set(
          (Math.random() - 0.5) * 0.6,
          s / 2,
          (Math.random() - 0.5) * 0.6
        );
        m.rotation.y = Math.random() * Math.PI;
        grp.add(m);
      }
    } else if (type === 'chest') {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.3, 0.35),
        new THREE.MeshLambertMaterial({ color: 0x6a3a18 })
      );
      base.position.y = 0.15;
      grp.add(base);
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.1, 0.36),
        new THREE.MeshLambertMaterial({ color: 0x4a2410 })
      );
      lid.position.y = 0.34;
      grp.add(lid);
      const gold = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.04, 0.28),
        new THREE.MeshLambertMaterial({ color: 0xf8d870, emissive: 0xd4a040, emissiveIntensity: 0.4 })
      );
      gold.position.y = 0.31;
      grp.add(gold);
    } else if (type === 'lair') {
      // Dark mound with skull on top.
      const mound = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.5, 0.8),
        new THREE.MeshLambertMaterial({ color: 0x2a1a1a })
      );
      mound.position.y = 0.25;
      grp.add(mound);
      const skull = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshLambertMaterial({ color: 0xf0e8d8 })
      );
      skull.position.y = 0.65;
      grp.add(skull);
      // Eyes glowing red.
      const eyeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.04);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.06, 0.65, 0.16);
      grp.add(eyeL);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.06, 0.65, 0.16);
      grp.add(eyeR);
    }
    return grp;
  }

  // ---- Renderer ---------------------------------------------------------
  class Renderer {
    constructor(game) {
      this.game = game;
      this.cv = document.createElement('canvas');
      this.cv.className = 'world-canvas';
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x1a0d2e);
      this.scene.fog = new THREE.Fog(0x1a0d2e, 8, 18);

      this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60);
      this.cameraTarget = new THREE.Vector3(0, 0, 0);
      this.cameraFocus  = new THREE.Vector3(0, 0, 0);

      try {
        this.threeRenderer = new THREE.WebGLRenderer({ canvas: this.cv, antialias: false, powerPreference: 'low-power' });
      } catch (e) {
        this.threeRenderer = null;
      }
      if (this.threeRenderer) {
        this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      }

      this.scene.add(new THREE.AmbientLight(0x9090b0, 0.65));
      const sun = new THREE.DirectionalLight(0xffeecc, 0.8);
      sun.position.set(6, 12, 4);
      this.scene.add(sun);
      const fill = new THREE.DirectionalLight(0x8090ff, 0.25);
      fill.position.set(-4, 6, -3);
      this.scene.add(fill);

      this.worldGroup = new THREE.Group(); this.scene.add(this.worldGroup);
      this.featureGroup = new THREE.Group(); this.scene.add(this.featureGroup);
      this.markerGroup = new THREE.Group(); this.scene.add(this.markerGroup);
      this.playerGroup = new THREE.Group(); this.scene.add(this.playerGroup);
      this.enemyGroup = new THREE.Group(); this.scene.add(this.enemyGroup);
      this.fxGroup = new THREE.Group(); this.scene.add(this.fxGroup);

      this.tileMeshes = []; // [{x, y, mesh, fogMesh}]
      this.featureMeshes = {}; // "x,y" → mesh
      this.combatMarkers = {}; // "x,y" → mesh
      this.playerObjects = {}; // playerId → { group, animState }
      this.enemyObjects = []; // [{ group, idx, type, baseY }]
      this.highlightMeshes = []; // adjacent-tile glow

      this.lastMapId = null;
      this.lastSeenActive = null;
      this.lastSeenPositions = {}; // pid → {x,y}

      this.lastRollTs = 0;
      this.attackActor = null;
      this.attackStart = 0;
      this.hitTargets = [];

      this.raycaster = new THREE.Raycaster();
      this.pointer = new THREE.Vector2();
      this.onTileTap = null;
      this.onEnemyTap = null;
      this.combatTargetMode = false;

      this._bindEvents();
    }

    _bindEvents() {
      this.cv.addEventListener('pointerdown', (e) => {
        const rect = this.cv.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this._handleTap();
      });
    }
    _handleTap() {
      if (!this.threeRenderer) return;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const s = this.game.state;
      if (s.phase === 'combat') {
        // Cast at enemies.
        const objs = this.enemyObjects.map(e => e.group);
        const hits = this.raycaster.intersectObjects(objs, true);
        if (hits.length) {
          // Walk up to find the enemy group.
          let node = hits[0].object;
          while (node && !node.userData.enemyIdx && node.parent) node = node.parent;
          const idx = node && node.userData.enemyIdx;
          if (idx != null && this.onEnemyTap) this.onEnemyTap(idx);
        }
        return;
      }
      if (s.phase === 'overworld') {
        // Cast at tiles.
        const meshes = this.tileMeshes.map(t => t.mesh);
        const hits = this.raycaster.intersectObjects(meshes);
        if (hits.length) {
          const hit = hits[0].object;
          const x = hit.userData.tx, y = hit.userData.ty;
          const tile = s.map.tiles[y * s.map.w + x];
          if (this.onTileTap) this.onTileTap(x, y, tile);
        }
      }
    }

    setCombatTargetMode(on) { this.combatTargetMode = on; }
    attach(container) {
      container.appendChild(this.cv);
      this.resize();
    }
    detach() {
      cancelAnimationFrame(this.raf);
      if (this.cv.parentElement) this.cv.parentElement.removeChild(this.cv);
    }
    resize() {
      const parent = this.cv.parentElement;
      if (!parent) return;
      const w = parent.clientWidth || 320;
      const h = Math.round(w * 0.72);
      this.cv.style.width = w + 'px';
      this.cv.style.height = h + 'px';
      if (this.threeRenderer) this.threeRenderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }

    start() {
      cancelAnimationFrame(this.raf);
      const loop = (t) => {
        this.draw(t || performance.now());
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
    stop() { cancelAnimationFrame(this.raf); }

    // ---- world rebuild ------------------------------------------------
    _maybeRebuildWorld() {
      const s = this.game.state;
      if (!s.map) return;
      // Use map identity (object reference) as a freshness key.
      if (this.lastMapId === s.map) {
        this._refreshTileDecor();
        return;
      }
      this.lastMapId = s.map;
      this._clearGroup(this.worldGroup);
      this._clearGroup(this.featureGroup);
      this._clearGroup(this.markerGroup);
      this.tileMeshes = [];
      this.featureMeshes = {};
      this.combatMarkers = {};
      const map = s.map;
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          const tile = map.tiles[y * map.w + x];
          const cfg = TERRAIN_COLOR[tile.terrain] || TERRAIN_COLOR.grass;
          // Use separate top/side colours so tiles look like a Minecraft block.
          const mats = [
            new THREE.MeshLambertMaterial({ color: cfg.side }),
            new THREE.MeshLambertMaterial({ color: cfg.side }),
            new THREE.MeshLambertMaterial({ color: cfg.top }),
            new THREE.MeshLambertMaterial({ color: cfg.side }),
            new THREE.MeshLambertMaterial({ color: cfg.side }),
            new THREE.MeshLambertMaterial({ color: cfg.side })
          ];
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, cfg.height, TILE_SIZE), mats);
          mesh.position.set(x * TILE_SIZE, cfg.height / 2, y * TILE_SIZE);
          mesh.userData = { tx: x, ty: y };
          this.worldGroup.add(mesh);
          this.tileMeshes.push({ x, y, mesh, terrain: tile.terrain, height: cfg.height });
          if (tile.feature) this._addFeature(x, y, tile);
        }
      }
      this._refreshTileDecor();
    }
    _addFeature(x, y, tile) {
      const f = buildFeature(tile.feature);
      if (!f) return;
      const cfg = TERRAIN_COLOR[tile.terrain] || TERRAIN_COLOR.grass;
      f.position.set(x * TILE_SIZE, cfg.height, y * TILE_SIZE);
      this.featureGroup.add(f);
      this.featureMeshes[`${x},${y}`] = f;
    }
    _refreshTileDecor() {
      // Combat markers (sword block) on discovered, uncleared combat tiles.
      const s = this.game.state;
      if (!s.map) return;
      // Remove markers for tiles no longer needing them.
      for (const key in this.combatMarkers) {
        const [xs, ys] = key.split(',').map(Number);
        const t = s.map.tiles[ys * s.map.w + xs];
        if (!t.enemies || t.cleared || !t.discovered) {
          this.markerGroup.remove(this.combatMarkers[key]);
          delete this.combatMarkers[key];
        }
      }
      // Add new ones.
      for (let y = 0; y < s.map.h; y++) {
        for (let x = 0; x < s.map.w; x++) {
          const t = s.map.tiles[y * s.map.w + x];
          if (!t.enemies || t.cleared || !t.discovered) continue;
          const key = `${x},${y}`;
          if (this.combatMarkers[key]) continue;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.18, 0.18),
            new THREE.MeshBasicMaterial({ color: 0xff3030 })
          );
          const cfg = TERRAIN_COLOR[t.terrain] || TERRAIN_COLOR.grass;
          m.position.set(x * TILE_SIZE, cfg.height + 0.5, y * TILE_SIZE);
          m.userData.bobBase = m.position.y;
          this.markerGroup.add(m);
          this.combatMarkers[key] = m;
        }
      }
    }
    _clearGroup(g) {
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      }
    }

    // ---- player object management -------------------------------------
    _ensurePlayerObjects() {
      const s = this.game.state;
      const seen = new Set();
      for (const p of s.players) {
        if (!p.classId) continue;
        seen.add(p.id);
        if (!this.playerObjects[p.id]) {
          const obj = buildCharacter(CLASS_VISUAL[p.classId] || CLASS_VISUAL.warrior);
          obj.userData.playerId = p.id;
          this.playerGroup.add(obj);
          this.playerObjects[p.id] = {
            group: obj,
            x: p.x, y: p.y,
            fromX: p.x, fromY: p.y,
            targetX: p.x, targetY: p.y,
            walking: false,
            walkStart: 0,
            facing: 0,
            baseY: 0,
            dead: false
          };
        }
      }
      // Remove stale players.
      for (const id in this.playerObjects) {
        if (!seen.has(id)) {
          const obj = this.playerObjects[id];
          this.playerGroup.remove(obj.group);
          delete this.playerObjects[id];
        }
      }
    }
    _ensureEnemyObjects() {
      const s = this.game.state;
      const combat = s.combat;
      if (!combat) {
        // Despawn all.
        while (this.enemyObjects.length) {
          this.enemyGroup.remove(this.enemyObjects.pop().group);
        }
        return;
      }
      // Reset if enemy list identity changed (new combat).
      if (this.enemyObjects.length !== combat.enemies.length || (this.enemyObjects[0] && this.enemyObjects[0].combat !== combat)) {
        while (this.enemyObjects.length) {
          this.enemyGroup.remove(this.enemyObjects.pop().group);
        }
        const center = combat.tileRef;
        const map = s.map;
        const cfg = map ? TERRAIN_COLOR[map.tiles[center.y * map.w + center.x].terrain] : TERRAIN_COLOR.grass;
        const baseY = (cfg ? cfg.height : 0);
        for (let i = 0; i < combat.enemies.length; i++) {
          const e = combat.enemies[i];
          const g = buildEnemy(e.type);
          g.userData = { enemyIdx: e.idx, type: e.type, baseY };
          // Arrange enemies in a small arc on the far side of the tile.
          const angle = -Math.PI / 2 + (i - (combat.enemies.length - 1) / 2) * 0.5;
          const radius = 1.0;
          const ex = center.x + Math.cos(angle) * radius;
          const ez = center.y + Math.sin(angle) * radius;
          g.position.set(ex, baseY, ez);
          g.rotation.y = Math.PI; // face south by default
          // Look toward party position (center of tile).
          this._faceToward(g, center.x, center.y);
          this.enemyGroup.add(g);
          this.enemyObjects.push({ group: g, idx: e.idx, type: e.type, baseY, combat, hp: e.hp, maxHp: e.maxHp });
        }
      }
    }
    _faceToward(group, targetX, targetZ) {
      const dx = targetX - group.position.x;
      const dz = targetZ - group.position.z;
      group.rotation.y = Math.atan2(dx, dz);
    }

    // ---- per-frame draw -----------------------------------------------
    draw(now) {
      if (!this.threeRenderer) return;
      const s = this.game.state;
      if (!s.map) { this.threeRenderer.render(this.scene, this.camera); return; }
      this._maybeRebuildWorld();
      this._ensurePlayerObjects();
      this._ensureEnemyObjects();
      this._syncPlayerPositions(now);
      this._animateCharacters(now);
      this._updateCamera(now, s);
      this._updateHighlights(now);
      this._updateMarkers(now);
      this._updateFogAndDecor(now);
      this._updateAttackAnim(now);
      this.threeRenderer.render(this.scene, this.camera);
    }

    _syncPlayerPositions(now) {
      const s = this.game.state;
      for (const p of s.players) {
        if (!p.classId) continue;
        const obj = this.playerObjects[p.id];
        if (!obj) continue;
        const last = this.lastSeenPositions[p.id];
        if (!last || last.x !== p.x || last.y !== p.y) {
          if (last && (last.x !== p.x || last.y !== p.y)) {
            obj.fromX = obj.x;
            obj.fromY = obj.y;
            obj.targetX = p.x;
            obj.targetY = p.y;
            obj.walking = true;
            obj.walkStart = now;
            // Update facing.
            const dx = p.x - last.x, dy = p.y - last.y;
            if (dx !== 0 || dy !== 0) obj.facing = Math.atan2(dx, dy);
          } else {
            // First seen — snap.
            obj.x = p.x; obj.y = p.y;
            obj.fromX = p.x; obj.fromY = p.y;
            obj.targetX = p.x; obj.targetY = p.y;
          }
          this.lastSeenPositions[p.id] = { x: p.x, y: p.y };
        }
        // Apply walk anim.
        if (obj.walking) {
          const t = (now - obj.walkStart) / WALK_MS;
          if (t >= 1) {
            obj.x = obj.targetX; obj.y = obj.targetY;
            obj.walking = false;
          } else {
            const e = 1 - Math.pow(1 - t, 2);
            obj.x = obj.fromX + (obj.targetX - obj.fromX) * e;
            obj.y = obj.fromY + (obj.targetY - obj.fromY) * e;
          }
        }
        // Determine terrain height at current tile for base Y.
        const tx = Math.round(obj.x), ty = Math.round(obj.y);
        const tile = s.map.tiles[ty * s.map.w + tx];
        const cfg = tile ? (TERRAIN_COLOR[tile.terrain] || TERRAIN_COLOR.grass) : TERRAIN_COLOR.grass;
        obj.baseY = cfg.height;
        obj.dead = !p.alive || p.hp <= 0;
        // Apply transform.
        obj.group.position.set(obj.x * TILE_SIZE, obj.baseY, obj.y * TILE_SIZE);
        obj.group.rotation.y = obj.facing;
      }
    }

    _animateCharacters(now) {
      // Player walk cycle / idle bob / death tilt.
      for (const pid in this.playerObjects) {
        const obj = this.playerObjects[pid];
        const g = obj.group;
        const ud = g.userData;
        if (obj.dead) {
          g.rotation.x = -Math.PI / 2;
          g.position.y = obj.baseY + 0.1;
          continue;
        } else {
          g.rotation.x = 0;
        }
        if (obj.walking) {
          const phase = (now / 110);
          const swing = Math.sin(phase) * 0.6;
          ud.leftLeg.rotation.x = swing;
          ud.rightLeg.rotation.x = -swing;
          ud.leftArm.rotation.x = -swing;
          ud.rightArm.rotation.x = swing;
          g.position.y = obj.baseY + Math.abs(Math.sin(phase * 2)) * 0.04;
        } else {
          // Idle: smooth zero plus subtle bob.
          ud.leftLeg.rotation.x *= 0.7;
          ud.rightLeg.rotation.x *= 0.7;
          ud.leftArm.rotation.x *= 0.7;
          ud.rightArm.rotation.x *= 0.7;
          g.position.y = obj.baseY + Math.sin(now / 500 + pid.charCodeAt(1)) * 0.025;
        }
      }
      // Enemy idle bob.
      for (const eo of this.enemyObjects) {
        eo.group.position.y = eo.baseY + Math.sin(now / 480 + eo.idx) * 0.05;
      }
    }

    _updateCamera(now, s) {
      const active = s.players[s.activeIdx];
      if (!active) return;
      const obj = this.playerObjects[active.id];
      const fx = obj ? obj.x : active.x;
      const fy = obj ? obj.y : active.y;
      // Smooth-lerp the camera focus.
      const dt = Math.min(50, performance.now() - (this._camLastTs || performance.now()));
      this._camLastTs = performance.now();
      const k = 1 - Math.pow(0.001, dt / CAM_LERP_MS); // ease constant per millisecond
      this.cameraFocus.x += (fx - this.cameraFocus.x) * k;
      this.cameraFocus.z += (fy - this.cameraFocus.z) * k;
      this.cameraFocus.y += (obj ? obj.baseY : 0) - this.cameraFocus.y * 0; // keep ground-level focus
      const cam = this.camera;
      cam.position.set(
        this.cameraFocus.x + 0,
        this.cameraFocus.y + VIEW_HEIGHT,
        this.cameraFocus.z + VIEW_DISTANCE
      );
      cam.lookAt(this.cameraFocus.x, this.cameraFocus.y, this.cameraFocus.z);
    }

    _updateHighlights(now) {
      // Adjacent-tile glow markers when local active player can move.
      const s = this.game.state;
      const active = s.players[s.activeIdx];
      const show = (s.phase === 'overworld' && active && this._isLocallyControlled(active));
      // Clear old.
      for (const h of this.highlightMeshes) this.fxGroup.remove(h);
      this.highlightMeshes = [];
      if (!show) return;
      const neighbours = [[active.x+1,active.y],[active.x-1,active.y],[active.x,active.y+1],[active.x,active.y-1]];
      for (const [x, y] of neighbours) {
        if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) continue;
        const t = s.map.tiles[y * s.map.w + x];
        if (!t || t.terrain === 'water') continue;
        const cfg = TERRAIN_COLOR[t.terrain] || TERRAIN_COLOR.grass;
        const alpha = 0.4 + 0.4 * Math.sin(now / 250);
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(TILE_SIZE * 0.95, TILE_SIZE * 0.95),
          new THREE.MeshBasicMaterial({ color: 0xffd770, transparent: true, opacity: alpha })
        );
        m.position.set(x * TILE_SIZE, cfg.height + 0.02, y * TILE_SIZE);
        m.rotation.x = -Math.PI / 2;
        this.fxGroup.add(m);
        this.highlightMeshes.push(m);
      }
    }

    _isLocallyControlled(p) {
      const net = window.NET;
      if (!net) return p.id === this.game.myId;
      if (net.mode === 'solo') return true;
      if (net.mode === 'host') return p.id === this.game.myId || p.isLocal;
      return p.id === this.game.myId;
    }

    _updateMarkers(now) {
      for (const key in this.combatMarkers) {
        const m = this.combatMarkers[key];
        m.position.y = m.userData.bobBase + Math.sin(now / 250) * 0.1;
        m.rotation.y = now / 600;
      }
      // Targeting overlay on enemies.
      for (const eo of this.enemyObjects) {
        const e = this.game.state.combat ? this.game.state.combat.enemies[eo.idx] : null;
        if (this.combatTargetMode && e && e.alive) {
          if (!eo.ring) {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.45, 0.55, 16),
              new THREE.MeshBasicMaterial({ color: 0xffd770, transparent: true, opacity: 0.8 })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = -eo.baseY + 0.02;
            eo.group.add(ring);
            eo.ring = ring;
          }
          if (eo.ring) eo.ring.material.opacity = 0.5 + 0.5 * Math.sin(now / 200);
        } else if (eo.ring) {
          eo.group.remove(eo.ring);
          eo.ring.material.dispose();
          eo.ring.geometry.dispose();
          eo.ring = null;
        }
      }
    }

    _updateFogAndDecor(/*now*/) {
      // Discover-based tile darkening: undiscovered tiles get a black overlay
      // emulated via material brightness.
      const s = this.game.state;
      if (!s.map) return;
      for (const tm of this.tileMeshes) {
        const tile = s.map.tiles[tm.y * s.map.w + tm.x];
        const target = tile.discovered ? 1.0 : 0.25;
        // Adjust each face material's color by scaling brightness toward base.
        // We achieve this by setting an emissive-like base color via .color.
        // Cache previous to avoid setHex churn.
        if (tm.lastDiscovered === tile.discovered) continue;
        tm.lastDiscovered = tile.discovered;
        const cfg = TERRAIN_COLOR[tm.terrain] || TERRAIN_COLOR.grass;
        const mats = tm.mesh.material;
        if (Array.isArray(mats)) {
          mats[0].color.setHex(this._dim(cfg.side, target));
          mats[1].color.setHex(this._dim(cfg.side, target));
          mats[2].color.setHex(this._dim(cfg.top,  target));
          mats[3].color.setHex(this._dim(cfg.side, target));
          mats[4].color.setHex(this._dim(cfg.side, target));
          mats[5].color.setHex(this._dim(cfg.side, target));
        }
        const feat = this.featureMeshes[`${tm.x},${tm.y}`];
        if (feat) feat.visible = tile.discovered;
      }
    }
    _dim(hex, factor) {
      const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
      return ((r * factor) << 16 | (g * factor) << 8 | (b * factor)) & 0xffffff;
    }

    _updateAttackAnim(now) {
      const s = this.game.state;
      const lr = s.lastRoll;
      if (lr && lr.ts && lr.ts !== this.lastRollTs) {
        this.lastRollTs = lr.ts;
        this.attackActor = lr.actor;
        this.attackStart = now;
        // Mark hit targets.
        if (lr.target === 'all') {
          for (const eo of this.enemyObjects) this.hitTargets.push({ key: 'e' + eo.idx, until: now + 500 });
        } else if (lr.target && lr.dmg) {
          this.hitTargets.push({ key: lr.target, until: now + 500 });
        }
      }
      this.hitTargets = this.hitTargets.filter(h => h.until > now);
      // Apply attack lunge to the attacker.
      const dt = now - this.attackStart;
      const t = dt / ATTACK_MS;
      const lunge = (t > 0 && t < 1) ? Math.sin(t * Math.PI) * 0.4 : 0;
      // Reset all bonus offsets first.
      for (const pid in this.playerObjects) {
        const obj = this.playerObjects[pid];
        obj.group.position.y = obj.baseY + (obj.dead ? 0.1 : Math.sin(now / 500 + pid.charCodeAt(1)) * 0.025);
      }
      // Attacker animation.
      if (this.attackActor && t < 1.2) {
        if (this.attackActor.startsWith('e')) {
          const idx = parseInt(this.attackActor.slice(1));
          const eo = this.enemyObjects.find(o => o.idx === idx);
          if (eo) {
            // Move enemy forward (toward party tile, which is opposite of their facing).
            const fwd = new THREE.Vector3(Math.sin(eo.group.rotation.y), 0, Math.cos(eo.group.rotation.y));
            eo.group.position.x = (eo.basePos ? eo.basePos.x : eo.group.position.x) - fwd.x * lunge;
            eo.group.position.z = (eo.basePos ? eo.basePos.z : eo.group.position.z) - fwd.z * lunge;
            if (!eo.basePos) eo.basePos = { x: eo.group.position.x, z: eo.group.position.z };
          }
        } else {
          const obj = this.playerObjects[this.attackActor];
          if (obj) {
            // Player lunges toward enemies (in +/-z direction).
            obj.group.position.z = obj.y * TILE_SIZE - lunge;
            const ud = obj.group.userData;
            if (ud) ud.rightArm.rotation.x = -lunge * 2;
          }
        }
      }
      // Hit flash on targets.
      for (const eo of this.enemyObjects) {
        const hit = this.hitTargets.find(h => h.key === 'e' + eo.idx);
        if (hit) {
          // Tint body red briefly.
          eo.group.position.x += (Math.sin(now / 30) * 0.04);
          eo.group.children.forEach(child => {
            if (child.material && child.material.emissive) {
              child.material.emissive = new THREE.Color(0xc43b3b);
              child.material.emissiveIntensity = 0.6;
            }
          });
        } else {
          eo.group.children.forEach(child => {
            if (child.material && child.material.emissive) {
              child.material.emissiveIntensity = 0;
            }
          });
        }
        // Death overlay: tip the enemy over.
        const e = s.combat ? s.combat.enemies[eo.idx] : null;
        if (e && (!e.alive || e.hp <= 0)) {
          eo.group.rotation.x = -Math.PI / 2;
          eo.group.position.y = eo.baseY + 0.1;
        } else {
          eo.group.rotation.x = 0;
        }
      }
    }
  }

  window.Renderer = Renderer;
})();
