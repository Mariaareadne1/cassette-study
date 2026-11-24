/**
 * The 3D stage: renderer lifecycle, camera and composition, object rotation with inertia, picking
 * and pointer gestures. It knows nothing about audio; the controller feeds it a deck snapshot each
 * frame and receives intent callbacks (key pressed, cassette dragged, door tapped).
 */
import * as THREE from 'three';
import type { DeckSnapshot } from '../../deck/machine';
import { BODY, KEY_ORDER, type KeyName } from '../geometry/player';
import { CASSETTE } from '../geometry/cassette';
import { Materials } from '../materials';
import { BACKDROP_FRAG as BACKDROP_FRAG_SRC, BACKDROP_VERT as BACKDROP_VERT_SRC } from '../shaders/surfaces';
import { type Fonts } from '../textures/prints';
import { Assembly, type HitKind } from './assembly';
import { type Pose, pose, spring } from './motion';
import { type GlassGroup, Pipeline, ROOM_SIZE, type Rect } from './pipeline';
import { RigPoser } from './rigPoser';

const FOV = 26;
const LIGHT = new THREE.Vector3(-0.32, 0.5, 1).normalize();
const BACKDROP_Z = -95;
const TAP_SLOP = 6;
const ROT_RATE = 0.0085;
const PITCH_LIMIT: [number, number] = [-0.7, 0.95];
const YAW_LIMIT = 2.7;
const SNAP_DISTANCE = 46;
export const HERO = { yaw: -0.46, pitch: 0.3 } as const;

export type ViewMode = 'hero' | 'reels' | 'keys';

export interface StageFrame {
  deck: DeckSnapshot;
  pressed: ReadonlySet<KeyName>;
  volume: number;
}

export interface StageHandlers {
  frame: () => StageFrame;
  tick?: (dt: number) => void;
  onKeyDown: (key: KeyName) => void;
  onKeyUp: (key: KeyName) => void;
  onDoorTap: () => void;
  onCassetteTap: () => void;
  onCassetteGrab: (at: THREE.Vector3) => boolean;
  onCassetteMove: (at: THREE.Vector3, nearSlot: boolean) => void;
  onCassetteDrop: () => void;
  onCassetteCancel: () => void;
  onInteract?: () => void;
  onReady?: () => void;
}

