// How the bot is allowed to move and dig, for the pathfinder.

import pathfinderPkg from 'mineflayer-pathfinder'

const { Movements } = pathfinderPkg
const SIDES = [[0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]]

export function createMovements (bot) {
  const movements = new Movements(bot)
  movements.allowParkour = false // fewer falls into ravines

  // Never break a block next to lava: it would pour out onto us. The built-in
  // dontCreateFlow option protects against water too, which walls off any
  // ore in a flooded cave (common underground since 1.18). A bit of loose
  // water is harmless, so only lava counts here.
  movements.dontCreateFlow = false
  const lava = bot.registry.blocksByName.lava.id
  const safeToBreak = movements.safeToBreak.bind(movements)
  movements.safeToBreak = (block) => {
    if (!safeToBreak(block)) return false
    return !SIDES.some(([dx, dy, dz]) => movements.getBlock(block.position, dx, dy, dz).type === lava)
  }
  return movements
}
