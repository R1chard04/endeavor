// Collect items by finding the blocks that drop them, walking over, breaking
// them and picking up the drops. Stage 1 (wood) is this skill on its own.

import { countItem } from './inventory.js'
import { explore } from './explore.js'

const SEARCH_RADIUS = 64
const MAX_EXPLORES = 6

/**
 * Collect `count` more of any of `items`.
 *
 * @param {object} bot
 * @param {object} gather - from buildGatherData(): which blocks drop which items
 * @param {string[]} items - e.g. ['oak_log'] or every log type
 * @param {number} count
 */
export async function collect (bot, gather, items, count, { signal, log = () => {} } = {}) {
  const blockNames = [...new Set(items.flatMap((item) => gather.sources.get(item) ?? []))]
  if (blockNames.length === 0) throw new Error(`I don't know where ${items.join(' / ')} comes from`)
  const blockIds = blockNames.map((name) => bot.registry.blocksByName[name].id)
  const what = items.length > 1
    ? (gather.groups.get(items[0])?.label ?? items.join(' / '))
    : bot.registry.itemsByName[items[0]].displayName

  const target = countItem(bot, items) + count
  const skipped = new Set() // blocks we tried and failed to get (too high, no path...)
  let explores = 0

  while (countItem(bot, items) < target) {
    signal?.throwIfAborted()

    const block = findNearest(bot, blockIds, skipped)
    if (!block) {
      if (explores >= MAX_EXPLORES) throw new Error(`I couldn't find any ${what} around here`)
      explores++
      log(`No ${what} in sight. Exploring (${explores}/${MAX_EXPLORES})...`)
      await explore(bot, { signal })
      continue
    }

    const before = countItem(bot, items)
    // For a tree, grab the whole trunk at once: the "vein" is every touching log of the same kind.
    const targets = gather.logs.includes(block.name)
      ? bot.collectBlock.findFromVein(block, target - before, 12)
      : [block]
    log(`Going for ${targets.length} ${block.name} at ${block.position}`)

    try {
      await bot.collectBlock.collect(targets, { ignoreNoPath: true })
    } catch (err) {
      signal?.throwIfAborted()
      log(`Couldn't reach the ${block.name} at ${block.position}: ${err.message}`)
    }

    if (countItem(bot, items) > before) {
      explores = 0
    } else {
      skipped.add(block.position.toString())
    }
  }
}

function findNearest (bot, blockIds, skipped) {
  const positions = bot.findBlocks({ matching: blockIds, maxDistance: SEARCH_RADIUS, count: 64 })
  const pos = positions.find((p) => !skipped.has(p.toString()))
  return pos ? bot.blockAt(pos) : null
}
