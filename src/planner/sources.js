// Which blocks the bot is allowed to break to get each raw item.
//
// This is a whitelist on purpose: planks drop from plank blocks too, but we
// don't want the bot tearing down a village house to get them. Add entries
// here as the bot learns new stages (iron ore, sand, etc.).

const OVERWORLD_WOODS = [
  'oak', 'spruce', 'birch', 'jungle', 'acacia',
  'dark_oak', 'mangrove', 'cherry', 'pale_oak'
]
const WOOD_RARITY = { oak_log: 1, birch_log: 1.2, spruce_log: 1.2 } // everything else: 1.5

/**
 * @param {object} mcData - a minecraft-data instance (bot.registry)
 * @returns {{
 *   sources: Map<string, string[]>,
 *   rarity: Map<string, number>,
 *   groups: Map<string, { label: string, members: string[] }>,
 *   logs: string[]
 * }}
 *   sources: item name -> block names that drop it
 *   rarity:  item name -> how much harder than usual it is to find (1 = common)
 *   groups:  item name -> every item that can stand in for it when gathering
 */
export function buildGatherData (mcData) {
  const sources = new Map()
  // How hard an item is to find when none is in sight. Breaks ties so the
  // planner reaches for oak and cobblestone before cherry and deepslate.
  const rarity = new Map()
  const add = (item, blocks, howRare = 1) => {
    const known = blocks.filter((b) => mcData.blocksByName[b])
    if (!mcData.itemsByName[item] || known.length === 0) return
    sources.set(item, [...(sources.get(item) ?? []), ...known])
    rarity.set(item, howRare)
  }

  const logs = OVERWORLD_WOODS
    .map((wood) => `${wood}_log`)
    .filter((name) => mcData.itemsByName[name])
  for (const log of logs) add(log, [log], WOOD_RARITY[log] ?? 1.5)

  add('cobblestone', ['stone'])
  add('cobbled_deepslate', ['deepslate'], 2)
  add('dirt', ['dirt', 'grass_block'])
  add('sand', ['sand'], 1.5)
  add('gravel', ['gravel'], 1.5)
  add('coal', ['coal_ore', 'deepslate_coal_ore'], 2)

  // Any log is as good as any other when the bot goes out chopping: the
  // planner picks a wood type, but the bot chops whatever tree is closest and
  // replans with what it actually got.
  const groups = new Map()
  const logGroup = { label: 'logs (any wood)', members: logs }
  for (const log of logs) groups.set(log, logGroup)

  return { sources, rarity, groups, logs }
}
