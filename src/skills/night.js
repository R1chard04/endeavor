// Getting through the night: sleep in a bed if we have one, otherwise dig a
// sealed hole and wait for morning.

import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { findStation, placeNearby, goNear, pickUp } from './stations.js'
import { sleep, waitFor } from '../util.js'

const { goals } = pathfinderPkg

/** True from dusk until dawn, when monsters spawn (and beds work). */
export function isNight (bot) {
  const t = bot.time.timeOfDay
  return t >= 12541 && t <= 23458
}

/** Morning is when the sun is up properly and zombies are burning. */
function isMorning (bot) {
  return bot.time.timeOfDay < 12000
}

export function bedBlockNames (bot) {
  return bot.registry.blocksArray.filter((b) => b.name.endsWith('_bed')).map((b) => b.name)
}

function bedHalves (bot, pos) {
  let n = 0
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (bot.isABed(bot.blockAt(pos.offset(dx, 0, dz)))) n++
  }
  return n
}

export function hasBed (bot) {
  return bot.inventory.items().some((i) => i.name.endsWith('_bed')) ||
    Boolean(findStation(bot, bedBlockNames(bot), 16))
}

/** Put a bed down (or use one nearby), sleep until morning, then take it along. */
export async function sleepInBed (bot, { signal, log = () => {} } = {}) {
  let bed = findStation(bot, bedBlockNames(bot), 16)
  let placed = false
  if (!bed) {
    const item = bot.inventory.items().find((i) => i.name.endsWith('_bed'))
    if (!item) throw new Error("I don't have a bed")
    log('Placing my bed')
    const foot = await placeNearby(bot, item.name, { twoLong: true, log })
    placed = true
    // The server sends the bed's two halves separately; wait for both.
    await waitFor(bot, () => bedHalves(bot, foot.position) === 2, 2000)
    bed = bot.blockAt(foot.position)
  }
  try {
    await goNear(bot, bed.position, 1)
    await bot.sleep(bed) // throws if monsters are close; the reflexes deal with them first
    log('Sleeping')
    while (bot.isSleeping && !isMorning(bot)) await sleep(1000, signal)
  } finally {
    if (bot.isSleeping) await bot.wake().catch(() => {})
    if (placed && !signal?.aborted) await pickUp(bot, bed, log)
  }
}

/**
 * No bed: dig three blocks straight down, put a block over our head, and
 * wait for morning in the dark. Mobs can't reach us in a sealed 1x1 hole.
 */
export async function shelter (bot, { signal, log = () => {} } = {}) {
  const spot = findShelterSpot(bot)
  if (!spot) throw new Error("I couldn't find solid ground to dig a shelter in")
  log(`Digging in for the night at ${spot}`)

  if (!bot.entity.position.floored().equals(spot)) await bot.pathfinder.goto(new goals.GoalBlock(spot.x, spot.y, spot.z))
  await digDown(bot, spot, 3, { signal })
  await sealAbove(bot, spot.offset(0, -1, 0))

  while (!isMorning(bot)) await sleep(2000, signal)
  log('Morning! Climbing out')
  await climbOut(bot, spot, { signal, log })
}

// Dig straight down `depth` blocks from `top`, dropping into the hole each time.
async function digDown (bot, top, depth, { signal }) {
  for (let d = 1; d <= depth; d++) {
    signal?.throwIfAborted()
    await centerOn(bot, top, signal) // off-center, we'd stay standing on the edge
    const below = bot.blockAt(top.offset(0, -d, 0))
    if (below && below.boundingBox === 'block') {
      await bot.tool.equipForBlock(below)
      await bot.dig(below)
    }
    const fell = await waitFor(bot, () => bot.entity.onGround && bot.entity.position.y <= top.y - d + 0.1, 2000)
    if (!fell) throw new Error(`I couldn't dig down at ${top}`)
  }
}

