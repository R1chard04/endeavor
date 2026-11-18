// Swimming tests with a fake bot: floating, and what's out of reach under water.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { keepAfloat, isSubmerged, reachableInWater } from '../src/skills/swimming.js'

// A world with water up to (not including) y = 63, like a lake whose surface is at 63.
const SURFACE = 63
function fakeBot ({ y = SURFACE - 0.5, inWater = true, moving = false } = {}) {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, y, 0), isInWater: inWater, height: 1.8 }
  bot.pathfinder = { isMoving: () => moving }
  bot.isSleeping = false
  bot.controls = []
  bot.setControlState = (control, on) => bot.controls.push(`${control}:${on}`)
  bot.blockAt = (pos) => ({ name: pos.y < SURFACE ? 'water' : 'air' })
  return bot
}

const mob = (y, height = 1.95) => ({ position: new Vec3(2, y, 0), height })

test('floats (holds jump) when idle in water', () => {
  const bot = fakeBot()
  keepAfloat(bot)
  bot.emit('physicsTick')
  assert.deepEqual(bot.controls, ['jump:true'])
})

test('leaves swimming to the pathfinder while it is moving', () => {
  const bot = fakeBot({ moving: true })
  keepAfloat(bot)
  bot.emit('physicsTick')
  assert.deepEqual(bot.controls, [])
})

test('lets go of jump once out of the water', () => {
  const bot = fakeBot()
  keepAfloat(bot)
  bot.emit('physicsTick')
  bot.entity.isInWater = false
  bot.emit('physicsTick')
  bot.emit('physicsTick')
  assert.deepEqual(bot.controls, ['jump:true', 'jump:false'], 'released once, then left alone')
})

test('a drowned at the bottom of the lake is out of reach', () => {
  const bot = fakeBot()
  const deep = mob(SURFACE - 6)
  assert.equal(isSubmerged(bot, deep), true)
  assert.equal(reachableInWater(bot, deep), false)
})

test('a zombie swimming at the surface can be hit', () => {
  const bot = fakeBot()
  assert.equal(reachableInWater(bot, mob(SURFACE - 1)), true)
})

test('a mob on land is never "out of reach under water"', () => {
  const bot = fakeBot({ y: 70, inWater: false })
  assert.equal(reachableInWater(bot, mob(68)), true)
})
