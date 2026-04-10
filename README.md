# pretext-playground

A playground for experimenting with [`@chenglou/pretext`](https://github.com/chenglou/pretext).

## Demos

- **Cursor Repulsion** — text characters scatter away from the mouse cursor
- **Hand Repulsion** — same effect driven by hand tracking via MediaPipe

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- [`@chenglou/pretext`](https://github.com/chenglou/pretext)
- [`@mediapipe/tasks-vision`](https://ai.google.dev/edge/mediapipe/solutions/vision/overview) for hand tracking

## Setup

> **Note:** The project uses [PP Neue Montreal](https://pangrampangram.com/products/neue-montreal), a licensed typeface. You need to supply the font files yourself and place them in `public/fonts/`:
> - `PPNeueMontreal-Regular.woff`
> - `PPNeueMontreal-Regular.woff2`

```bash
npm install
npm run dev
```
