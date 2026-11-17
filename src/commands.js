// Chat commands. Type these in Minecraft chat, e.g. "!get stone pickaxe".

import { collect } from './skills/collect.js'
import { obtain, planFor } from './skills/obtain.js'
import { comeTo, giveTo } from './skills/players.js'
import { inventorySummary } from './skills/inventory.js'
import { describeStep } from './planner/planner.js'

const PREFIX = '!'

const HELP = [
  '!wood [n] - chop n logs of any kind (default 16)',
  '!get <item> [n] - get an item, crafting whatever it needs. e.g. !get stone pickaxe',
  '!plan <item> [n] - show the steps without doing them',
  '!come - walk to you',
  '!give [item|logs] - bring you everything, or just one kind of item',
  '!inv - list what I am carrying',
  '!stop - stop what I am doing'
]

export function createCommandHandler (bot, { gather, tasks, config, log, say }) {
  const opts = (signal) => ({ signal, log, say })

  const commands = {
    help () {
      for (const line of HELP) say(line)
    },

    wood (args) {
      const count = parseCount(args[0], 16)
      tasks.run(`chop ${count} logs`, (signal) => collect(bot, gather, gather.logs, count, opts(signal)))
    },

    get (args) {
      const { item, count } = parseItem(bot, args)
      tasks.run(`get ${count} ${item}`, (signal) => obtain(bot, gather, item, count, opts(signal)))
    },

    plan (args) {
      const { item, count } = parseItem(bot, args)
      const plan = planFor(bot, gather, item, count)
      if (!plan.ok) return say(plan.reason)
      if (plan.steps.length === 0) return say(`I already have ${count} ${item}`)
      say(plan.steps.map((s, i) => `${i + 1}. ${describeStep(s, bot.registry)}`).join('  '))
    },

    come (args, username) {
      tasks.run(`come to ${username}`, () => comeTo(bot, username))
    },

    give (args, username) {
      const what = args.join('_').toLowerCase()
      const which = what === ''
        ? () => true
        : what === 'logs' || what === 'wood'
          ? (name) => gather.logs.includes(name)
          : (name) => name === what
      tasks.run(`give ${what || 'everything'} to ${username}`, async () => {
        const given = await giveTo(bot, username, which)
        if (given === 0) say(`I don't have any ${what || 'items'}`)
      })
    },

    inv () {
      say(`I have: ${inventorySummary(bot)}`)
    },

    async stop () {
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
