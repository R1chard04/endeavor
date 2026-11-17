// Get an item by any means: ask the planner for the steps, do the first one,
// then ask again. Replanning after every step means surprises (the
// pathfinder used our cobblestone as scaffolding, a tree was out of reach)
// just get folded into the next plan.

import { makePlan, describeStep } from '../planner/planner.js'
import { countItem, inventoryMap, inventorySummary } from './inventory.js'
import { collect } from './collect.js'
import { craft, findCraftingTable } from './craft.js'

const NEARBY_RADIUS = 32
const MAX_STEPS = 40

export async function obtain (bot, gather, goal, count, { signal, log = () => {}, say = log } = {}) {
  for (let i = 0; i < MAX_STEPS; i++) {
    signal?.throwIfAborted()
    if (countItem(bot, goal) >= count) return

    const world = snapshot(bot, gather)
    const plan = makePlan(world, inventoryMap(bot), goal, count)
    if (!plan.ok) throw new Error(plan.reason)
    const step = plan.steps[0]
    if (!step) return

    say(`${describeStep(step, bot.registry)} (${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'} left)`)
    if (step.type === 'collect') {
      // Chop the wood the plan picked if it's in sight; any other wood is the fallback.
      // (Always taking the closest tree can loop: the plan wants dark oak, we keep getting oak.)
      const exactIsNearby = gather.sources.get(step.item).some((b) => world.nearby.has(b))
      const items = exactIsNearby ? [step.item] : step.anyOf
      await collect(bot, gather, items, step.count, { signal, log })
    } else {
      await craft(bot, step.item, step.times, { signal, log })
    }
    log(`  now holding: ${inventorySummary(bot)}`)
  }
  throw new Error(`I gave up on ${goal} after ${MAX_STEPS} steps`)
}

/** The planner's current plan, from what the bot holds and can see right now. */
export function planFor (bot, gather, goal, count) {
  return makePlan(snapshot(bot, gather), inventoryMap(bot), goal, count)
}

// What the planner needs to know about the world around the bot.
function snapshot (bot, gather) {
  return {
    mcData: bot.registry,
    ...gather,
    nearby: nearbyBlocks(bot, gather),
    craftingTableNearby: Boolean(findCraftingTable(bot))
  }
}

// Which of the gatherable blocks are near the bot. Scanning is slow-ish, and
// a burst of crafting steps doesn't move the bot, so reuse a recent scan.
const RESCAN_AFTER_MS = 15_000
const RESCAN_AFTER_BLOCKS = 8
const scans = new WeakMap()

function nearbyBlocks (bot, gather) {
  const last = scans.get(bot)
  const pos = bot.entity.position
  if (last && Date.now() - last.time < RESCAN_AFTER_MS && pos.distanceTo(last.pos) < RESCAN_AFTER_BLOCKS) {
    return last.nearby
  }
  const nearby = new Set()
  for (const blocks of gather.sources.values()) {
    for (const name of blocks) {
      if (nearby.has(name)) continue
      const found = bot.findBlock({ matching: bot.registry.blocksByName[name].id, maxDistance: NEARBY_RADIUS })
      if (found) nearby.add(name)
    }
  }
  scans.set(bot, { time: Date.now(), pos: pos.clone(), nearby })
  return nearby
}
