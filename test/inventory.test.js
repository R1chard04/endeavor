// What the bot throws away when its inventory fills up. No server needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { junkToToss } from '../src/skills/inventory.js'

const stacks = (...pairs) => pairs.map(([name, count]) => ({ name, count }))

test('throws away stone it has no use for', () => {
  const toss = junkToToss(stacks(['granite', 25], ['diorite', 8], ['raw_iron', 8]))
  assert.deepEqual(toss, [{ name: 'granite', count: 25 }, { name: 'diorite', count: 8 }])
})

test('keeps a working supply of cobblestone and dirt, tosses the rest', () => {
  const toss = junkToToss(stacks(['cobblestone', 64], ['cobblestone', 28], ['dirt', 10]))
  assert.deepEqual(toss, [{ name: 'cobblestone', count: 28 }])
})

test('never throws away tools, food or ores', () => {
  const toss = junkToToss(stacks(['iron_pickaxe', 1], ['cooked_beef', 8], ['raw_iron', 30], ['coal', 12], ['torch', 9]))
  assert.deepEqual(toss, [])
})
