# Endeavor

A Minecraft bot that plays survival by itself, one stage at a time. The long-term goal is to beat the game (kill the Ender Dragon), which is where the name comes from: it's always working its way toward the End.

It uses [Mineflayer](https://github.com/PrismarineJS/mineflayer), so the bot joins the world as its own player, named **Endeavor**, separate from you. You can play alongside it and give it jobs in chat.

## Status

| Stage | What the bot can do | Status |
|---|---|---|
| 1. Wood | Find trees, chop the whole trunk, pick up the logs | ✅ |
| 2. Tools | Craft planks, sticks and a crafting table, then wooden and stone pickaxes | ✅ |
| 3. Survive | Eat, sleep, fight or run from mobs, avoid lava and falls | — |
| 4. Iron | Mine, smelt, make iron tools, armor and a bucket | — |
| 5. Diamonds | Mine at the right depth without dying | — |
| 6. Nether | Build a portal, find a fortress, get blaze rods | — |
| 7. Ender pearls | Trade with piglins or hunt endermen | — |
| 8. Stronghold | Craft eyes of ender, triangulate, find the portal | — |
| 9. Dragon | Destroy the crystals, fight the dragon | — |

## Setup

You need Node.js 22.9 or newer, Java 21, and Minecraft Java Edition **1.21.11** (pick it in the launcher under Installations). Mineflayer doesn't support 26.2 yet.

```bash
npm install
npm run server:setup     # downloads the official server from Mojang into ./server
```

The server won't start until you accept the [Minecraft EULA](https://aka.ms/MinecraftEULA) by setting `eula=true` in `server/eula.txt`. Then:

```bash
npm run server:start     # leave this running; type "stop" to shut it down
npm start                # in a second terminal: the bot joins
```

In Minecraft, go to Multiplayer → Direct Connection → `localhost` to join the same world.

The test server:
- only accepts connections from your computer (`server-ip=127.0.0.1`);
- runs in offline mode, so the bot doesn't need its own account (don't expose this server to the internet);
- starts on Peaceful, with spawn protection off so the bot can break blocks near spawn.

## Chat commands

| Command | What it does |
|---|---|
| `!wood [n]` | Chop n logs of any kind (default 16) |
| `!get <item> [n]` | Get an item, crafting whatever it needs, e.g. `!get stone pickaxe` |
| `!plan <item> [n]` | Show the steps without doing them |
| `!give [item\|logs]` | Bring you everything, or one kind of item |
| `!come` | Walk to you |
| `!inv` | List what the bot is carrying |
| `!stop` | Stop the current job |

You can also give the bot one job from the terminal:

```bash
npm start -- --wood 10
npm start -- --get stone_pickaxe --exit   # disconnect when done (handy for testing)
```

Settings such as the bot's name, the server address and who's allowed to give commands go in a `.env` file. See [.env.example](.env.example).

## How it works

The code is built in three layers, so each new stage mostly means adding skills:

1. **Skills** ([src/skills/](src/skills/)) are small actions: `collect` (find blocks, break them, pick up drops), `craft` (with or without a crafting table), `explore`, and helpers for players and the inventory.
2. **Planner** ([src/planner/planner.js](src/planner/planner.js)) works backward from a goal. Ask for a stone pickaxe and it works out that it needs cobblestone and sticks at a crafting table, that cobblestone needs a wooden pickaxe, and so on. It reads recipes from `minecraft-data` instead of having them typed in, and it picks the options that are cheapest given what's nearby (birch planks if only birch trees are around).
3. **Executor** ([src/skills/obtain.js](src/skills/obtain.js)) does the first step of the plan, then asks for a new plan. If something unexpected happens (it chopped spruce instead of oak, or used cobblestone to climb), the next plan accounts for it.

Survival reflexes, which run in the background, come with stage 3.

[src/planner/sources.js](src/planner/sources.js) lists which blocks the bot is allowed to break for each raw item. It's a whitelist, so the bot never tears down a house to get planks. Extending it is part of each new stage: iron ore for stage 4, for example.

## Tests

```bash
npm test
```

The planner tests run without a server. Planning is just data, so they check the plans for many situations in milliseconds.

## Troubleshooting

- **`client timed out after 30000 milliseconds`**: the bot heard nothing from the server for 30 seconds. On a laptop this usually means the computer went to sleep, which freezes both the server and the bot. A MacBook on battery sleeps when the lid is closed, even if apps ask it to stay awake. Keep the lid open (or plug in an external display) while the bot works.
- **`ECONNREFUSED`**: the server isn't running. Start it with `npm run server:start`.
- **The bot ignores your commands**: if `BOT_OWNER` is set in `.env`, it only listens to that player.
- **Want a fresh world?** Stop the server and delete `server/world`. The next start generates a new one.

## Testing a later stage

Don't play from scratch every time. On the server console (or in game as an op), skip ahead:

```
op YourName
give Endeavor minecraft:stone_pickaxe
tp Endeavor ~ ~ ~
difficulty easy
```
