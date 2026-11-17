// The planner works backwards from a goal item to a list of steps.
//
// Ask for a stone pickaxe and it works out: that needs cobblestone and sticks
// at a crafting table; cobblestone needs a wooden pickaxe; that needs planks
// and sticks; planks need logs... and returns the steps in order.
//
// Items come from four places: breaking blocks, hunting animals, crafting,
// and smelting in a furnace.
//
// It only reads plain data (recipes, the inventory, what's nearby), so it can
// be tested without a Minecraft server. The bot runs the first step, then
// asks for a fresh plan, so the plan never has to be perfect.

import recipeLoader from 'prismarine-recipe'

const NEARBY_COST = 1 // effort to gather one block the bot can already see
const FAR_COST = 50 // the block exists, but none is nearby: needs exploring
const CRAFT_COST = 1 // effort of one crafting action
const KILL_COST = 4 // effort of hunting down one animal we can see
const FAR_KILL_COST = 60 // ...or one we have to go and find
const SMELT_COST = 1 // effort per item smelted (mostly waiting)
const MAX_OPTIONS_TRIED = 4 // per item, when the cheapest way turns out to be a dead end

/**
 * A snapshot of the world, as plain data.
 * @typedef {object} PlanWorld
 * @property {object} mcData - minecraft-data / bot.registry
 * @property {Map<string, string[]>} sources - item -> blocks that drop it
 * @property {Map<string, {mobs: string[], perKill: number}>} [hunts] - item -> animals that drop it
 * @property {Map<string, string[]>} [smelts] - item -> furnace inputs that make it
 * @property {{item: string, smelts: number}[]} [fuels] - what can burn, and how much each smelts
 * @property {Map<string, number>} [rarity] - item -> how much harder than usual it is to find
 * @property {Map<string, {label: string, members: string[]}>} groups - interchangeable items
 * @property {Set<string>} [nearby] - block names seen near the bot (omit to treat everything as nearby)
 * @property {Set<string>} [nearbyMobs] - animals seen near the bot (omit to treat all as nearby)
 * @property {boolean} [craftingTableNearby] - a placed crafting table is in reach
 * @property {boolean} [furnaceNearby] - a placed furnace is in reach
 */

/**
 * @typedef {{ type: 'collect', item: string, count: number, anyOf: string[], label: string }
 *         | { type: 'hunt', item: string, count: number, mobs: string[], anyOf: string[], label: string }
 *         | { type: 'craft', item: string, times: number, count: number, table: boolean }
 *         | { type: 'smelt', item: string, input: string, count: number, fuel: string, fuelCount: number }} Step
 */

class PlanError extends Error {}

/**
 * @param {PlanWorld} world
 * @param {Map<string, number>} inventory - item name -> count
 * @param {string} goal - item name, e.g. 'stone_pickaxe'
 * @param {number} count - how many the bot should end up holding
 * @returns {{ ok: true, steps: Step[] } | { ok: false, reason: string }}
 */
