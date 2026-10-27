## Why

Owner request, 2026-10-10: "use the assets in pulse-ui-kit.zip to update UI in our new dev environment so we can test and continue to build; we will then push to live when ready." The kit (`docs/design/pulse-ui-kit/`) defines a hardware UI: machined chassis cards on a stack of slabs, recessed wells for data, physical keys, Pulse yellow (#FFC900) as the indicator light, Archivo + JetBrains Mono, rolling digits for changing figures.

## What Changes

Built on staging (`develop`) in slices, each reviewed on https://develop--studiopulse-staging.netlify.app before the next; promoted to production only when the owner says ship.

1. **Foundation:** kit tokens mapped onto the app's own token names, Archivo, chassis Card, key Button, chip Badge, solid graphite instead of glass, yellow focus ring. Scoped to the app shell and agency console (`.pulse-hw`); marketing pages unchanged. Staging-only `/ui-lab` gallery.
2. **Shell:** sidebar and top bar as chassis with LEDs and the pushed-in active item; corner brackets.
3. **Studio overview** per the mockup (live session hero, KPI StatTiles, revenue chart, room utilization, Pulse AI card, sessions table, deposits feed).
4. **Bookings** and **Invoices and splits** per the mockups.
5. **Live data:** Ticker rolling digits, boot sequence on hero chassis, Bklit charts in wells, no content-replacing spinners; contrast and focus pass (kit section 8).

## Non-goals (for now)

- The marketing site (/, /pricing, /vs) keeps its design.
- Light theme: the kit is dark only; inside the app shell light mode is ignored.
- The iOS app (`PulseUI.swift`) is a separate rollout in `pulse-native`.