export interface StageOptions {
  fonts: Fonts;
  manual?: boolean;
  preserveBuffer?: boolean;
  reducedMotion?: boolean;
  maxDpr?: number;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'rotate'; id: number; x: number; y: number; sx: number; sy: number; moved: number; t: number; hit: HitKind | null }
  | { kind: 'key'; id: number; key: KeyName }
  | { kind: 'cassette'; id: number; sx: number; sy: number; dragging: boolean; offset: THREE.Vector3; depth: number };

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly pipe: Pipeline;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
  private readonly mats: Materials;
  readonly asm: Assembly;
  private readonly poser: RigPoser;
  private readonly backdrop: THREE.Mesh;
  private readonly shadow;
  private readonly ro: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly reduced: boolean;
  private raf = 0;
  private last = 0;
  private time = 0;
  private disposed = false;
  private manual: boolean;
  private gesture: Gesture = { kind: 'none' };
  private yaw: number = HERO.yaw;
  private pitch: number = HERO.pitch;
  private vyaw = 0;
  private vpitch = 0;
  private homing = false;
  private idle = 0;
  private view: ViewMode = 'hero';
  private viewMix: [number, number] = [0, 0];
  private keysMix: [number, number] = [0, 0];
  private compose: [number, number] = [1, 0];
  private portrait = false;
  private size = { w: 1, h: 1 };
  private readonly rest: Pose = pose();
  private readonly handlers: StageHandlers;
  private hover: HitKind | null = null;
  private readonly frameStats = { frames: 0, gaps: [] as number[] };
  private dprProbe = true;
  private readonly maxDpr: number;
  private readonly glassList: GlassGroup[] = [];

  constructor(container: HTMLElement, handlers: StageHandlers, opts: StageOptions) {
    this.handlers = handlers;
    this.manual = opts.manual ?? false;
    this.reduced = opts.reducedMotion ?? false;
    this.maxDpr = opts.maxDpr ?? 2;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'A clear cassette player and a cassette. Drag to turn the player; press its keys; drag the tape into the deck.');
    container.appendChild(this.canvas);
    this.pipe = new Pipeline(this.canvas, opts.preserveBuffer);
    this.pipe.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.mats = new Materials(this.pipe.roomRT.texture, ROOM_SIZE, this.camera, coarse ? 1 : 2);
    this.asm = new Assembly(this.pipe.opaque, this.pipe.glass, this.mats, opts.fonts, this.pipe.renderer);
    this.poser = new RigPoser(this.asm);
    this.pipe.registerGlass([...this.asm.groups.body.meshes, ...this.asm.groups.door.meshes, ...this.asm.groups.cassette.meshes]);

    const inv = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
    this.shadow = {
      uLight: { value: LIGHT.clone() },
      uInv: { value: inv },
      uBox: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uZ: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uCentre: { value: new THREE.Vector3() },
      uScale: { value: 1 },
    };
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.ShaderMaterial({ uniforms: this.shadow, vertexShader: BACKDROP_VERT_SRC, fragmentShader: BACKDROP_FRAG_SRC, depthWrite: false }),
    );
    this.backdrop.position.z = BACKDROP_Z;
    this.backdrop.renderOrder = -20;
    this.backdrop.updateMatrixWorld();
    this.pipe.opaque.add(this.backdrop);

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('lostpointercapture', this.onLost);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.layout();
    this.placeRest();
    this.renderFrame(0);
    handlers.onReady?.();
    if (!this.manual) this.raf = requestAnimationFrame(this.loop);
  }

  // ───────────────────────── public API ─────────────────────────

  setLabel(side: 'A' | 'B', canvas: HTMLCanvasElement): void {
    this.asm.setLabel(side, canvas, this.pipe.renderer);
  }

  setView(mode: ViewMode): void {
    this.view = mode;
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  resetView(): void {
    this.homing = true;
    this.view = 'hero';
  }

  /** Deterministic stepping for capture and tests. */
  setManual(on: boolean): void {
    if (on === this.manual) return;
    this.manual = on;
    if (on) cancelAnimationFrame(this.raf);
    else {
      this.last = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  advance(dt: number): void {
    this.handlers.tick?.(dt);
    this.renderFrame(dt);
  }

  /** Scripted rotation (demo capture uses the same orbit state as the pointer). */
  setOrbit(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.vyaw = 0;
    this.vpitch = 0;
    this.homing = false;
  }

  get orbit(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  /** Screen position (CSS px) of a named feature, for tests and the demo script. */
  screenOf(target: 'cassette' | 'door' | 'slot' | 'body' | KeyName): { x: number; y: number } {
    const v = new THREE.Vector3();
    if (target === 'cassette') v.copy(this.poser.cassettePose.p);
    else if (target === 'slot') v.copy(this.poser.approachPose('A', pose()).p);
    else if (target === 'door') v.set(0, 18, 18).applyMatrix4(this.asm.rig('door').matrixWorld);
    else if (target === 'body') v.set(-40, -30, 16).applyMatrix4(this.asm.rig('player').matrixWorld);
    else v.set(0, 6, 0).applyMatrix4(this.asm.rig(`key:${target}`).matrixWorld);
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  /** Rendered pixels as a data URL (used for the collector card). */
  snapshot(type = 'image/png'): string {
    this.renderFrame(0);
    return this.canvas.toDataURL(type);
  }

  debug(): Record<string, unknown> {
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      view: this.view,
      hubL: this.asm.rig('hubL').rotation.z,
      hubR: this.asm.rig('hubR').rotation.z,
      spindleL: this.asm.rig('spindleL').rotation.z,
      packL: this.asm.packMaterials.L.uniforms.uRadius.value,
      packR: this.asm.packMaterials.R.uniforms.uRadius.value,
      doorX: this.asm.rig('door').quaternion.x,
      cassette: this.poser.cassettePose.p.toArray(),
      dpr: this.pipe.renderer.getPixelRatio(),
      frames: this.frameStats.frames,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onLost);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.asm.dispose();
    this.mats.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.pipe.dispose();
    this.canvas.remove();
  }

  // ───────────────────────── frame ─────────────────────────

  private readonly loop = (now: number): void => {
    if (this.disposed || this.manual) return;
    this.raf = requestAnimationFrame(this.loop);
    const gap = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    const dt = Math.min(gap, 1 / 20);
    this.handlers.tick?.(dt);
    this.renderFrame(dt);
    this.probe(gap);
  };

  private renderFrame(dt: number): void {
    this.time += dt;
    this.frameStats.frames++;
    const f = this.handlers.frame();
    this.updateOrbit(dt);
    this.placeRest();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    if (!this.reduced && this.gesture.kind === 'none' && this.idle > 2.5) {
      const s = Math.min(1, (this.idle - 2.5) / 2);
      const sway = new THREE.Euler(0.025 * Math.sin(this.time * 0.6) * s, 0.06 * Math.sin(this.time * 0.37) * s, 0.012 * Math.sin(this.time * 0.5) * s);
      q.multiply(new THREE.Quaternion().setFromEuler(sway));
    }
    this.poser.update(dt, {
      deck: f.deck,
      pressed: f.pressed,
      volume: f.volume,
      rest: this.rest,
      player: q,
      reduced: this.reduced,
      time: this.time,
    });
    this.asm.sync();
    this.updateCamera(dt, f.deck);
    this.updateShadows(f.deck);
    const groups = this.orderGroups(f.deck);
    this.pipe.draw(this.camera, groups, this.scissor());
  }

  private updateOrbit(dt: number): void {
    this.idle += dt;
    if (this.homing) {
      [this.yaw, this.vyaw] = spring(this.yaw, this.vyaw, HERO.yaw, 6, dt);
      [this.pitch, this.vpitch] = spring(this.pitch, this.vpitch, HERO.pitch, 6, dt);
      if (Math.abs(this.yaw - HERO.yaw) < 1e-3 && Math.abs(this.pitch - HERO.pitch) < 1e-3) this.homing = false;
      return;
    }
    if (this.gesture.kind === 'rotate') return;
    const damp = Math.exp(-dt * (this.reduced ? 12 : 4.2));
    this.vyaw *= damp;
    this.vpitch *= damp;
    this.yaw = THREE.MathUtils.clamp(this.yaw + this.vyaw * dt, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.vpitch * dt, PITCH_LIMIT[0], PITCH_LIMIT[1]);
  }

  private placeRest(): void {
    if (this.portrait) {
      this.rest.p.set(0, -98, 14);
      this.rest.q.setFromEuler(new THREE.Euler(0.42, -0.18, 0.05));
    } else {
      this.rest.p.set(124, -10, 14);
      this.rest.q.setFromEuler(new THREE.Euler(0.36, -0.52, 0.07));
    }
  }

  private updateCamera(dt: number, deck: DeckSnapshot): void {
    const loose = deck.cassette !== 'seated' && deck.cassette !== 'inserting' ? 1 : 0;
    [this.compose[0], this.compose[1]] = spring(this.compose[0], this.compose[1], loose, 2.6, dt);
    [this.viewMix[0], this.viewMix[1]] = spring(this.viewMix[0], this.viewMix[1], this.view === 'reels' ? 1 : 0, 3.2, dt);
    [this.keysMix[0], this.keysMix[1]] = spring(this.keysMix[0], this.keysMix[1], this.view === 'keys' ? 1 : 0, 3.2, dt);
    const c = this.compose[0];
    const aspect = this.size.w / this.size.h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // Composition box: the player, plus the loose tape beside (landscape) or below (portrait) it.
    const boxW = this.portrait ? 136 : 136 + c * 128;
    const boxH = this.portrait ? 118 + c * 96 : 118;
    const fit = (w: number, h: number): number => Math.max(h / 0.66 / 2 / tanHalf, w / 0.84 / 2 / (tanHalf * aspect));
    let dist = fit(boxW, boxH);
    const target = new THREE.Vector3(this.portrait ? 0 : c * 60, this.portrait ? -c * 48 : 2, 0);
    // Macro views: reels through the window, or the keys from above.
    const reels = this.viewMix[0];
    const keys = this.keysMix[0];
    if (reels > 1e-3) {
      const focus = this.poser.cassettePose.p.clone();
      target.lerp(focus, reels);
      // Close on the tape window: the shell's width with a little air.
      dist = THREE.MathUtils.lerp(dist, fit(112, 78), reels);
    }
    if (keys > 1e-3) {
      const focus = new THREE.Vector3(0, BODY.hh, 0).applyMatrix4(this.asm.rig('player').matrixWorld);
      target.lerp(focus, keys);
      dist = THREE.MathUtils.lerp(dist, fit(124, 64), keys);
    }
    this.camera.aspect = aspect;
    this.camera.position.set(target.x, target.y, dist);
    this.camera.lookAt(target.x, target.y, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.shadow.uCentre.value.copy(target);
    this.shadow.uScale.value = dist / 900;
  }

  private updateShadows(deck: DeckSnapshot): void {
    const inv = this.shadow.uInv.value;
    const box = this.shadow.uBox.value;
    const z = this.shadow.uZ.value;
    inv[0].copy(this.asm.rig('player').matrixWorld).invert();
    box[0].set(BODY.hw - 1, BODY.hh - 1, BODY.r, 0.15);
    z[0].set(0, 1.5);
    inv[1].copy(this.asm.rig('door').matrixWorld).invert();
    box[1].set(52, 37, 7, deck.door === 'closed' ? 0 : 0.05);
    z[1].set(16.8, 0);
    inv[2].copy(this.asm.rig('cassette').matrixWorld).invert();
    const loose = deck.cassette !== 'seated';
    box[2].set(CASSETTE.hw, CASSETTE.hh, CASSETTE.r, loose ? 0.12 : 0);
    z[2].set(0, 0.5);
  }

  private orderGroups(deck: DeckSnapshot): GlassGroup[] {
    const { body, door, cassette } = this.asm.groups;
    const view = this.camera.matrixWorldInverse;
    const depthOf = (rig: string, local: THREE.Vector3): number =>
      local.clone().applyMatrix4(this.asm.rig(rig as 'player').matrixWorld).applyMatrix4(view).z;
    body.depth = depthOf('player', new THREE.Vector3(0, 0, 0));
    door.depth = depthOf('door', new THREE.Vector3(0, 0, 17));
    cassette.depth = depthOf('cassette', new THREE.Vector3());
    const inside = deck.cassette === 'seated' || (deck.cassette === 'inserting' && deck.cassetteT > 0.55);
    this.glassList.length = 0;
    if (inside) {
      // Nested: when the front faces the camera draw shell → tape → door; from behind, reverse.
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.asm.rig('player').quaternion).z > 0;
      this.glassList.push(...(front ? [body, cassette, door] : [door, cassette, body]));
    } else {
      this.glassList.push(body, door, cassette);
      this.glassList.sort((a, b) => a.depth - b.depth);
    }
    return this.glassList;
  }

  private scissor(): Rect | null {
    const { w, h } = this.pipe.drawSize;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const c = new THREE.Vector3();
    const boxes: [THREE.Matrix4, number, number, number][] = [
      [this.asm.rig('player').matrixWorld, BODY.hw + 6, BODY.hh + 14, BODY.hd + 6],
      [this.asm.rig('door').matrixWorld, BODY.hw, BODY.hh, 22],
      [this.asm.rig('cassette').matrixWorld, CASSETTE.hw + 4, CASSETTE.hh + 4, CASSETTE.hd + 4],
    ];
    for (const [m, bx, by, bz] of boxes) {
      for (let i = 0; i < 8; i++) {
        c.set(i & 1 ? bx : -bx, i & 2 ? by : -by, i & 4 ? bz : -bz).applyMatrix4(m).project(this.camera);
        if (c.z > 1) continue;
        x0 = Math.min(x0, c.x);
        x1 = Math.max(x1, c.x);
        y0 = Math.min(y0, c.y);
        y1 = Math.max(y1, c.y);
      }
    }
    const pad = 0.03;
    const px = (v: number): number => Math.round(((v + 1) / 2) * w);
    const py = (v: number): number => Math.round(((v + 1) / 2) * h);
    const r = {
      x: THREE.MathUtils.clamp(px(x0 - pad), 0, w),
      y: THREE.MathUtils.clamp(py(y0 - pad), 0, h),
      x1: THREE.MathUtils.clamp(px(x1 + pad), 0, w),
      y1: THREE.MathUtils.clamp(py(y1 + pad), 0, h),
    };
    return r.x1 > r.x && r.y1 > r.y ? r : null;
  }

  private layout(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || 1;
    const h = parent?.clientHeight || 1;
    this.size = { w, h };
    this.portrait = h > w * 1.08;
    this.pipe.setSize(w, h);
    if (this.manual) this.renderFrame(0);
  }

  private probe(gap: number): void {
    if (!this.dprProbe || document.hidden || gap > 0.1) return;
    this.frameStats.gaps.push(gap);
    if (this.frameStats.gaps.length < 120) return;
    const gaps = this.frameStats.gaps.sort((a, b) => a - b);
    const typical = gaps[gaps.length >> 1];
    gaps.length = 0;
    const ratio = this.pipe.renderer.getPixelRatio();
    if (typical < 1 / 40 || ratio <= 1) {
      this.dprProbe = false;
      return;
    }
    this.pipe.renderer.setPixelRatio(Math.max(1, Math.min(ratio - 0.25, Math.round(ratio * Math.sqrt(1 / 45 / typical) * 4) / 4)));
    this.layout();
  }

  private readonly onRestored = (): void => this.pipe.bakeRoom();

  // ───────────────────────── input ─────────────────────────

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  }

  private pick(e: PointerEvent): HitKind | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.asm.hitMeshes, false);
    if (!hits.length) return null;
    // Keys and the cassette win over the body box they sit in or beside.
    const order = (h: HitKind): number => (h.kind === 'key' ? 0 : h.kind === 'cassette' ? 1 : h.kind === 'door' ? 2 : 3);
    const near = hits[0].distance;
    const candidates = hits.filter((h) => h.distance < near + 30).map((h) => h.object.userData.hit as HitKind);
    candidates.sort((a, b) => order(a) - order(b));
    return candidates[0];
  }

  private worldOnPlane(e: PointerEvent, depth: number): THREE.Vector3 {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ?? out;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.gesture.kind !== 'none') return;
    this.idle = 0;
    this.homing = false;
    this.handlers.onInteract?.();
    const hit = this.pick(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (hit?.kind === 'key') {
      this.gesture = { kind: 'key', id: e.pointerId, key: hit.key };
      this.handlers.onKeyDown(hit.key);
      return;
    }
    if (hit?.kind === 'cassette') {
      const p = this.poser.cassettePose.p;
      const at = this.worldOnPlane(e, p.z);
      this.gesture = { kind: 'cassette', id: e.pointerId, sx: e.clientX, sy: e.clientY, dragging: false, offset: p.clone().sub(at), depth: p.z };
      return;
    }
    this.gesture = { kind: 'rotate', id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now(), hit };
    this.vyaw = 0;
    this.vpitch = 0;
    this.canvas.style.cursor = 'grabbing';
  };

  private readonly onMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none') {
      this.hover = this.pick(e);
      this.canvas.style.cursor = this.hover && this.hover.kind !== 'body' ? 'pointer' : 'grab';
      return;
    }
    if ('id' in g && g.id !== e.pointerId) return;
    this.idle = 0;
    if (g.kind === 'rotate') {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      const now = performance.now();
      const dts = Math.max((now - g.t) / 1000, 1 / 240);
      g.x = e.clientX;
      g.y = e.clientY;
      g.t = now;
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.sx, e.clientY - g.sy));
      this.yaw = THREE.MathUtils.clamp(this.yaw + dx * ROT_RATE, -YAW_LIMIT, YAW_LIMIT);
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * ROT_RATE, PITCH_LIMIT[0], PITCH_LIMIT[1]);
      this.vyaw = THREE.MathUtils.lerp(this.vyaw, (dx * ROT_RATE) / dts, 0.5);
      this.vpitch = THREE.MathUtils.lerp(this.vpitch, (dy * ROT_RATE) / dts, 0.5);
    } else if (g.kind === 'cassette') {
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP_SLOP) return;
        const at = this.worldOnPlane(e, g.depth).add(g.offset);
        if (!this.handlers.onCassetteGrab(at)) {
          // The tape can't come out right now (it's seated, playing, or the door is shut):
          // dragging across it turns the whole player instead, like dragging anywhere else.
          this.gesture = { kind: 'rotate', id: g.id, x: e.clientX, y: e.clientY, sx: g.sx, sy: g.sy, moved: TAP_SLOP, t: performance.now(), hit: null };
          this.vyaw = 0;
          this.vpitch = 0;
          this.canvas.style.cursor = 'grabbing';
          return;
        }
        g.dragging = true;
        this.canvas.style.cursor = 'grabbing';
      }
      const at = this.worldOnPlane(e, g.depth).add(g.offset);
      // Lift the tape toward the viewer while held so it clears the door.
      at.z = Math.max(at.z, 30);
      const approach = this.poser.approachPose('A', pose()).p;
      const near = Math.hypot(at.x - approach.x, at.y - approach.y) < SNAP_DISTANCE;
      this.handlers.onCassetteMove(at, near);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none' || ('id' in g && g.id !== e.pointerId)) return;
    this.gesture = { kind: 'none' };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = '';
    if (g.kind === 'key') this.handlers.onKeyUp(g.key);
    else if (g.kind === 'cassette') {
      if (g.dragging) this.handlers.onCassetteDrop();
      else this.handlers.onCassetteTap();
    } else if (g.kind === 'rotate') {
      if (performance.now() - g.t > 90) {
        this.vyaw = 0;
        this.vpitch = 0;
      }
      if (g.moved < TAP_SLOP && g.hit?.kind === 'door') this.handlers.onDoorTap();
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none' || ('id' in g && g.id !== e.pointerId)) return;
    this.gesture = { kind: 'none' };
    this.canvas.style.cursor = '';
    if (g.kind === 'key') this.handlers.onKeyUp(g.key);
    if (g.kind === 'cassette' && g.dragging) this.handlers.onCassetteCancel();
  };

  private readonly onLost = (e: PointerEvent): void => {
    // Capture lost without pointerup (window blur, element removed): never leave a stuck gesture.
    if (this.gesture.kind !== 'none') this.onCancel(e);
  };

  private readonly onLeave = (): void => {
    this.hover = null;
  };

  /** Releases any held key or dragged tape (e.g. on window blur). */
  cancelGestures(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'key') this.handlers.onKeyUp(g.key);
    if (g.kind === 'cassette' && g.dragging) this.handlers.onCassetteCancel();
  }

  get gestureKind(): string {
    return this.gesture.kind;
  }

  static keys(): readonly KeyName[] {
    return KEY_ORDER;
  }
}
