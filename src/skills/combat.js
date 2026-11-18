// Fighting: pick the best weapon, chase a mob and hit it until it dies.

import pathfinderPkg from 'mineflayer-pathfinder'
import { sleep } from '../util.js'
import { reachableInWater } from './swimming.js'

const { goals } = pathfinderPkg

// Best first. Axes hit hard but swing slowly; swords are the safer pick.
const WEAPONS = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'copper_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'copper_axe', 'stone_axe', 'golden_axe', 'wooden_axe'
]
export const REACH = 3 // blocks
const SWING_EVERY_MS = 650 // a sword's full-strength cooldown is 0.625s
const NO_ROUTE_MS = 5000 // give up once the pathfinder has found no way to the mob for this long

// Hostile mobs worth fighting. Endermen and zombified piglins only attack if
// you provoke them, so the bot leaves them alone.
const NEUTRAL = new Set(['enderman', 'zombified_piglin', 'piglin', 'piglin_brute'])
const EXTRA_HOSTILE = new Set(['slime', 'magma_cube', 'phantom', 'shulker', 'ghast'])

// Mobs that shoot from range. They keep firing while you chase them.
export const ARCHERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'piglin', 'witch', 'blaze'])

export function isHostile (entity) {
  if (!entity?.name || NEUTRAL.has(entity.name)) return false
  return entity.type === 'hostile' || EXTRA_HOSTILE.has(entity.name)
}

/** The closest hostile mob within `range` blocks, or null. `skip` leaves some out. */
export function nearestHostile (bot, range, skip = () => false) {
  return bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(bot.entity.position) <= range && !skip(e))
}

export async function equipWeapon (bot) {
  const items = bot.inventory.items()
  const best = WEAPONS.map((name) => items.find((i) => i.name === name)).find(Boolean)
  if (best && bot.heldItem?.name !== best.name) await bot.equip(best, 'hand')
}

/**
 * Chase an entity and hit it until it's gone (dead or despawned).
 * Returns true if it went away, false if we gave up: it's deep under water,
 * or there's no way to get to it (across a ravine, up a cliff...).
 * The timing options exist so the tests can run fast.
 */
export async function attack (bot, entity, {
  signal,
  giveUpAfterMs = 30_000,
  noRouteMs = NO_ROUTE_MS,
  swingEveryMs = SWING_EVERY_MS
} = {}) {
  if (!reachableInWater(bot, entity)) return false
  await equipWeapon(bot)
  // "Can't get there" has to come from the pathfinder, not from how fast
  // we're closing in: a slow approach (shield raised, a skeleton backing off)
  // looks just like a dead end otherwise.
  let noRouteSince = null
  const onPath = ({ status }) => {
    if (status === 'noPath' || status === 'timeout') noRouteSince ??= Date.now()
    else noRouteSince = null
  }
  bot.on('path_update', onPath)
  bot.pathfinder.setGoal(new goals.GoalFollow(entity, 1.5), true) // keeps following as it moves
  // Against archers, walk in behind a raised shield, and lower it to swing.
  const useShield = ARCHERS.has(entity.name) && bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')]?.name === 'shield'
  let shieldUp = false
  const raise = (up) => {
    if (up === shieldUp) return
    if (up) bot.activateItem(true)
    else bot.deactivateItem()
    shieldUp = up
  }
  const started = Date.now()
  try {
    while (entity.isValid && Date.now() - started < giveUpAfterMs) {
      signal?.throwIfAborted()
      if (bot.entity.position.distanceTo(entity.position) <= REACH) {
        raise(false)
        await bot.lookAt(entity.position.offset(0, entity.height * 0.7, 0), true)
        bot.attack(entity)
      } else {
        if (useShield) raise(true)
        // Give up if it dived out of reach, or the pathfinder keeps finding no way to it.
        if (!reachableInWater(bot, entity)) break
        if (noRouteSince !== null && Date.now() - noRouteSince > noRouteMs) break
      }
      await sleep(swingEveryMs, signal)
    }
  } finally {
    raise(false)
    bot.removeListener('path_update', onPath)
    bot.pathfinder.setGoal(null)
  }
  return !entity.isValid
}

/** Run directly away from a mob for a few seconds. */
export async function runFrom (bot, entity, { signal, seconds = 4 } = {}) {
  bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(entity, 16)), true)
  try {
    await sleep(seconds * 1000, signal)
  } finally {
    bot.pathfinder.setGoal(null)
  }
}
