# UI refinement notes

Based on the current product direction and the goal of keeping the app tiny, friendly, and wizard-first.

## Recommended simplified information architecture

Primary nav only:
- Home
- Setup
- Configuration
- Runtime
- Files

Move these out of top-level prominence:
- Advanced JSON should be a secondary link inside Configuration
- Logs should live under Runtime
- Templates should live inside Setup, not the main nav

## Product direction

The app should feel like:
- a small appliance UI
- not a cloud dashboard
- not a dev tool with too many tabs

That means:
- fewer top-level pages
- stronger defaults
- more guided sequencing
- clearer separation between beginner and expert actions

## Recommended page model

### Home
Purpose:
- answer "is it set up?"
- answer "is it running?"
- answer "what should I do next?"

Show:
- setup completeness
- config validity
- container status
- quick actions

### Setup
Purpose:
- first-run guided flow

Steps:
1. Choose a template
2. Add radio source
3. Add radio system
4. Set storage and logging
5. Review and save

### Configuration
Purpose:
- structured editing after setup

Sections:
- General
- Sources
- Systems
- Uploads / integrations
- Advanced JSON (collapsed / secondary)

### Files
Purpose:
- edit CSV helpers

Sections:
- Talkgroups
- Unit tags
- import/export hints
- analog mode explanation

### Runtime
Purpose:
- operate the service

Sections:
- service health
- start/restart/stop
- recent logs
- last error state

## MVP priorities

1. Reduce top-level navigation clutter
2. Make Setup a true multi-step flow, not one long page
3. Make Configuration sectioned and easier to scan
4. Put analog choices next to mode-dependent fields, not buried
5. Add better empty states and inline help
6. Keep Advanced JSON but visually de-emphasize it

## Microcopy suggestions

Replace:
- "Setup Wizard" -> "Quick Setup"
- "Configurator" -> "Configuration"
- "CSV Files" -> "Talkgroups & Tags"
- "Advanced JSON" -> "Raw Config"
- "Status" -> "Runtime"
- "Logs" -> "Recent Logs"

Wizard section labels:
- "Choose your setup"
- "Radio source"
- "System details"
- "Storage and logging"
- "Review config"

Field labels:
- "Center frequency (Hz)" -> "Center frequency"
- "Rate" -> "Sample rate"
- "Digital recorders" -> "Digital channels"
- "Analog recorders" -> "Analog channels"
- "Default mode" -> "Default call mode"
- "Control channels" -> "Control channel frequencies"
- "Talkgroups file" -> "Talkgroups CSV"
- "Unit tags file" -> "Unit tags CSV"

Helper text examples:
- "Use analog if this system carries analog voice traffic by default."
- "Add one or more always-on control channel frequencies."
- "Start with a template if you want the easiest path."
- "Raw Config is for power users. Most setups should not need it."

## Visual direction

Go for:
- soft neutral background
- one accent color only
- card-based layout
- generous spacing
- compact forms, not crowded forms
- strong section headings
- subtle status chips

Avoid:
- sidebar-heavy admin dashboard feel
- too many button styles
- dense tables as the default interaction
- giant walls of form fields without grouping

## Concrete next UI changes

1. Rename pages using friendlier language
2. Merge Logs into Runtime page
3. Turn Setup into 4 to 5 smaller cards or steps
4. Move templates into Setup header area
5. Move Raw Config into Configuration page footer
6. Make Talkgroups & Tags page explain analog mode values clearly
7. Add "recommended" badges on templates
8. Add a home-page checklist like:
   - choose template
   - configure source
   - configure system
   - review talkgroups
   - start services
