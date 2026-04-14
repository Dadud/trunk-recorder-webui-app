# Architecture

## Design goals

- very lightweight
- easy to self-host
- easy to understand
- minimal frontend complexity
- wizard-first, but not locked down

## Current stack

- **Node.js + Express**
- server-rendered HTML
- tiny inline CSS
- JSON file storage for `config/config.json`
- CSV file editing for talkgroups and unit tags
- Docker Compose for Trunk Recorder + Web UI

## Why this approach

This project is intentionally not using a heavy SPA stack.

Reasons:
- faster iteration
- fewer moving parts
- lower memory use
- easier to maintain on small self-hosted machines
- simpler deploy story

## Main pages

- **Home**
- **Setup**
- **Configuration**
- **Runtime**
- **Talkgroups & Tags**
- **Raw Config**

## Data model

Primary config file:
- `config/config.json`

Per-system helper files:
- `talkgroups*.csv`
- `unit-tags*.csv`

## Runtime model

Runtime actions currently shell out to:
- `docker compose up -d`
- `docker compose restart`
- `docker compose down`
- `docker compose ps`
- `docker compose logs --tail=...`

## Future direction

- stronger validation rules
- packaged image build
- recordings browser
- better service-level health info
- import/export helpers
