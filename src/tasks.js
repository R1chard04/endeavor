// Runs one task at a time and lets `!stop` cancel it.
//
// Every task gets an AbortSignal. Long-running skills check it between
// steps, and stop() also halts walking and digging right away.

const STOP_TIMEOUT_MS = 5000

export class TaskRunner {
  constructor (bot, { log, say }) {
    this.bot = bot
    this.log = log
    this.say = say
    this.current = null
  }

  get busy () {
    return this.current !== null
  }

  /**
   * Start a task, stopping whatever was running before.
   * Resolves to true if the task finished, false if it failed or was stopped.
   */
  async run (name, fn) {
    if (this.current) await this.stop()
    const task = { name, controller: new AbortController() }
    this.current = task
    task.done = this.#execute(task, fn)
    return task.done
  }

  async stop () {
    const task = this.current
    if (!task) return
    task.controller.abort()
    this.bot.pathfinder.stop()
    try { this.bot.stopDigging() } catch {}
    await this.bot.collectBlock.cancelTask().catch(() => {})
    // Let the task notice and unwind before anything else starts.
    await Promise.race([task.done, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
  }

  async #execute (task, fn) {
    this.log(`Task started: ${task.name}`)
    try {
      await fn(task.controller.signal)
      this.say(`Done: ${task.name}`)
      return true
    } catch (err) {
      if (task.controller.signal.aborted) {
        this.log(`Task stopped: ${task.name}`)
      } else {
        this.say(`I couldn't finish "${task.name}": ${err.message}`)
        this.log(err.stack)
      }
      return false
    } finally {
      if (this.current === task) this.current = null
    }
  }
}
