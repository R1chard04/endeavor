// Small async helpers shared by the skills.

/** Wait `ms` milliseconds, or stop early (with an error) if the signal aborts. */
export function sleep (ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    function done () {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort () {
      clearTimeout(timer)
      reject(signal.reason)
    }
  })
}

/**
 * Resolve once check() is true, checking every game tick. Resolves false
 * after the timeout instead of throwing: callers decide whether that's bad.
 */
export function waitFor (bot, check, timeoutMs = 2000) {
  if (check()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer)
      bot.removeListener('physicsTick', onTick)
      resolve(result)
    }
    const onTick = () => { if (check()) finish(true) }
    const timer = setTimeout(() => finish(false), timeoutMs)
    bot.on('physicsTick', onTick)
  })
}
