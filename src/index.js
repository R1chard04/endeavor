// Starts the bot: connects to the server, loads plugins, listens for chat commands.
//
//   npm start                              join and wait for chat commands
//   npm start -- --get stone_pickaxe       do one job as soon as it spawns
//   npm start -- --wood 10 --exit          chop 10 logs, then disconnect

import { parseArgs } from 'node:util'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import collectBlockPkg from 'mineflayer-collectblock'
import { config } from './config.js'
import { buildGatherData } from './planner/sources.js'
import { TaskRunner } from './tasks.js'
import { createCommandHandler, parseItem } from './commands.js'
import { collect } from './skills/collect.js'
import { obtain } from './skills/obtain.js'
import { inventorySummary } from './skills/inventory.js'

const { pathfinder, Movements } = pathfinderPkg

const { values: cli } = parseArgs({
  options: {
    get: { type: 'string' }, // e.g. --get stone_pickaxe
    count: { type: 'string', default: '1' },
    wood: { type: 'string' }, // e.g. --wood 10
    exit: { type: 'boolean', default: false } // disconnect when the job is done
  }
})

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args)

log(`Connecting to ${config.host}:${config.port} as ${config.username} (Minecraft ${config.version})`)
const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version,
  auth: config.auth
})
bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlockPkg.plugin)

// Talk in game chat and in the terminal. Chat lines max out at 256 characters.
function say (text) {
  log(`[chat] ${text}`)
  for (let i = 0; i < text.length; i += 250) bot.chat(text.slice(i, i + 250))
}

bot.once('spawn', async () => {
  // The world arrives in chunks after spawning; look around only once it's here.
  await bot.waitForChunksToLoad()

  const movements = new Movements(bot)
  movements.allowParkour = false // fewer falls into ravines
  bot.pathfinder.setMovements(movements)
  bot.collectBlock.movements = movements

  const gather = buildGatherData(bot.registry)
  const tasks = new TaskRunner(bot, { log, say })
  bot.on('chat', createCommandHandler(bot, { gather, tasks, config, log, say }))
  bot.on('death', () => {
    say('I died!')
    tasks.stop()
  })

  const { x, y, z } = bot.entity.position.floored()
  log(`Spawned at ${x} ${y} ${z}. Type !help in game chat.`)

  let job = null
  try {
    job = startupJob(gather)
  } catch (err) {
    log(err.message)
    if (cli.exit) {
      process.exitCode = 1
      bot.quit()
    }
  }
  if (job) {
    process.exitCode = 1 // until the job finishes; a disconnect midway counts as a failure
    tasks.run(job.name, job.run).then((ok) => {
      log(`Inventory: ${inventorySummary(bot)}`)
      if (cli.exit) {
        bot.quit()
        process.exitCode = ok ? 0 : 1
      }
    })
  }
})

function startupJob (gather) {
  const opts = (signal) => ({ signal, log, say })
  if (cli.wood) {
    const count = Number(cli.wood)
    return { name: `chop ${count} logs`, run: (signal) => collect(bot, gather, gather.logs, count, opts(signal)) }
  }
  if (cli.get) {
    const { item, count } = parseItem(bot, [cli.get, cli.count])
    return { name: `get ${count} ${item}`, run: (signal) => obtain(bot, gather, item, count, opts(signal)) }
  }
  return null
}

bot.on('kicked', (reason) => log('Kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason)))
bot.on('error', (err) => {
  log('Error:', err.message)
  if (err.code === 'ECONNREFUSED') log('Is the server running? Try: npm run server:start')
})
bot.on('end', (reason) => {
  log(`Disconnected (${reason})`)
  process.exit(process.exitCode ?? 0)
})
