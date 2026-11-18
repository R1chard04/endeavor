// Where raw items come from: blocks to break, animals to hunt, and things to
// smelt in a furnace. Crafting recipes come from minecraft-data instead.
//
// The block list is a whitelist on purpose: planks drop from plank blocks
// too, but we don't want the bot tearing down a village house to get them.
// Add entries here as the bot learns new stages.

const OVERWORLD_WOODS = [
  'oak', 'spruce', 'birch', 'jungle', 'acacia',
  'dark_oak', 'mangrove', 'cherry', 'pale_oak'
]
const WOOD_RARITY = { oak_log: 1, birch_log: 1.2, spruce_log: 1.2 } // everything else: 1.5

// item -> animals that drop it, and roughly how many drop per kill
const HUNTS = {
  beef: { mobs: ['cow', 'mooshroom'], perKill: 2 },
  leather: { mobs: ['cow', 'mooshroom'], perKill: 1 },
  porkchop: { mobs: ['pig'], perKill: 2 },
  mutton: { mobs: ['sheep'], perKill: 1.5 },
  chicken: { mobs: ['chicken'], perKill: 1 },
  feather: { mobs: ['chicken'], perKill: 1 },
  rabbit: { mobs: ['rabbit'], perKill: 0.5 }
}

// furnace output -> input
const SMELTS = {
  cooked_beef: 'beef',
  cooked_porkchop: 'porkchop',
  cooked_mutton: 'mutton',
  cooked_chicken: 'chicken',
  cooked_rabbit: 'rabbit',
  iron_ingot: 'raw_iron',
  gold_ingot: 'raw_gold',
  copper_ingot: 'raw_copper',
  glass: 'sand',
  stone: 'cobblestone'
}

// item -> an empty container you fill from a block in the world
const FILLS = {
  water_bucket: { container: 'bucket', block: 'water' }
}

/**
 * @param {object} mcData - a minecraft-data instance (bot.registry)
 * @returns {{
 *   sources: Map<string, string[]>,
 *   hunts: Map<string, { mobs: string[], perKill: number }>,
 *   smelts: Map<string, string[]>,
 *   fills: Map<string, { container: string, block: string }>,
 *   fuels: { item: string, smelts: number }[],
 *   rarity: Map<string, number>,
 *   groups: Map<string, { label: string, members: string[] }>,
 *   logs: string[],
 *   planks: string[]
 * }}
 *   sources: item name -> block names that drop it
 *   hunts:   item name -> animals that drop it
 *   smelts:  item name -> what can go in the furnace to get it
 *   fills:   item name -> container + block to fill it from (bucket + water)
 *   fuels:   what can burn, and how many items each one smelts
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
  const planks = OVERWORLD_WOODS
    .map((wood) => `${wood}_planks`)
    .filter((name) => mcData.itemsByName[name])

  add('cobblestone', ['stone'])
  add('cobbled_deepslate', ['deepslate'], 2)
  add('dirt', ['dirt', 'grass_block'])
  add('sand', ['sand'], 1.5)
  add('gravel', ['gravel'], 1.5)
  add('coal', ['coal_ore', 'deepslate_coal_ore'], 2)
  add('raw_iron', ['iron_ore', 'deepslate_iron_ore'], 3)

  const hunts = new Map()
  for (const [item, hunt] of Object.entries(HUNTS)) {
    const mobs = hunt.mobs.filter((m) => mcData.entitiesByName[m])
    if (mcData.itemsByName[item] && mobs.length) hunts.set(item, { ...hunt, mobs })
  }
  // Every sheep drops one wool of its own color; most sheep are white.
  const wools = mcData.itemsArray.map((i) => i.name).filter((n) => n.endsWith('_wool'))
  for (const wool of wools) {
    hunts.set(wool, { mobs: ['sheep'], perKill: 1 })
    rarity.set(wool, wool === 'white_wool' ? 1 : 5)
  }

  const smelts = new Map()
  for (const [out, input] of Object.entries(SMELTS)) {
    if (mcData.itemsByName[out] && mcData.itemsByName[input]) smelts.set(out, [input])
  }
  smelts.set('charcoal', logs) // any log burns down to charcoal

  const fills = new Map(
    Object.entries(FILLS).filter(([item, f]) => mcData.itemsByName[item] && mcData.blocksByName[f.block])
  )

  // How many items one piece of fuel smelts.
  const fuels = [
    { item: 'coal', smelts: 8 },
    { item: 'charcoal', smelts: 8 },
    ...planks.map((item) => ({ item, smelts: 1.5 })),
    ...logs.map((item) => ({ item, smelts: 1.5 }))
  ]

  // Any log is as good as any other when the bot goes out chopping: the
  // planner picks a wood type, but the bot chops whatever tree is closest and
  // replans with what it actually got. Same for sheep and wool colors.
  const groups = new Map()
  const logGroup = { label: 'logs (any wood)', members: logs }
  for (const log of logs) groups.set(log, logGroup)
  const woolGroup = { label: 'wool (any color)', members: wools }
  for (const wool of wools) groups.set(wool, woolGroup)

  return { sources, hunts, smelts, fills, fuels, rarity, groups, logs, planks }
}
