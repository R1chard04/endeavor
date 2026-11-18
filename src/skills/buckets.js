// Buckets: fill one with water, and pour water on ourselves to put out
// fire or turn the lava we're standing in into stone.

import { countItem } from './inventory.js'
import { goNear } from './stations.js'
import { explore } from './explore.js'
import { waitFor, sleep } from '../util.js'

const MAX_EXPLORES = 6

function findStillWater (bot, maxDistance = 48) {
  return bot.findBlock({
    matching: bot.registry.blocksByName.water.id,
    maxDistance,
    // A source block, not flowing water. (The level comes back as a string.)
    useExtraInfo: (b) => Number(b.getProperties().level) === 0
  })
}

/** Walk to the nearest still water and fill an empty bucket. */
export async function fillBucket (bot, { signal, log = () => {} } = {}) {
  let water = findStillWater(bot)
  for (let i = 1; !water && i <= MAX_EXPLORES; i++) {
    log(`No water in sight. Exploring (${i}/${MAX_EXPLORES})...`)
    await explore(bot, { signal })
    water = findStillWater(bot)
  }
  if (!water) throw new Error("I couldn't find any water to fill my bucket")
  log(`Filling a bucket at ${water.position}`)
  await goNear(bot, water.position, 2)

  const before = countItem(bot, 'water_bucket')
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted()
    const bucket = bot.inventory.items().find((i) => i.name === 'bucket')
    if (!bucket) throw new Error("I don't have an empty bucket")
    await bot.equip(bucket, 'hand')
    await bot.lookAt(water.position.offset(0.5, 0.9, 0.5), true)
    bot.activateItem()
    if (await waitFor(bot, () => countItem(bot, 'water_bucket') > before, 1500)) return
    await goNear(bot, water.position, 1) // maybe too far or at a bad angle: get closer
  }
  throw new Error("I couldn't fill my bucket")
}

export function hasWaterBucket (bot) {
  return countItem(bot, 'water_bucket') > 0
}

/**
 * Pour water at our feet: puts out fire, and turns lava we're standing in
 * into obsidian or stone. Then scoop the water back up to keep the bucket.
 */
export async function douse (bot, { signal } = {}) {
  const full = bot.inventory.items().find((i) => i.name === 'water_bucket')
  if (!full) return false
  await bot.equip(full, 'hand')
  await bot.look(bot.entity.yaw, -Math.PI / 2, true) // straight down
  bot.activateItem()
  await sleep(1200, signal) // long enough to put the fire out
  // Scoop the water back up. It may have spread or we may have moved, so aim
  // at the nearest still water rather than straight down.
  const empty = bot.inventory.items().find((i) => i.name === 'bucket')
  const source = findStillWater(bot, 4)
  if (empty && source) {
    await bot.equip(empty, 'hand')
    await bot.lookAt(source.position.offset(0.5, 0.9, 0.5), true)
    bot.activateItem()
    await waitFor(bot, () => hasWaterBucket(bot), 1000)
  }
  return true
}
