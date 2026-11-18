// attack() with a fake bot: it should keep fighting a mob that gets knocked
// back after every hit or approaches slowly, and give up only when the
// pathfinder says there's no way to reach it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { attack } from '../src/skills/combat.js'

// Fast timings so the tests run in well under a second.
const FAST = { noRouteMs: 60, swingEveryMs: 10 }

/** @param pathStatus - what the fake pathfinder reports while following, e.g. 'noPath' */
function fakeBot ({ onHit = () => {}, pathStatus = null } = {}) {
  const bot = new EventEmitter()
  let reporting = null
  Object.assign(bot, {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [], slots: [] },
    heldItem: null,
    getEquipmentDestSlot: () => 45,
    pathfinder: {
      setGoal (goal) {
        clearInterval(reporting)
        if (goal && pathStatus) reporting = setInterval(() => bot.emit('path_update', { status: pathStatus }), 10)
      }
    },
    blockAt: () => ({ name: 'air' }),
    lookAt: async () => {},
    activateItem () {},
    deactivateItem () {},
    hits: 0
  })
  bot.attack = (mob) => { bot.hits++; onHit(mob) }
  return bot
}

const mobAt = (x, name = 'skeleton') => ({ name, position: new Vec3(x, 64, 0), height: 1.99, isValid: true })

test('keeps fighting a mob that is knocked back out of reach after every hit', async () => {
  // Like a skeleton: each hit knocks it 4.5 blocks away, then it comes back within reach.
  const mob = mobAt(2.5)
  let ticks = 0
  const bot = fakeBot({
    pathStatus: 'success',
    onHit: (m) => {
      m.position = new Vec3(4.5, 64, 0)
      if (bot.hits >= 8) m.isValid = false // dies after 8 hits
    }
  })
  const comeBack = setInterval(() => { if (++ticks % 3 === 0) mob.position = new Vec3(2.5, 64, 0) }, 10)
  try {
    const killed = await attack(bot, mob, { ...FAST, giveUpAfterMs: 5000 })
    assert.equal(killed, true, 'it should not give up mid-fight')
    assert.equal(bot.hits, 8)
  } finally {
    clearInterval(comeBack)
  }
})

test('a slow approach is not a dead end (shield raised, skeleton backing off)', async () => {
  // Never gets closer, but the pathfinder keeps finding a route: keep at it
  // until the overall time limit.
  const bot = fakeBot({ pathStatus: 'partial' })
  const started = Date.now()
  const killed = await attack(bot, mobAt(8), { ...FAST, giveUpAfterMs: 300 })
  assert.equal(killed, false)
  assert.ok(Date.now() - started >= 290, 'kept trying until the overall limit')
})

test('gives up when the pathfinder finds no way to the mob', async () => {
  const bot = fakeBot({ pathStatus: 'noPath' }) // e.g. across a ravine
  const started = Date.now()
  const killed = await attack(bot, mobAt(12, 'zombie'), { ...FAST, giveUpAfterMs: 5000 })
  assert.equal(killed, false)
  assert.equal(bot.hits, 0)
  assert.ok(Date.now() - started < 1000, 'gave up quickly rather than at the overall time limit')
})

test('gives up straight away on a mob deep under water', async () => {
  const bot = fakeBot()
  bot.blockAt = (pos) => ({ name: pos.y < 70 ? 'water' : 'air' }) // bot floating at the surface
  bot.entity.position = new Vec3(0, 69.5, 0)
  const killed = await attack(bot, { name: 'drowned', position: new Vec3(2, 63, 0), height: 1.95, isValid: true }, FAST)
  assert.equal(killed, false)
  assert.equal(bot.hits, 0)
})
