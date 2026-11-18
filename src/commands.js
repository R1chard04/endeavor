// Chat commands. Type these in Minecraft chat, e.g. "!get stone pickaxe".

import { collect } from './skills/collect.js'
import { obtain, planFor } from './skills/obtain.js'
import { comeTo, giveTo } from './skills/players.js'
import { countItem, inventorySummary } from './skills/inventory.js'
import { eat } from './skills/eat.js'
import { hasBed, sleepInBed, shelter } from './skills/night.js'
import { gearSummary } from './skills/equipment.js'
import { describeStep } from './planner/planner.js'

const PREFIX = '!'

const HELP = [
  '!auto [off] - play on my own (or stop)',
  '!status - what I am up to, my health and food',
  '!wood [n] - chop n logs of any kind (default 16)',
  '!get <item> [n] - get an item: mine, hunt, craft or smelt. e.g. !get cooked beef 4',
  '!plan <item> [n] - show the steps without doing them',
  '!come - walk to you',
  '!give [item|logs] - bring you everything, or just one kind of item',
  '!eat - eat something now',
  '!sleep - sleep in my bed, or dig in for the night',
  '!inv - list what I am carrying',
  '!stop - stop what I am doing (including !auto)'
]

/**
 * @param ctx.setAuto - turn autonomous play on or off
 * @param ctx.afterJob - called when a chat job finishes (to resume autonomous play)
 */
export function createCommandHandler (bot, { gather, tasks, brain, config, log, say, setAuto, afterJob = () => {} }) {
  const opts = (signal) => ({ signal, log, say })
  // Run a job from chat. Jobs may be interrupted by reflexes and restarted,
  // so each one works out what's left to do when it (re)starts.
  const job = (name, fn) => tasks.run(name, fn).then(afterJob)

  const commands = {
    help () {
      for (const line of HELP) say(line)
    },

    auto (args) {
      const on = args[0]?.toLowerCase() !== 'off'
      setAuto(on)
      say(on ? "I'll play on my own. Type !auto off to stop." : 'OK, waiting for commands.')
    },

    status () {
      const { x, y, z } = bot.entity.position.floored()
      const air = bot.oxygenLevel < 20 ? `, air ${bot.oxygenLevel}/20` : ''
      say(`${brain.status()} Health ${Math.round(bot.health)}/20, food ${bot.food}/20${air}, at ${x} ${y} ${z}.`)
    },

    wood (args) {
      const count = parseCount(args[0], 16)
      const target = countItem(bot, gather.logs) + count
      job(`chop ${count} logs`, (signal) =>
        collect(bot, gather, gather.logs, Math.max(0, target - countItem(bot, gather.logs)), opts(signal)))
    },

    get (args) {
      const { item, count } = parseItem(bot, args)
      job(`get ${count} ${item}`, (signal) => obtain(bot, gather, item, count, opts(signal)))
    },

    plan (args) {
      const { item, count } = parseItem(bot, args)
      const plan = planFor(bot, gather, item, count)
      if (!plan.ok) return say(plan.reason)
      if (plan.steps.length === 0) return say(`I already have ${count} ${item}`)
      say(plan.steps.map((s, i) => `${i + 1}. ${describeStep(s, bot.registry)}`).join('  '))
    },

    come (args, username) {
      job(`come to ${username}`, () => comeTo(bot, username))
    },

    give (args, username) {
      const what = args.join('_').toLowerCase()
      const which = what === ''
        ? () => true
        : what === 'logs' || what === 'wood'
          ? (name) => gather.logs.includes(name)
          : (name) => name === what
      job(`give ${what || 'everything'} to ${username}`, async () => {
        const given = await giveTo(bot, username, which)
        if (given === 0) say(`I don't have any ${what || 'items'}`)
      })
    },

    eat () {
      job('eat', async () => {
        if (!(await eat(bot))) say(bot.food >= 20 ? "I'm not hungry" : 'I have nothing good to eat')
      })
    },

    sleep () {
      job('sleep', (signal) => hasBed(bot) ? sleepInBed(bot, opts(signal)) : shelter(bot, opts(signal)))
    },

    inv () {
      say(`I have: ${inventorySummary(bot)}. Wearing: ${gearSummary(bot)}.`)
    },

    async stop () {
      setAuto(false)
      if (!tasks.busy) return say("I'm not doing anything")
      await tasks.stop()
      say('Stopped')
    }
  }

  return function onChat (username, message) {
    if (username === bot.username || !message.startsWith(PREFIX)) return
    if (config.owner && username !== config.owner) return
    const [name, ...args] = message.slice(PREFIX.length).trim().split(/\s+/)
    const key = name.toLowerCase()
    const command = Object.hasOwn(commands, key) ? commands[key] : null
    if (!command) return say(`I don't know "${name}". Try !help`)
    log(`${username}: ${message}`)
    Promise.resolve()
      .then(() => command(args, username))
      .catch((err) => say(err.message))
  }
}

function parseCount (text, fallback) {
  if (text === undefined) return fallback
  const n = Number(text)
  if (!Number.isInteger(n) || n < 1) throw new Error(`"${text}" isn't a count`)
  return n
}

// "stone pickaxe 2" -> { item: 'stone_pickaxe', count: 2 }
export function parseItem (bot, args) {
  const words = [...args]
  const count = /^\d+$/.test(words.at(-1) ?? '') ? Number(words.pop()) : 1
  const item = words.join('_').toLowerCase().replace(/^minecraft:/, '')
  if (!item) throw new Error('Which item? e.g. !get stone pickaxe')
  if (!bot.registry.itemsByName[item]) throw new Error(`"${item}" isn't a Minecraft item name`)
  return { item, count }
}
