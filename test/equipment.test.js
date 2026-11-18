// Armor choice tests. Pure data: no server needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armorRank, bestArmorPiece } from '../src/skills/equipment.js'

const items = (...names) => names.map((name) => ({ name }))

test('ranks armor tiers from leather to netherite', () => {
  const order = ['leather_boots', 'golden_boots', 'chainmail_boots', 'iron_boots', 'diamond_boots', 'netherite_boots']
  const ranks = order.map(armorRank)
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks)
  assert.equal(armorRank('stone_pickaxe'), -1)
  assert.equal(armorRank(undefined), -1)
})

test('picks the best piece for each slot and ignores other slots', () => {
  const inv = items('leather_chestplate', 'iron_chestplate', 'iron_boots', 'diamond_helmet', 'stone_sword')
  assert.equal(bestArmorPiece(inv, 'torso').name, 'iron_chestplate')
  assert.equal(bestArmorPiece(inv, 'feet').name, 'iron_boots')
  assert.equal(bestArmorPiece(inv, 'head').name, 'diamond_helmet')
  assert.equal(bestArmorPiece(inv, 'legs'), null)
})
