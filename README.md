# trunk-recorder-webui

A super lightweight Web UI for configuring and running [Trunk Recorder](https://github.com/TrunkRecorder/trunk-recorder) in Docker.

## Goals
- very easy first-time setup
- setup wizard for the common path
- advanced editor for every Trunk Recorder option
- lightweight runtime with minimal moving parts
- docker compose deployment

## UX design
- **Setup Wizard** for first boot
  - recording location
  - SDR source setup
  - system type + control channels
  - logging / upload options
  - generated `config.json`
- **Advanced Config**
  - full JSON editor
  - form-based editing for global, sources, systems, plugins
- **Operations**
  - start / stop / restart stack
  - logs view
  - config validation

## Planned architecture
- small Node server
- server-rendered HTML + tiny vanilla JS
- file-backed config storage
- Docker Compose for `trunk-recorder` + `webui`

## Status
Initial real scaffold in progress.
