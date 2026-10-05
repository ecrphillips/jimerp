# Pack tab completion and WIP states

## Build
- Replace line status labels with counts: `0 / needed`, and `Complete packed / needed` once fully covered.
- Give not-started, partly completed, and fully completed lines clearly distinct treatments while preserving urgent and grind warnings.
- Strengthen the three WIP readiness treatments: enough WIP, some WIP, and no WIP.
- Calculate completion for every nested drawer and show its packed-versus-needed total in the drawer heading.
- When a fully completed drawer is closed, fade it and move it below unfinished drawers at the same level.

## Technical details
- Reuse the existing authoritative packed, picked, demand, and WIP maps so display states remain aligned with pack inventory logic.
- Keep completed drawers in place while open; apply demotion only through the close interaction.
- Validate the preview and run the relevant checks after implementation.
