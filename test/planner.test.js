// Planner tests. These run without a Minecraft server: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import mcDataLoader from 'minecraft-data'
import { buildGatherData } from '../src/planner/sources.js'
import { makePlan, describeStep } from '../src/planner/planner.js'
import { MC_VERSION } from '../src/config.js'

const mcData = mcDataLoader(MC_VERSION)
const gather = buildGatherData(mcData)

function world ({ nearby, mobs, craftingTableNearby = false } = {}) {
  return {
    mcData,
    ...gather,
    nearby: nearby && new Set(nearby),
    nearbyMobs: mobs && new Set(mobs),
    craftingTableNearby
  }
}

function plan (w, inventory, goal, count = 1) {
  return makePlan(w, new Map(Object.entries(inventory)), goal, count)
}

// Run a plan against a pretend inventory, checking each craft has its
// ingredients. Returns the final inventory. This catches plans that look
// fine but would run out of planks halfway through.
function simulate (steps, inventory) {
  const inv = new Map(Object.entries(inventory))
  const add = (k, n) => inv.set(k, (inv.get(k) ?? 0) + n)
  const recipeFor = {
    oak_planks: { oak_log: 1 },
    birch_planks: { birch_log: 1 },
    crafting_table: (s) => ({ [plankOf(inv)]: 4 }),
    stick: (s) => ({ [plankOf(inv)]: 2 }),
    wooden_pickaxe: (s) => ({ [plankOf(inv)]: 3, stick: 2 }),
    stone_pickaxe: { cobblestone: 3, stick: 2 }
  }
  for (const step of steps) {
    if (step.type === 'collect') {
      add(step.item, step.count)
      continue
    }
    for (let i = 0; i < step.times; i++) {
      const r = recipeFor[step.item]
      const needs = typeof r === 'function' ? r(step) : r
      for (const [name, n] of Object.entries(needs)) {
        assert.ok((inv.get(name) ?? 0) >= n, `ran out of ${name} while crafting ${step.item}`)
        add(name, -n)
      }
      add(step.item, step.count / step.times)
    }
    if (step.table) {
      assert.ok((inv.get('crafting_table') ?? 0) > 0, `no crafting table for ${step.item}`)
    }
  }
  return inv
}

function plankOf (inv) {
  return ['oak_planks', 'birch_planks'].find((p) => (inv.get(p) ?? 0) > 0) ?? 'oak_planks'
}

test('wooden pickaxe from nothing: chop, make a table, then the pickaxe', () => {
  const result = plan(world({ nearby: ['oak_log'] }), {}, 'wooden_pickaxe')
  assert.ok(result.ok, result.reason)
  const { steps } = result

  assert.equal(steps[0].type, 'collect')
  assert.equal(steps[0].count, 3, 'one trip for all 3 logs')
  assert.ok(steps[0].anyOf.includes('birch_log'), 'any wood is fine for an ingredient')
  assert.ok(steps.some((s) => s.item === 'crafting_table'))
  assert.equal(steps.at(-1).item, 'wooden_pickaxe')

  const inv = simulate(steps, {})
  assert.equal(inv.get('wooden_pickaxe'), 1)
})

test('stone pickaxe from nothing: wooden pickaxe first, then cobblestone', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'] }), {}, 'stone_pickaxe')
  assert.ok(result.ok, result.reason)
  const items = result.steps.map((s) => s.item)

  assert.ok(items.indexOf('wooden_pickaxe') < items.indexOf('cobblestone'),
    'needs a pickaxe before it can mine stone')
  assert.equal(items.filter((i) => i === 'crafting_table').length, 1, 'reuses one table')
  assert.equal(result.steps.find((s) => s.item === 'cobblestone').count, 3)

  const inv = simulate(result.steps, {})
  assert.equal(inv.get('stone_pickaxe'), 1)
})