export function makePlan (world, inventory, goal, count = 1) {
  if (!world.mcData.itemsByName[goal]) {
    return { ok: false, reason: `"${goal}" isn't a Minecraft item name` }
  }

  const stock = new Map(inventory)
  const steps = []
  const coster = createCoster(world, inventory)

  // Make `n` of `item` available, then use them up.
  function acquire (item, n, path) {
    const fromStock = Math.min(n, stock.get(item) ?? 0)
    add(stock, item, -fromStock)
    const missing = n - fromStock
    if (missing === 0) return
    if (path.includes(item)) throw new PlanError(`${item} needs itself to be made`)

    const options = coster.options(item, missing)
    if (options.length === 0) throw new PlanError(explainMissing(world, coster, item))
    const here = [...path, item]

    // Try the cheapest option first. The cost estimates can't see everything
    // (e.g. a stone pickaxe looks cheap when we hold cobblestone, but that
    // cobblestone is already set aside for a furnace), so if an option runs
    // into a dead end, undo it and try the next one.
    let failure
    for (const option of options.slice(0, MAX_OPTIONS_TRIED)) {
      const saved = snapshot()
      try {
        use(option, item, missing, path, here)
        return
      } catch (err) {
        if (!(err instanceof PlanError)) throw err
        failure = err
        restore(saved)
      }
    }
    throw failure
  }

  function use (option, item, missing, path, here) {
    // Any log (or wool color) will do as an ingredient, but if you asked for oak, you get oak.
    const group = path.length > 0 ? world.groups.get(item) : undefined
    const anyOf = group?.members ?? [item]
    const label = group?.label ?? item

    switch (option.kind) {
      case 'gather': {
        const tools = harvestToolsFor(world, item)
        if (tools) keepOneOf(tools, here)
        steps.push({ type: 'collect', item, count: missing, anyOf, label })
        return
      }
      case 'hunt': {
        steps.push({ type: 'hunt', item, count: missing, mobs: world.hunts.get(item).mobs, anyOf, label })
        return
      }
      case 'smelt': {
        if (!world.furnaceNearby) keep('furnace', here)
        acquire(option.input, missing, here)
        acquire(option.fuel.item, option.fuel.count, here)
        steps.push({
          type: 'smelt',
          item,
          input: option.input,
          count: missing,
          fuel: option.fuel.item,
          fuelCount: option.fuel.count
        })
        return
      }
      case 'craft': {
        const { recipe } = option
        const times = Math.ceil(missing / recipe.out)
        if (recipe.requiresTable && !world.craftingTableNearby) keep('crafting_table', here)
        for (const ing of recipe.ingredients) acquire(ing.name, ing.count * times, here)
        steps.push({ type: 'craft', item, times, count: times * recipe.out, table: recipe.requiresTable })
        add(stock, item, times * recipe.out - missing) // leftovers, e.g. extra planks
      }
    }
  }

  // Tools, crafting tables and furnaces aren't used up: make sure we hold one.
  function keep (item, path) {
    if ((stock.get(item) ?? 0) > 0) return
    acquire(item, 1, path)
    add(stock, item, 1)
  }

  // Make sure we hold any one of these tools. The lowest tier that works
  // (wooden before stone before iron) is nearly always the cheapest; the
  // cost estimate only breaks ties, since it can't see what's set aside.
  function keepOneOf (tools, path) {
    if (tools.some((t) => (stock.get(t) ?? 0) > 0)) return
    const byCost = tools
      .map((tool) => ({ tool, tier: tierOf(tool), cost: coster.cost(tool, 1) }))
      .filter((t) => t.cost < Infinity)
      .sort((a, b) => a.tier - b.tier || a.cost - b.cost)
    let failure = new PlanError(explainMissing(world, coster, tools[0]))
    for (const { tool } of byCost) {
      const saved = snapshot()
      try {
        keep(tool, path)
        return
      } catch (err) {
        if (!(err instanceof PlanError)) throw err
        failure = err
        restore(saved)
      }
    }
    throw failure
  }

  function snapshot () {
    return { stock: new Map(stock), steps: steps.length }
  }

  function restore (saved) {
    stock.clear()
    for (const [k, v] of saved.stock) stock.set(k, v)
    steps.length = saved.steps
  }

  try {
    acquire(goal, count, [])
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, reason: err.message }
    throw err
  }
  return { ok: true, steps: tidy(steps) }
}

/** One line of plain English for a step, e.g. "Craft 4 × Oak Planks". */
export function describeStep (step, mcData) {
  const name = (item) => displayName(item, mcData)
  const what = step.anyOf?.length > 1 ? step.label : `× ${name(step.item)}`
  switch (step.type) {
    case 'collect':
      return `Collect ${step.count} ${what}`
    case 'hunt':
      return `Hunt ${step.mobs.join('/')} for ${step.count} ${what}`
    case 'smelt':
      return `Smelt ${step.count} × ${name(step.input)} into ${name(step.item)} (fuel: ${step.fuelCount} ${name(step.fuel)})`
    default:
      return `Craft ${step.count} × ${name(step.item)}`
  }
}

