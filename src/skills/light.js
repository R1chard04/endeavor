// Torches. Monsters spawn in complete darkness, so underground the bot puts
// a torch down wherever there's no light at all. One torch lights about 12
// blocks around it, so they end up spaced out on their own.

import { placeHere } from './stations.js'

// The server sends light updates a moment after a torch goes down, so right
// after placing one the spot still looks dark. Remember where our torches
// are and don't place another one this close.
const TORCH_SPACING = 8
const placedTorches = new WeakMap() // bot -> positions

/** Underground and pitch dark? Put a torch down (if we have one). */
export async function lightUpIfDark (bot, { log = () => {} } = {}) {
  if (!bot.inventory.items().some((i) => i.name === 'torch')) return false
  const feet = bot.entity.position.floored()
  const underground = bot.world.getSkyLight(feet) === 0
  const dark = bot.world.getBlockLight(feet) === 0
  if (!underground || !dark) return false

  const mine = placedTorches.get(bot) ?? []
  if (mine.some((pos) => pos.distanceTo(feet) < TORCH_SPACING)) return false

  try {
    const torch = await placeHere(bot, 'torch')
    placedTorches.set(bot, [...mine.slice(-50), torch.position])
    log(`Placed a torch at ${torch.position}`)
    return true
  } catch {
    return false // nowhere to put it here; try again further on
  }
}
