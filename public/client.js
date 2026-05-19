// Realm Quest client. Single file. Renders authoritative state from server.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let ws = null;
let me = { playerId: null, code: null, name: '' };
let state = null;
let selectedEnemy = null;
let pendingSkillTarget = null; // for heal/multishot when needing target

// --- WebSocket ---
function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => onOpen && onOpen();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    handleMessage(msg);
  };
  ws.onclose = () => { toast('Disconnected'); };
  ws.onerror = () => { toast('Connection error'); };
}
function send(type, payload = {}) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function handleMessage(msg) {
  if (msg.type === 'joined') {
    me.playerId = msg.playerId;
    me.code = msg.code;
    showScreen('room');
  } else if (msg.type === 'state') {
    state = msg.state;
    render();
  } else if (msg.type === 'error') {
    toast(msg.message || 'Error');
  }
}

// --- Screens ---
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.add('hidden'));
  $(`#screen-${name}`).classList.remove('hidden');
}

// --- Toast ---
let toastT = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 2500);
}

// --- Lobby actions ---
async function fetchSavesIntoSelect() {
  // We'll grab saves via state once connected. Pre-populate empty.
}

$('#btn-create').onclick = () => {
  const name = $('#create-name').value.trim() || 'Hero';
  me.name = name;
  connect(() => send('create_room', { name }));
};

$('#btn-join').onclick = () => {
  const name = $('#join-name').value.trim() || 'Hero';
  const code = $('#join-code').value.trim().toUpperCase();
  if (!code) { toast('Enter a room code'); return; }
  me.name = name;
  connect(() => send('join_room', { name, code }));
};

$('#btn-load').onclick = () => {
  const name = $('#load-name').value.trim() || 'Hero';
  const save = $('#load-save').value;
  if (!save) { toast('No save selected'); return; }
  me.name = name;
  connect(() => send('load_room', { name, save }));
};

// Try fetching list of saves before joining: connect with a temp ws? Easier: lazy populate after first state.

// --- Leave room ---
function leaveRoom() {
  if (ws) ws.close();
  ws = null;
  state = null;
  me = { playerId: null, code: null, name: '' };
  showScreen('lobby');
}
$('#btn-leave-1').onclick = leaveRoom;
$('#btn-leave-2').onclick = leaveRoom;
$('#btn-back').onclick = leaveRoom;

// --- Render dispatcher ---
function render() {
  if (!state) return;
  // Populate saves dropdown if on lobby
  if (state.saves) {
    const sel = $('#load-save');
    if (sel && document.activeElement !== sel) {
      const cur = sel.value;
      sel.innerHTML = '';
      if (!state.saves.length) {
        sel.innerHTML = '<option value="">(no saves)</option>';
      } else {
        for (const s of state.saves) sel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
      }
      if (cur) sel.value = cur;
    }
  }

  $('#room-code').textContent = state.code;
  $('#game-code').textContent = state.code;
  $('#round-info').textContent = `Round ${state.round}`;

  if (state.phase === 'lobby') {
    showScreen('room');
    renderLobby();
  } else if (state.phase === 'victory' || state.phase === 'defeat') {
    showScreen('game');
    renderGameTop();
    renderPartyPanel();
    renderLog();
    showSubPanel('end');
    $('#end-title').textContent = state.phase === 'victory' ? 'Victory!' : 'Defeat';
    $('#end-text').textContent = state.phase === 'victory'
      ? 'You have slain the Ancient Dragon and saved the realm.'
      : 'The party has fallen. Better luck next time, hero.';
  } else {
    showScreen('game');
    renderGameTop();
    renderPartyPanel();
    renderLog();
    if (state.phase === 'combat') {
      showSubPanel('combat');
      renderCombat();
    } else if (state.phase === 'event') {
      showSubPanel('event');
      renderEvent();
    } else if (state.phase === 'shop') {
      showSubPanel('shop');
      renderShop();
    } else {
      // overworld
      showSubPanel('map');
      renderMap();
    }
  }
}