test('uses the wood that is nearby', () => {
  const result = plan(world({ nearby: ['birch_log', 'stone'] }), {}, 'wooden_pickaxe')
  assert.ok(result.ok, result.reason)
  assert.ok(result.steps.some((s) => s.item === 'birch_planks'))
  assert.ok(!result.steps.some((s) => s.item === 'oak_planks'))
})

test('prefers common materials when nothing is in sight', () => {
  const result = plan(world({ nearby: [] }), {}, 'stone_pickaxe')
  assert.ok(result.ok, result.reason)
  const items = result.steps.map((s) => s.item)
  assert.ok(items.includes('oak_planks'), `expected oak, got ${items}`)
  assert.ok(items.includes('cobblestone'), `expected cobblestone, got ${items}`)
})

test('uses what is already in the inventory', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'] }), {
    cobblestone: 3, stick: 2, crafting_table: 1
  }, 'stone_pickaxe')
  assert.ok(result.ok, result.reason)
  assert.deepEqual(result.steps.map((s) => s.item), ['stone_pickaxe'])
})

test('skips making a table when one is placed nearby', () => {
  const result = plan(world({ nearby: ['oak_log'], craftingTableNearby: true }), {}, 'wooden_pickaxe')
  assert.ok(result.ok, result.reason)
  assert.ok(!result.steps.some((s) => s.item === 'crafting_table'))
})

test('nothing to do when the goal is already in the inventory', () => {
  const result = plan(world({ nearby: ['oak_log'] }), { wooden_pickaxe: 1 }, 'wooden_pickaxe')
  assert.ok(result.ok)
  assert.deepEqual(result.steps, [])
})

test('asking for a specific log means exactly that log', () => {
  const result = plan(world({ nearby: ['oak_log'] }), {}, 'oak_log', 16)
  assert.ok(result.ok, result.reason)
  assert.deepEqual(result.steps[0].anyOf, ['oak_log'])
  assert.equal(result.steps[0].count, 16)
})

test('explains what is missing for later stages', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'] }), {}, 'diamond_pickaxe')
  assert.equal(result.ok, false)
  assert.match(result.reason, /Diamond/)
})

// --- hunting and smelting -------------------------------------------------

const types = (result) => result.steps.map((s) => `${s.type}:${s.item}`)

test('cooked food: hunt, build a furnace, then smelt', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'], mobs: ['cow'] }), {}, 'cooked_beef', 3)
  assert.ok(result.ok, result.reason)
  const steps = types(result)
  const smelt = result.steps.find((s) => s.type === 'smelt')

  assert.ok(steps.includes('hunt:beef'))
  assert.ok(steps.indexOf('craft:furnace') < steps.indexOf('smelt:cooked_beef'))
  assert.ok(steps.indexOf('hunt:beef') < steps.indexOf('smelt:cooked_beef'))
  assert.equal(smelt.count, 3)
  assert.ok(smelt.fuelCount >= 2, 'planks smelt 1.5 items each, so 3 items need 2')
  assert.equal(result.steps.find((s) => s.type === 'collect' && s.item === 'cobblestone').count, 8)
})

test('falls back to another tool when the cheapest one is a dead end', () => {
  // Happened live: holding 6 cobblestone (2 short of a furnace) and no pickaxe.
  // A stone pickaxe looks cheapest for mining the rest, but the cobblestone
  // it would use is already set aside for the furnace.
  const result = plan(world({ nearby: ['oak_log', 'stone'], mobs: ['cow'] }), { cobblestone: 6 }, 'cooked_beef', 3)
  assert.ok(result.ok, result.reason)
  const steps = types(result)
  assert.ok(steps.includes('craft:wooden_pickaxe'))
  assert.ok(steps.indexOf('craft:wooden_pickaxe') < steps.indexOf('collect:cobblestone'))
  assert.ok(!steps.includes('craft:stone_pickaxe'), `no detour through a stone pickaxe: ${steps}`)
})

test('smelting uses coal it already has instead of making fuel', () => {
  const result = plan(world({ nearby: ['oak_log'], mobs: ['cow'] }), { furnace: 1, coal: 2 }, 'cooked_beef', 4)
  assert.ok(result.ok, result.reason)
  assert.deepEqual(types(result), ['hunt:beef', 'smelt:cooked_beef'])
  assert.equal(result.steps[1].fuel, 'coal')
})

