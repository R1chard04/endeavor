// Craft items. Small recipes (planks, sticks, a crafting table) use the
// inventory's 2x2 grid. Bigger ones need a crafting table: the bot uses one
// nearby, or places its own and picks it back up afterwards.

import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { countItem } from './inventory.js'

const { goals } = pathfinderPkg
export const TABLE_SEARCH_RADIUS = 24

export async function craft (bot, itemName, times, { signal, log = () => {} } = {}) {
  const item = bot.registry.itemsByName[itemName]
  if (!item) throw new Error(`"${itemName}" isn't an item`)

  let table = null
  let placedTable = false
  try {
    for (let i = 0; i < times; i++) {
      signal?.throwIfAborted()
      // One craft at a time, choosing the recipe fresh each time, so a mix of
      // wood types (3 oak planks + 1 birch) still works.
      let recipe = bot.recipesFor(item.id, null, 1, null)[0]
      if (!recipe) {
        if (!table) {
          ({ block: table, placed: placedTable } = await getCraftingTable(bot, log))
        }
        await goNear(bot, table.position)
        recipe = bot.recipesFor(item.id, null, 1, table)[0]
      }
      if (!recipe) throw new Error(`I'm missing ingredients for ${item.displayName}`)
      const before = countItem(bot, itemName)
      await bot.craft(recipe, 1, recipe.requiresTable ? table : null)
      // Crafting in the 2x2 grid returns before the server confirms it. If we
      // replan now we see a stale inventory and craft things twice, so wait
      // for the new items to show up.
      await waitFor(bot, () => countItem(bot, itemName) >= before + recipe.result.count)
    }
  } finally {
    // Take our table with us, unless we were told to stop.
    if (placedTable && !signal?.aborted) await pickUp(bot, table, log)
  }
}

export function findCraftingTable (bot) {
  return bot.findBlock({
    matching: bot.registry.blocksByName.crafting_table.id,
    maxDistance: TABLE_SEARCH_RADIUS
  })
}

async function getCraftingTable (bot, log) {
  const existing = findCraftingTable(bot)
  if (existing) return { block: existing, placed: false }
  log('Placing a crafting table')
  return { block: await placeCraftingTable(bot), placed: true }
}

// Spots around the bot to try: about 2 blocks away first (close enough to
// reach, far enough not to be standing in the way), then 1, then 3.
const OFFSETS = []
for (let dx = -3; dx <= 3; dx++) {
  for (let dz = -3; dz <= 3; dz++) {
    if (dx !== 0 || dz !== 0) OFFSETS.push([dx, dz])
  }
}
OFFSETS.sort(([ax, az], [bx, bz]) => Math.abs(Math.hypot(ax, az) - 2) - Math.abs(Math.hypot(bx, bz) - 2))

// Plants and ground cover (grass, flowers, leaf litter) can be broken
// instantly to make room. Never these, though: they're probably someone's build.
const DONT_CLEAR = /torch|rail|redstone|button|lever|plate|sign|banner|head|skull|candle|fire|portal/

async function placeCraftingTable (bot) {
  const tableItem = bot.inventory.items().find((i) => i.name === 'crafting_table')
  if (!tableItem) throw new Error("I don't have a crafting table")
  const feet = bot.entity.position.floored()

  // First look for open air; only clear plants if there's no open spot.
  for (const clearPlants of [false, true]) {
    for (const [dx, dz] of OFFSETS) {
      for (const dy of [0, -1, 1]) {
        const spot = feet.offset(dx, dy, dz)
        const space = bot.blockAt(spot)
        const ground = bot.blockAt(spot.offset(0, -1, 0))
        if (!space || !ground || ground.boundingBox !== 'block') continue
        if (overlapsBot(bot, spot)) continue
        const isAir = space.name === 'air' || space.name === 'cave_air'
        if (!isAir && !(clearPlants && canClear(space))) continue

        if (!isAir) await bot.dig(space)
        await bot.equip(tableItem, 'hand')
        try {
          await bot.placeBlock(ground, new Vec3(0, 1, 0))
        } catch {
          // placeBlock sometimes times out even though the block went down; check below.
        }
        const placed = bot.blockAt(spot)
        if (placed?.name === 'crafting_table') return placed
      }
    }
  }
  throw new Error("I couldn't find a spot to put my crafting table")
}

function canClear (block) {
  return block.boundingBox === 'empty' && block.hardness === 0 && block.diggable &&
    !DONT_CLEAR.test(block.name)
}

function overlapsBot (bot, spot) {
  const p = bot.entity.position
  const w = 0.3 // half the player's width
  return p.x + w > spot.x && p.x - w < spot.x + 1 &&
    p.z + w > spot.z && p.z - w < spot.z + 1 &&
    p.y < spot.y + 1 && p.y + 1.8 > spot.y
}

// Resolve once check() is true, checking every game tick. Gives up quietly
// after the timeout: the next plan will notice if something's off.
function waitFor (bot, check, timeoutMs = 2000) {
  if (check()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (result) => {
      clearTimeout(timer)
      bot.removeListener('physicsTick', onTick)
      resolve(result)
    }
    const onTick = () => { if (check()) done(true) }
    const timer = setTimeout(() => done(false), timeoutMs)
    bot.on('physicsTick', onTick)
  })
}

async function goNear (bot, position) {
  if (bot.entity.position.distanceTo(position.offset(0.5, 0.5, 0.5)) <= 3.5) return
  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2))
}

async function pickUp (bot, table, log) {
  const block = bot.blockAt(table.position)
  if (block?.name !== 'crafting_table') return
  try {
    await bot.collectBlock.collect(block)
  } catch (err) {
    log(`Left my crafting table behind: ${err.message}`)
  }
}
