# Warcon local customizations

These patches are local changes applied on this LXC and must be reviewed/re-applied after upstream updates.

Patch file:

```bash
/opt/warcon/local-patches/warcon-local-customizations.patch
```

## Included changes

1. Config form: add `RestartTimeUtc` as a time input for section `[/Script/WDGame.WDServerLifecycleSubsystem]`.
   - Files: `src/lib/config-fields.ts`, `src/lib/components/ConfigForm.svelte`

2. Analytics/overview colors: add WARDOGS faction fallback colors.
   - File: `src/lib/format.ts`
   - Lonestar blue, Valkyra red, Manticore green, White gray.

3. Overview Cash in Play: add Match/30m/15m/5m/2m window buttons.
   - File: `src/routes/(app)/server/[id]/+page.svelte`
   - Loads missing cash history from `/api/servers/:id/cash`.
   - Filters current match from the latest 0$→positive-cash segment.
   - Removes empty 0$ samples from the chart.

4. Automation delivery log: raise API result limit from 40 to 200.
   - File: `src/routes/api/servers/[id]/outbox/+server.ts`

5. Automation delivery log: do not retain completed Welcome whisper outbox rows.
   - File: `src/lib/server/outbox.ts`
   - Pending/sending rows remain durable until delivery finishes.

## Re-apply after upstream update

```bash
cd /opt/warcon
git apply --check local-patches/warcon-local-customizations.patch
git apply local-patches/warcon-local-customizations.patch
bun run build
systemctl restart warcon
curl -sf http://127.0.0.1:3000/api/health
```

If `git apply --check` fails, inspect upstream changes in the listed files and port the hunks manually.
