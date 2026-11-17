#!/bin/sh
# Starts the local test server in ./server. Type "stop" to shut it down.
set -e
cd "$(dirname "$0")/../server" 2>/dev/null || {
  echo "No server yet. Run: npm run server:setup"
  exit 1
}

if [ ! -f server.jar ]; then
  echo "No server.jar yet. Run: npm run server:setup"
  exit 1
fi

if ! grep -q '^eula=true' eula.txt 2>/dev/null; then
  echo "The server needs you to accept the Minecraft EULA first:"
  echo "read https://aka.ms/MinecraftEULA, then set eula=true in server/eula.txt"
  exit 1
fi

exec java -Xms1G -Xmx2G -jar server.jar nogui