// Shuffle (sneaking, so we can't slip off an edge) until we're in the
// middle of the block column.
async function centerOn (bot, column, signal) {
  const target = new Vec3(column.x + 0.5, 0, column.z + 0.5)
  bot.setControlState('sneak', true)
  try {
    for (let i = 0; i < 60; i++) {
      const p = bot.entity.position
      if (Math.hypot(target.x - p.x, target.z - p.z) < 0.12) return
      await bot.lookAt(new Vec3(target.x, p.y + bot.entity.height * 0.9, target.z), true)
      bot.setControlState('forward', true)
      await sleep(50, signal)
      bot.setControlState('forward', false)
      await sleep(50, signal)
    }
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('sneak', false)
  }
}

// Open the lid, then pillar up: jump, and at the top of each jump put a
// block where our feet were. Three times gets us back to the surface, and
// fills the hole in behind us.
async function climbOut (bot, top, { signal, log }) {
  const lid = bot.blockAt(top.offset(0, -1, 0))
  if (lid && lid.boundingBox === 'block') await bot.dig(lid)

  while (bot.entity.position.y < top.y - 0.5) {
    signal?.throwIfAborted()
    const block = scaffoldItem(bot)
    if (!block) break
    await bot.equip(block, 'hand')
    await bot.look(bot.entity.yaw, -Math.PI / 2, true) // straight down
    const feetY = Math.floor(bot.entity.position.y + 0.01)
    bot.setControlState('jump', true)
    const rose = await waitFor(bot, () => bot.entity.position.y >= feetY + 1, 1500)
    bot.setControlState('jump', false)
    if (!rose) break
    const floor = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), feetY - 1, Math.floor(bot.entity.position.z)))
    try {
      await bot.placeBlock(floor, new Vec3(0, 1, 0))
    } catch {}
    await waitFor(bot, () => bot.entity.onGround, 1500)
  }

  if (bot.entity.position.y < top.y - 0.5) {
    // Out of blocks or the jump didn't work: let the pathfinder have a go.
    try {
      await bot.pathfinder.goto(new goals.GoalNear(top.x, top.y, top.z, 2))
    } catch (err) {
      throw new Error(`I'm stuck in my shelter: ${err.message}`)
    }
  }
}

function scaffoldItem (bot) {
  return bot.inventory.items().find((i) => SEAL_BLOCKS.includes(i.name) || i.name.endsWith('_planks'))
}

// A column next to us we can dig 3 deep that's solid all around, so nothing
// can get in from the side and no water or lava can flow in.
function findShelterSpot (bot) {
  const feet = bot.entity.position.floored()
  const solid = (pos) => {
    const b = bot.blockAt(pos)
    return b && b.boundingBox === 'block' && !b.name.includes('leaves')
  }
  const diggable = (pos) => {
    const b = bot.blockAt(pos)
    return solid(pos) && b.diggable && b.hardness !== null && b.hardness < 5 &&
      !['sand', 'gravel', 'red_sand'].includes(b.name) // these would fall on us
  }
  const sides = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]

  for (let r = 0; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        for (const dy of [0, 1, -1]) {
          const top = feet.offset(dx, dy, dz) // where we'd stand before digging
          const air = bot.blockAt(top)
          if (!air || air.boundingBox !== 'empty' || air.name.includes('water') || air.name.includes('lava')) continue
          const shaft = [1, 2, 3].map((d) => top.offset(0, -d, 0))
          if (!shaft.every(diggable)) continue
          if (!solid(top.offset(0, -4, 0))) continue // something to stand on
          const walls = shaft.flatMap((p) => sides.map((s) => p.plus(s)))
          if (!walls.every(solid)) continue
          return top
        }
      }
    }
  }
  return null
}

const SEAL_BLOCKS = ['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'granite', 'diorite', 'andesite', 'tuff', 'netherrack']

async function sealAbove (bot, pos) {
  const block = scaffoldItem(bot)
  if (!block) throw new Error('I have no blocks to seal my shelter with')
  await bot.equip(block, 'hand')
  // Place it against one of the solid walls around the hole's top.
  for (const side of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
    const wall = bot.blockAt(pos.plus(side))
    if (wall?.boundingBox !== 'block') continue
    try {
      await bot.placeBlock(wall, side.scaled(-1))
    } catch {}
    if (bot.blockAt(pos)?.boundingBox === 'block') return
  }
  throw new Error("I couldn't seal the shelter")
}
