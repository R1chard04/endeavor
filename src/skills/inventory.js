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

/** "3 Oak Log, 1 Wooden Pickaxe", for chat. */
export function inventorySummary (bot) {
  const counts = inventoryMap(bot)
  if (counts.size === 0) return 'nothing'
  return [...counts]
    .map(([name, n]) => `${n} ${bot.registry.itemsByName[name]?.displayName ?? name}`)
    .join(', ')
}
