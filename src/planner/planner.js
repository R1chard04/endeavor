// The planner works backwards from a goal item to a list of steps.
//
// Ask for a stone pickaxe and it works out: that needs cobblestone and sticks
// at a crafting table; cobblestone needs a wooden pickaxe; that needs planks
// and sticks; planks need logs... and returns the steps in order.
//
// It only reads plain data (recipes, the inventory, what's nearby), so it can
// be tested without a Minecraft server. The bot runs the first step, then
// asks for a fresh plan, so the plan never has to be perfect.

import recipeLoader from 'prismarine-recipe'

const NEARBY_COST = 1 // effort to gather one block the bot can already see
const FAR_COST = 50 // the block exists, but none is nearby: needs exploring
const CRAFT_COST = 1 // effort of one crafting action

/**
 * A snapshot of the world, as plain data.
 * @typedef {object} PlanWorld
 * @property {object} mcData - minecraft-data / bot.registry
 * @property {Map<string, string[]>} sources - item -> blocks that drop it
 * @property {Map<string, number>} [rarity] - item -> how much harder than usual it is to find
 * @property {Map<string, {label: string, members: string[]}>} groups - interchangeable items
 * @property {Set<string>} [nearby] - block names seen near the bot (omit to treat everything as nearby)
 * @property {boolean} [craftingTableNearby] - a placed crafting table is in reach
 */

/**
 * @typedef {{ type: 'collect', item: string, count: number, anyOf: string[], label: string }
 *         | { type: 'craft', item: string, times: number, count: number, table: boolean }} Step
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

    const option = coster.cheapestOption(item, missing)
    if (!option) throw new PlanError(explainMissing(world, coster, item))
    const here = [...path, item]

    if (option.kind === 'gather') {
      const tools = harvestToolsFor(world, item)
      if (tools) keep(cheapestTool(tools), here)
      // Any log will do when it's an ingredient, but if you asked for oak, you get oak.
      const group = path.length > 0 ? world.groups.get(item) : undefined
      steps.push({
        type: 'collect',
        item,
        count: missing,
        anyOf: group?.members ?? [item],
        label: group?.label ?? item
      })
      return
    }

    const { recipe } = option
    const times = Math.ceil(missing / recipe.out)
    if (recipe.requiresTable && !world.craftingTableNearby) keep('crafting_table', here)
    for (const ing of recipe.ingredients) acquire(ing.name, ing.count * times, here)
    steps.push({ type: 'craft', item, times, count: times * recipe.out, table: recipe.requiresTable })
    add(stock, item, times * recipe.out - missing) // leftovers, e.g. extra planks
  }

  // Tools and crafting tables aren't used up: make sure we hold one.
  function keep (item, path) {
    if ((stock.get(item) ?? 0) > 0) return
    acquire(item, 1, path)
    add(stock, item, 1)
  }

  function cheapestTool (tools) {
    const held = tools.find((t) => (stock.get(t) ?? 0) > 0)
    if (held) return held
    return tools.reduce((best, t) => (coster.cost(t, 1) < coster.cost(best, 1) ? t : best))
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
  if (step.type === 'collect') {
    if (step.anyOf.length > 1) return `Collect ${step.count} ${step.label}`
    return `Collect ${step.count} × ${displayName(step.item, mcData)}`
  }
  return `Craft ${step.count} × ${displayName(step.item, mcData)}`
}

// Find the item that's actually blocking us, so the bot can say
// "I don't know how to get Iron Ingot yet" instead of just "no".
function explainMissing (world, coster, goal) {
  const seen = new Set()
  let item = goal
  while (!seen.has(item)) {
    seen.add(item)
    if (world.sources.has(item)) break // gatherable, but its tool isn't
    const stuck = getRecipes(world.mcData, item)
      .flatMap((r) => r.ingredients)
      .find((ing) => coster.cost(ing.name, ing.count) === Infinity)
    if (!stuck) break
    item = stuck.name
  }
  const name = displayName(item, world.mcData)
  if (item === goal) return `I don't know how to get ${name} yet`
  return `I don't know how to get ${name} yet, so I can't make ${displayName(goal, world.mcData)}`
}

function displayName (item, mcData) {
  return mcData.itemsByName[item]?.displayName ?? item
}

// --- cost estimates -------------------------------------------------------

// Estimates how much effort it takes to get items, so the planner can choose
// between options: birch planks vs. oak planks, or cobblestone vs. deepslate.
function createCoster (world, inventory) {
  const memo = new Map()
  const visiting = new Set()
  let cycleHits = 0
  const have = (name) => inventory.get(name) ?? 0

  function gatherUnitCost (item) {
    const blocks = world.sources.get(item)
    if (!blocks) return Infinity
    const rarity = world.rarity?.get(item) ?? 1
    if (!world.nearby || blocks.some((b) => world.nearby.has(b))) return NEARBY_COST * rarity
    return FAR_COST * rarity
  }

  function toolCost (tools) {
    if (!tools) return 0
    if (tools.some((t) => have(t) > 0)) return 0
    return Math.min(...tools.map((t) => cost(t, 1)))
  }

  function tableCost () {
    if (world.craftingTableNearby || have('crafting_table') > 0) return 0
    return cost('crafting_table', 1)
  }

  // Effort to end up holding `n` of `item`.
  function cost (item, n) {
    const missing = n - have(item)
    if (missing <= 0) return 0
    return cheapestOption(item, missing)?.cost ?? Infinity
  }

  // The cheapest way to get `missing` more of `item`, or null if there's none.
  function cheapestOption (item, missing) {
    const key = `${item}:${missing}`
    if (memo.has(key)) return memo.get(key)
    if (visiting.has(item)) {
      cycleHits++ // e.g. iron ingot -> iron block -> iron ingot
      return null
    }
    visiting.add(item)
    const hitsBefore = cycleHits

    let best = null
    const unit = gatherUnitCost(item)
    if (unit < Infinity) {
      const c = unit * missing + toolCost(harvestToolsFor(world, item))
      if (c < Infinity) best = { kind: 'gather', cost: c }
    }
    for (const recipe of getRecipes(world.mcData, item)) {
      const times = Math.ceil(missing / recipe.out)
      let c = CRAFT_COST * times + (recipe.requiresTable ? tableCost() : 0)
      for (const ing of recipe.ingredients) {
        c += cost(ing.name, ing.count * times)
        if (c === Infinity) break
      }
      if (c < (best?.cost ?? Infinity)) best = { kind: 'craft', recipe, cost: c }
    }

    visiting.delete(item)
    // A result that ran into a cycle depends on where we started, so don't reuse it.
    if (cycleHits === hitsBefore) memo.set(key, best)
    return best
  }

  return { cost, cheapestOption }
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

// Combine steps so the bot does one chopping trip instead of three.
// Gathering earlier never hurts, so later collect steps fold into the first
// one for the same item; back-to-back crafts of the same item merge too.
function tidy (steps) {
  const out = []
  for (const step of steps) {
    if (step.type === 'collect') {
      const earlier = out.find((s) => s.type === 'collect' && s.item === step.item)
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
    out.push({ ...step })
  }
  return out
}
