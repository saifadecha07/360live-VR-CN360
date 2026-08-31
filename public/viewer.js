/**
 * CN360Live — viewer.js  [SUPERSEDED]
 *
 * This file is kept for backwards compatibility only.
 * The new architecture uses:
 *
 *   app.js         → SPA entry point & state machine
 *   panorama.js    → Three.js 360° sphere renderer (equivalent to this file)
 *   pc-mode.js     → PC camera list + viewer
 *   vr-lobby.js    → Three.js 3D camera lobby
 *   vr-viewer.js   → VR 360° viewer
 *   config.js      → Central config & stream URL builder
 *   cameras-api.js → Client-side camera API
 *
 * All features from this file are preserved in panorama.js:
 *   ✓ Inside-out equirectangular sphere
 *   ✓ WebXR immersive-vr
 *   ✓ Mouse / touch drag
 *   ✓ Scroll / pinch to zoom FOV
 *   ✓ Upload 360° image (setImageTexture)
 *   ✓ Live stream VideoTexture (setLiveStream)
 *   ✓ Procedural default panorama (useDefaultTexture)
 *   ✓ Status indicator callbacks
 *   ✓ Toast callbacks
 *
 * This file is NOT loaded by index.html in the new version.
 * index.html loads app.js instead.
 */

// Re-export Panorama class for any external scripts that might import viewer.js
export { Panorama } from './panorama.js';
