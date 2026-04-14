# trunk-recorder-webui

Dockerized Trunk Recorder stack with a web UI for viewing status and managing configuration.

## Goals
- Run Trunk Recorder in Docker
- Provide a browser-based UI for:
  - viewing recorder status
  - editing configuration
  - managing talkgroups / sources
  - inspecting logs and recent activity
- Keep the setup self-hostable and easy to extend

## Planned stack
- `trunk-recorder` container
- lightweight web UI container
- docker compose for local deployment

## Status
Scaffold in progress.
