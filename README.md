# Realm Quest

A small co-op turn-based RPG inspired by *For the King*. Up to 4 heroes share a hex overworld, fight enemies in dice-driven combat, shop in towns, and try to slay the Ancient Dragon.

## Stack

- Node.js + `ws` for the WebSocket server (authoritative game state)
- Plain HTML / CSS / Canvas client, no build step

## Run

```bash
npm install
npm start
# open http://localhost:3000
```

To play co-op, the host clicks **Create Room** and shares the 4-letter code. Friends click **Join Room** and enter the code. Up to 4 players per room.

Want to run for friends on the LAN? Set `PORT` if needed and share your LAN IP:

```bash
PORT=3000 npm start
# others open http://<your-lan-ip>:3000
```

## How to play

1. **Lobby**: each player picks one of four classes (Knight / Hunter / Wizard / Cleric). Host clicks *Start Adventure*.
2. **Overworld**: on your turn you roll for movement, then click a highlighted tile to walk there.
   - **Forest / Mountain / Plains**: random event or encounter
   - **Town** (🏘): shop, rest at inn (15g heals all), revive fallen (50g)
   - **Dungeon** (🏚): guaranteed fight, drops loot when cleared
   - **Boss** (🐉): the Ancient Dragon — final fight
3. **Combat**: turn order is speed-based. Actions:
   - **Attack**: d6 + ATK vs target DEF. 6 crits.
   - **Skill**: class-specific (taunt, multi-shot, fireball, heal). Costs *focus*.
   - **Use Item**: potions, bomb, focus brew.
   - **Defend**: +3 DEF this round, +1 focus.
   - **Flee**: roll ≥ 4 to escape (bosses block fleeing).
4. **Win**: slay the dragon. **Lose**: whole party falls.

## Save / Load

Host can click **Save** any time. Saves are stored in `saves/*.json`. From the lobby, anyone can pick **Load Game** to spin up a room from a save — the saved character slots are filled in join-order.

## Layout

```
server.js          Static + WS server. State machine. Save/load.
gamedata.js        Static data: classes, enemies, items, events, map gen.
public/
  index.html       UI shell
  style.css        Theme
  client.js        Renders state from server, sends actions
saves/             Save files (gitignored)
```
