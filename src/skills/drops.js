// Picking up items lying on the ground.

import { sleep } from '../util.js'

/** Walk over the items that dropped around a spot (after a kill, or breaking a bed). */
export async function pickUpDrops (bot, spot, { signal, radius = 5 } = {}) {
  await sleep(600, signal) // let the drops appear
  const drops = Object.values(bot.entities).filter((e) =>
    e.name === 'item' && e.position.distanceTo(spot) <= radius)
  if (drops.length === 0) return
  try {
    await bot.collectBlock.collect(drops, { ignoreNoPath: true })
  } catch {
    signal?.throwIfAborted() // an item we couldn't reach isn't worth failing over
  }
}