function showSubPanel(which) {
  // which: 'map' | 'combat' | 'event' | 'shop' | 'end'
  $('#map-wrap').classList.toggle('hidden', which !== 'map');
  $('#combat-panel').classList.toggle('hidden', which !== 'combat');
  $('#event-panel').classList.toggle('hidden', which !== 'event');
  $('#shop-panel').classList.toggle('hidden', which !== 'shop');
  $('#end-panel').classList.toggle('hidden', which !== 'end');
}

// --- Lobby (in-room) ---
function renderLobby() {
  // Class grid
  const grid = $('#class-grid');
  grid.innerHTML = '';
  const me_p = state.players.find(p => p.isYou);
  for (const id in state.classes) {
    const c = state.classes[id];
    const selected = me_p && me_p.classId === id;
    const takenBy = state.players.find(p => p.classId === id && !p.isYou);
    const div = document.createElement('div');
    div.className = `class-card${selected ? ' selected' : ''}`;
    const s = c.baseStats;
    div.innerHTML = `
      <h3>${c.name}</h3>
      <div class="muted">${c.desc}</div>
      <div class="stats">HP ${s.hp} • ATK ${s.atk} • DEF ${s.def} • SPD ${s.spd} • MAG ${s.mag}</div>
      <div class="stats">Skill: <b>${c.skill.name}</b> (${c.skill.cost}f) — ${c.skill.desc}</div>
      ${takenBy ? `<div class="stats">Picked by ${takenBy.name}</div>` : ''}
    `;
    div.onclick = () => send('pick_class', { classId: id });
    grid.appendChild(div);
  }
  // Party list
  const list = $('#party-list');
  list.innerHTML = '';
  for (const p of state.players) {
    const chip = document.createElement('div');
    chip.className = `party-chip${p.isYou ? ' you' : ''}`;
    chip.innerHTML = `${p.name}${p.classId ? ` <span class="badge">${state.classes[p.classId].name}</span>` : ' (picking…)'}`;
    list.appendChild(chip);
  }
  $('#room-host').textContent = `Host: ${state.players.find(p => p.id === state.hostId)?.name || '-'}`;
  // Start button
  const start = $('#btn-start');
  const iAmHost = me_p && me_p.id === state.hostId;
  const allReady = state.players.every(p => p.classId);
  start.disabled = !(iAmHost && allReady && state.players.length >= 1);
  start.onclick = () => send('start_game');
}

// --- Game top ---
function renderGameTop() {
  const active = state.players.find(p => p.id === state.activeId);
  $('#turn-info').textContent = active ? `${active.name}'s turn` : '';
}

// --- Party panel ---
function renderPartyPanel() {
  const panel = $('#party-panel');
  panel.innerHTML = '';
  for (const p of state.players) {
    const cls = state.classes[p.classId];
    const isActive = state.activeId === p.id;
    const card = document.createElement('div');
    card.className = `player-card${p.isYou ? ' you' : ''}${isActive ? ' active' : ''}${!p.alive ? ' dead' : ''}`;
    const hpPct = p.maxHp ? Math.max(0, (p.hp / p.maxHp) * 100) : 0;
    const focusPct = (p.focus / 6) * 100;
    card.innerHTML = `
      <div class="name">${p.name}<span class="cls">${cls ? cls.name : ''}</span></div>
      <div class="bar"><div class="bar-fill hp" style="width:${hpPct}%"></div>
        <div class="bar-text">HP ${p.hp}/${p.maxHp}</div></div>
      <div class="bar"><div class="bar-fill focus" style="width:${focusPct}%"></div>
        <div class="bar-text">Focus ${p.focus}/6</div></div>
      <div class="meta">
        <span>ATK ${p.stats?.atk ?? '-'} DEF ${p.stats?.def ?? '-'} SPD ${p.stats?.spd ?? '-'} MAG ${p.stats?.mag ?? '-'}</span>
      </div>
      <div class="meta"><span class="gold">${p.gold}g</span><span>XP ${p.xp}</span></div>
    `;
    panel.appendChild(card);
  }
}

