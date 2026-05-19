// Canvas-based renderer for the open-world map and combat scene.
// All sprites are pre-baked offscreen canvases (see sprites.js); this class
// only composes them and runs animations via requestAnimationFrame.
(function () {
  'use strict';

  const TILE_SRC = 32;     // sprite source pixels per tile (matches terrain canvases)
  const SPRITE_SRC = 16;   // character sprite source pixels
  const VIEW_W = 9;        // tiles visible horizontally
  const VIEW_H = 7;        // tiles visible vertically
  const WALK_MS = 320;     // walk animation duration per tile

  class Renderer {
    constructor(game) {
      this.game = game;
      this.cv = document.createElement('canvas');
      this.cv.className = 'world-canvas';
      this.ctx = this.cv.getContext('2d');
      this.scale = 2;
      this.partyAnim = null;
      this.lastSeenParty = null;
      this.facingLeft = false;
      this.lastRollTs = 0;
      this.attackAnimStart = 0;
      this.attackActor = null;
      this.hitTargets = []; // [{kind:'p'|'e', idx, until}]
      this.raf = 0;
      this.combatLayout = null;
      this.onTileTap = null;     // (x, y, tile) => void
      this.onEnemyTap = null;    // (enemyIdx) => void
      this.onPartyTap = null;    // (playerIdx) => void (for combat target)
      this.combatTargetMode = false; // when true, enemy taps fire onEnemyTap
      this._bindEvents();
    }

    _bindEvents() {
      this.cv.addEventListener('pointerdown', (e) => {
        const rect = this.cv.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (this.cv.width / rect.width);
        const cy = (e.clientY - rect.top) * (this.cv.height / rect.height);
        this._handleTap(cx, cy);
      });
    }
    _handleTap(cx, cy) {
      const s = this.game.state;
      if (s.phase === 'overworld') {
        const t = this.screenToTile(cx, cy);
        if (t && this.onTileTap) this.onTileTap(t.x, t.y, t.tile);
      } else if (s.phase === 'combat') {
        if (this.combatLayout) {
          // Check enemies (the only tap-targets).
          for (const e of this.combatLayout.enemies) {
            if (cx >= e.x && cx <= e.x + e.w && cy >= e.y && cy <= e.y + e.h) {
              if (this.onEnemyTap) this.onEnemyTap(e.idx);
              return;
            }
          }
        }
      }
    }

    attach(container) {
      container.appendChild(this.cv);
      this.resize();
    }
    detach() {
      if (this.cv.parentElement) this.cv.parentElement.removeChild(this.cv);
      cancelAnimationFrame(this.raf);
    }
    resize() {
      const parent = this.cv.parentElement;
      if (!parent) return;
      const containerW = parent.clientWidth || 320;
      // Keep the internal resolution constant at 2x the sprite source so the
      // browser only has to scale by an integer multiple via CSS — pixelated
      // rendering keeps everything crisp.
      const internalScale = 2;
      this.scale = internalScale;
      const intW = VIEW_W * TILE_SRC * internalScale;
      const intH = VIEW_H * TILE_SRC * internalScale;
      this.cv.width = intW;
      this.cv.height = intH;
      this.cv.style.width = containerW + 'px';
      this.cv.style.height = (containerW * intH / intW) + 'px';
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.dispW = intW;
      this.dispH = intH;
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

    draw(now) {
      const s = this.game.state;
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.fillStyle = '#0a0510';
      this.ctx.fillRect(0, 0, this.dispW, this.dispH);
      if (!s.map) return;
      if (s.phase === 'overworld' || s.phase === 'event') {
        this._drawWorld(now);
      } else if (s.phase === 'combat') {
        this._drawCombat(now);
      } else if (s.phase === 'victory') {
        this._drawWorld(now);
      } else if (s.phase === 'gameover') {
        this._drawWorld(now);
      }
    }

    // ---- WORLD -----------------------------------------------------------
    _syncPartyAnim() {
      const s = this.game.state;
      if (!s.map) return;
      const cur = s.party;
      if (!this.lastSeenParty) {
        this.lastSeenParty = { x: cur.x, y: cur.y };
        this.partyAnim = { x: cur.x, y: cur.y, fromX: cur.x, fromY: cur.y, targetX: cur.x, targetY: cur.y, walking: false, startTime: 0 };
        return;
      }
      if (this.lastSeenParty.x !== cur.x || this.lastSeenParty.y !== cur.y) {
        this.partyAnim.fromX = this.partyAnim.x;
        this.partyAnim.fromY = this.partyAnim.y;
        this.partyAnim.targetX = cur.x;
        this.partyAnim.targetY = cur.y;
        this.partyAnim.walking = true;
        this.partyAnim.startTime = performance.now();
        this.facingLeft = (cur.x - this.lastSeenParty.x) < 0;
        this.lastSeenParty = { x: cur.x, y: cur.y };
      }
    }
    _drawWorld(now) {
      this._syncPartyAnim();
      // advance walk anim
      if (this.partyAnim.walking) {
        const elapsed = now - this.partyAnim.startTime;
        if (elapsed >= WALK_MS) {
          this.partyAnim.x = this.partyAnim.targetX;
          this.partyAnim.y = this.partyAnim.targetY;
          this.partyAnim.walking = false;
        } else {
          const t = elapsed / WALK_MS;
          // ease-out
          const e = 1 - Math.pow(1 - t, 2);
          this.partyAnim.x = this.partyAnim.fromX + (this.partyAnim.targetX - this.partyAnim.fromX) * e;
          this.partyAnim.y = this.partyAnim.fromY + (this.partyAnim.targetY - this.partyAnim.fromY) * e;
        }
      }
      const s = this.game.state;
      const tp = TILE_SRC * this.scale;

      // camera centred on party
      let camX = this.partyAnim.x - (VIEW_W / 2) + 0.5;
      let camY = this.partyAnim.y - (VIEW_H / 2) + 0.5;
      camX = Math.max(0, Math.min(camX, s.map.w - VIEW_W));
      camY = Math.max(0, Math.min(camY, s.map.h - VIEW_H));
      this.camera = { x: camX, y: camY };

      // tiles
      const x0 = Math.floor(camX);
      const y0 = Math.floor(camY);
      const x1 = Math.min(s.map.w, x0 + VIEW_W + 2);
      const y1 = Math.min(s.map.h, y0 + VIEW_H + 2);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const tile = s.map.tiles[y * s.map.w + x];
          const sx = (x - camX) * tp;
          const sy = (y - camY) * tp;
          const tCv = window.TERRAIN[tile.terrain] || window.TERRAIN.grass;
          this.ctx.drawImage(tCv, 0, 0, tCv.width, tCv.height, sx, sy, tp, tp);
          if (tile.feature) {
            const sp = window.SPRITES['feature_' + tile.feature];
            if (sp && sp.frames[0]) {
              this.ctx.drawImage(sp.frames[0], 0, 0, SPRITE_SRC, SPRITE_SRC, sx, sy, tp, tp);
            }
          }
          if (tile.enemies && !tile.cleared && tile.discovered) {
            // Combat marker — small sword icon on tile corner.
            this._drawSwordMarker(sx + tp * 0.62, sy + tp * 0.05, tp * 0.32);
          }
          // fog
          if (!tile.discovered) {
            const adj = (Math.abs(this.partyAnim.x - x) + Math.abs(this.partyAnim.y - y)) <= 1.2;
            this.ctx.fillStyle = adj ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.7)';
            this.ctx.fillRect(sx, sy, tp, tp);
          }
        }
      }

      // movement hints (only if local active player)
      this._drawMoveHints(camX, camY, tp);

      // party token(s)
      this._drawPartyOnWorld(now, camX, camY, tp);
    }

    _drawSwordMarker(x, y, sz) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 1, y - 1, sz + 2, sz + 2);
      ctx.fillStyle = '#c43b3b';
      ctx.fillRect(x, y + sz * 0.2, sz, sz * 0.18);
      ctx.fillStyle = '#7a1818';
      ctx.fillRect(x, y + sz * 0.4, sz, sz * 0.15);
    }

    _drawMoveHints(camX, camY, tp) {
      const s = this.game.state;
      if (s.phase !== 'overworld') return;
      const active = s.players[s.activeIdx];
      if (!active) return;
      // Only highlight when local player can act.
      if (!this._isLocallyControlled(active)) return;
      const px = s.party.x, py = s.party.y;
      const neighbours = [[px+1,py],[px-1,py],[px,py+1],[px,py-1]];
      for (const [x, y] of neighbours) {
        const t = (s.map && s.map.tiles[y * s.map.w + x]);
        if (!t) continue;
        if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) continue;
        if (t.terrain === 'water') continue;
        const sx = (x - camX) * tp;
        const sy = (y - camY) * tp;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
        this.ctx.strokeStyle = `rgba(255, 215, 112, ${0.6 + pulse * 0.4})`;
        this.ctx.lineWidth = 2 * this.scale;
        this.ctx.strokeRect(sx + 1, sy + 1, tp - 2, tp - 2);
      }
    }

    _isLocallyControlled(p) {
      // host or solo controls all locals; client controls myId only.
      const net = window.NET;
      if (!net) return p.id === this.game.myId;
      if (net.mode === 'solo') return true;
      if (net.mode === 'host') return p.id === this.game.myId || p.isLocal;
      return p.id === this.game.myId;
    }

    _drawPartyOnWorld(now, camX, camY, tp) {
      const s = this.game.state;
      const players = s.players.filter(p => p.alive && p.classId);
      if (!players.length) return;
      const baseX = (this.partyAnim.x - camX) * tp;
      const baseY = (this.partyAnim.y - camY) * tp;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const cls = p.classId;
        const walking = this.partyAnim.walking;
        const spKey = walking ? cls + '_walk' : cls + '_idle';
        const sp = window.SPRITES[spKey] || window.SPRITES[cls + '_idle'];
        if (!sp) continue;
        const fIdx = sp.frames.length > 1 ? Math.floor(now / 180) % sp.frames.length : 0;
        const frame = sp.frames[fIdx];
        // small horizontal offset so the group is visible
        const offsetX = (i - (players.length - 1) / 2) * tp * 0.18;
        const offsetY = i * 2 * this.scale;
        // small idle bob
        const bob = !walking ? Math.sin((now / 400) + i) * (this.scale * 0.6) : 0;
        const drawX = baseX + offsetX;
        const drawY = baseY + offsetY + bob;
        this._drawSprite(frame, drawX, drawY, tp, this.facingLeft);
      }
    }

    _drawSprite(frame, x, y, sz, flip) {
      const ctx = this.ctx;
      if (flip) {
        ctx.save();
        ctx.translate(x + sz, y);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0, SPRITE_SRC, SPRITE_SRC, 0, 0, sz, sz);
        ctx.restore();
      } else {
        ctx.drawImage(frame, 0, 0, SPRITE_SRC, SPRITE_SRC, x, y, sz, sz);
      }
    }

    screenToTile(cx, cy) {
      const s = this.game.state;
      if (!s.map || !this.camera) return null;
      const tp = TILE_SRC * this.scale;
      const tx = Math.floor(cx / tp + this.camera.x);
      const ty = Math.floor(cy / tp + this.camera.y);
      if (tx < 0 || ty < 0 || tx >= s.map.w || ty >= s.map.h) return null;
      const tile = s.map.tiles[ty * s.map.w + tx];
      return { x: tx, y: ty, tile };
    }

    // ---- COMBAT ----------------------------------------------------------
    setCombatTargetMode(on) { this.combatTargetMode = on; }
    _drawCombat(now) {
      const s = this.game.state;
      const c = s.combat;
      if (!c) return;
      // Backdrop: dim gradient.
      const ctx = this.ctx;
      const grad = ctx.createLinearGradient(0, 0, 0, this.dispH);
      grad.addColorStop(0, '#2a1450');
      grad.addColorStop(1, '#0a0510');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.dispW, this.dispH);
      // Ground strip.
      ctx.fillStyle = '#3a2a18';
      ctx.fillRect(0, this.dispH * 0.62, this.dispW, this.dispH * 0.06);
      ctx.fillStyle = '#1a1008';
      ctx.fillRect(0, this.dispH * 0.68, this.dispW, this.dispH * 0.32);

      // Layout
      const layout = { players: [], enemies: [] };
      const baseY = this.dispH * 0.48;
      const partyAlive = s.players.filter(p => p.classId);
      const drawSize = Math.min(this.dispW, this.dispH) * 0.16;
      // Players on left
      partyAlive.forEach((p, i) => {
        const x = 12 + i * drawSize * 0.95;
        const y = baseY + (i % 2) * 4;
        layout.players.push({ id: p.id, idx: s.players.indexOf(p), x, y, w: drawSize, h: drawSize });
      });
      // Enemies on right
      const aliveE = c.enemies;
      aliveE.forEach((e, i) => {
        const x = this.dispW - 12 - (i + 1) * drawSize * 0.95;
        const y = baseY + (i % 2) * 4 - drawSize * 0.05;
        layout.enemies.push({ idx: e.idx, x, y, w: drawSize, h: drawSize });
      });
      this.combatLayout = layout;

      // Detect new attack/dice roll → trigger animation.
      const lr = s.lastRoll;
      if (lr && lr.ts && lr.ts !== this.lastRollTs) {
        this.lastRollTs = lr.ts;
        this.attackAnimStart = now;
        this.attackActor = lr.actor;
        // Mark hit targets.
        if (lr.target && lr.dmg && lr.target !== 'all') {
          this.hitTargets.push({ key: lr.target, until: now + 500 });
        } else if (lr.target === 'all') {
          for (const e of c.enemies) {
            this.hitTargets.push({ key: 'e' + e.idx, until: now + 500 });
          }
        }
      }
      // prune hit targets
      this.hitTargets = this.hitTargets.filter(h => h.until > now);

      // Draw players
      for (const slot of layout.players) {
        const p = s.players[slot.idx];
        this._drawCombatant(p, slot, false, now);
      }
      // Draw enemies
      for (const slot of layout.enemies) {
        const e = c.enemies[slot.idx];
        this._drawCombatant(e, slot, true, now);
      }
      // Active actor pointer
      const turn = c.turn;
      if (turn.side === 'players') {
        const slot = layout.players.find(l => l.idx === turn.idx);
        if (slot) this._drawTurnPointer(slot, '#ffd770');
      } else if (turn.side === 'enemies') {
        const slot = layout.enemies.find(l => l.idx === turn.idx);
        if (slot) this._drawTurnPointer(slot, '#c43b3b');
      }
      // Targeting overlay over enemies
      if (this.combatTargetMode) {
        for (const slot of layout.enemies) {
          const e = c.enemies[slot.idx];
          if (!e.alive || e.hp <= 0) continue;
          const pulse = 0.5 + 0.5 * Math.sin(now / 200);
          ctx.strokeStyle = `rgba(255, 215, 112, ${0.7 + pulse * 0.3})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(slot.x - 4, slot.y - 4, slot.w + 8, slot.h + 8);
        }
      }
      // Dice tray
      this._drawDiceTray(now);
    }

    _drawCombatant(entity, slot, isEnemy, now) {
      const ctx = this.ctx;
      // anim offsets
      let lungeX = 0, shakeX = 0;
      const attacking = this.attackActor === (isEnemy ? 'e' + entity.idx : entity.id);
      if (attacking) {
        const t = (now - this.attackAnimStart) / 500;
        if (t < 1) {
          // ease out and in for a lunge
          const e = Math.sin(t * Math.PI);
          lungeX = (isEnemy ? -1 : 1) * e * slot.w * 0.4;
        }
      }
      const hit = this.hitTargets.find(h => h.key === (isEnemy ? 'e' + entity.idx : entity.id));
      if (hit) {
        const left = hit.until - now;
        shakeX = Math.sin(left / 20) * 4;
      }
      // sprite key
      let key;
      if (isEnemy) {
        key = entity.type + '_idle';
        if (attacking && window.SPRITES[entity.type + '_attack']) key = entity.type + '_attack';
      } else {
        key = entity.classId + '_idle';
        if (attacking && window.SPRITES[entity.classId + '_attack']) key = entity.classId + '_attack';
      }
      const sp = window.SPRITES[key];
      if (!sp) return;
      const frameIdx = sp.frames.length > 1 ? Math.floor(now / 200) % sp.frames.length : 0;
      const frame = sp.frames[frameIdx];
      const x = slot.x + lungeX + shakeX;
      const y = slot.y + (hit ? Math.sin(now/30) * 2 : 0);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + slot.w/2, y + slot.h * 0.95, slot.w * 0.35, slot.h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hit flash overlay
      if (hit) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
      }
      this._drawSprite(frame, x, y, slot.w, isEnemy);
      if (hit) {
        ctx.fillStyle = 'rgba(255,80,80,0.5)';
        ctx.fillRect(x, y, slot.w, slot.h);
        ctx.restore();
      }
      // Death overlay
      if (!entity.alive || entity.hp <= 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y, slot.w, slot.h);
        ctx.strokeStyle = '#c43b3b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 4);
        ctx.lineTo(x + slot.w - 4, y + slot.h - 4);
        ctx.moveTo(x + slot.w - 4, y + 4);
        ctx.lineTo(x + 4, y + slot.h - 4);
        ctx.stroke();
      }
      // HP bar above
      const hpPct = entity.hp / entity.maxHp;
      const bw = slot.w * 0.9;
      const bh = 5;
      const bx = x + slot.w * 0.05;
      const by = y - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = isEnemy ? '#c43b3b' : '#3a8a3a';
      ctx.fillRect(bx, by, bw * Math.max(0, hpPct), bh);
      // name
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(9, this.scale * 5)}px sans-serif`;
      ctx.textAlign = 'center';
      const nm = isEnemy ? entity.name : entity.name;
      ctx.fillText(nm, x + slot.w / 2, by - 2);
      ctx.textAlign = 'left';
    }
    _drawTurnPointer(slot, color) {
      const ctx = this.ctx;
      const cx = slot.x + slot.w / 2;
      const cy = slot.y - 16;
      const bob = Math.sin(performance.now() / 200) * 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy + bob + 8);
      ctx.lineTo(cx - 6, cy + bob - 2);
      ctx.lineTo(cx + 6, cy + bob - 2);
      ctx.closePath();
      ctx.fill();
    }
    _drawDiceTray(now) {
      const s = this.game.state;
      const lr = s.lastRoll;
      if (!lr || !lr.dice || !lr.dice.length) return;
      const ctx = this.ctx;
      const trayH = 36;
      const ts = this.scale * 11;
      const totalW = lr.dice.length * (ts + 4);
      const x0 = (this.dispW - totalW) / 2;
      const y = this.dispH - trayH - 4;
      // backdrop
      ctx.fillStyle = 'rgba(10,5,15,0.65)';
      ctx.fillRect(x0 - 6, y - 4, totalW + 12, trayH);
      const dt = now - this.attackAnimStart;
      const animating = dt < 350;
      for (let i = 0; i < lr.dice.length; i++) {
        const v = lr.dice[i];
        const dx = x0 + i * (ts + 4);
        const dy = y;
        const hit = lr.hitOn && v >= lr.hitOn;
        const crit = lr.crit && v === lr.crit;
        if (animating) {
          // jiggle
          const j = Math.sin(now / 30 + i) * 2;
          ctx.save();
          ctx.translate(dx + ts/2, dy + ts/2 + j);
          ctx.rotate(Math.sin(now/50 + i) * 0.4);
          ctx.translate(-ts/2, -ts/2);
          this._drawDie(0, 0, ts, animating ? 1 + Math.floor(Math.random()*6) : v, hit, crit);
          ctx.restore();
        } else {
          this._drawDie(dx, dy, ts, v, hit, crit);
        }
      }
      if (!animating && lr.dmg != null && lr.dmg > 0) {
        ctx.fillStyle = '#ffd770';
        ctx.font = `${Math.max(10, this.scale * 6)}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(`→ ${lr.dmg} dmg`, x0 + totalW + 4, y + ts * 0.7);
      }
    }
    _drawDie(x, y, sz, v, hit, crit) {
      const ctx = this.ctx;
      ctx.fillStyle = crit ? '#f8a070' : (hit ? '#f8d870' : '#f8f0d8');
      ctx.fillRect(x, y, sz, sz);
      ctx.strokeStyle = '#1a0d0d';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
      ctx.fillStyle = '#1a0d0d';
      ctx.font = `bold ${Math.floor(sz * 0.62)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x + sz/2, y + sz/2 + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    }
  }

  window.Renderer = Renderer;
})();
