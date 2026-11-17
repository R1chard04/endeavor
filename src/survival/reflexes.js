// Survival reflexes: checked twice a second, whatever the bot is doing.
// When one is needed it interrupts the current task, deals with the problem,
// and the task carries on afterwards.
//
//   priority  reflex
//   100       get out of lava
//    95       swim up before drowning
//    90       run away (badly hurt, or a creeper and no weapon)
//    80       fight back
//    50       eat

import pathfinderPkg from 'mineflayer-pathfinder'
import { attack, runFrom, nearestHostile, equipWeapon } from '../skills/combat.js'
import { eat, bestFood } from '../skills/eat.js'
import { sleep } from '../util.js'

const { goals } = pathfinderPkg
const CHECK_EVERY_MS = 500
const FIGHT_RANGE = 8 // attack hostile mobs this close
const ALERT_RANGE = 16 // ...or this close if one just hurt us (skeletons shoot from range)
const LOW_HEALTH = 6 // 3 hearts
const LOW_HEALTH_VS_ARCHERS = 10 // 5 hearts
const HUNGRY = 14 // eat below this...
const TOPPED_UP = 18 // ...or below this while hurt, since health only regenerates at 18+

export class Reflexes {
  constructor (bot, { tasks, log }) {
    this.bot = bot
    this.tasks = tasks
    this.log = log
    this.lastHurtAt = 0
    this.inFlight = null // { priority }
  }

  start () {
    const bot = this.bot
    bot.on('entityHurt', (entity) => {
      if (entity === bot.entity) this.lastHurtAt = Date.now()
    })
    // Right after (re)spawning, state like "in lava" can still be stale for a moment.
    this.spawnedAt = Date.now()
    bot.on('spawn', () => { this.spawnedAt = Date.now() })
    const timer = setInterval(() => this.check(), CHECK_EVERY_MS)
    bot.once('end', () => clearInterval(timer))
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
    if (bot.entity.isInWater && bot.oxygenLevel <= 6) {
      return { name: 'swim up for air', priority: 95, run: (s) => this.swimUp(s) }
    }

    const recentlyHurt = Date.now() - this.lastHurtAt < 3000
    const threat = nearestHostile(bot, recentlyHurt ? ALERT_RANGE : FIGHT_RANGE)
    if (threat) {
      const unarmed = !hasWeapon(bot)
      if (bot.health <= retreatAt(threat) || (threat.name === 'creeper' && unarmed)) {
        return { name: `run from ${threat.name}`, priority: 90, run: (s) => this.flee(threat, s) }
      }
      return { name: `fight ${threat.name}`, priority: 80, run: (s) => this.fight(s) }
    }

    const hungry = bot.food <= HUNGRY || (bot.food < TOPPED_UP && bot.health < 20)
    if (hungry && bestFood(bot)) return { name: 'eat', priority: 50, run: () => eat(bot) }
    return null
  }

  // Keep fighting until nothing hostile is close.
  async fight (signal) {
    const bot = this.bot
    await equipWeapon(bot)
    let mob
    while ((mob = nearestHostile(bot, ALERT_RANGE)) && bot.entity.position.distanceTo(mob.position) <= ALERT_RANGE) {
      signal.throwIfAborted()
      if (bot.health <= retreatAt(mob)) return // the flee reflex takes over
      await attack(bot, mob, { signal, giveUpAfterMs: 20_000 })
    }
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
      const until = Date.now() + 6000
      while (bot.oxygenLevel < 15 && Date.now() < until) await sleep(250, signal)
    } finally {
      bot.setControlState('jump', false)
    }
  }
}

// Archers keep shooting while you chase them, so back off from them sooner.
const ARCHERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'piglin', 'witch', 'blaze'])
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