// --- Log ---
function renderLog() {
  const ul = $('#log-list');
  ul.innerHTML = '';
  for (const line of state.log) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
  ul.scrollTop = ul.scrollHeight;
}

// --- Hex math ---
const HEX_SIZE = 38;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;

function hexCenter(q, r) {
  const x = HEX_W * (q + 0.5 * (r & 1)) + HEX_W / 2 + 20;
  const y = HEX_H * 0.75 * r + HEX_SIZE + 20;
  return { x, y };
}

function drawHex(ctx, cx, cy, fill, stroke, lineWidth = 2) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i - 30); // pointy-top
    const x = cx + HEX_SIZE * Math.cos(ang);
    const y = cy + HEX_SIZE * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

// Determine canvas size based on map
function fitCanvasToMap() {
  const canvas = $('#map-canvas');
  const W = state.map.width;
  const H = state.map.height;
  const cw = HEX_W * W + HEX_W / 2 + 40;
  const ch = HEX_H * 0.75 * H + HEX_H * 0.5 + 40;
  canvas.width = Math.ceil(cw);
  canvas.height = Math.ceil(ch);
}

const TILE_COLORS = {
  plains:   { fill: '#5a7a3a', stroke: '#3a5a2a', label: '' },
  forest:   { fill: '#2a5a2a', stroke: '#1a3a1a', label: '🌲' },
  mountain: { fill: '#6a6a6a', stroke: '#3a3a3a', label: '⛰' },
  town:     { fill: '#a07040', stroke: '#604020', label: '🏘' },
  dungeon:  { fill: '#4a2a4a', stroke: '#2a1a2a', label: '🏚' },
  boss:     { fill: '#8a2020', stroke: '#4a1010', label: '🐉' },
};

function renderMap() {
  if (!state.map) return;
  fitCanvasToMap();
  const canvas = $('#map-canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15110c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const reachKeys = new Set((state.moveTiles || []).map(t => `${t.q},${t.r}`));
  const active = state.players.find(p => p.id === state.activeId);
  const iAmActive = active && active.isYou;

  for (const t of state.map.tiles) {
    const { x, y } = hexCenter(t.q, t.r);
    let col = TILE_COLORS[t.type];
    const explored = t.explored;
    let fill = explored ? col.fill : '#1a1812';
    let stroke = col.stroke;
    if (t.cleared && (t.type === 'dungeon' || t.type === 'boss')) fill = '#4a4a4a';
    const isReachable = iAmActive && reachKeys.has(`${t.q},${t.r}`);
    if (isReachable) { stroke = '#f0c060'; }
    drawHex(ctx, x, y, fill, stroke, isReachable ? 3 : 1.5);
    if (explored) {
      ctx.fillStyle = '#000';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.label || '·', x, y + 2);
    } else {
      ctx.fillStyle = '#3a2c20';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y);
    }
  }
  // Players
  const colors = ['#f0c060', '#5ec0e0', '#7adf7a', '#e07ad8'];
  state.players.forEach((p, i) => {
    if (!p.alive) return;
    const { x, y } = hexCenter(p.pos.q, p.pos.r);
    const off = (i - (state.players.length - 1) / 2) * 12;
    ctx.beginPath();
    ctx.arc(x + off, y - 8, 8, 0, Math.PI * 2);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(p.name.slice(0, 2).toUpperCase(), x + off, y - 6);
  });

  $('#map-overlay').textContent = iAmActive
    ? `Your turn — ${state.pendingMoves} move${state.pendingMoves === 1 ? '' : 's'}. Click a highlighted tile.`
    : `Waiting on ${active?.name || '...'}`;

  canvas.onclick = (e) => {
    if (!iAmActive) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    // Find nearest tile
    let best = null, bestD = 1e9;
    for (const t of state.map.tiles) {
      const { x, y } = hexCenter(t.q, t.r);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (!best) return;
    if (!reachKeys.has(`${best.q},${best.r}`)) { toast('Out of range'); return; }
    send('move', { q: best.q, r: best.r });
  };
}

