// Collect items by finding the blocks that drop them, walking over, breaking
// them and picking up the drops. Stage 1 (wood) is this skill on its own.

import { countItem } from './inventory.js'
import { explore } from './explore.js'
import { lightUpIfDark } from './light.js'

const SEARCH_RADIUS = 64
const MAX_EXPLORES = 6
const TARGET_TIME_LIMIT_MS = 90_000 // digging down to deep ore can legitimately take a while

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
    // For a tree or an ore vein, take every touching block of the same kind in one go.
    const targets = gather.logs.includes(block.name) || block.name.endsWith('_ore')
      ? bot.collectBlock.findFromVein(block, target - before, 12)
      : [block]
    log(`Going for ${targets.length} ${block.name} at ${block.position}`)

    try {
      await collectWithTimeout(bot, targets, signal)
    } catch (err) {
      signal?.throwIfAborted()
      log(`Couldn't reach the ${block.name} at ${block.position}: ${err.message}`)
    }
    await lightUpIfDark(bot, { log }) // underground: keep monsters from spawning around us

    if (countItem(bot, items) > before) {
      explores = 0
    } else {
      skipped.add(block.position.toString())
    }
  }
}

// The collectblock plugin can occasionally hang (seen live: no error, no
// movement, for minutes). Give each attempt a time limit, and stop waiting
// right away if our task is cancelled.
async function collectWithTimeout (bot, targets, signal) {
  let timer
  let onAbort
  const giveUp = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('it was taking too long')), TARGET_TIME_LIMIT_MS)
    onAbort = () => reject(signal.reason ?? new Error('stopped'))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([bot.collectBlock.collect(targets, { ignoreNoPath: true }), giveUp])
  } catch (err) {
    abandonCollect(bot)
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Unstick the collectblock plugin: stop moving and digging, and forget its targets. */
export function abandonCollect (bot) {
  bot.pathfinder.stop()
  try { bot.stopDigging() } catch {}
  bot.collectBlock.targets.clear()
  bot.emit('collectBlock_finished') // release anyone waiting on the stuck collect
}

function findNearest (bot, blockIds, skipped) {
  const positions = bot.findBlocks({ matching: blockIds, maxDistance: SEARCH_RADIUS, count: 64 })
  for (const pos of positions) {
    if (skipped.has(pos.toString())) continue
    const block = bot.blockAt(pos)
    // Ore in a flooded cave means fighting underwater and running out of air
    // (it killed the bot in testing). There's plenty of dry ore; skip it.
    if (block.name.endsWith('_ore') && touchesWater(bot, pos)) continue
    return block
  }
  return null
}

function touchesWater (bot, pos) {
  const water = bot.registry.blocksByName.water.id
  return [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 2, 0]]
    .some(([dx, dy, dz]) => bot.blockAt(pos.offset(dx, dy, dz))?.type === water)
}
