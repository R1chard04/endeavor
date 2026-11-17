// Skills that involve another player: coming over, handing items over.

import pathfinderPkg from 'mineflayer-pathfinder'

const { goals } = pathfinderPkg

export async function comeTo (bot, username) {
  const player = bot.players[username]?.entity
  if (!player) throw new Error(`I can't see you, ${username}. Come closer?`)
  const { x, y, z } = player.position
  await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2))
  return player
}

/**
 * Walk to a player and throw items at them.
 * @param {(itemName: string) => boolean} which - which items to hand over
 */
export async function giveTo (bot, username, which) {
  const player = await comeTo(bot, username)
  const items = bot.inventory.items().filter((item) => which(item.name))
  if (items.length === 0) return 0
  await bot.lookAt(player.position.offset(0, 1.6, 0))
  let given = 0
  for (const item of items) {
    await bot.tossStack(item)
    given += item.count
  }
  return given
}
