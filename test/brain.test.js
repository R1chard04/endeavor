// Brain tests: goal order, switching to something more important, and
// backing off from goals that fail. Uses fake goals; no server needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Brain } from '../src/brain/brain.js'
import { sleep } from '../src/util.js'

const fakeBot = () => ({ pathfinder: { stop () {} }, collectBlock: { cancelTask: async () => {} } })

function brainWith (goals) {
  const said = []
  const brain = new Brain(fakeBot(), { log: () => {}, say: (t) => said.push(t), goals })
  return { brain, said }
}

// Run the brain for a while, then stop it.
async function runFor (brain, ms) {
  const controller = new AbortController()
  const done = brain.run(controller.signal).catch(() => {})
  await sleep(ms)
  controller.abort()
  await done
}

test('works through goals in order', async () => {
  const order = []
  const state = { a: false, b: false }
  const { brain } = brainWith([
    { name: 'a', isDone: () => state.a, run: async () => { order.push('a'); state.a = true } },
    { name: 'b', isDone: () => state.b, run: async () => { order.push('b'); state.b = true } }
  ])
  await runFor(brain, 50)
  assert.deepEqual(order, ['a', 'b'])
})

test('drops a goal when a more important one comes up (night falls)', async () => {
  const world = { night: false, slept: false }
  const events = []
  const { brain, said } = brainWith([
    {
      name: 'get through the night',
      isDone: () => !world.night || world.slept,
      run: async () => { events.push('sleep'); world.slept = true }
    },
    {
      name: 'make a bed',
      isDone: () => false,
      run: async (signal) => { events.push('bed'); await sleep(60_000, signal) }
    }
  ])
  setTimeout(() => { world.night = true }, 100)
  await runFor(brain, 2600) // the brain checks priorities every 2s
  assert.deepEqual(events.slice(0, 2), ['bed', 'sleep'])
  assert.ok(said.some((s) => s.includes('Dropping "make a bed"')))
  assert.equal(brain.failures.has('make a bed'), false, "being set aside isn't a failure")
})

test('a failing goal waits before retrying, and others go ahead meanwhile', async () => {
  let attempts = 0
  let otherRan = false
  const { brain, said } = brainWith([
    { name: 'flaky', isDone: () => false, run: async () => { attempts++; throw new Error('no trees') } },
    { name: 'other', isDone: () => otherRan, run: async () => { otherRan = true } }
  ])
  await runFor(brain, 100)
  assert.equal(attempts, 1, 'not retried straight away')
  assert.ok(otherRan)
  assert.ok(said.some((s) => s.includes("Couldn't flaky (no trees)")))
  assert.ok(brain.failures.get('flaky').retryAt > Date.now())
})
