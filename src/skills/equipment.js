// Wearing armor and holding a shield.

// Weakest first. Copper armor (1.21.9+) sits between leather and iron.
const ARMOR_TIERS = ['leather', 'golden', 'copper', 'chainmail', 'turtle', 'iron', 'diamond', 'netherite']
export const ARMOR_SLOTS = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' }

/** How good a piece of armor is: higher is better, -1 if it isn't armor. */
export function armorRank (name) {
  if (!name) return -1
  const tier = name.split('_')[0]
  return ARMOR_TIERS.indexOf(tier)
}

/** The best piece for a slot from a list of items, or null. */
export function bestArmorPiece (items, slot) {
  const piece = ARMOR_SLOTS[slot]
  let best = null
  for (const item of items) {
    if (!item.name.endsWith(`_${piece}`) && !(slot === 'head' && item.name === 'turtle_helmet')) continue
    if (!best || armorRank(item.name) > armorRank(best.name)) best = item
  }
  return best
}

/** What's in an armor slot (or 'off-hand') right now. */
export function worn (bot, slot) {
  return bot.inventory.slots[bot.getEquipmentDestSlot(slot)] ?? null
}

/** Put on anything better than what we're wearing, and hold a shield. Quick if there's nothing to do. */
export async function wearBestGear (bot) {
  const items = bot.inventory.items()
  for (const slot of Object.keys(ARMOR_SLOTS)) {
    const best = bestArmorPiece(items, slot)
    if (best && armorRank(best.name) > armorRank(worn(bot, slot)?.name)) await bot.equip(best, slot)
  }
  const shield = items.find((i) => i.name === 'shield')
  if (shield && worn(bot, 'off-hand')?.name !== 'shield') await bot.equip(shield, 'off-hand')
}

export function hasShield (bot) {
  return worn(bot, 'off-hand')?.name === 'shield' || bot.inventory.items().some((i) => i.name === 'shield')
}

/** Is the bot wearing (or carrying) armor this good in a slot? */
export function hasArmor (bot, slot, minTier) {
  const need = ARMOR_TIERS.indexOf(minTier)
  const candidates = [worn(bot, slot), bestArmorPiece(bot.inventory.items(), slot)]
  return candidates.some((item) => item && armorRank(item.name) >= need)
}

/** "iron chestplate, iron boots, shield", for chat. */
export function gearSummary (bot) {
  const names = [...Object.keys(ARMOR_SLOTS), 'off-hand']
    .map((slot) => worn(bot, slot))
    .filter(Boolean)
    .map((item) => item.displayName)
  return names.join(', ') || 'nothing'
}
