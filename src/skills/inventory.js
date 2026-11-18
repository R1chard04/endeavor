// Small helpers for reading the bot's inventory.

/** How many of these items the bot holds, e.g. countItem(bot, 'oak_log') or countItem(bot, ['oak_log', 'birch_log']). */
export function countItem (bot, names) {
  const wanted = new Set([names].flat())
  return bot.inventory.items()
    .filter((item) => wanted.has(item.name))
    .reduce((total, item) => total + item.count, 0)
}

/** The inventory as a Map of item name -> count, which is what the planner reads. */
export function inventoryMap (bot) {
  const counts = new Map()
  for (const item of bot.inventory.items()) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
  }
  return counts
}

// Mining fills the inventory with stone the bot has no use for. When space
// runs low it throws these away. Some blocks are worth keeping up to a point:
// cobblestone for furnaces and tools, dirt and cobblestone for stepping
// blocks and sealing shelters.
const JUNK = new Set([
  'granite', 'diorite', 'andesite', 'tuff', 'calcite', 'gravel', 'flint', 'sandstone',
  'netherrack', 'pointed_dripstone', 'dripstone_block', 'wheat_seeds'
])
const KEEP_UP_TO = { cobblestone: 64, cobbled_deepslate: 32, dirt: 16 }
const MIN_FREE_SLOTS = 6

/** What to throw away from a list of items, as [{ name, count }]. */
export function junkToToss (items) {
  const totals = new Map()
  for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  const toss = []
  for (const [name, count] of totals) {
    if (JUNK.has(name)) toss.push({ name, count })
    else if (KEEP_UP_TO[name] !== undefined && count > KEEP_UP_TO[name]) toss.push({ name, count: count - KEEP_UP_TO[name] })
  }
  return toss
}

/** Is the inventory getting full, with junk we could throw away? */
export function needsTidying (bot) {
  return bot.inventory.emptySlotCount() < MIN_FREE_SLOTS && junkToToss(bot.inventory.items()).length > 0
}

/**
 * Throw the junk away. Aim up and forward so it lands out of reach:
 * dropped at our feet, we'd just pick it up again. Returns how many items went.
 */
export async function tossJunk (bot) {
  await bot.look(bot.entity.yaw, 0.6, true) // about 35 degrees up
  let tossed = 0
  for (const { name, count } of junkToToss(bot.inventory.items())) {
    await bot.toss(bot.registry.itemsByName[name].id, null, count)
    tossed += count
  }
  return tossed
}

/** "3 Oak Log, 1 Wooden Pickaxe", for chat. */
export function inventorySummary (bot) {
  const counts = inventoryMap(bot)
  if (counts.size === 0) return 'nothing'
  return [...counts]
    .map(([name, n]) => `${n} ${bot.registry.itemsByName[name]?.displayName ?? name}`)
    .join(', ')
}
