// Settings, read from environment variables (or a .env file, see .env.example).

// The newest version Mineflayer supports that runs on Java 21.
// Your Minecraft client and the server must both be on this version.
export const MC_VERSION = process.env.MC_VERSION ?? '1.21.11'

export const config = {
  // 127.0.0.1 rather than "localhost": Node may resolve localhost to IPv6,
  // which a server listening on 127.0.0.1 won't answer.
  host: process.env.MC_HOST ?? '127.0.0.1',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USERNAME ?? 'Endeavor',
  version: MC_VERSION,
  // 'offline' works with the local server (online-mode=false).
  // Use 'microsoft' to log in with a real account on other servers.
  auth: process.env.MC_AUTH ?? 'offline',
  // If set, the bot only takes chat commands from this player.
  owner: process.env.BOT_OWNER || null
}
