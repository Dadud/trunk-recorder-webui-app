# Usage Guide

## Recommended flow

### 1. Open Home
Use the Home page to see:
- whether setup is complete
- whether the config looks valid
- what to do next

### 2. Run Quick Setup
Use **Setup** if you want the fastest path.

Recommended starting point:
- **RTL-SDR + P25** for common simple setups
- **RTL-SDR + SmartNet / analog** when your system needs analog-focused defaults

### 3. Review Configuration
Open **Configuration** to refine:
- global settings
- radio sources
- radio systems
- analog and digital channel counts

### 4. Edit Talkgroups & Tags
Use **Talkgroups & Tags** to edit:
- talkgroups CSV
- unit tags CSV

For talkgroups, the `Mode` column can be used for:
- `D` = digital
- `A` = analog

### 5. Start services
Open **Runtime** and:
- start services
- review status
- check recent logs

## Pages

### Home
Small overview and setup checklist.

### Setup
Guided first-run experience.

### Configuration
Structured editor for Trunk Recorder config.

### Talkgroups & Tags
Per-system CSV editing.

### Runtime
Service controls and recent logs.

### Raw Config
Power-user escape hatch.

## Analog workflows

The UI supports analog-related setup in a few places:
- **Default call mode** can be set to `analog`
- sources expose **analog channel** count
- SmartNet template is available
- talkgroup CSV supports analog `Mode` values

## Notes

This project is intentionally small and simple.
If you need a setting that is not exposed cleanly yet, use **Raw Config**.

## Screenshot status

Real screenshots are still pending.

The intended capture set is documented in `docs/SCREENSHOTS.md`, but the current browser-control path on the VM was unstable during screenshot capture. The docs are intentionally honest about that instead of showing fake or outdated images.
