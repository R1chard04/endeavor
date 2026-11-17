// Runs one task at a time and lets `!stop` cancel it.
//
// Every task gets an AbortSignal. Long-running skills check it between
// steps, and stop() also halts walking and digging right away.
//
// Survival reflexes can *preempt* a task: the task is stopped, the reflex
// runs (fight, eat, get out of lava), and then the task starts again. That
// works because tasks replan from scratch, so restarting one just picks up
// where it left off.

const STOP_TIMEOUT_MS = 5000

export class TaskRunner {
  constructor (bot, { log, say }) {
    this.bot = bot
    this.log = log
    this.say = say
    this.current = null
    this.pending = null // a task waiting for the current one to stop
    this.interrupted = null // a task a reflex stopped, to restart afterwards
  }

  get busy () {
    return this.current !== null
  }

  /**
   * Start a task, stopping whatever was running before.
   * Resolves to true if the task finished, false if it failed or was stopped.
   */
  async run (name, fn, { quiet = false } = {}) {
    this.interrupted = null // a new job replaces anything waiting to resume
    return this.#start({ name, fn, quiet, reflex: false, priority: 0 })
  }

  /**
   * Run a reflex now, then resume whatever it interrupted.
   * A reflex only interrupts another reflex of lower priority.
   */
  async preempt (name, fn, priority) {
    const current = this.current
    if (current?.reflex && current.priority >= priority) return false
    if (current && !current.reflex) this.interrupted = current
    const ok = await this.#start({ name, fn, quiet: true, reflex: true, priority })

    // Resume the interrupted job, unless something else has started (or is starting) meanwhile.
    if (!this.current && !this.pending && this.interrupted) {
      const job = this.interrupted
      this.interrupted = null
      this.log(`Resuming: ${job.name}`)
      this.#start({ ...job, controller: undefined })
    }
    return ok
  }

  /** Stop the current task (and forget anything waiting to resume). */
  async stop () {
    this.interrupted = null
    await this.#halt()
  }

  async #start (task) {
    this.pending = task
    if (this.current) await this.#halt()
    if (this.pending !== task) return false // another task started while we waited
    this.pending = null
    task.controller = new AbortController()
    this.current = task
    task.done = this.#execute(task)
    return task.done
  }

  async #halt () {
    const task = this.current
    if (!task) return
    task.controller.abort()
    this.bot.pathfinder.stop()
    this.bot.pathfinder.setGoal(null)
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint']) {
      this.bot.setControlState(control, false)
    }
    try { this.bot.stopDigging() } catch {}
    await this.bot.collectBlock.cancelTask().catch(() => {})
    // Let the task notice and unwind before anything else starts.
    await Promise.race([task.done, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
  }

  async #execute (task) {
    const tell = task.quiet ? this.log : this.say
    this.log(`${task.reflex ? 'Reflex' : 'Task'} started: ${task.name}`)
    try {
      await task.fn(task.controller.signal)
      tell(`Done: ${task.name}`)
      return true
    } catch (err) {
      if (task.controller.signal.aborted) {
        this.log(`Stopped: ${task.name}`)
      } else {
        tell(`I couldn't finish "${task.name}": ${err.message}`)
        this.log(err.stack)
      }
      return false
    } finally {
      if (this.current === task) this.current = null
    }
  }
}
