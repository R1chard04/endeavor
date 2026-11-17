// Eating. Picks the best food in the inventory and avoids the ones that
// make you sick, unless the bot is starving.

// Food that has a bad side effect (hunger or poison).
const RISKY = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew'])
// Never worth it: these are better used for something else or are hard to get.
const NEVER = new Set(['golden_apple', 'enchanted_golden_apple', 'chorus_fruit'])

/** The best food to eat right now, or null. Risky food only when starving. */
export function bestFood (bot) {
  const starving = bot.food <= 6
  let best = null
  for (const item of bot.inventory.items()) {
    const food = bot.registry.foodsByName[item.name]
    if (!food || NEVER.has(item.name)) continue
    if (RISKY.has(item.name) && !starving) continue
    if (!best || food.effectiveQuality > best.food.effectiveQuality) best = { item, food }
  }
  return best?.item ?? null
}

/** Total hunger points of the safe food the bot carries. */
export function foodSupply (bot) {
  let points = 0
  for (const item of bot.inventory.items()) {
    const food = bot.registry.foodsByName[item.name]
    if (food && !RISKY.has(item.name) && !NEVER.has(item.name)) points += food.foodPoints * item.count
  }
  return points
}

/** Eat one item. Returns false if there's nothing (good) to eat. */
export async function eat (bot) {
  if (bot.food >= 20) return false
  const food = bestFood(bot)
  if (!food) return false
  await bot.equip(food, 'hand')
  await bot.consume()
  return true
}
