// Fighting: pick the best weapon, chase a mob and hit it until it dies.

import pathfinderPkg from 'mineflayer-pathfinder'
import { sleep } from '../util.js'

const { goals } = pathfinderPkg

// Best first. Axes hit hard but swing slowly; swords are the safer pick.
const WEAPONS = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'copper_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'copper_axe', 'stone_axe', 'golden_axe', 'wooden_axe'
]
const REACH = 3 // blocks
const SWING_EVERY_MS = 650 // a sword's full-strength cooldown is 0.625s

// Hostile mobs worth fighting. Endermen and zombified piglins only attack if
// you provoke them, so the bot leaves them alone.
const NEUTRAL = new Set(['enderman', 'zombified_piglin', 'piglin', 'piglin_brute'])
const EXTRA_HOSTILE = new Set(['slime', 'magma_cube', 'phantom', 'shulker', 'ghast'])

export function isHostile (entity) {
  if (!entity?.name || NEUTRAL.has(entity.name)) return false
  return entity.type === 'hostile' || EXTRA_HOSTILE.has(entity.name)
}

/** The closest hostile mob within `range` blocks, or null. */
export function nearestHostile (bot, range) {
  return bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(bot.entity.position) <= range)
}

export async function equipWeapon (bot) {
  const items = bot.inventory.items()
  const best = WEAPONS.map((name) => items.find((i) => i.name === name)).find(Boolean)
  if (best && bot.heldItem?.name !== best.name) await bot.equip(best, 'hand')
}

/**
 * Chase an entity and hit it until it's gone (dead or despawned).
 * Returns true if it went away, false if we gave up.
 */
export async function attack (bot, entity, { signal, giveUpAfterMs = 30_000 } = {}) {
  await equipWeapon(bot)
  bot.pathfinder.setGoal(new goals.GoalFollow(entity, 1.5), true) // keeps following as it moves
  const started = Date.now()
  try {
    while (entity.isValid && Date.now() - started < giveUpAfterMs) {
      signal?.throwIfAborted()
      if (bot.entity.position.distanceTo(entity.position) <= REACH) {
        await bot.lookAt(entity.position.offset(0, entity.height * 0.7, 0), true)
        bot.attack(entity)
      }
      await sleep(SWING_EVERY_MS, signal)
    }
  } finally {
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