// Find the item that's actually blocking us, so the bot can say
// "I don't know how to get Iron Ingot yet" instead of just "no".
function explainMissing (world, coster, goal) {
  const seen = new Set()
  let item = goal
  while (!seen.has(item)) {
    seen.add(item)
    if (world.sources.has(item) || world.hunts?.has(item)) break // gatherable, but its tool isn't
    const inputs = world.smelts?.get(item) ?? []
    const ingredients = [
      ...getRecipes(world.mcData, item).flatMap((r) => r.ingredients),
      ...inputs.map((name) => ({ name, count: 1 }))
    ]
    const stuck = ingredients.find((ing) => coster.cost(ing.name, ing.count) === Infinity)
    if (!stuck) break
    item = stuck.name
  }
  const name = displayName(item, world.mcData)
  if (item === goal) return `I don't know how to get ${name} yet`
  return `I don't know how to get ${name} yet, so I can't make ${displayName(goal, world.mcData)}`
}

const TIERS = ['wooden', 'stone', 'golden', 'copper', 'iron', 'diamond', 'netherite']

function tierOf (tool) {
  const i = TIERS.indexOf(tool.split('_')[0])
  return i === -1 ? TIERS.length : i
}

function displayName (item, mcData) {
  return mcData.itemsByName[item]?.displayName ?? item
}

// --- cost estimates -------------------------------------------------------

// Estimates how much effort it takes to get items, so the planner can choose
// between options: birch planks vs. oak planks, cobblestone vs. deepslate,
// coal vs. planks for fuel.
function createCoster (world, inventory) {
  const memo = new Map()
  const visiting = new Set()
  let cycleHits = 0
  const have = (name) => inventory.get(name) ?? 0
  const rarityOf = (item) => world.rarity?.get(item) ?? 1

  function gatherUnitCost (item) {
    const blocks = world.sources.get(item)
    if (!blocks) return Infinity
    const seen = !world.nearby || blocks.some((b) => world.nearby.has(b))
    return (seen ? NEARBY_COST : FAR_COST) * rarityOf(item)
  }

  function huntUnitCost (item) {
    const hunt = world.hunts?.get(item)
    if (!hunt) return Infinity
    const seen = !world.nearbyMobs || hunt.mobs.some((m) => world.nearbyMobs.has(m))
    return (seen ? KILL_COST : FAR_KILL_COST) * rarityOf(item) / hunt.perKill
  }

  function toolCost (tools) {
    if (!tools) return 0
    if (tools.some((t) => have(t) > 0)) return 0
    return Math.min(...tools.map((t) => cost(t, 1)))
  }

  function stationCost (station, placedNearby) {
    if (placedNearby || have(station) > 0) return 0
    return cost(station, 1)
  }

  // The cheapest fuel for smelting n items, e.g. { item: 'coal', count: 1, cost: 0 }.
  function cheapestFuel (n) {
    let best = null
    for (const fuel of world.fuels ?? []) {
      const count = Math.ceil(n / fuel.smelts)
      const c = cost(fuel.item, count)
      if (c < (best?.cost ?? Infinity)) best = { item: fuel.item, count, cost: c }
    }
    return best
  }

  // Effort to end up holding `n` of `item`.
  function cost (item, n) {
    const missing = n - have(item)
    if (missing <= 0) return 0
    return options(item, missing)[0]?.cost ?? Infinity
  }

  // Every possible way to get `missing` more of `item`, cheapest first.
  function options (item, missing) {
    const key = `${item}:${missing}`
    if (memo.has(key)) return memo.get(key)
    if (visiting.has(item)) {
      cycleHits++ // e.g. iron ingot -> iron block -> iron ingot
      return []
    }
    visiting.add(item)
    const hitsBefore = cycleHits

    const found = []
    const consider = (option) => {
      if (option.cost < Infinity) found.push(option)
    }

    const gather = gatherUnitCost(item)
    if (gather < Infinity) {
      consider({ kind: 'gather', cost: gather * missing + toolCost(harvestToolsFor(world, item)) })
    }

    const hunt = huntUnitCost(item)
    if (hunt < Infinity) consider({ kind: 'hunt', cost: hunt * missing })

    for (const recipe of getRecipes(world.mcData, item)) {
      const times = Math.ceil(missing / recipe.out)
      let c = CRAFT_COST * times + (recipe.requiresTable ? stationCost('crafting_table', world.craftingTableNearby) : 0)
      for (const ing of recipe.ingredients) {
        c += cost(ing.name, ing.count * times)
        if (c === Infinity) break
      }
      consider({ kind: 'craft', recipe, cost: c })
    }

    for (const input of world.smelts?.get(item) ?? []) {
      const inputCost = cost(input, missing)
      if (inputCost === Infinity) continue
      const fuel = cheapestFuel(missing)
      if (!fuel) continue
      const c = SMELT_COST * missing + inputCost + fuel.cost +
        stationCost('furnace', world.furnaceNearby)
      consider({ kind: 'smelt', input, fuel, cost: c })
    }

    visiting.delete(item)
    found.sort((a, b) => a.cost - b.cost) // stable: ties keep the order above
    // A result that ran into a cycle depends on where we started, so don't reuse it.
    if (cycleHits === hitsBefore) memo.set(key, found)
    return found
  }

  return { cost, options }
}

