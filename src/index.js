// Starts the bot: connects to the server, loads plugins, turns on survival
// reflexes, and listens for chat commands.
//
//   npm start                              join and wait for chat commands
//   npm start -- --auto                    play on its own (reconnects if dropped)
//   npm start -- --get stone_pickaxe       do one job as soon as it spawns
//   npm start -- --wood 10 --exit          chop 10 logs, then disconnect

import { parseArgs } from 'node:util'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import collectBlockPkg from 'mineflayer-collectblock'
import { config } from './config.js'
import { createMovements } from './movement.js'
import { buildGatherData } from './planner/sources.js'
import { TaskRunner } from './tasks.js'
import { Reflexes } from './survival/reflexes.js'
import { Brain } from './brain/brain.js'
import { createCommandHandler, parseItem } from './commands.js'
import { collect } from './skills/collect.js'
import { obtain } from './skills/obtain.js'
import { countItem, inventorySummary } from './skills/inventory.js'

const { pathfinder } = pathfinderPkg

const { values: cli } = parseArgs({
  options: {
    auto: { type: 'boolean', default: false }, // play on its own
    get: { type: 'string' }, // e.g. --get stone_pickaxe
    count: { type: 'string', default: '1' },
    wood: { type: 'string' }, // e.g. --wood 10
    exit: { type: 'boolean', default: false } // disconnect when the job is done
  }
})

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args)

// Survives reconnects, unlike the bot object.
const state = {
  auto: cli.auto,
  quitting: false,
  startupJobDone: false
}

function connect () {
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
  const say = (text) => {
    log(`[chat] ${text}`)
    for (let i = 0; i < text.length; i += 250) bot.chat(text.slice(i, i + 250))
  }

  bot.once('spawn', async () => {
    // The world arrives in chunks after spawning; look around only once it's here.
    await bot.waitForChunksToLoad()

    bot.pathfinder.setMovements(createMovements(bot))
    // Ore is often 30+ blocks down; give the pathfinder longer to plan a dig route.
    bot.pathfinder.thinkTimeout = 10_000
    // collectBlock brings its own movement settings, which allow breaking
    // blocks next to lava. Without them it uses ours.
    bot.collectBlock.movements = null

    const gather = buildGatherData(bot.registry)
    const tasks = new TaskRunner(bot, { log, say })
    const brain = new Brain(bot, { gather, log, say })
    new Reflexes(bot, { tasks, log }).start()

    const playOnMyOwn = () => tasks.run('play on my own', (signal) => brain.run(signal))
    const setAuto = (on) => {
      state.auto = on
      if (on) playOnMyOwn()
    }
    // After a chat job finishes, go back to playing if we were.
    const afterJob = () => { if (state.auto && !tasks.busy) playOnMyOwn() }

    bot.on('chat', createCommandHandler(bot, { gather, tasks, brain, config, log, say, setAuto, afterJob }))
    bot.on('death', () => {
      say('I died!')
      tasks.stop()
    })
    // Mineflayer respawns automatically; 'spawn' fires again when it does.
    bot.on('spawn', () => { if (state.auto) playOnMyOwn() })

    const { x, y, z } = bot.entity.position.floored()
    log(`Spawned at ${x} ${y} ${z}. Type !help in game chat.`)

    if (state.auto) {
      say("I'm playing on my own. Type !auto off to stop, or !status to see what I'm doing.")
      playOnMyOwn()
    } else if (!state.startupJobDone) {
      state.startupJobDone = true
      runStartupJob(bot, gather, tasks, say)
    }
  })

  bot.on('kicked', (reason) => log('Kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason)))
  bot.on('error', (err) => {
    log('Error:', err.message)
    if (err.code === 'ECONNREFUSED') log('Is the server running? Try: npm run server:start')
  })
  bot.on('end', (reason) => {
    log(`Disconnected (${reason})`)
    if (state.auto && !state.quitting) {
      log('Reconnecting in 10 seconds...')
      setTimeout(connect, 10_000)
    } else {
      process.exit(process.exitCode ?? 0)
    }
  })
}

// --get / --wood from the command line.
function runStartupJob (bot, gather, tasks, say) {
  const opts = (signal) => ({ signal, log, say })
  let job = null
  try {
    if (cli.wood) {
      const count = Number(cli.wood)
      const target = countItem(bot, gather.logs) + count
      job = {
        name: `chop ${count} logs`,
        run: (signal) => collect(bot, gather, gather.logs, Math.max(0, target - countItem(bot, gather.logs)), opts(signal))
      }
    } else if (cli.get) {
      const { item, count } = parseItem(bot, [cli.get, cli.count])
      job = { name: `get ${count} ${item}`, run: (signal) => obtain(bot, gather, item, count, opts(signal)) }
    }
  } catch (err) {
    log(err.message)
    if (cli.exit) quit(bot, 1)
    return
  }
  if (!job) return

  process.exitCode = 1 // until the job finishes; a disconnect midway counts as a failure
  tasks.run(job.name, job.run).then((ok) => {
    log(`Inventory: ${inventorySummary(bot)}`)
    if (cli.exit) quit(bot, ok ? 0 : 1)
  })
}

function quit (bot, code) {
  state.quitting = true
  process.exitCode = code
  bot.quit()
}

connect()
