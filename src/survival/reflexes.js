// Survival reflexes: checked twice a second, whatever the bot is doing.
// When one is needed it interrupts the current task, deals with the problem,
// and the task carries on afterwards.
//
//   priority  reflex
//   100       get out of lava (pour a water bucket if we have one)
//    95       swim up before drowning
//    90       run away (badly hurt, or a creeper and no weapon)
//    85       get away from something hurting us that we can't reach
//    80       fight back
//    50       eat
//    20       throw away junk when the inventory is nearly full

import pathfinderPkg from 'mineflayer-pathfinder'
import { attack, runFrom, nearestHostile, isHostile, equipWeapon, ARCHERS, REACH } from '../skills/combat.js'
import { keepAfloat, isSubmerged } from '../skills/swimming.js'
import { eat, bestFood } from '../skills/eat.js'
import { douse, hasWaterBucket } from '../skills/buckets.js'
import { wearBestGear } from '../skills/equipment.js'
import { needsTidying, tossJunk } from '../skills/inventory.js'
import { sleep } from '../util.js'

const { goals } = pathfinderPkg
const CHECK_EVERY_MS = 500
const HOUSEKEEPING_MS = 3000
const TIDY_EVERY_MS = 60_000
const IGNORE_UNREACHABLE_MS = 30_000 // leave a mob we couldn't reach alone this long
const FIGHT_RANGE = 8 // attack hostile mobs this close
const ALERT_RANGE = 16 // ...or this close if one just hurt us (skeletons shoot from range)
const LOW_HEALTH = 6 // 3 hearts
const LOW_HEALTH_VS_ARCHERS = 10 // 5 hearts
const LOW_AIR = 10 // of 20: surface with plenty of margin (fights underwater ate the rest)
const HUNGRY = 14 // eat below this...
const TOPPED_UP = 18 // ...or below this while hurt, since health only regenerates at 18+

export class Reflexes {
  constructor (bot, { tasks, log }) {
    this.bot = bot
    this.tasks = tasks
    this.log = log
    this.lastHurtAt = 0
    this.lastAttacker = null
    this.unreachable = new Map() // mob id -> ignore it until this time
    this.inFlight = null // { priority }
    this.lastTidyAt = 0
  }

  start () {
    const bot = this.bot
    keepAfloat(bot)
    bot.on('entityHurt', (entity, source) => {
      if (entity !== bot.entity) return
      this.lastHurtAt = Date.now()
      if (source) this.lastAttacker = source
    })
    // Right after (re)spawning, state like "in lava" can still be stale for a moment.
    this.spawnedAt = Date.now()
    bot.on('spawn', () => { this.spawnedAt = Date.now() })
    const timer = setInterval(() => this.check(), CHECK_EVERY_MS)
    // Put on any better armor or a shield as soon as we have them. Equipping
    // armor doesn't touch the item in hand, so this needn't interrupt anything.
    const housekeeping = setInterval(() => {
      // Not while a crafting table or furnace is open: moving items then confuses both.
      if (this.inFlight || !bot.entity || bot.health <= 0 || this.dressing || bot.currentWindow) return
      this.dressing = true
      wearBestGear(bot).catch(() => {}).finally(() => { this.dressing = false })
    }, HOUSEKEEPING_MS)
    bot.once('end', () => {
      clearInterval(timer)
      clearInterval(housekeeping)
    })
    // Lava does 4 damage every half second: don't wait for the next check.
    bot.on('physicsTick', () => { if (bot.entity && inLava(bot)) this.check() })
  }

  check () {
    const bot = this.bot
    if (!bot.entity || bot.isSleeping || bot.health <= 0 || Date.now() - this.spawnedAt < 1500) return
    const need = this.mostUrgent()
    if (!need) return
    if (this.inFlight && this.inFlight.priority >= need.priority) return

    const flight = { priority: need.priority }
    this.inFlight = flight
    this.log(`Reflex: ${need.name}`)
    this.tasks.preempt(need.name, need.run, need.priority)
      .catch((err) => this.log(`Reflex ${need.name} failed: ${err.message}`))
      .finally(() => { if (this.inFlight === flight) this.inFlight = null })
  }

