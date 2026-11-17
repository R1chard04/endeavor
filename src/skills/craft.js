// Craft items. Small recipes (planks, sticks, a crafting table) use the
// inventory's 2x2 grid. Bigger ones need a crafting table: the bot uses one
// nearby, or places its own and picks it back up afterwards.

import { countItem } from './inventory.js'
import { findStation, getStation, goNear, pickUp } from './stations.js'
import { waitFor } from '../util.js'

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
          ({ block: table, placed: placedTable } = await getStation(bot, 'crafting_table', { log }))
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
  return findStation(bot, 'crafting_table')
}
