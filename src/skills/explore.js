// Walk off in a random direction to find new things (like trees).

import pathfinderPkg from 'mineflayer-pathfinder'

const { goals } = pathfinderPkg
const GIVE_UP_AFTER_MS = 45_000

export async function explore (bot, { signal, distance = 48 } = {}) {
  const angle = Math.random() * 2 * Math.PI
  const { x, z } = bot.entity.position
  const goal = new goals.GoalNearXZ(
    Math.round(x + Math.cos(angle) * distance),
    Math.round(z + Math.sin(angle) * distance),
    4
  )
  const timer = setTimeout(() => bot.pathfinder.stop(), GIVE_UP_AFTER_MS)
  try {
    await bot.pathfinder.goto(goal)
  } catch (err) {
    // Getting partway there is fine: we just want to see new chunks.
    signal?.throwIfAborted()
  } finally {
    clearTimeout(timer)
  }
}
