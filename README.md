# G2 Car Nav

Turn-by-turn **car navigation** plugin for the [Even Realities G2](https://www.evenrealities.com) smart glasses.

## Try it on your glasses

Scan with the Even Realities app:

<p align="center">
  <img src="qr.png" width="180" alt="QR code to load G2 Car Nav" /><br/>
  <a href="https://marioduartelanseros-eng.github.io/g2-car-nav/">marioduartelanseros-eng.github.io/g2-car-nav</a>
</p>

## Features

- **Driving routes** via OSRM (free, no API key)
- **Geocoding** via Nominatim / OpenStreetMap (free, no API key)
- **Live GPS tracking** — auto-advances steps as you drive
- **Distance & ETA** updated in real time on the glasses

## G2 Gestures

| Gesture | Action |
|---|---|
| Swipe Up | Preview next step |
| Swipe Down | Go back a step |
| Press | Return to live view |
| Double Press | Recalculate route |

## Local development

```bash
npm install
npm run dev        # Vite dev server
npm run simulate   # G2 simulator (separate terminal)
```