  /** The most urgent thing to deal with right now, or null. */
  mostUrgent () {
    const bot = this.bot
    if (inLava(bot)) return { name: 'escape lava', priority: 100, run: (s) => this.escapeLava(s) }
    if (bot.entity.isInWater && bot.oxygenLevel <= LOW_AIR) {
      return { name: 'swim up for air', priority: 95, run: (s) => this.swimUp(s) }
    }

    const recentlyHurt = Date.now() - this.lastHurtAt < 3000
    const threat = nearestHostile(bot, recentlyHurt ? ALERT_RANGE : FIGHT_RANGE, (e) => this.outOfReach(e))
    if (threat) {
      const unarmed = !hasWeapon(bot)
      if (bot.health <= retreatAt(threat) || (threat.name === 'creeper' && unarmed)) {
        return { name: `run from ${threat.name}`, priority: 90, run: (s) => this.flee(threat, s) }
      }
      return { name: `fight ${threat.name}`, priority: 80, run: (s) => this.fight(s) }
    }
    // Being hurt by something we can't get at (a drowned throwing tridents
    // from the deep, a skeleton across a river): don't stand there, leave.
    const attacker = this.lastAttacker
    if (recentlyHurt && attacker?.isValid && isHostile(attacker) && this.outOfReach(attacker)) {
      return { name: `get away from ${attacker.name}`, priority: 85, run: (s) => this.flee(attacker, s) }
    }

    const hungry = bot.food <= HUNGRY || (bot.food < TOPPED_UP && bot.health < 20)
    if (hungry && bestFood(bot)) return { name: 'eat', priority: 50, run: () => eat(bot) }

    // At most once a minute: if the junk lands within reach and we pick it
    // back up, this would otherwise loop.
    if (needsTidying(bot) && Date.now() - this.lastTidyAt > TIDY_EVERY_MS && !bot.currentWindow) {
      return { name: 'throw away junk', priority: 20, run: (s) => this.tidy(s) }
    }
    return null
  }

  async tidy (signal) {
    const bot = this.bot
    this.lastTidyAt = Date.now()
    const spot = bot.entity.position.clone()
    const tossed = await tossJunk(bot)
    this.log(`Inventory nearly full: threw away ${tossed} junk blocks`)
    // Dropped items can't be picked up for 2 seconds. Get clear of them by
    // then, or (in a tunnel especially) we'd walk straight back over them.
    const timer = setTimeout(() => bot.pathfinder.stop(), 4000)
    try {
      await bot.pathfinder.goto(new goals.GoalInvert(new goals.GoalNear(spot.x, spot.y, spot.z, 5)))
    } catch {
      signal?.throwIfAborted()
    } finally {
      clearTimeout(timer)
    }
  }

  // Keep fighting until nothing hostile (that we can reach) is close.
  async fight (signal) {
    const bot = this.bot
    await equipWeapon(bot)
    let mob
    while ((mob = nearestHostile(bot, ALERT_RANGE, (e) => this.outOfReach(e)))) {
      signal.throwIfAborted()
      if (bot.health <= retreatAt(mob)) return // the flee reflex takes over
      if (bot.entity.isInWater && bot.oxygenLevel <= LOW_AIR) return // breathe first
      const gone = await attack(bot, mob, { signal, giveUpAfterMs: 20_000 })
      if (!gone && mob.isValid) {
        // Can't get at it (deep under water, across a gap). Chasing it again
        // half a second later would loop forever, so leave it be for a while.
        this.unreachable.set(mob.id, Date.now() + IGNORE_UNREACHABLE_MS)
        this.log(`Can't reach the ${mob.name}; leaving it alone for now`)
      }
    }
  }

  // A mob we recently failed to reach, unless it has come close enough to hit.
  outOfReach (mob) {
    const until = this.unreachable.get(mob.id)
    if (!until) return false
    if (until < Date.now()) {
      this.unreachable.delete(mob.id)
      return false
    }
    // Only take it on again once it's close *and* up out of the water: a mob
    // bobbing at the edge of reach would otherwise flip us back and forth.
    const close = mob.position.distanceTo(this.bot.entity.position) <= REACH + 1
    return !(close && !isSubmerged(this.bot, mob))
  }

  async flee (mob, signal) {
    await runFrom(this.bot, mob, { signal, seconds: 5 })
    // Out of reach for a moment: eat if we can, to start healing.
    if (bestFood(this.bot)) await eat(this.bot).catch(() => {})
  }

