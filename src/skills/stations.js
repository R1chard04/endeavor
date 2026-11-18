// Placing and picking up "stations": crafting tables, furnaces, beds.
// The bot carries its own, puts one down when it needs it, and takes it
// along again afterwards.

import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { pickUpDrops } from './drops.js'

const { goals } = pathfinderPkg
export const STATION_SEARCH_RADIUS = 24

/**
 * A placed block nearby, e.g. findStation(bot, 'furnace') or
 * findStation(bot, ['white_bed', 'red_bed']). Matching by block id (not a
 * function) lets Mineflayer skip whole chunk sections, which is much faster.
 */
export function findStation (bot, names, radius = STATION_SEARCH_RADIUS) {
  const ids = [names].flat().map((n) => bot.registry.blocksByName[n]?.id).filter((id) => id !== undefined)
  return bot.findBlock({ matching: ids, maxDistance: radius })
}

/** Use a placed station nearby, or place one from the inventory. */
export async function getStation (bot, itemName, { log = () => {}, matches } = {}) {
  const existing = findStation(bot, matches ?? itemName)
  if (existing) return { block: existing, placed: false }
  log(`Placing a ${bot.registry.itemsByName[itemName].displayName}`)
  return { block: await placeNearby(bot, itemName, { log }), placed: true }
}

/** Walk to the nearest spot with solid ground and open air (e.g. out of a river). */
export async function moveToOpenGround (bot, radius = 12) {
  const feet = bot.entity.position.floored()
  let best = null
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -3; dy <= 3; dy++) {
        const pos = feet.offset(dx, dy, dz)
        // Room to stand (feet and head), plus free neighbors to put things on.
        if (!isFreeSpot(bot, pos, false) || bot.blockAt(pos.offset(0, 1, 0))?.boundingBox !== 'empty') continue
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([x, z]) => isFreeSpot(bot, pos.offset(x, 0, z), false))
        if (neighbors.length < 2) continue
        const d = Math.hypot(dx, dz) + Math.abs(dy)
        if (!best || d < best.d) best = { pos, d }
      }
    }
  }
  if (!best) return false
  await bot.pathfinder.goto(new goals.GoalBlock(best.pos.x, best.pos.y, best.pos.z))
  return true
}

// Spots around the bot to try: about 2 blocks away first (close enough to
// reach, far enough not to be standing in the way), then 1, then 3.
const OFFSETS = []
for (let dx = -3; dx <= 3; dx++) {
  for (let dz = -3; dz <= 3; dz++) {
    if (dx !== 0 || dz !== 0) OFFSETS.push([dx, dz])
  }
}
OFFSETS.sort(([ax, az], [bx, bz]) => Math.abs(Math.hypot(ax, az) - 2) - Math.abs(Math.hypot(bx, bz) - 2))

// Plants and ground cover (grass, flowers, leaf litter) can be broken
// instantly to make room. Never these, though: they're probably someone's build.
const DONT_CLEAR = /torch|rail|redstone|button|lever|plate|sign|banner|head|skull|candle|fire|portal/

/**
 * Put a block from the inventory down on the ground next to the bot.
 * Beds take two blocks: pass twoLong so there's room for the head end
 * (it extends away from the bot).
 */
export async function placeNearby (bot, itemName, { twoLong = false, log = () => {} } = {}) {
  try {
    return await placeHere(bot, itemName, twoLong)
  } catch (err) {
    // In a tunnel or a shaft there's no open floor: dig a niche into the wall.
    if (!twoLong && await carveNiche(bot)) {
      log(`${err.message}; carved out a spot`)
      return await placeHere(bot, itemName, twoLong)
    }
    // Standing in water or a hole leaves nowhere to put things: find open ground and retry.
    log(`${err.message}; moving to open ground`)
    if (!(await moveToOpenGround(bot))) throw err
    return await placeHere(bot, itemName, twoLong)
  }
}

// Dig out one wall block beside our feet, so there's a free spot with solid
// floor under it. Never a block next to lava.
async function carveNiche (bot) {
  const feet = bot.entity.position.floored()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const pos = feet.offset(dx, 0, dz)
    const wall = bot.blockAt(pos)
    const floor = bot.blockAt(pos.offset(0, -1, 0))
    if (wall?.boundingBox !== 'block' || floor?.boundingBox !== 'block') continue
    if (!wall.diggable || wall.hardness === null || wall.hardness > 5) continue
    if (!bot.pathfinder.movements.safeToBreak(wall)) continue
    await bot.tool.equipForBlock(wall)
    await bot.dig(wall)
    return true
  }
  return false
}

export async function placeHere (bot, itemName, twoLong = false) {
  const item = bot.inventory.items().find((i) => i.name === itemName)
  if (!item) throw new Error(`I don't have a ${itemName}`)
  const feet = bot.entity.position.floored()

  // First look for open air; only clear plants if there's no open spot.
  for (const clearPlants of [false, true]) {
    for (const [dx, dz] of OFFSETS) {
      for (const dy of [0, -1, 1]) {
        const spot = feet.offset(dx, dy, dz)
        if (!isFreeSpot(bot, spot, clearPlants)) continue
        let beyond = null
        if (twoLong) {
          // Cardinal direction away from the bot; the bed's head goes there.
          const dir = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz))
          beyond = spot.plus(dir)
          if (!isFreeSpot(bot, beyond, clearPlants)) continue
        }

        for (const pos of [spot, beyond].filter(Boolean)) {
          const space = bot.blockAt(pos)
          if (space.name !== 'air' && space.name !== 'cave_air') await bot.dig(space)
        }
        await bot.equip(item, 'hand')
        const ground = bot.blockAt(spot.offset(0, -1, 0))
        try {
          await bot.placeBlock(ground, new Vec3(0, 1, 0))
        } catch {
          // placeBlock sometimes times out even though the block went down; check below.
        }
        const placed = bot.blockAt(spot)
        if (placed && placed.name !== 'air' && placed.name !== 'cave_air') return placed
      }
    }
  }
  throw new Error(`I couldn't find a spot to put my ${itemName}`)
}

function isFreeSpot (bot, spot, clearPlants) {
  const space = bot.blockAt(spot)
  const ground = bot.blockAt(spot.offset(0, -1, 0))
  if (!space || !ground || ground.boundingBox !== 'block' || ground.name.includes('leaves')) return false
  if (overlapsBot(bot, spot)) return false
  if (space.name === 'air' || space.name === 'cave_air') return true
  return clearPlants && canClear(space)
}

function canClear (block) {
  return block.boundingBox === 'empty' && block.hardness === 0 && block.diggable &&
    !DONT_CLEAR.test(block.name)
}

function overlapsBot (bot, spot) {
  const p = bot.entity.position
  const w = 0.3 // half the player's width
  return p.x + w > spot.x && p.x - w < spot.x + 1 &&
    p.z + w > spot.z && p.z - w < spot.z + 1 &&
    p.y < spot.y + 1 && p.y + 1.8 > spot.y
}

/** Walk until a block is within reach. */
export async function goNear (bot, position, range = 2) {
  if (bot.entity.position.distanceTo(position.offset(0.5, 0.5, 0.5)) <= range + 1.5) return
  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, range))
}

/** Break a station we placed and pick it back up. */
export async function pickUp (bot, station, log = () => {}) {
  const block = bot.blockAt(station.position)
  if (!block || block.type !== station.type) return
  try {
    await bot.collectBlock.collect(block)
    // A bed's item can drop from either half, so sweep the area too.
    await pickUpDrops(bot, block.position, { radius: 3 })
  } catch (err) {
    log(`Left my ${block.name} behind: ${err.message}`)
  }
}
