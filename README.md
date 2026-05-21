# 🎯 Tactical FPS (Competitive Browser Edition)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101)](https://socket.io/)

A high-fidelity, server-authoritative 128-tick tactical shooter that runs directly in the browser. Prioritizing precision, minimalist geometric neon aesthetics, and extreme responsiveness without the need for heavy engines like Unity or Unreal.

---

## ✨ Features & Recent Updates (v1.2.0)

This version brings monumental improvements to game stability, competitive integrity, and audiovisual immersion:

### 🛡️ Core Mechanics & Competitive Integrity
- **Server-Authoritative Physics:** Hard-locked movement during critical actions (like planting/defusing the Nuke) using server-side constraints.
- **Advanced Anti-Cheat:** Refactored Speed Hack detection logic utilizing velocity/time deltas with grace periods to accommodate legitimate physics interactions (like knife ice-skating) while logging anomalies accurately.
- **Input System Polish:** Fixed inputs freezing when the browser window loses focus or when interacting with UI elements like the scoreboard or buy menu.

### 🎥 Rendering & "Fog of War"
- **Visibility Polygons (Raycasting):** Completely replaced the old bugged shadow volumes. The map now uses perfect raycast-based evenodd visibility polygons to draw dynamic "Among Us style" vision cones. **Zero wall-leaking.**
- **Z-Index Rendering:** Fixed entities rendering *over* shadows by strictly separating the rendering layers (Entities -> Fog of War -> Ally Outlines).

### 🎵 Procedural Acoustic Engine
- **Client-Side Predictable Audio:** Footsteps and Nuke beeps are now decoupled from network events and calculated mathematically on the client using `Date.now()` and velocity data from snapshots. This completely eliminates audio stutter caused by network jitter.
- **Rich Sound Profiles:** Added dual-layered footsteps (scuff + thud), weapon mechanical clicks, a low-frequency ambient tension loop (55Hz drone), and a devastating sub-bass rumble for the Nuke explosion using pure WebAudio oscillators.
- **Dynamic Feedback:** A cyan neon arc effect triggers visually precisely when a knife swing audio event is registered.

### 💻 HUD & UX
- **Refined Overlays:** Match overlays (Attacker Win, Round Won) were adjusted vertically to prevent text overlapping and visual clutter.
- **Unified Site Bounds:** Bomb sites are no longer a mess of multiple bounding boxes. They are now mathematically unified single perimeters that glow neon only if you hold the Nuke.

---

## 🏗️ Architecture

The project is structured as a **Monorepo** using npm workspaces:

*   **`packages/client/`**: React, Zustand for state, and a highly optimized custom `Canvas2D` renderer.
*   **`packages/server/`**: Node.js, Socket.io, handling 128-tick server-authoritative physics, economy, and matchmaking.
*   **`packages/shared/`**: Single Source of Truth for types, constants, map structures, and weapon configurations.

---

## 🚀 Getting Started

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Start both client and server in development mode:**
    ```bash
    npm run dev
    ```
3.  Open `http://localhost:5173` in your browser.

---

## 🔮 Future Roadmap
The `PROJECT_SPEC.md` contains an extensive technical diary and refactoring plans. Upcoming priorities include dropping physical weapons on the ground, creating a robust spectator mode, and replacing the pure Canvas2D rendering pipeline with WebGL for scale.
