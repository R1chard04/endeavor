# Endeavor

A Minecraft bot that plays survival by itself, one stage at a time. The long-term goal is to beat the game (kill the Ender Dragon), which is where the name comes from: it's always working its way toward the End.

It uses [Mineflayer](https://github.com/PrismarineJS/mineflayer), so the bot joins the world as its own player, named **Endeavor**, separate from you. You can play alongside it and give it jobs in chat, or let it play on its own.

## Status

| Stage | What the bot can do | Status |
|---|---|---|
| 1. Wood | Find trees, chop the whole trunk, pick up the logs | ✅ |
| 2. Tools | Craft planks, sticks and a crafting table, then wooden and stone pickaxes | ✅ |
| 3. Survive | Fight or run from mobs, eat, hunt and cook food, sleep in a bed or dig in for the night, swim (float at the surface), get out of lava and water | ✅ |
| 4. Iron | Mine iron (lighting tunnels with torches), smelt, make an iron pickaxe, sword, shield, armor and a water bucket; wear armor, block arrows with the shield, pour water on lava, throw away junk when its inventory fills up | ✅ On its own, from stone tools to an iron pickaxe, shield, sword, water bucket and chestplate in about 10 minutes, at full health. The last three armor pieces use the same steps |
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
npm start                # in a second terminal: the bot joins and waits for chat commands
npm start -- --auto      # ...or the bot plays on its own
```

In Minecraft, go to Multiplayer → Direct Connection → `localhost` to join the same world.

The test server:
- only accepts connections from your computer (`server-ip=127.0.0.1`);
- runs in offline mode, so the bot doesn't need its own account (don't expose this server to the internet);
- starts on Peaceful, with spawn protection off so the bot can break blocks near spawn. Type `difficulty easy` in the server console when you want mobs.

## Playing on its own

With `npm start -- --auto` (or `!auto` in chat), the bot works through a list of goals in [src/brain/goals.js](src/brain/goals.js), most important first:

1. Get through the night: sleep in its bed, or dig a sealed hole and wait for morning.
2. Find food when it's getting hungry.
3. Wooden pickaxe → stone pickaxe → stone sword → a stock of cooked food → a bed → torches → iron pickaxe → shield → iron sword → water bucket → iron chestplate, leggings, boots and helmet.

If something more important comes up, such as nightfall or hunger, it sets the current goal aside and comes back to it later. A goal that fails waits a while before the bot tries it again. If the bot dies it respawns and starts over from what it has; if it gets disconnected it reconnects. `!status` tells you what it's working on.

## Chat commands

| Command | What it does |
|---|---|
| `!auto [off]` | Play on its own (or stop) |
| `!status` | What it's working on, plus health, food and position |
| `!wood [n]` | Chop n logs of any kind (default 16) |
| `!get <item> [n]` | Get an item any way it can (mine, hunt, craft, smelt), e.g. `!get cooked beef 4` |
| `!plan <item> [n]` | Show the steps without doing them |
| `!give [item\|logs]` | Bring you everything, or one kind of item |
| `!come` | Walk to you |
| `!eat` | Eat something now |
| `!sleep` | Sleep in its bed, or dig in for the night |
| `!inv` | List what the bot is carrying |
| `!stop` | Stop the current job (and `!auto`) |

You can also give the bot one job from the terminal:

```bash
npm start -- --wood 10
npm start -- --get stone_pickaxe --exit   # disconnect when done (handy for testing)
```

Settings such as the bot's name, the server address and who's allowed to give commands go in a `.env` file. See [.env.example](.env.example).

## How it works

The code is built in layers, so each new stage mostly means adding skills and goals:

1. **Skills** ([src/skills/](src/skills/)) are small actions: `collect` (find blocks, break them, pick up drops), `craft`, `hunt`, `smelt`, `combat` (including raising a shield against archers), `eat`, `night` (bed or shelter), `equipment` (wearing the best armor), `buckets` (filling one, pouring it on lava), `light` (torches underground), `explore`, and helpers for stations (placing and picking up tables, furnaces and beds, carving a niche for them in tight tunnels), players and the inventory. [src/movement.js](src/movement.js) sets how the bot may dig: never next to lava.
2. **Planner** ([src/planner/planner.js](src/planner/planner.js)) works backward from a goal item. Ask for steak and it works out: cows to hunt, a furnace (8 cobblestone, so a wooden pickaxe first), and fuel (coal if it has some, planks if not). It reads recipes from `minecraft-data`, picks the cheapest options given what's nearby, and if its first choice turns out to be a dead end it tries the next one.
3. **Executor** ([src/skills/obtain.js](src/skills/obtain.js)) does the first step of the plan, then asks for a new plan. If something unexpected happens (it chopped spruce instead of oak, a reflex interrupted it), the next plan accounts for it.
4. **Survival reflexes** ([src/survival/reflexes.js](src/survival/reflexes.js)) are checked twice a second, every tick when in lava. They interrupt whatever is running to escape lava, swim up for air, run away, fight back, eat or throw away junk, and then the job resumes. In the background they also put on any better armor and a shield, and keep the bot afloat in water ([src/skills/swimming.js](src/skills/swimming.js)). Mobs it can't reach (deep under water, across a gap) are left alone for 30 seconds instead of chased in circles, and if one of those keeps hurting it, it moves away. The [task runner](src/tasks.js) handles interrupting and resuming.
5. **Brain** ([src/brain/](src/brain/)) picks goals when the bot plays on its own.

[src/planner/sources.js](src/planner/sources.js) lists where raw items come from: blocks the bot may break (a whitelist, so it never tears down a house for planks), animals to hunt, and what to smelt. Extending it is part of each new stage.

## Tests

```bash
npm test
```

These run without a server: the planner (plans for many situations), the task runner (interrupting and resuming jobs), and the brain (goal order, switching priorities, retrying).

## Known weak spots

- **Lava** is survivable with a water bucket (it pours water and keeps full health). Without one, the leftover fire can still kill it. It never breaks blocks next to lava.
- **Water with a ceiling** (a flooded cave, an underwater tunnel) can still drown it: it floats up, but if there's rock above it has nowhere to breathe.
- **Underground water** once drowned it mid-fight. It now skips ore that touches water, surfaces earlier and won't fight while short of air; it hasn't drowned since, but flooded caves are still the riskiest place it goes.
- **Skeletons** are much less of a threat with a shield and armor (it won at full health in testing), but without them they can still win.
- **Interrupted jobs can leave a furnace or crafting table behind.** If the bot gets pulled away (by a fight, say) and wanders off, it builds a new one later instead of going back for it.
- **Dying loses everything.** It doesn't go back to pick up its items yet.

## Troubleshooting

- **`client timed out after 30000 milliseconds`**: the bot heard nothing from the server for 30 seconds. On a laptop this usually means the computer went to sleep, which freezes both the server and the bot. A MacBook on battery sleeps when the lid is closed, even if apps ask it to stay awake. Keep the lid open (or plug in an external display) while the bot works. With `--auto`, the bot reconnects on its own.
- **`ECONNREFUSED`**: the server isn't running. Start it with `npm run server:start`.
- **The bot ignores your commands**: if `BOT_OWNER` is set in `.env`, it only listens to that player.
- **Want a fresh world?** Stop the server and delete `server/world`. The next start generates a new one.

## Testing a later stage

Don't play from scratch every time. On the server console (or in game as an op), set up the situation you want to test:

```
op YourName
difficulty easy
give Endeavor minecraft:stone_pickaxe
give Endeavor minecraft:white_bed
time set 13000
execute at Endeavor run summon minecraft:zombie ~5 ~ ~
```
