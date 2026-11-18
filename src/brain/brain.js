// The brain: when the bot plays on its own, keep doing the most important
// goal that isn't done yet. Survival reflexes (fighting, eating) interrupt
// it as needed; afterwards the brain just picks up again.

import { buildGoals } from './goals.js'
import { sleep } from '../util.js'

const GOAL_TIME_LIMIT_MS = 10 * 60_000 // give up on a goal that takes longer than this
const FIRST_RETRY_MS = 30_000
const MAX_RETRY_MS = 5 * 60_000
const PRIORITY_CHECK_MS = 2000 // how often to check whether something more important came up

export class Brain {
  /** @param opts.goals - override the goal list (used by the tests) */
  constructor (bot, { gather, log, say, goals }) {
    this.bot = bot
    this.log = log
    this.say = say
    this.goals = goals ?? buildGoals(bot, { gather, log, say })
    this.failures = new Map() // goal name -> { count, retryAt }
    this.current = null
  }

  /** The goal to work on now, or null if everything is done (or waiting to retry). */
  next () {
    const now = Date.now()
    return this.goals.find((g) => !g.isDone() && !(this.failures.get(g.name)?.retryAt > now)) ?? null
  }

  /** Runs until the signal aborts. Restarting it is safe: it just re-checks the goals. */
  async run (signal) {
    let idleSaid = false
    while (true) {
      signal.throwIfAborted()
      const goal = this.next()
      if (!goal) {
        if (!idleSaid) this.say("I've done everything I know how to do for now.")
        idleSaid = true
        await sleep(10_000, signal)
        continue
      }
      idleSaid = false
      if (this.current !== goal.name) this.say(`Next: ${goal.name}`)
      this.current = goal.name
      await this.attempt(goal, signal)
    }
  }

  async attempt (goal, signal) {
    // Each goal gets a time limit, so one that's stuck doesn't stall everything.
    // And if something more important comes up (night falls, we get hungry),
    // drop this goal for now: the loop will pick the more important one.
    const switchTo = new AbortController()
    const goalSignal = AbortSignal.any([signal, switchTo.signal, AbortSignal.timeout(GOAL_TIME_LIMIT_MS)])
    const rank = this.goals.indexOf(goal)
    const watcher = setInterval(() => {
      // Done some other way (picked one up, someone gave it to us)? Move on.
      if (goal.isDone()) {
        clearInterval(watcher)
        switchTo.abort()
        return
      }
      const next = this.next()
      if (next && this.goals.indexOf(next) < rank) {
        clearInterval(watcher)
        this.say(`Dropping "${goal.name}" for now: ${next.name}`)
        switchTo.abort()
      }
    }, PRIORITY_CHECK_MS)
    const stopMoving = () => {
      if (signal.aborted) return
      this.bot.pathfinder.stop()
      this.bot.collectBlock.cancelTask().catch(() => {})
    }
    goalSignal.addEventListener('abort', stopMoving, { once: true })
    try {
      await goal.run(goalSignal)
      this.failures.delete(goal.name)
    } catch (err) {
      if (signal.aborted) throw err // stopped or interrupted by a reflex: not the goal's fault
      if (switchTo.signal.aborted) return // set aside for something more important: not a failure
      const reason = goalSignal.aborted ? 'it was taking too long' : err.message
      const f = this.failures.get(goal.name) ?? { count: 0 }
      f.count++
      const wait = goal.retryAfterMs ?? Math.min(FIRST_RETRY_MS * 2 ** (f.count - 1), MAX_RETRY_MS)
      f.retryAt = Date.now() + wait
      this.failures.set(goal.name, f)
      this.say(`Couldn't ${goal.name} (${reason}). I'll come back to it in ${Math.round(wait / 1000)}s.`)
      this.log(err.stack)
    } finally {
      clearInterval(watcher)
      goalSignal.removeEventListener('abort', stopMoving)
    }
  }

  /** A one-line status for chat. */
  status () {
    const done = this.goals.filter((g) => g.milestone && g.isDone()).map((g) => g.label)
    const next = this.next()
    return `Working on: ${next?.name ?? 'nothing'}. Done: ${done.join(', ') || 'nothing yet'}.`
  }
}
