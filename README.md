# trunk-recorder-webui

A lightweight Web UI for configuring and running [Trunk Recorder](https://github.com/TrunkRecorder/trunk-recorder) with Docker.

It is designed to feel like a small self-hosted appliance UI, not a giant dashboard.

## What it does

- guided **Quick Setup** flow
- lightweight **Configuration** editor for Trunk Recorder settings
- support for **digital and analog** workflows
- **Talkgroups & Tags** CSV editing
- **Runtime** page with service controls and logs
- **Raw Config** editing for power users

## Current features

### Setup
- template-based quick start
- RTL-SDR + P25 template
- Airspy + P25 template
- USRP + P25 template
- RTL-SDR + SmartNet / analog template

### Configuration
- global settings
- multi-source editing
- multi-system editing
- digital + analog channel settings
- control channels, modulation, squelch, CSV file paths

### Files
- per-system talkgroups CSV editing
- per-system unit tags CSV editing
- analog-friendly `Mode` editing (`A` / `D`)

### Runtime
- start / restart / stop services
- docker compose service status
- recent logs in the UI

## UI structure

Top-level navigation is intentionally small:

- **Home**
- **Setup**
- **Configuration**
- **Runtime**
- **Talkgroups & Tags**

`Raw Config` is still available, but intentionally de-emphasized.

## Screenshots

Screenshots are documented in `docs/SCREENSHOTS.md`.

Real captures are still pending. The current VM/browser-control path proved unstable during capture work, so the repo documents the intended screenshot set honestly instead of pretending they already exist.

## Local development

### Requirements
- Node.js 22+
- Docker + Docker Compose

### Run locally

```bash
npm install
node app/server.js
```

Then open:

```text
http://localhost:8080
```

## Docker Compose

```yaml
services:
  trunk-recorder:
    image: robotastic/trunk-recorder:latest
    container_name: trunk-recorder
    restart: unless-stopped
    volumes:
      - ./data/recordings:/recordings
      - ./config:/config
    command: ["--config=/config/config.json"]

  webui:
    image: node:22-alpine
    container_name: trunk-recorder-webui
    restart: unless-stopped
    working_dir: /app
    command: sh -c "npm install && npm start"
    ports:
      - "8080:8080"
    volumes:
      - ./:/app
```

Start the stack:

```bash
docker compose up -d
```

## Project goals

- keep the UI **super lightweight**
- make first setup **easy**
- keep advanced configuration **available**
- support both **analog** and **digital** Trunk Recorder workflows
- stay easy to self-host and hack on

## MVP status

This project is at a usable MVP stage now:
- guided setup works
- analog and digital flows are both represented
- structured config editing is in place
- talkgroup and unit-tag CSV editing works
- runtime controls and logs are available

The main unfinished item from the current pass is real screenshots.

## Roadmap

Priority order:
- real screenshots
- stronger validation by system type
- packaged image for the web UI
- recordings browser
- import/export helpers
- better visual polish

## Trunk Recorder reference

This project is a companion UI for:
- <https://github.com/TrunkRecorder/trunk-recorder>

Local reference docs are stored in:
- `refs/TRUNKRECORDER_CONFIGURE.md`
- `refs/TRUNKRECORDER_INSTALL_DOCKER.md`