// --- Combat ---
function renderCombat() {
  $('#combat-title').textContent = `Combat — Round ${state.combat.round}`;
  // Enemies
  const row = $('#enemy-row');
  row.innerHTML = '';
  for (const e of state.combat.enemies) {
    const div = document.createElement('div');
    div.className = `enemy-card${e.alive ? '' : ' dead'}${e.boss ? ' boss' : ''}${selectedEnemy === e.idx ? ' selected' : ''}`;
    const pct = (e.hp / e.maxHp) * 100;
    div.innerHTML = `
      <h4>${e.name}${e.boss ? ' 🐉' : ''}</h4>
      <div class="bar"><div class="bar-fill hp" style="width:${pct}%"></div>
        <div class="bar-text">${e.hp}/${e.maxHp}</div></div>
    `;
    if (e.alive) {
      div.onclick = () => { selectedEnemy = e.idx; renderCombat(); };
    }
    row.appendChild(div);
  }
  // Turn order
  const order = $('#turn-order');
  order.innerHTML = '';
  state.combat.order.forEach((o, i) => {
    const isActive = i === state.combat.turn;
    let label;
    if (o.side === 'player') {
      const p = state.players.find(pp => pp.id === o.id);
      label = p ? p.name : '?';
    } else {
      const e = state.combat.enemies[o.idx];
      label = e ? e.name : '?';
    }
    const pip = document.createElement('span');
    pip.className = `pip${isActive ? ' active' : ''}`;
    pip.textContent = label;
    order.appendChild(pip);
  });
  // Actions: only show if it's our turn
  const actions = $('#combat-actions');
  actions.innerHTML = '';
  const cur = state.combat.order[state.combat.turn];
  const isMe = cur && cur.side === 'player' && cur.id === me.playerId;
  if (!isMe) {
    actions.innerHTML = `<i style="color:var(--muted)">Waiting...</i>`;
    return;
  }
  const me_p = state.players.find(p => p.isYou);
  const cls = state.classes[me_p.classId];

  const bAttack = makeBtn('Attack', () => {
    if (selectedEnemy == null) { toast('Pick an enemy'); return; }
    send('combat_action', { action: { kind: 'attack', targetIdx: selectedEnemy } });
  });
  actions.appendChild(bAttack);

  const skillDisabled = me_p.focus < cls.skill.cost;
  const bSkill = makeBtn(`Skill: ${cls.skill.name} (${cls.skill.cost}f)`, () => {
    if (cls.skill.id === 'heal') {
      pickTarget('Choose ally to heal', state.players.filter(p => p.alive), (id) => {
        send('combat_action', { action: { kind: 'skill', targetId: id } });
      });
    } else if (cls.skill.id === 'multishot') {
      if (selectedEnemy == null) { toast('Pick an enemy'); return; }
      send('combat_action', { action: { kind: 'skill', targetIdx: selectedEnemy } });
    } else if (cls.skill.id === 'taunt' || cls.skill.id === 'fireball') {
      send('combat_action', { action: { kind: 'skill' } });
    }
  });
  bSkill.disabled = skillDisabled;
  actions.appendChild(bSkill);

  const bItem = makeBtn('Use Item', () => {
    const consumables = (me_p.inventory || []).map((s, idx) => ({ idx, ...state.items[s.id], slot: state.items[s.id].slot, id: s.id }))
      .filter(x => x.slot === 'consumable');
    if (!consumables.length) { toast('No consumables'); return; }
    pickItem('Use an item', consumables, (chosen) => {
      const def = state.items[chosen.id];
      if (def.heal) {
        pickTarget('Heal whom?', state.players.filter(p => p.alive), (id) => {
          send('combat_action', { action: { kind: 'item', itemIdx: chosen.idx, targetId: id } });
        });
      } else {
        send('combat_action', { action: { kind: 'item', itemIdx: chosen.idx } });
      }
    });
  });
  actions.appendChild(bItem);

  const bDefend = makeBtn('Defend', () => send('combat_action', { action: { kind: 'defend' } }));
  actions.appendChild(bDefend);

  const bFlee = makeBtn('Flee', () => send('combat_action', { action: { kind: 'flee' } }));
  actions.appendChild(bFlee);
}

