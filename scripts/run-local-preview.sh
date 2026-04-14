#!/usr/bin/env bash
set -euo pipefail
cd /home/dadud/.openclaw/workspace/trunk-recorder-webui
npm install >/tmp/trunk-webui-npm.log 2>&1
exec node app/server.js
