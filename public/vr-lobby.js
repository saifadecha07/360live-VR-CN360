/**
 * CN360Live — vr-lobby.js
 *
 * Spatial Control Room 3D Lobby — Three.js
 *
 * Design language:
 *   Dark spatial room · subtle grid floor · floating glass panels
 *   Calm ambient lighting · soft cyan accents · no excessive FX
 *
 * Performance target: smooth on Pico 4 (≤ 72 fps budget)
 */

import * as THREE from 'three';

const LOBBY_BG_URL = 'https://res.cloudinary.com/dmclcfxea/image/upload/v1788237250/IMG_3100_hjojo1.png';

// ─── Colour palette (matches CSS design tokens) ─────────
const C = {
  BG:           0x050A12,
  ACCENT:       0x00C6FF,
  GRID_LINE:    0x00C6FF,
  LIVE:         0x00FF88,
  WAITING:      0xFFD000,
  OFFLINE:      0xFF3344,
  PANEL_BG:     0x080F1C,
  PANEL_BORDER: 0x0077FF,
};

// ─── Float parameters ────────────────────────────────────
const FLOAT = {
  amplitude: 0.04,   // ± units
  speed:     0.5,    // full cycle per second (slow and calm)
};

export class VRLobby {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onSelectCamera: (cam:object)=>void,
   *            onToast?: (msg:string)=>void }} opts
   */
  constructor(canvas, opts) {
    this.canvas      = canvas;
    this.opts        = opts;
    this._cameras    = [];
    this._panels     = [];
    this._raycaster  = new THREE.Raycaster();
    this._pointer    = new THREE.Vector2(-999, -999);
    this._hovered    = null;
    this._drag       = { active: false, moved: false, x: 0, y: 0 };
    this._yaw        = 0;
    this._pitch      = 0;
    this._xrSession  = null;
    this._controllers = [];

    this._setupRenderer();
    this._setupScene();
    this._resize();
    this._buildEnvironment();
    this._setupXRControllers();
    this._bindEvents();
    this._startLoop();
  }

  // ── PUBLIC ────────────────────────────────────────────

  updateCameras(cameras) {
    this._cameras = cameras;
    this._buildPanels();
  }

  forceResize() { this._resize(); }

  /** Request an immersive-vr session immediately (must be called from a user gesture) */
  async enterXR() {
    if (!navigator.xr) return false;
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      if (!ok) return false;
      this._xrSession = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      this._renderer.xr.setSession(this._xrSession);
      document.body.classList.add('vr-on');
      this._xrSession.addEventListener('end', () => {
        document.body.classList.remove('vr-on');
        this._xrSession = null;
        this.opts.onExitXR?.();
      });
      return true;
    } catch (err) {
      console.error('[CN360] Lobby XR error:', err);
      return false;
    }
  }

  /**
   * @param {{ keepXRSession?: boolean }} opts  Pass keepXRSession:true when
   *   handing the live session off to another screen (e.g. the viewer) —
   *   otherwise the session is ended, which would kick the user out of VR.
   */
  destroy(opts = {}) {
    this._stopLoop();
    if (this._xrSession && !opts.keepXRSession) {
      this._xrSession.end().catch(() => {});
    }
    this._xrSession = null;
    this._renderer.dispose();
    this._unbindEvents();
  }

  // ── SETUP ─────────────────────────────────────────────

  _setupRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:          this.canvas,
      antialias:       true,
      alpha:           false,
      powerPreference: 'high-performance',
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));  // Pico 4 safe
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 0.85;
    this._renderer.xr.enabled = true;
  }

  _setupScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(C.BG);

    // Equirectangular background pano — falls back to solid colour on failure
    new THREE.TextureLoader().load(
      LOBBY_BG_URL,
      tex => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        this._scene.background = tex;
      },
      undefined,
      () => { /* keep solid colour fallback */ }
    );

    // Subtle depth fog — adds spatial depth without cost
    this._scene.fog = new THREE.Fog(C.BG, 8, 28);

    // Camera at standing height
    this._camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
    this._camera.position.set(0, 1.6, 0);
    this._scene.add(this._camera);

    // Lights
    this._scene.add(new THREE.AmbientLight(0x08152A, 6));

    // Soft overhead point light — cyan tint
    const overhead = new THREE.PointLight(C.ACCENT, 1.5, 16, 2);
    overhead.position.set(0, 5, 0);
    this._scene.add(overhead);

    // Dim fill from below — warm-dark
    const fill = new THREE.PointLight(0x0A0D14, 0.6, 10, 2);
    fill.position.set(0, -1, 0);
    this._scene.add(fill);
  }

  _buildEnvironment() {
    // ── Floor ──────────────────────────────────────────
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x020608 });
    const floor    = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this._scene.add(floor);

    // Grid — subtle, not bright
    const grid = new THREE.GridHelper(30, 30, C.GRID_LINE, C.GRID_LINE);
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMats.forEach(m => { m.opacity = 0.07; m.transparent = true; });
    grid.position.y = 0;
    this._scene.add(grid);

    // ── Far wall hint (very faint) ───────────────────
    const wallGeo = new THREE.PlaneGeometry(22, 8);
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x050B15,
      transparent: true,
      opacity: 0.6,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 3, -10);
    this._scene.add(wall);

    // Thin horizontal accent line on wall
    const lineGeo = new THREE.PlaneGeometry(18, 0.008);
    const lineMat = new THREE.MeshBasicMaterial({
      color: C.ACCENT,
      transparent: true,
      opacity: 0.18,
    });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, 2.2, -9.95);
    this._scene.add(line);

    // ── Ceiling accent ring (slow rotation) ─────────
    const ringGeo = new THREE.TorusGeometry(4.5, 0.008, 6, 80);
    const ringMat = new THREE.MeshBasicMaterial({ color: C.ACCENT, transparent: true, opacity: 0.18 });
    this._ring = new THREE.Mesh(ringGeo, ringMat);
    this._ring.position.y = 3.8;
    this._scene.add(this._ring);

    // Second, slightly larger ring — counter-rotate
    const ring2Geo = new THREE.TorusGeometry(5.8, 0.005, 6, 80);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: C.ACCENT, transparent: true, opacity: 0.08 });
    this._ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    this._ring2.position.y = 3.8;
    this._scene.add(this._ring2);

    // ── Logo / title in 3D ──────────────────────────
    this._scene.add(this._makeTitlePlane());

    // ── Sparse stars (depth cue) ─────────────────────
    this._scene.add(this._makeStars());
  }

  _makeTitlePlane() {
    const W = 768, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);

    // Soft glow behind text
    const glow = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45);
    glow.addColorStop(0,   'rgba(0,198,255,0.04)');
    glow.addColorStop(1,   'transparent');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // CN360
    g.font = '600 52px Inter, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#FFFFFF';
    g.fillText('CN360', W / 2 - 68, H / 2);

    // Live — accent colour
    g.fillStyle = '#00C6FF';
    g.fillText('Live', W / 2 + 92, H / 2);

    // Thin separator line
    g.strokeStyle = 'rgba(0,198,255,0.20)';
    g.lineWidth   = 0.8;
    g.beginPath();
    g.moveTo(W / 2 - 160, H * 0.82);
    g.lineTo(W / 2 + 160, H * 0.82);
    g.stroke();

    // Sub-label
    g.font = '400 18px Inter, sans-serif';
    g.fillStyle = 'rgba(184,201,216,0.55)';
    g.fillText('Spatial Camera Control Room', W / 2, H * 0.92);

    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(4.2, 0.70);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const m   = new THREE.Mesh(geo, mat);
    m.position.set(0, 3.1, -6.5);
    return m;
  }

  _makeStars() {
    const geo = new THREE.BufferGeometry();
    const N   = 300;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 10 + 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.03, transparent: true, opacity: 0.35 });
    return new THREE.Points(geo, mat);
  }

  // ── CAMERA PANELS ─────────────────────────────────────

  _buildPanels() {
    // Dispose previous
    this._panels.forEach(p => {
      this._scene.remove(p.group);
      p.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    });
    this._panels = [];

    const cams  = this._cameras;
    const count = cams.length;
    if (!count) return;

    // Spatial placement — semicircle at comfortable viewing distance
    const radius  = 3.2;
    const arcSpan = Math.min(Math.PI * 0.85, (count - 1) * 1.0);
    const start   = -arcSpan / 2;

    cams.forEach((cam, i) => {
      const angle = (count === 1) ? 0 : start + (arcSpan / (count - 1)) * i;
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius;

      const panel = this._makePanel(cam, i);
      panel.group.position.set(x, 1.35, z);
      panel.group.lookAt(new THREE.Vector3(0, 1.35, 0));

      // Slight random offset so panels feel placed, not generated
      panel.group.position.y += (Math.random() - 0.5) * 0.08;

      // Store baseY for float animation
      panel.group.userData.baseY = panel.group.position.y;

      this._scene.add(panel.group);
      this._panels.push(panel);
    });
  }

  _makePanel(camera, index) {
    const group    = new THREE.Group();
    const canView  = camera.status === 'streaming' || camera.status === 'waiting';

    const statusColor =
      camera.status === 'streaming' ? C.LIVE :
      camera.status === 'waiting'   ? C.WAITING : C.OFFLINE;

    const W = 2.0, H = 1.30;

    // ── Background glass plane ───────────────────────
    const bgGeo = new THREE.PlaneGeometry(W, H);
    const bgMat = new THREE.MeshBasicMaterial({
      color:       C.PANEL_BG,
      transparent: true,
      opacity:     canView ? 0.80 : 0.42,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    group.add(bg);

    // ── Border lines — thin quads ────────────────────
    const bc = canView ? C.PANEL_BORDER : 0x1A1F2E;
    const bo = canView ? 0.75 : 0.25;
    const borders = [
      { w: W,     h: 0.010, x: 0,       y:  H / 2 },
      { w: W,     h: 0.010, x: 0,       y: -H / 2 },
      { w: 0.010, h: H,     x:  W / 2,  y: 0      },
      { w: 0.010, h: H,     x: -W / 2,  y: 0      },
    ];
    borders.forEach(b => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(b.w, b.h),
        new THREE.MeshBasicMaterial({ color: bc, transparent: true, opacity: bo })
      );
      m.position.set(b.x, b.y, 0.001);
      group.add(m);
    });

    // Status edge glow on left border
    if (canView) {
      const glowMat = new THREE.MeshBasicMaterial({
        color:       statusColor,
        transparent: true,
        opacity:     0.55,
      });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.014, H * 0.6), glowMat);
      glow.position.set(-W / 2, 0, 0.002);
      group.add(glow);
    }

    // ── Canvas texture ────────────────────────────────
    const tex  = this._makePanelTexture(camera, statusColor, canView);
    const tGeo = new THREE.PlaneGeometry(W - 0.10, H - 0.10);
    const tMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const t    = new THREE.Mesh(tGeo, tMat);
    t.position.z = 0.003;
    group.add(t);

    // Unique float phase per panel — prevents synchronised movement
    group.userData = {
      camera,
      canView,
      floatPhase:    (index / Math.max(1, this._cameras.length)) * Math.PI * 2,
      baseY:         0,   // set after positioning
    };
    bg.userData = { isPanelHit: true, camera, canView };

    return { group, hitMesh: bg, camera };
  }

  _makePanelTexture(camera, statusColor, canView) {
    const W = 600, H = 390;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);

    const alpha = canView ? 1 : 0.42;

    // ── Camera name ─────────────────────────────────
    g.font = `600 38px Inter, -apple-system, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = canView ? `rgba(255,255,255,${alpha})` : `rgba(255,255,255,0.35)`;
    g.fillText(camera.name, 36, 34);

    // ── Status row ───────────────────────────────────
    const statusLabel =
      camera.status === 'streaming' ? 'Live' :
      camera.status === 'waiting'   ? 'Waiting' : 'Offline';

    const hex = '#' + statusColor.toString(16).padStart(6, '0');
    const dotR = 7;
    const dotX = 38, dotY = 104;

    // Status dot
    g.beginPath();
    g.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    if (canView) {
      g.shadowColor = hex;
      g.shadowBlur  = 8;
    }
    g.fillStyle = hex;
    g.fill();
    g.shadowBlur = 0;

    g.font = `600 22px Inter, sans-serif`;
    g.fillStyle = hex;
    g.fillText(statusLabel, dotX + dotR + 10, dotY - 11);

    // ── Divider ──────────────────────────────────────
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth   = 1;
    g.beginPath();
    g.moveTo(36, 140); g.lineTo(W - 36, 140);
    g.stroke();

    // ── Model / specs ────────────────────────────────
    g.font = '400 20px Inter, sans-serif';
    g.fillStyle = `rgba(184,201,216,${canView ? 0.60 : 0.28})`;
    g.fillText(camera.model, 36, 160);

    g.font = '400 17px Inter, sans-serif';
    g.fillStyle = `rgba(0,198,255,${canView ? 0.50 : 0.20})`;
    g.fillText(`360° · 3840×1920 · 30 fps`, 36, 192);

    // ── CTA button area ───────────────────────────────
    if (canView) {
      const bx = 36, by = 290, bw = W - 72, bh = 60;

      // Button background
      g.fillStyle   = 'rgba(0, 119, 255, 0.14)';
      g.strokeStyle = 'rgba(0, 198, 255, 0.30)';
      g.lineWidth   = 1;
      g.beginPath();
      g.roundRect(bx, by, bw, bh, 10);
      g.fill(); g.stroke();

      // Button label
      g.font = `600 20px Inter, sans-serif`;
      g.fillStyle = '#00C6FF';
      g.textAlign = 'center';
      g.fillText('View Camera', W / 2, by + bh / 2 + 1);
      g.textAlign = 'left';

    } else {
      // Offline state
      g.font = '500 18px Inter, sans-serif';
      g.fillStyle = 'rgba(255,51,68,0.42)';
      g.textAlign = 'center';
      g.fillText('Unavailable', W / 2, 310);
      g.textAlign = 'left';
    }

    return new THREE.CanvasTexture(c);
  }

  // ── XR CONTROLLERS ─────────────────────────────────────

  _setupXRControllers() {
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -5),
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: C.ACCENT, transparent: true, opacity: 0.6 });

    for (let i = 0; i < 2; i++) {
      const controller = this._renderer.xr.getController(i);
      controller.visible = false;
      controller.add(new THREE.Line(rayGeo.clone(), rayMat.clone()));
      controller.addEventListener('connected',    () => { controller.visible = true; });
      controller.addEventListener('disconnected', () => { controller.visible = false; });
      controller.addEventListener('selectstart', () => this._xrSelect(controller));
      this._scene.add(controller);
      this._controllers.push(controller);
    }
  }

  /** Raycast from an XR controller's pose and select a hovered panel */
  _xrSelect(controller) {
    const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);

    const hits = this._raycaster.intersectObjects(this._panels.map(p => p.hitMesh));
    if (!hits.length) return;

    const { camera, canView } = hits[0].object.userData;
    if (!canView) {
      this.opts.onToast?.(`${camera.name} is currently unavailable`);
      return;
    }
    this.opts.onSelectCamera(camera);
  }

  // ── INTERACTION ───────────────────────────────────────

  _bindEvents() {
    this._onResize     = this._resize.bind(this);
    this._onMouseDown  = this._mouseDown.bind(this);
    this._onMouseMove  = this._mouseMove.bind(this);
    this._onMouseUp    = this._mouseUp.bind(this);
    this._onTouchStart = this._touchStart.bind(this);
    this._onTouchMove  = this._touchMove.bind(this);
    this._onTouchEnd   = this._touchEnd.bind(this);
    this._onClick      = this._click.bind(this);

    window.addEventListener('resize',          this._onResize);
    this.canvas.addEventListener('mousedown',  this._onMouseDown);
    window.addEventListener('mousemove',       this._onMouseMove);
    window.addEventListener('mouseup',         this._onMouseUp);
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
    window.addEventListener('touchmove',       this._onTouchMove,  { passive: true });
    window.addEventListener('touchend',        this._onTouchEnd);
    this.canvas.addEventListener('click',      this._onClick);
  }

  _unbindEvents() {
    window.removeEventListener('resize',          this._onResize);
    this.canvas.removeEventListener('mousedown',  this._onMouseDown);
    window.removeEventListener('mousemove',       this._onMouseMove);
    window.removeEventListener('mouseup',         this._onMouseUp);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove',       this._onTouchMove);
    window.removeEventListener('touchend',        this._onTouchEnd);
    this.canvas.removeEventListener('click',      this._onClick);
  }

  _resize() {
    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  _xy(e) {
    return e.touches
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX,            y: e.clientY };
  }

  _mouseDown(e) {
    const p = this._xy(e);
    this._drag = { active: true, moved: false, x: p.x, y: p.y };
  }

  _mouseMove(e) {
    if (!this._drag.active) {
      this._updatePointer(e);
      return;
    }
    const p  = this._xy(e);
    const dx = p.x - this._drag.x;
    const dy = p.y - this._drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
    this._yaw   -= dx * 0.28;
    this._pitch += dy * 0.18;
    this._pitch  = Math.max(-28, Math.min(28, this._pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _mouseUp()  { this._drag.active = false; }

  _touchStart(e) {
    const p = this._xy(e);
    this._drag = { active: true, moved: false, x: p.x, y: p.y };
  }

  _touchMove(e) {
    if (!this._drag.active) return;
    const p  = this._xy(e);
    const dx = p.x - this._drag.x;
    const dy = p.y - this._drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
    this._yaw   -= dx * 0.28;
    this._pitch += dy * 0.18;
    this._pitch  = Math.max(-28, Math.min(28, this._pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _touchEnd(e) {
    if (!this._drag.moved && e.changedTouches?.length) {
      const t = e.changedTouches[0];
      this._hitTest(t.clientX, t.clientY);
    }
    this._drag.active = false;
  }

  _click(e) {
    if (this._drag.moved) return;
    this._hitTest(e.clientX, e.clientY);
  }

  _updatePointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this._pointer.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    this._pointer.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }

  _hitTest(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const x =  ((cx - r.left) / r.width)  * 2 - 1;
    const y = -((cy - r.top)  / r.height) * 2 + 1;

    this._raycaster.setFromCamera({ x, y }, this._camera);
    const hits = this._raycaster.intersectObjects(this._panels.map(p => p.hitMesh));
    if (!hits.length) return;

    const { camera, canView } = hits[0].object.userData;
    if (!canView) {
      this.opts.onToast?.(`${camera.name} is currently unavailable`);
      return;
    }
    this.opts.onSelectCamera(camera);
  }

  _applyRotation() {
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.y = THREE.MathUtils.degToRad(-this._yaw);
    this._camera.rotation.x = THREE.MathUtils.degToRad(-this._pitch);
  }

  // ── RENDER LOOP ───────────────────────────────────────

  _startLoop() {
    const _sv  = new THREE.Vector3(); // reuse for lerp
    this._renderer.setAnimationLoop(ts => {
      const t = ts * 0.001;

      // ── Slow ring rotation ─────────────────────────
      if (this._ring)  this._ring.rotation.z  =  t * 0.08;
      if (this._ring2) this._ring2.rotation.z = -t * 0.05;

      // ── Panel floating animation ───────────────────
      this._panels.forEach(p => {
        const { floatPhase, baseY } = p.group.userData;
        const targetY = baseY + Math.sin(t * FLOAT.speed * Math.PI * 2 + floatPhase) * FLOAT.amplitude;
        p.group.position.y += (targetY - p.group.position.y) * 0.04;
      });

      // ── Hover detection + scale ───────────────────
      if (this._panels.length && this._renderer.xr.isPresenting) {
        // XR: hover follows whichever connected controller points at a panel
        let newHov = null;
        for (const controller of this._controllers) {
          if (!controller.visible) continue;
          const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
          this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
          this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
          const hits = this._raycaster.intersectObjects(this._panels.map(p => p.hitMesh));
          if (hits.length) { newHov = hits[0].object; break; }
        }
        this._hovered = newHov;
      } else if (this._panels.length && !this._drag.active) {
        this._raycaster.setFromCamera(this._pointer, this._camera);
        const hits   = this._raycaster.intersectObjects(this._panels.map(p => p.hitMesh));
        const newHov = hits.length ? hits[0].object : null;

        if (newHov !== this._hovered) {
          this._hovered = newHov;
          this.canvas.style.cursor = (newHov?.userData.canView) ? 'pointer' : 'default';
        }
      }

      this._panels.forEach(p => {
        const hov    = p.hitMesh === this._hovered && p.camera.status !== 'offline';
        const target = hov ? 1.03 : 1.0;
        _sv.set(target, target, target);
        p.group.scale.lerp(_sv, 0.10);
      });

      this._renderer.render(this._scene, this._camera);
    });
  }

  _stopLoop() {
    this._renderer.setAnimationLoop(null);
  }
}