function makeBtn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

// --- Event ---
function renderEvent() {
  $('#event-title').textContent = `Event`;
  $('#event-text').textContent = state.event.text;
  const c = $('#event-choices');
  c.innerHTML = '';
  const active = state.players.find(p => p.id === state.activeId);
  const isMe = active && active.isYou;
  state.event.choices.forEach((ch, i) => {
    const b = document.createElement('button');
    b.textContent = ch.label;
    b.disabled = !isMe;
    b.onclick = () => send('event_choice', { idx: i });
    c.appendChild(b);
  });
  if (!isMe) {
    const note = document.createElement('div');
    note.style.color = 'var(--muted)';
    note.textContent = `Waiting on ${active?.name || '...'}`;
    c.appendChild(note);
  }
}

// --- Shop ---
function renderShop() {
  const stock = $('#shop-stock');
  stock.innerHTML = '';
  const me_p = state.players.find(p => p.isYou);
  state.shop.stock.forEach((s, i) => {
    const it = s.item;
    const card = document.createElement('div');
    card.className = 'shop-item';
    const bits = [];
    if (it.atk) bits.push(`ATK +${it.atk}`);
    if (it.def) bits.push(`DEF +${it.def}`);
    if (it.spd) bits.push(`SPD ${it.spd > 0 ? '+' : ''}${it.spd}`);
    if (it.mag) bits.push(`MAG +${it.mag}`);
    if (it.heal) bits.push(`Heals ${it.heal}`);
    if (it.focus) bits.push(`+${it.focus} focus`);
    if (it.damage) bits.push(`${it.damage} dmg`);
    if (it.aoe) bits.push(`AoE`);
    card.innerHTML = `
      <div><b>${it.name}</b> <i style="color:var(--muted)">(${it.slot})</i></div>
      <div class="stats">${bits.join(' · ') || '—'}</div>
      <div class="price">${it.price}g</div>
    `;
    const btn = document.createElement('button');
    btn.textContent = 'Buy';
    btn.disabled = me_p.gold < it.price;
    btn.onclick = () => send('shop_buy', { idx: i });
    card.appendChild(btn);
    stock.appendChild(card);
  });
  $('#btn-rest').disabled = me_p.gold < 15;
  $('#btn-rest').onclick = () => send('shop_rest');
  const anyDead = state.players.some(p => !p.alive);
  $('#btn-revive').disabled = !anyDead || me_p.gold < 50;
  $('#btn-revive').onclick = () => {
    const fallen = state.players.filter(p => !p.alive);
    pickTarget('Revive whom?', fallen, (id) => send('shop_revive', { targetId: id }));
  };
  $('#btn-leave-shop').disabled = state.activeId !== me.playerId;
  $('#btn-leave-shop').onclick = () => send('shop_leave');
}

