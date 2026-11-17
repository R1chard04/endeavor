// Downloads the official Minecraft server from Mojang into ./server and
// writes settings for a local test world the bot can join.
//
//   npm run server:setup
//
// The server only listens on this computer (127.0.0.1) and runs in offline
// mode, so the bot can join without its own Minecraft account.

import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MC_VERSION } from '../src/config.js'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')

const SERVER_PROPERTIES = `# Written by scripts/setup-server.js: a test world for the bot.
# Only reachable from this computer. Offline mode lets the bot join without an account,
# so don't open this server to the internet.
server-ip=127.0.0.1
server-port=25565
online-mode=false
gamemode=survival
difficulty=peaceful
spawn-protection=0
motd=Bot test world
max-players=5
view-distance=8
simulation-distance=8
`

const EULA = `# The Minecraft server needs you to accept the Minecraft EULA: https://aka.ms/MinecraftEULA
# Read it, and if you agree, change the line below to eula=true
eula=false
`

async function main () {
  await mkdir(serverDir, { recursive: true })
  const jarPath = join(serverDir, 'server.jar')

  const manifest = await fetchJson(MANIFEST_URL)
  const entry = manifest.versions.find((v) => v.id === MC_VERSION)
  if (!entry) throw new Error(`Mojang has no Minecraft version called ${MC_VERSION}`)
  const { downloads } = await fetchJson(entry.url)
  const { url, sha1, size } = downloads.server

  if (existsSync(jarPath) && sha1Of(await readFile(jarPath)) === sha1) {
    console.log(`server.jar for ${MC_VERSION} is already downloaded`)
  } else {
    console.log(`Downloading Minecraft ${MC_VERSION} server (${(size / 1e6).toFixed(0)} MB) from Mojang...`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    const jar = Buffer.from(await res.arrayBuffer())
    if (sha1Of(jar) !== sha1) throw new Error('Downloaded server.jar is corrupt (checksum mismatch)')
    await writeFile(jarPath, jar)
    console.log('Saved server/server.jar')
  }

  await writeIfMissing(join(serverDir, 'server.properties'), SERVER_PROPERTIES)
  await writeIfMissing(join(serverDir, 'eula.txt'), EULA)

  const eula = await readFile(join(serverDir, 'eula.txt'), 'utf8')
  if (!/^eula=true/m.test(eula)) {
    console.log('\nOne more step: read https://aka.ms/MinecraftEULA and, if you agree,')
    console.log('set eula=true in server/eula.txt. Then run: npm run server:start')
  } else {
    console.log('\nReady. Run: npm run server:start')
  }
}

async function fetchJson (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't fetch ${url}: HTTP ${res.status}`)
  return res.json()
}

function sha1Of (buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

async function writeIfMissing (path, text) {
  if (existsSync(path)) return
  await writeFile(path, text)
  console.log(`Wrote ${path.slice(serverDir.length - 'server'.length)}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