// --- recipe and block data -----------------------------------------------

/** Tools that can harvest this item's source block, or null if hands work. */
function harvestToolsFor (world, item) {
  const blockName = world.sources.get(item)?.[0]
  const block = blockName && world.mcData.blocksByName[blockName]
  if (!block?.harvestTools) return null
  return Object.keys(block.harvestTools).map((id) => world.mcData.items[id].name)
}

const recipeCache = new WeakMap()

/** Crafting recipes for an item, as { out, requiresTable, ingredients: [{name, count}] }. */
function getRecipes (mcData, itemName) {
  let cache = recipeCache.get(mcData)
  if (!cache) {
    cache = { Recipe: recipeLoader(mcData).Recipe, byItem: new Map() }
    recipeCache.set(mcData, cache)
  }
  if (!cache.byItem.has(itemName)) {
    const item = mcData.itemsByName[itemName]
    const raw = item ? cache.Recipe.find(item.id, null) : []
    const seen = new Set()
    const recipes = []
    for (const r of raw) {
      const ingredients = r.delta
        .filter((d) => d.count < 0 && mcData.items[d.id])
        .map((d) => ({ name: mcData.items[d.id].name, count: -d.count }))
      const key = ingredients.map((i) => `${i.name}x${i.count}`).sort().join(',') + `|${r.requiresTable}`
      if (seen.has(key)) continue
      seen.add(key)
      recipes.push({ out: r.result.count, requiresTable: r.requiresTable, ingredients })
    }
    cache.byItem.set(itemName, recipes)
  }
  return cache.byItem.get(itemName)
}

// --- helpers ---------------------------------------------------------------

function add (map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

// Combine steps so the bot does one trip instead of three.
// Gathering earlier never hurts, so later collect/hunt steps fold into the
// first one for the same item; back-to-back crafts or smelts of the same
// item merge too.
function tidy (steps) {
  const out = []
  for (const step of steps) {
    if (step.type === 'collect' || step.type === 'hunt') {
      const earlier = out.find((s) => s.type === step.type && s.item === step.item)
      if (earlier) {
        earlier.count += step.count
        continue
      }
    }
    const last = out.at(-1)
    if (step.type === 'craft' && last?.type === 'craft' && last.item === step.item) {
      last.times += step.times
      last.count += step.count
      continue
    }
    if (step.type === 'smelt' && last?.type === 'smelt' && last.item === step.item &&
        last.input === step.input && last.fuel === step.fuel) {
      last.count += step.count
      last.fuelCount += step.fuelCount
      continue
    }
    out.push({ ...step })
  }
  return out
}