// --- Inventory modal ---
$('#btn-inv').onclick = () => openInventory();
$('#modal-inv-close').onclick = () => $('#modal-inv').classList.add('hidden');
function openInventory() {
  const me_p = state.players.find(p => p.isYou);
  if (!me_p) return;
  const body = $('#inv-body');
  body.innerHTML = '';
  // Equip row
  const equipRow = document.createElement('div');
  equipRow.className = 'equip-row';
  const wId = me_p.equip.weapon, aId = me_p.equip.armor;
  equipRow.innerHTML = `
    <div><b>Equipped:</b></div>
    <div>Weapon: ${wId ? state.items[wId].name : '(none)'} ${wId ? statsLine(state.items[wId]) : ''}</div>
    <div>Armor: ${aId ? state.items[aId].name : '(none)'} ${aId ? statsLine(state.items[aId]) : ''}</div>
  `;
  body.appendChild(equipRow);

  // Inventory
  const list = document.createElement('div');
  list.className = 'inv-list';
  if (!me_p.inventory.length) {
    list.innerHTML = '<i style="color:var(--muted)">Empty.</i>';
  }
  me_p.inventory.forEach((slot, idx) => {
    const it = state.items[slot.id];
    const card = document.createElement('div');
    card.className = 'inv-item';
    card.innerHTML = `
      <div><b>${it.name}</b> <i style="color:var(--muted)">(${it.slot})</i></div>
      <div class="stats">${statsLine(it)}</div>
    `;
    const actions = document.createElement('div');
    actions.className = 'actions';
    if (it.slot === 'weapon' || it.slot === 'armor') {
      const bEquip = makeBtn('Equip', () => { send('equip', { idx }); $('#modal-inv').classList.add('hidden'); });
      actions.appendChild(bEquip);
    }
    if (it.slot === 'consumable' && state.phase !== 'combat') {
      const bUse = makeBtn('Use', () => {
        if (it.heal) {
          pickTarget('Heal whom?', state.players.filter(p => p.alive), (id) => {
            send('use_item', { idx, targetId: id });
            $('#modal-inv').classList.add('hidden');
          });
        } else {
          send('use_item', { idx });
          $('#modal-inv').classList.add('hidden');
        }
      });
      actions.appendChild(bUse);
    }
    const bDrop = makeBtn('Drop', () => { send('drop', { idx }); $('#modal-inv').classList.add('hidden'); });
    bDrop.classList.add('danger');
    actions.appendChild(bDrop);
    card.appendChild(actions);
    list.appendChild(card);
  });
  body.appendChild(list);
  $('#modal-inv').classList.remove('hidden');
}

function statsLine(it) {
  const bits = [];
  if (it.atk) bits.push(`ATK +${it.atk}`);
  if (it.def) bits.push(`DEF +${it.def}`);
  if (it.spd) bits.push(`SPD ${it.spd > 0 ? '+' : ''}${it.spd}`);
  if (it.mag) bits.push(`MAG +${it.mag}`);
  if (it.heal) bits.push(`Heals ${it.heal}`);
  if (it.focus) bits.push(`+${it.focus} focus`);
  if (it.damage) bits.push(`${it.damage} dmg`);
  return bits.join(' · ');
}

// --- Target picker modal ---
function pickTarget(title, players, cb) {
  $('#target-title').textContent = title;
  const body = $('#target-body');
  body.innerHTML = '';
  for (const p of players) {
    const b = document.createElement('button');
    b.textContent = `${p.name} (HP ${p.hp}/${p.maxHp})${!p.alive ? ' [fallen]' : ''}`;
    b.style.width = '100%';
    b.style.marginBottom = '6px';
    b.onclick = () => {
      $('#modal-target').classList.add('hidden');
      cb(p.id);
    };
    body.appendChild(b);
  }
  $('#modal-target').classList.remove('hidden');
}
$('#modal-target-close').onclick = () => $('#modal-target').classList.add('hidden');

function pickItem(title, items, cb) {
  $('#target-title').textContent = title;
  const body = $('#target-body');
  body.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = `${it.name} — ${statsLine(it)}`;
    b.style.width = '100%';
    b.style.marginBottom = '6px';
    b.onclick = () => {
      $('#modal-target').classList.add('hidden');
      cb(it);
    };
    body.appendChild(b);
  }
  $('#modal-target').classList.remove('hidden');
}

// --- Save ---
$('#btn-save').onclick = () => {
  const name = prompt('Save name?', state.code) || state.code;
  send('save_game', { name });
};

// --- Chat ---
$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  if (!input.value.trim()) return;
  send('chat', { text: input.value.trim() });
  input.value = '';
};

// --- On load, try peek saves from a transient connection? Simpler: fill on join.
// Pre-fill from a tiny pre-connect via ws is overkill — keep saves list lazy after join.
