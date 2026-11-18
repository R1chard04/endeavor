// What the bot works toward when it plays on its own, most important first.
// The brain does the first goal that isn't done yet.
//
// To teach the bot a new stage, add goals here. Item goals can reuse
// obtain(), which already knows how to mine, hunt, craft and smelt.

import { countItem } from '../skills/inventory.js'
import { obtain } from '../skills/obtain.js'
import { foodSupply } from '../skills/eat.js'
import { isNight, hasBed, sleepInBed, shelter } from '../skills/night.js'
import { hasArmor, hasShield } from '../skills/equipment.js'

const TIERS = ['wooden', 'stone', 'golden', 'copper', 'iron', 'diamond', 'netherite']
const TIER_RANK = { wooden: 0, golden: 0, stone: 1, copper: 1, iron: 2, diamond: 3, netherite: 4 }

/** Does the bot hold a `kind` (pickaxe, sword...) at least as good as `minTier`? */
export function hasTool (bot, kind, minTier) {
  return bot.inventory.items().some((item) => {
    const [tier, ...rest] = item.name.split('_')
    return rest.join('_') === kind && TIERS.includes(tier) && TIER_RANK[tier] >= TIER_RANK[minTier]
  })
}

// Cooked food for each kind of animal, so the bot hunts whatever is around.
const MEALS = { cow: 'cooked_beef', mooshroom: 'cooked_beef', pig: 'cooked_porkchop', sheep: 'cooked_mutton', chicken: 'cooked_chicken' }
const ENOUGH_FOOD = 40 // hunger points, about 5 steaks
const LOW_FOOD = 12
const TORCHES = 12 // make this many...
const LOW_TORCHES = 4 // ...when down to fewer than this

/**
 * @returns {{ name: string, isDone: () => boolean, run: (signal) => Promise,
 *   retryAfterMs?: number, milestone?: boolean, label?: string }[]}
 */
export function buildGoals (bot, { gather, log, say }) {
  const opts = (signal) => ({ signal, log, say: log })
  const get = (item, count = 1) => (signal) => obtain(bot, gather, item, count, opts(signal))

  const getFood = async (signal) => {
    const meal = mealForNearbyAnimals(bot)
    await obtain(bot, gather, meal, countItem(bot, meal) + 4, opts(signal))
  }

  // Any color of bed will do. Sheep come in random colors, so after each
  // step re-pick the color we have the most wool for.
  const makeBed = async (signal) => {
    for (let i = 0; i < 30 && !hasBed(bot); i++) {
      const wool = gather.groups.get('white_wool').members
        .reduce((best, w) => (countItem(bot, w) > countItem(bot, best) ? w : best), 'white_wool')
      await obtain(bot, gather, wool.replace('_wool', '_bed'), 1, { ...opts(signal), steps: 1 })
    }
    if (!hasBed(bot)) throw new Error("I couldn't put a bed together")
  }

  return [
    {
      name: 'get through the night',
      isDone: () => !isNight(bot),
      run: (signal) => hasBed(bot) ? sleepInBed(bot, opts(signal)) : shelter(bot, opts(signal)),
      retryAfterMs: 10_000 // e.g. "monsters nearby": fight, then try again soon
    },
    {
      // Only urgent once the bot is actually getting hungry.
      name: 'find something to eat',
      isDone: () => foodSupply(bot) >= LOW_FOOD || bot.food >= 14,
      run: getFood
    },
    // Stages 1-3: tools, food, a bed.
    milestone('a wooden pickaxe', () => hasTool(bot, 'pickaxe', 'wooden'), get('wooden_pickaxe')),
    milestone('a stone pickaxe', () => hasTool(bot, 'pickaxe', 'stone'), get('stone_pickaxe')),
    milestone('a stone sword', () => hasTool(bot, 'sword', 'stone'), get('stone_sword')),
    { name: 'stock up on food', isDone: () => foodSupply(bot) >= ENOUGH_FOOD, run: getFood },
    milestone('a bed', () => hasBed(bot), makeBed),

    // Stage 4: iron. Torches first, since iron means going underground.
    {
      name: 'make torches',
      isDone: () => countItem(bot, 'torch') >= LOW_TORCHES,
      run: get('torch', TORCHES)
    },
    milestone('an iron pickaxe', () => hasTool(bot, 'pickaxe', 'iron'), get('iron_pickaxe')),
    milestone('a shield', () => hasShield(bot), get('shield')),
    milestone('an iron sword', () => hasTool(bot, 'sword', 'iron'), get('iron_sword')),
    milestone('a water bucket', () => countItem(bot, 'water_bucket') > 0, get('water_bucket')),
    // Armor, most protection per ingot first.
    milestone('an iron chestplate', () => hasArmor(bot, 'torso', 'iron'), get('iron_chestplate')),
    milestone('iron leggings', () => hasArmor(bot, 'legs', 'iron'), get('iron_leggings')),
    milestone('iron boots', () => hasArmor(bot, 'feet', 'iron'), get('iron_boots')),
    milestone('an iron helmet', () => hasArmor(bot, 'head', 'iron'), get('iron_helmet'))
  ]
}

// A step on the way to beating the game. `label` is how !status lists it.
function milestone (label, isDone, run) {
  return { name: `make ${label}`, label, milestone: true, isDone, run }
}

function mealForNearbyAnimals (bot) {
  const counts = new Map()
  for (const e of Object.values(bot.entities)) {
    const meal = MEALS[e.name]
    if (meal && e.position.distanceTo(bot.entity.position) <= 48) counts.set(meal, (counts.get(meal) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'cooked_beef'
}
