// TaskRunner tests: interrupting a job for a reflex and resuming it.
// Uses a fake bot, so no server is needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { TaskRunner } from '../src/tasks.js'
import { sleep } from '../src/util.js'

function fakeBot () {
  const bot = new EventEmitter()
  bot.pathfinder = { stop () {}, setGoal () {} }
  bot.collectBlock = { cancelTask: async () => {} }
  bot.setControlState = () => {}
  bot.stopDigging = () => {}
  return bot
}

function runner () {
  const said = []
  const tasks = new TaskRunner(fakeBot(), { log: () => {}, say: (t) => said.push(t) })
  return { tasks, said }
}

// A job that runs until stopped, counting how many times it was started.
function longJob (counter) {
  return async (signal) => {
    counter.starts++
    await sleep(10_000, signal)
  }
}

test('a reflex interrupts a job, then the job resumes', async () => {
  const { tasks } = runner()
  const job = { starts: 0 }
  tasks.run('chop wood', longJob(job))
  await sleep(10)

  let reflexRan = false
  await tasks.preempt('eat', async () => { reflexRan = true }, 50)
  await sleep(10)

  assert.ok(reflexRan)
  assert.equal(job.starts, 2, 'the job was restarted after the reflex')
  assert.equal(tasks.current?.name, 'chop wood')
  await tasks.stop()
})

test('a higher-priority reflex interrupts a lower one, and the job still resumes once', async () => {
  const { tasks } = runner()
  const job = { starts: 0 }
  tasks.run('chop wood', longJob(job))
  await sleep(10)

  const eating = tasks.preempt('eat', (signal) => sleep(10_000, signal), 50)
  await sleep(10)
  const fighting = tasks.preempt('fight', () => sleep(20), 80)
  await Promise.all([eating, fighting])
  await sleep(10)

  assert.equal(job.starts, 2, 'resumed exactly once, not twice')
  assert.equal(tasks.current?.name, 'chop wood')
  await tasks.stop()
})

test('a lower-priority reflex does not interrupt a higher one', async () => {
  const { tasks } = runner()
  const fighting = tasks.preempt('fight', () => sleep(30), 80)
  await sleep(5)
  const started = await tasks.preempt('eat', async () => {}, 50)
  assert.equal(started, false)
  await fighting
})

test('!stop during a reflex cancels the job instead of resuming it', async () => {
  const { tasks } = runner()
  const job = { starts: 0 }
  tasks.run('chop wood', longJob(job))
  await sleep(10)
  const eating = tasks.preempt('eat', (signal) => sleep(10_000, signal), 50)
  await sleep(10)
  await tasks.stop()
  await eating
  await sleep(10)

  assert.equal(job.starts, 1)
  assert.equal(tasks.busy, false)
})

test('a new command replaces the interrupted job', async () => {
  const { tasks } = runner()
  const job = { starts: 0 }
  tasks.run('chop wood', longJob(job))
  await sleep(10)
  const eating = tasks.preempt('eat', (signal) => sleep(10_000, signal), 50)
  await sleep(10)
  tasks.run('come here', (signal) => sleep(10_000, signal))
  await eating
  await sleep(10)

  assert.equal(job.starts, 1, 'chop wood was not resumed')
  assert.equal(tasks.current?.name, 'come here')
  await tasks.stop()
})
