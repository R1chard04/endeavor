// Swimming. The pathfinder swims (holds jump) while it's following a path,
// but when the bot stands still in water (fighting, eating, waiting
// between jobs) nothing keeps it up: it sinks to the bottom and starts to
// drown. Like a player holding space, keep it at the surface.

/** Hold jump whenever the bot is in water and nothing else is steering it. */
export function keepAfloat (bot) {
  let floating = false
  bot.on('physicsTick', () => {
    const shouldFloat = Boolean(bot.entity?.isInWater) && !bot.pathfinder.isMoving() && !bot.isSleeping
    if (shouldFloat) {
      floating = true
      bot.setControlState('jump', true)
    } else if (floating) {
      // Let go only of the jump we pressed, once we're out of the water or the pathfinder takes over.
      floating = false
      if (!bot.pathfinder.isMoving()) bot.setControlState('jump', false)
    }
  })
}

/** Is this entity entirely under water (its head included)? */
export function isSubmerged (bot, entity) {
  const head = entity.position.offset(0, (entity.height ?? 1.8) * 0.9, 0)
  return bot.blockAt(head)?.name === 'water'
}

// Floating at the surface, the bot can still hit things about this far below it.
const REACH_BELOW_SURFACE = 2.5

/** Can the bot get at this mob, or is it out of reach under the water? */
export function reachableInWater (bot, entity) {
  return !(isSubmerged(bot, entity) && entity.position.y < bot.entity.position.y - REACH_BELOW_SURFACE)
}