test('a bed: wool from sheep plus planks', () => {
  const result = plan(world({ nearby: ['oak_log'], mobs: ['sheep'] }), {}, 'white_bed')
  assert.ok(result.ok, result.reason)
  const hunt = result.steps.find((s) => s.type === 'hunt')
  assert.deepEqual(hunt.mobs, ['sheep'])
  assert.equal(hunt.count, 3)
  assert.ok(hunt.anyOf.includes('black_wool'), 'any sheep will do; the plan adapts to the colors we get')
  assert.equal(result.steps.at(-1).item, 'white_bed')
})

test('iron pickaxe from nothing: stone pickaxe before mining iron', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone', 'iron_ore', 'coal_ore'] }), {}, 'iron_pickaxe')
  assert.ok(result.ok, result.reason)
  const steps = types(result)
  assert.ok(steps.indexOf('craft:stone_pickaxe') < steps.indexOf('collect:raw_iron'),
    'iron ore needs at least a stone pickaxe')
  assert.ok(steps.indexOf('smelt:iron_ingot') < steps.indexOf('craft:iron_pickaxe'))
})

test('still plans a hunt when no animals are in sight (the bot will explore)', () => {
  const result = plan(world({ nearby: ['oak_log'], mobs: [] }), { furnace: 1, coal: 1 }, 'cooked_beef')
  assert.ok(result.ok, result.reason)
  assert.deepEqual(types(result), ['hunt:beef', 'smelt:cooked_beef'])
})

// --- stage 4: iron, buckets, torches -----------------------------------------

test('a water bucket: mine and smelt iron, craft a bucket, fill it', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone', 'iron_ore', 'coal_ore', 'water'] }),
    { stone_pickaxe: 1, crafting_table: 1 }, 'water_bucket')
  assert.ok(result.ok, result.reason)
  const steps = types(result)
  assert.deepEqual(steps.slice(-2), ['craft:bucket', 'fill:water_bucket'])
  assert.ok(steps.indexOf('smelt:iron_ingot') < steps.indexOf('craft:bucket'))
  assert.equal(result.steps.find((s) => s.type === 'collect' && s.item === 'raw_iron').count, 3)
})

test('torches from coal when there is coal around', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone', 'coal_ore'] }), { wooden_pickaxe: 1, stick: 2 }, 'torch', 8)
  assert.ok(result.ok, result.reason)
  assert.deepEqual(types(result), ['collect:coal', 'craft:torch'])
})

test('torches from charcoal when there is no coal', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'] }), { wooden_pickaxe: 1, crafting_table: 1 }, 'torch', 4)
  assert.ok(result.ok, result.reason)
  assert.ok(types(result).includes('smelt:charcoal'))
})

test('iron armor: enough raw iron for the piece, smelted with fuel it has', () => {
  const result = plan(world({ nearby: ['stone', 'iron_ore'] }),
    { stone_pickaxe: 1, crafting_table: 1, furnace: 1, coal: 2 }, 'iron_chestplate')
  assert.ok(result.ok, result.reason)
  assert.deepEqual(types(result), ['collect:raw_iron', 'smelt:iron_ingot', 'craft:iron_chestplate'])
  assert.equal(result.steps[0].count, 8)
})

test('rejects names that are not items', () => {
  const result = plan(world(), {}, 'woodn_pickaxe')
  assert.equal(result.ok, false)
  assert.match(result.reason, /isn't a Minecraft item/)
})

test('describes steps in plain English', () => {
  const result = plan(world({ nearby: ['oak_log', 'stone'] }), {}, 'stone_pickaxe')
  const lines = result.steps.map((s) => describeStep(s, mcData))
  assert.equal(lines[0], 'Collect 3 logs (any wood)')
  assert.equal(lines.at(-1), 'Craft 1 × Stone Pickaxe')
})
