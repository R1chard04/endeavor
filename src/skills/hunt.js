// Hunt animals for meat, wool and leather.

import { attack } from './combat.js'
import { explore } from './explore.js'
import { countItem } from './inventory.js'
import { pickUpDrops } from './drops.js'

const SEARCH_RADIUS = 48
const MAX_EXPLORES = 6

/**
 * Kill animals until the bot holds `count` more of any of `items`.
 * @param {string[]} mobs - e.g. ['cow', 'mooshroom']
 * @param {string[]} items - e.g. ['beef'], or every wool color
 */
export async function hunt (bot, mobs, items, count, { signal, log = () => {} } = {}) {
  const target = countItem(bot, items) + count
  const gaveUpOn = new Set()
  let explores = 0

  while (countItem(bot, items) < target) {
    signal?.throwIfAborted()
    const prey = bot.nearestEntity((e) =>
      mobs.includes(e.name) && !gaveUpOn.has(e.id) && !isBaby(bot, e) &&
      e.position.distanceTo(bot.entity.position) <= SEARCH_RADIUS)

    if (!prey) {
      if (explores >= MAX_EXPLORES) throw new Error(`I couldn't find any ${mobs.join(' or ')} around here`)
      explores++
      log(`No ${mobs.join('/')} in sight. Exploring (${explores}/${MAX_EXPLORES})...`)
      await explore(bot, { signal })
      continue
    }

    log(`Hunting a ${prey.name}`)
    const killed = await attack(bot, prey, { signal })
    if (!killed) {
      gaveUpOn.add(prey.id)
      continue
    }
    explores = 0
    await pickUpDrops(bot, prey.position, { signal })
  }
}

// Baby animals drop nothing, so don't bother.
function isBaby (bot, entity) {
  const index = bot.registry.entitiesByName[entity.name]?.metadataKeys?.indexOf('baby')
  return index >= 0 && entity.metadata?.[index] === true
}
