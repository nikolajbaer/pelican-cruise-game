# Pelican Glide

A small, relaxing web game: fly a pelican along an endless beach break and ride the air pushed up in front of
the incoming waves. Built for a phone held in one hand; works with a keyboard too.

- **Drag anywhere** to steer (a stick appears under your thumb): left and right bank, up climbs, down dives.
  Arrow keys or WASD on a keyboard.
- Let go and the pelican holds its height and flaps to cruise. It cannot crash.
- **Swoop low in front of a wave face**: the rising air becomes speed and the wings stop beating. Let go of the
  stick on a wave and the bird slides shoreward with it. Flying close to the water also costs less drag.
- The counter is the distance glided since the last wingbeat.

## Run

```
npm install
npm run dev        # then open the printed address
npm run build      # static site in dist/
npm run typecheck
npm test           # the sea and the flight model, without a browser
```

## Deploy

The page is TypeScript, so it has to be built; serving the repository as it is shows only the title. A push to
`main` builds it and publishes `dist/` to GitHub Pages (`.github/workflows/deploy.yml`). For that, the repository's
Settings > Pages > Source must be "GitHub Actions".

## How it is made

Three.js and a few shaders; no art or sound files.

- `src/waves.ts`: the sea and the shore as functions of place and time, written once in TypeScript (the flight
  model reads the water's height and how fast it is rising) and once in GLSL (the meshes are displaced and shaded
  by the same formulas). Swell lines have peaks and shoulders along their length, steepen toward the depth where
  they break, break first at the peak, and run in as a bore.
- `src/scene.ts`: sky, sea, beach and dune grass. Four draw calls, each one mesh that follows the pelican.
- `src/flight.ts`: the flight model (no rendering, so it runs in the test).
- `src/bird.ts`, `src/audio.ts`, `src/main.ts`: the pelican, the synthesised wind and surf, and the page (touch
  stick, chase camera, HUD).

About nine draw calls and 160k triangles. The pixel ratio is capped at 2 and steps down on a device that cannot
keep up.