  // Lava kills in a couple of seconds, too fast to wait for the pathfinder:
  // steer straight at the nearest safe spot and sprint-jump until we're out.
  async escapeLava (signal) {
    const bot = this.bot
    // With a water bucket, pour it at our feet: the lava turns to stone and the fire goes out.
    if (hasWaterBucket(bot)) {
      this.log(`In lava with ${Math.round(bot.health)} health: pouring water`)
      await douse(bot, { signal })
      if (!inLava(bot)) return
    }
    const safe = findSafeSpot(bot, 6)
    if (!safe) {
      bot.setControlState('jump', true) // nowhere obvious to go: at least try to get up and out
      try { await sleep(2000, signal) } finally { bot.setControlState('jump', false) }
      return
    }
    const target = safe.offset(0.5, 0, 0.5)
    this.log(`In lava with ${Math.round(bot.health)} health, heading for ${safe}`)
    const until = Date.now() + 6000
    try {
      while (Date.now() < until) {
        await bot.lookAt(target.offset(0, bot.entity.height, 0), true)
        for (const c of ['forward', 'sprint', 'jump']) bot.setControlState(c, true)
        // Don't stop at the edge: lava flows up to 3 blocks and would catch us.
        const p = bot.entity.position
        if (!inLava(bot) && Math.hypot(target.x - p.x, target.z - p.z) < 0.8) break
        await sleep(50, signal)
      }
    } finally {
      for (const c of ['forward', 'sprint', 'jump']) bot.setControlState(c, false)
      this.log(`Lava escape ended at ${bot.entity.position.floored()}, health ${Math.round(bot.health)}, in lava: ${bot.entity.isInLava}`)
    }
    // We keep burning for ~15 seconds after lava, 1 damage per second. Water puts it out.
    if (isOnFire(bot) && !inLava(bot)) await this.putOutFire(signal)
  }

  async putOutFire (signal) {
    const bot = this.bot
    if (hasWaterBucket(bot)) {
      this.log('On fire: pouring water')
      await douse(bot, { signal })
      return
    }
    const water = bot.findBlock({ matching: bot.registry.blocksByName.water.id, maxDistance: 16 })
    if (!water) return
    this.log(`On fire: running for the water at ${water.position}`)
    const timer = setTimeout(() => bot.pathfinder.stop(), 8000)
    try {
      await bot.pathfinder.goto(new goals.GoalNear(water.position.x, water.position.y, water.position.z, 0))
    } catch {
      signal.throwIfAborted()
    } finally {
      clearTimeout(timer)
    }
  }

  async swimUp (signal) {
    const bot = this.bot
    bot.setControlState('jump', true)
    try {
      // Stay up until fully recovered, so we don't dive straight back in short of air.
      const until = Date.now() + 10_000
      while ((bot.oxygenLevel < 19 || bot.entity.isInWater) && Date.now() < until) await sleep(250, signal)
    } finally {
      bot.setControlState('jump', false)
    }
  }
}

// Archers keep shooting while you chase them, so back off from them sooner.
function retreatAt (mob) {
  return ARCHERS.has(mob.name) ? LOW_HEALTH_VS_ARCHERS : LOW_HEALTH
}

// The physics flag can be stale right after a respawn, so also check for an actual lava block.
function inLava (bot) {
  if (!bot.entity.isInLava) return false
  const feet = bot.entity.position.floored()
  return [0, 1].some((dy) => bot.blockAt(feet.offset(0, dy, 0))?.name === 'lava')
}

// Entity flag 0x01 in the first metadata byte means "on fire".
function isOnFire (bot) {
  const flags = bot.entity.metadata?.[0]
  return typeof flags === 'number' && (flags & 0x01) !== 0
}

function hasWeapon (bot) {
  return bot.inventory.items().some((i) => i.name.endsWith('_sword') || i.name.endsWith('_axe'))
}

// The best nearby spot to stand that isn't in or next to lava or fire:
// close, level with us (jumping up out of lava is slow), and 2+ blocks
// from the nearest lava so the flow doesn't follow us there.
function findSafeSpot (bot, radius) {
  const feet = bot.entity.position.floored()
  const bad = (b) => !b || b.name.includes('lava') || b.name.includes('fire') || b.name === 'magma_block'
  // Lava spreads up to 3 blocks on flat ground, so stay at least that far away.
  const lavaNear = (pos) => {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = -1; dy <= 2; dy++) if (bad(bot.blockAt(pos.offset(dx, dy, dz)))) return true
      }
    }
    return false
  }
  let best = null
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = feet.offset(dx, dy, dz)
        const below = bot.blockAt(pos.offset(0, -1, 0))
        const at = bot.blockAt(pos)
        const head = bot.blockAt(pos.offset(0, 1, 0))
        if (!below || below.boundingBox !== 'block' || bad(below)) continue
        if (!at || at.boundingBox !== 'empty' || bad(at) || !head || head.boundingBox !== 'empty' || bad(head)) continue
        if (lavaNear(pos)) continue
        // Water puts the fire out, so it's worth a slightly longer run.
        const score = Math.hypot(dx, dz) + Math.abs(dy) * 2 - (at.name === 'water' ? 3 : 0)
        if (!best || score < best.score) best = { pos, score }
      }
    }
  }
  return best?.pos ?? null
}
