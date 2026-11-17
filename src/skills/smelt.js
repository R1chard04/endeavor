// Smelt items in a furnace: cook food, and later turn raw iron into ingots.

import { countItem } from './inventory.js'
import { getStation, goNear, pickUp, findStation } from './stations.js'
import { sleep } from '../util.js'

const SECONDS_PER_ITEM = 10 // a regular furnace smelts one item every 10 seconds

/**
 * @param {{ input: string, item: string, count: number, fuel: string, fuelCount: number }} job
 *   e.g. { input: 'beef', item: 'cooked_beef', count: 3, fuel: 'oak_planks', fuelCount: 2 }
 */
export async function smelt (bot, job, { signal, log = () => {} } = {}) {
  const id = (name) => bot.registry.itemsByName[name].id
  const { block, placed } = await getStation(bot, 'furnace', { log })
  let furnace = null
  try {
    await goNear(bot, block.position)
    furnace = await bot.openFurnace(block)

    // Clear out anything left over from last time.
    if (furnace.outputItem()) await furnace.takeOutput()
    if (furnace.inputItem() && furnace.inputItem().name !== job.input) await furnace.takeInput()
    if (furnace.fuelItem() && furnace.fuelItem().name !== job.fuel) await furnace.takeFuel()

    const fuel = Math.min(job.fuelCount, countItem(bot, job.fuel))
    if (fuel > 0) await furnace.putFuel(id(job.fuel), null, fuel)
    const amount = Math.min(job.count, countItem(bot, job.input))
    if (amount === 0) throw new Error(`I don't have any ${job.input} to smelt`)
    await furnace.putInput(id(job.input), null, amount)
    log(`Smelting ${amount} ${job.input} (about ${amount * SECONDS_PER_ITEM}s)`)

    // Watch the furnace's own slots: while its window is open, the bot's
    // inventory doesn't update until the window closes.
    const deadline = Date.now() + (amount * SECONDS_PER_ITEM + 20) * 1000
    while (furnace.inputItem() || furnace.outputItem()) {
      signal?.throwIfAborted()
      if (Date.now() > deadline) throw new Error(`Smelting ${job.item} is taking too long. Out of fuel?`)
      await sleep(1000, signal)
      if (furnace.outputItem() && (!furnace.inputItem() || furnace.outputItem().count >= 16)) {
        await furnace.takeOutput()
      }
    }
  } finally {
    if (furnace) {
      // Take back whatever is still in there, especially if we were interrupted.
      for (const take of ['takeOutput', 'takeInput', 'takeFuel']) {
        const slot = { takeOutput: 'outputItem', takeInput: 'inputItem', takeFuel: 'fuelItem' }[take]
        try { if (furnace[slot]()) await furnace[take]() } catch {}
      }
      furnace.close()
    }
    // A furnace only drops itself when broken with a pickaxe.
    if (placed && !signal?.aborted && hasHarvestTool(bot, 'furnace')) await pickUp(bot, block, log)
  }
}

export function findFurnace (bot) {
  return findStation(bot, 'furnace')
}

function hasHarvestTool (bot, blockName) {
  const tools = bot.registry.blocksByName[blockName].harvestTools
  if (!tools) return true
  return bot.inventory.items().some((item) => tools[item.type])
}
