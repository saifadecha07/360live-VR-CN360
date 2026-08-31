/**
 * CN360Live — vr-lobby.js
 *
 * Three.js 3D Camera Lobby scene.
 *
 * Layout: viewer at origin, camera panels arranged in a semicircle.
 * Theme: dark, futuristic, neon blue grid floor, floating panels.
 *
 * Interaction (non-VR): mouse drag to look around, click panel to select.
 * Interaction (VR): gaze/controller ray-cast to select (Phase 2 — for now click).
 */

import * as THREE from 'three';

const C = {
  BG:      0x050A12,
  GRID:    0x00C6FF,
  ACCENT:  0x00C6FF,
  LIVE:    0x00FF88,
  WAITING: 0xFFD000,
  OFFLINE: 0xFF3344,
  PANEL_BG:     0x060D1A,
  PANEL_BORDER: 0x0077FF,
};

export class VRLobby {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onSelectCamera: (camera:object)=>void,
   *            onToast?: (msg:string)=>void }} opts
   */
  constructor(canvas, opts) {
    this.canvas   = canvas;
    this.opts     = opts;
    this._cameras  = [];
    this._panels   = [];   // { mesh, camera, labelMesh }
    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2(-999, -999);
    this._hovered   = null;
    this._drag      = { active: false, moved: false, x: 0, y: 0 };
    this._yaw       = 0;
    this._pitch     = 0;

    this._setupRenderer();
    this._setupScene();
    this._setupLights();
    this._buildEnvironment();
    this._bindEvents();
    this._startLoop();
  }

  // ── PUBLIC ───────────────────────────────────────────────

  /** Update camera panels with fresh status data */
  updateCameras(cameras) {
    this._cameras = cameras;
    this._buildPanels();
  }

  forceResize() { this._resize(); }

  destroy() {
    this._stopLoop();
    this._renderer.dispose();
    this._unbindEvents();
  }

  // ── RENDERER / SCENE SETUP ───────────────────────────────

  _setupRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:    this.canvas,
      antialias: true,
      alpha:     false,
      powerPreference: 'high-performance',
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 0.9;
    this._renderer.xr.enabled = true;
    this._resize();
  }

  _setupScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(C.BG);
    this._scene.fog = new THREE.FogExp2(C.BG, 0.04);

    this._camera = new THREE.PerspectiveCamera(75, 1, 0.01, 200);
    this._camera.position.set(0, 1.6, 0);   // standing height
    this._scene.add(this._camera);
  }

  _setupLights() {
    this._scene.add(new THREE.AmbientLight(0x0A1528, 4));
    const pt = new THREE.PointLight(C.ACCENT, 2, 20);
    pt.position.set(0, 4, 0);
    this._scene.add(pt);
  }

  _buildEnvironment() {
    // ── Grid floor ───────────────────────────────────────
    const gridHelper = new THREE.GridHelper(40, 40, C.GRID, C.GRID);
    // GridHelper uses two materials — set opacity on both
    const gridMats = Array.isArray(gridHelper.material)
      ? gridHelper.material
      : [gridHelper.material];
    gridMats.forEach(m => { m.opacity = 0.12; m.transparent = true; });
    gridHelper.position.y = -0.01;
    this._scene.add(gridHelper);

    // ── Floor plane (dark, slightly reflective) ──────────
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x020609,
      transparent: true,
      opacity: 0.9,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this._scene.add(floor);

    // ── Ceiling ambient ring ─────────────────────────────
    const ringGeo = new THREE.TorusGeometry(6, 0.03, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: C.ACCENT, transparent: true, opacity: 0.3 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 4;
    this._scene.add(ring);
    this._ambientRing = ring;

    // ── Title text rendered on a canvas texture ──────────
    this._scene.add(this._makeTitlePlane());

    // ── Subtle stars ─────────────────────────────────────
    this._scene.add(this._makeStarField());
  }

  _makeTitlePlane() {
    const w = 512, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');

    g.clearRect(0, 0, w, h);
    g.font = '700 52px Inter,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // Glow
    g.shadowColor = '#00C6FF';
    g.shadowBlur  = 24;
    g.fillStyle   = '#00C6FF';
    g.fillText('CN360', w / 2 - 52, h / 2);

    g.shadowBlur = 0;
    g.fillStyle  = '#ffffff';
    g.fillText('Live', w / 2 + 68, h / 2);

    const tex  = new THREE.CanvasTexture(c);
    const geo  = new THREE.PlaneGeometry(3.2, 0.8);
    const mat  = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 3.2, -5);
    return mesh;
  }

  _makeStarField() {
    const geo = new THREE.BufferGeometry();
    const n   = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 15 + 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.5 });
    return new THREE.Points(geo, mat);
  }

  // ── CAMERA PANELS ─────────────────────────────────────────

  _buildPanels() {
    // Remove old panels
    this._panels.forEach(p => {
      this._scene.remove(p.group);
      p.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    });
    this._panels = [];

    const cams   = this._cameras;
    const count  = cams.length;
    if (!count) return;

    // Arrange in a semicircle in front of user
    const radius   = 3.5;
    const arcSpan  = Math.min(Math.PI * 0.9, (count - 1) * 0.9);
    const startAng = -arcSpan / 2;

    cams.forEach((cam, i) => {
      const angle = count === 1 ? 0 : startAng + (arcSpan / (count - 1)) * i;
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius;

      const panel = this._makePanel(cam);
      panel.group.position.set(x, 1.2, z);
      panel.group.lookAt(0, 1.2, 0);   // face the viewer
      this._scene.add(panel.group);
      this._panels.push(panel);
    });
  }

  _makePanel(camera) {
    const group = new THREE.Group();

    // Status colour
    const statusColor =
      camera.status === 'streaming' ? C.LIVE :
      camera.status === 'waiting'   ? C.WAITING : C.OFFLINE;

    const canView = camera.status === 'streaming' || camera.status === 'waiting';

    // ── Background plane ─────────────────────────────────
    const W = 2.2, H = 1.4;
    const bgGeo = new THREE.PlaneGeometry(W, H);
    const bgMat = new THREE.MeshBasicMaterial({
      color:       C.PANEL_BG,
      transparent: true,
      opacity:     canView ? 0.88 : 0.55,
      side:        THREE.FrontSide,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    group.add(bg);

    // ── Border frame (4 thin quads) ──────────────────────
    const borderColor = canView ? C.PANEL_BORDER : 0x333355;
    const borders = [
      { w: W,    h: 0.015, x: 0,       y:  H / 2  },
      { w: W,    h: 0.015, x: 0,       y: -H / 2  },
      { w: 0.015, h: H,   x:  W / 2,  y: 0       },
      { w: 0.015, h: H,   x: -W / 2,  y: 0       },
    ];
    borders.forEach(b => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(b.w, b.h),
        new THREE.MeshBasicMaterial({ color: borderColor, transparent: true, opacity: canView ? 0.9 : 0.35 })
      );
      m.position.set(b.x, b.y, 0.001);
      group.add(m);
    });

    // ── Canvas texture with text ─────────────────────────
    const tex  = this._makePanelTexture(camera, statusColor, canView);
    const tGeo = new THREE.PlaneGeometry(W - 0.12, H - 0.12);
    const tMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const tMesh = new THREE.Mesh(tGeo, tMat);
    tMesh.position.z = 0.002;
    group.add(tMesh);

    // ── Status glow dot ───────────────────────────────────
    const dotGeo = new THREE.CircleGeometry(0.04, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: statusColor, transparent: true, opacity: canView ? 1 : 0.4 });
    const dot    = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(-0.72, 0.42, 0.003);
    group.add(dot);

    // Store ref for hit-testing
    group.userData = { camera, canView };
    bg.userData    = { isPanelHit: true, camera, canView };

    return { group, hitMesh: bg, camera };
  }

  _makePanelTexture(camera, statusColor, canView) {
    const W = 512, H = 320;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    g.clearRect(0, 0, W, H);

    // Camera name
    g.fillStyle = canView ? '#ffffff' : 'rgba(255,255,255,0.4)';
    g.font = '700 36px Inter,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(camera.name.toUpperCase(), W / 2, 36);

    // Status label
    const statusLabel =
      camera.status === 'streaming' ? 'LIVE' :
      camera.status === 'waiting'   ? 'WAITING' : 'OFFLINE';

    const hex = '#' + statusColor.toString(16).padStart(6, '0');
    g.font = '700 22px Inter,sans-serif';
    g.fillStyle = hex;
    g.shadowColor = hex;
    g.shadowBlur  = canView ? 14 : 0;
    g.fillText('● ' + statusLabel, W / 2, 96);
    g.shadowBlur = 0;

    // Model
    g.font = '400 20px Inter,sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(camera.model, W / 2, 150);

    // Type / resolution
    g.font = '400 18px Inter,sans-serif';
    g.fillStyle = 'rgba(0,198,255,0.6)';
    g.fillText('360° · 3840×1920 · 30fps', W / 2, 190);

    // Action button area
    if (canView) {
      const bx = W / 2 - 100, by = 238, bw = 200, bh = 46;
      g.fillStyle = 'rgba(0,119,255,0.18)';
      g.strokeStyle = 'rgba(0,198,255,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(bx, by, bw, bh, 8);
      g.fill(); g.stroke();
      g.font = '700 19px Inter,sans-serif';
      g.fillStyle = '#00C6FF';
      g.fillText('VIEW CAMERA', W / 2, by + bh / 2 + 1);
    } else {
      g.font = '600 18px Inter,sans-serif';
      g.fillStyle = 'rgba(255,51,68,0.5)';
      g.fillText('UNAVAILABLE', W / 2, 256);
    }

    return new THREE.CanvasTexture(c);
  }

  // ── INTERACTION ───────────────────────────────────────────

  _bindEvents() {
    this._onResize     = this._resize.bind(this);
    this._onMouseDown  = this._mouseDown.bind(this);
    this._onMouseMove  = this._mouseMove.bind(this);
    this._onMouseUp    = this._mouseUp.bind(this);
    this._onTouchStart = this._touchStart.bind(this);
    this._onTouchMove  = this._touchMoveEvt.bind(this);
    this._onTouchEnd   = this._touchEnd.bind(this);
    this._onClick      = this._click.bind(this);

    window.addEventListener('resize',     this._onResize);
    this.canvas.addEventListener('mousedown',  this._onMouseDown);
    window.addEventListener('mousemove',  this._onMouseMove);
    window.addEventListener('mouseup',    this._onMouseUp);
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
    window.addEventListener('touchmove',  this._onTouchMove,  { passive: true });
    window.addEventListener('touchend',   this._onTouchEnd);
    this.canvas.addEventListener('click',      this._onClick);
  }

  _unbindEvents() {
    window.removeEventListener('resize',    this._onResize);
    this.canvas.removeEventListener('mousedown',  this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend',  this._onTouchEnd);
    this.canvas.removeEventListener('click',      this._onClick);
  }

  _resize() {
    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  _getXY(e) {
    if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  _mouseDown(e) {
    const p = this._getXY(e);
    this._drag = { active: true, moved: false, x: p.x, y: p.y };
  }

  _mouseMove(e) {
    if (!this._drag.active) {
      // Update hover
      this._updatePointer(e);
      return;
    }
    const p = this._getXY(e);
    const dx = p.x - this._drag.x;
    const dy = p.y - this._drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
    this._yaw   -= dx * 0.3;
    this._pitch += dy * 0.2;
    this._pitch  = Math.max(-30, Math.min(30, this._pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _mouseUp() { this._drag.active = false; }

  _touchStart(e) {
    const p = this._getXY(e);
    this._drag = { active: true, moved: false, x: p.x, y: p.y };
  }

  _touchMoveEvt(e) {
    if (!this._drag.active) return;
    const p = this._getXY(e);
    const dx = p.x - this._drag.x;
    const dy = p.y - this._drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
    this._yaw   -= dx * 0.3;
    this._pitch += dy * 0.2;
    this._pitch  = Math.max(-30, Math.min(30, this._pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _touchEnd(e) {
    if (!this._drag.moved) {
      // Treat as tap/click
      if (e.changedTouches?.length) {
        const t = e.changedTouches[0];
        this._hitTest(t.clientX, t.clientY);
      }
    }
    this._drag.active = false;
  }

  _click(e) {
    if (this._drag.moved) return;
    this._hitTest(e.clientX, e.clientY);
  }

  _updatePointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
  }

  _hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    const y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    this._raycaster.setFromCamera({ x, y }, this._camera);
    const hits = this._panels.map(p => p.hitMesh);
    const intersects = this._raycaster.intersectObjects(hits);

    if (!intersects.length) return;
    const { camera, canView } = intersects[0].object.userData;
    if (!canView) {
      this.opts.onToast?.(`${camera.name} is not available`);
      return;
    }
    this.opts.onSelectCamera(camera);
  }

  _applyRotation() {
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.y = THREE.MathUtils.degToRad(-this._yaw);
    this._camera.rotation.x = THREE.MathUtils.degToRad(-this._pitch);
  }

  // ── RENDER LOOP ───────────────────────────────────────────

  _startLoop() {
    let t = 0;
    const _scaleVec = new THREE.Vector3();
    this._renderer.setAnimationLoop(ts => {
      t = ts * 0.001;

      // Gentle ring rotation
      if (this._ambientRing) {
        this._ambientRing.rotation.z = t * 0.1;
      }

      // Hover detection via raycaster (only if panels exist)
      if (this._panels.length) {
        this._raycaster.setFromCamera(this._pointer, this._camera);
        const hitMeshes = this._panels.map(p => p.hitMesh);
        const hits = this._raycaster.intersectObjects(hitMeshes);
        const newHov = hits.length ? hits[0].object : null;
        if (newHov !== this._hovered) {
          this._hovered = newHov;
          this.canvas.style.cursor =
            (newHov && newHov.userData.canView) ? 'pointer' : 'default';
        }

        // Scale hovered panel
        this._panels.forEach(p => {
          const isHov   = p.hitMesh === this._hovered;
          const target  = (isHov && p.camera.status !== 'offline') ? 1.04 : 1.0;
          _scaleVec.set(target, target, target);
          p.group.scale.lerp(_scaleVec, 0.12);
        });
      }

      this._renderer.render(this._scene, this._camera);
    });
  }

  _stopLoop() {
    this._renderer.setAnimationLoop(null);
  }
}
