/**
 * Scene assembly. Parts hang off "rigs" (plain Object3D nodes that are never rendered). Each frame
 * the rig hierarchy is updated once and every visible mesh, its depth proxy and its hit target copy
 * their rig's world matrix — the same manual-matrix approach as the reference stage, so the three
 * scenes (opaque, glass, hits) always agree.
 */
import * as THREE from 'three';
import { HUB_RADIUS } from '../../deck/transport';
import {
  CASSETTE,
  type CassettePart,
  type CassetteRig,
  LABEL,
  cassetteGlass,
  cassetteParts,
  ribbonGeometry,
} from '../geometry/cassette';
import {
  ABSORB,
  BODY,
  CAPSTAN,
  DOOR,
  HINGE,
  HUB_X,
  HUB_Y,
  KEY,
  KEY_ORDER,
  type KeyName,
  MOTOR,
  type Part,
  type RigName,
  SLOT,
  WHEEL,
  bodyGlass,
  doorGlass,
  playerParts,
} from '../geometry/player';
import { type Materials, PRESET } from '../materials';
import {
  type Fonts,
  backPrint,
  deckPrint,
  doorPrint,
  keyGlyph,
  keyStrip,
  shellPrint,
  toTexture,
  volumeScale,
} from '../textures/prints';
import type { GlassGroup } from './pipeline';

type AnyRig = RigName | CassetteRig;

interface Attached {
  mesh: THREE.Object3D;
  rig: THREE.Object3D;
  local: THREE.Matrix4;
}

export type HitKind = { kind: 'key'; key: KeyName } | { kind: 'door' } | { kind: 'cassette' } | { kind: 'body' };

const KEY_LABELS: Record<KeyName, string> = {
  stop: 'STOP',
  rewind: 'REW',
  play: 'PLAY',
  fastForward: 'F.FWD',
  pause: 'PAUSE',
  eject: 'EJECT',
};

export class Assembly {
  readonly rigRoot = new THREE.Object3D();
  readonly rigs = new Map<AnyRig, THREE.Object3D>();
  readonly hits = new THREE.Scene();
  readonly hitMeshes: THREE.Mesh[] = [];
  readonly groups: { body: GlassGroup; door: GlassGroup; cassette: GlassGroup };
  readonly packMaterials: { L: THREE.ShaderMaterial; R: THREE.ShaderMaterial };
  readonly ribbon: THREE.BufferGeometry;
  readonly labelMaterials: { A: THREE.ShaderMaterial; B: THREE.ShaderMaterial };
  private readonly attached: Attached[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly hitMaterial = new THREE.MeshBasicMaterial();

  constructor(
    private readonly opaque: THREE.Scene,
    private readonly glass: THREE.Scene,
    private readonly mats: Materials,
    fonts: Fonts,
    renderer: THREE.WebGLRenderer,
  ) {
    this.hits.matrixWorldAutoUpdate = false;
    this.buildRigs();

    const tex = (c: HTMLCanvasElement): THREE.CanvasTexture => this.keepTex(toTexture(c, renderer));
    // ── Player opaque parts.
    for (const p of playerParts({ deck: tex(deckPrint(fonts)) })) this.addPart(p, p.rig);

    // ── Cassette opaque parts.
    this.packMaterials = { L: mats.pack(HUB_RADIUS), R: mats.pack(HUB_RADIUS) };
    const blank = this.keepTex(new THREE.CanvasTexture(document.createElement('canvas')));
    this.labelMaterials = {
      A: mats.surface({ ...PRESET.paper, map: blank, mapMode: 1 }),
      B: mats.surface({ ...PRESET.paper, map: blank, mapMode: 1 }),
    };
    for (const p of cassetteParts()) this.addCassettePart(p);
    this.ribbon = this.keepGeo(ribbonGeometry());
    this.addMesh(new THREE.Mesh(this.ribbon, mats.surface(PRESET.tape)), 'cassette', undefined, undefined, true);

    // ── Decals (ink on plastic/metal), drawn in the opaque pass after solid parts.
    this.decal(tex(doorPrint(fonts, DOOR.hw * 2, DOOR.hh * 2)), DOOR.hw * 2, DOOR.hh * 2, 'door', [0, DOOR.cy, DOOR.z0 + 0.42], [0, 0, 0], 0.95);
    this.decal(tex(backPrint(fonts, 100, 60)), 100, 60, 'player', [0, 4, -BODY.hd - 0.02], [0, Math.PI, 0], 0.9);
    this.decal(
      tex(keyStrip(fonts, KEY_ORDER.map((k) => KEY_LABELS[k]), KEY.pitch)),
      KEY.pitch * 6,
      5,
      'player',
      [0, BODY.hh + 0.04, KEY.z + KEY.d / 2 + 4.6],
      [-Math.PI / 2, 0, 0],
      0.95,
    );
    this.decal(tex(volumeScale(fonts)), 26, 8, 'player', [BODY.hw + 0.05, WHEEL.y - 11, WHEEL.z + 4], [0, Math.PI / 2, 0], 0.9);
    for (const side of ['A', 'B'] as const) {
      const z = side === 'A' ? CASSETTE.hd + 0.03 : -CASSETTE.hd - 0.03;
      this.decal(tex(shellPrint(fonts, side)), 100, 64, 'cassette', [0, 0, z], [0, side === 'A' ? 0 : Math.PI, 0], 0.7);
    }
    KEY_ORDER.forEach((k) => {
      this.decal(tex(keyGlyph(k, fonts, KEY_LABELS[k])), KEY.w - 0.4, KEY.d - 0.4, `key:${k}`, [0, KEY.h + 0.03, 0], [-Math.PI / 2, 0, 0], 0.92);
    });

    // ── Clear groups.
    const body = bodyGlass();
    const door = doorGlass();
    const cas = cassetteGlass();
    this.groups = {
      body: this.glassGroup(body.rods, body.sheets, ABSORB.body, 'player'),
      door: this.glassGroup(door.rods, door.sheets, ABSORB.door, 'door'),
      cassette: this.glassGroup(cas.rods, cas.sheets, [0.0044, 0.0036, 0.0032], 'cassette'),
    };

    // ── Hit targets (never drawn).
    KEY_ORDER.forEach((k) => this.hit(new THREE.BoxGeometry(KEY.w + 1.4, KEY.h + 4, KEY.d + 2), `key:${k}`, [0, KEY.h / 2, 0], { kind: 'key', key: k }));
    this.hit(new THREE.BoxGeometry(DOOR.hw * 2, DOOR.hh * 2, 5), 'door', [0, DOOR.cy, (DOOR.z0 + DOOR.z1) / 2], { kind: 'door' });
    this.hit(new THREE.BoxGeometry(CASSETTE.hw * 2 + 4, CASSETTE.hh * 2 + 4, CASSETTE.hd * 2 + 4), 'cassette', [0, 0, 0], { kind: 'cassette' });
    this.hit(new THREE.BoxGeometry(BODY.hw * 2, BODY.hh * 2 + 10, BODY.hd * 2), 'player', [0, 4, 0], { kind: 'body' });
  }

  private buildRigs(): void {
    const make = (name: AnyRig, parent: THREE.Object3D, at?: [number, number, number]): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.name = name;
      if (at) o.position.set(...at);
      parent.add(o);
      this.rigs.set(name, o);
      return o;
    };
    const player = make('player', this.rigRoot);
    make('door', player);
    make('spindleL', player, [-HUB_X, SLOT.y + HUB_Y, 0]);
    make('spindleR', player, [HUB_X, SLOT.y + HUB_Y, 0]);
    make('head', player);
    make('pinch', player, [CAPSTAN[0], CAPSTAN[1] - 4.6, SLOT.z]);
    make('flywheel', player, [CAPSTAN[0], CAPSTAN[1], -8.6]);
    make('idler', player, [0, SLOT.y + HUB_Y - 9, -5.4]);
    make('pulley', player, [MOTOR[0], MOTOR[1], -7.6]);
    make('wheel', player, [WHEEL.x, WHEEL.y, WHEEL.z]);
    KEY_ORDER.forEach((k, i) => make(`key:${k}`, player, [(i - 2.5) * KEY.pitch, KEY.top + 1.05, KEY.z]));
    const cassette = make('cassette', this.rigRoot);
    make('hubL', cassette, [-HUB_X, HUB_Y, 0]);
    make('hubR', cassette, [HUB_X, HUB_Y, 0]);
    make('packL', cassette, [-HUB_X, HUB_Y, 0]);
    make('packR', cassette, [HUB_X, HUB_Y, 0]);
  }

  rig(name: AnyRig): THREE.Object3D {
    const r = this.rigs.get(name);
    if (!r) throw new Error(`Unknown rig ${name}`);
    return r;
  }

  private keepGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private keepTex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private localMatrix(at?: [number, number, number], rot?: [number, number, number]): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...(at ?? [0, 0, 0])), q, new THREE.Vector3(1, 1, 1));
    return m;
  }

  private addMesh(mesh: THREE.Mesh, rig: AnyRig, at?: [number, number, number], rot?: [number, number, number], noProxy = false): void {
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    const local = this.localMatrix(at, rot);
    this.opaque.add(mesh);
    this.attached.push({ mesh, rig: this.rig(rig), local });
    if (!noProxy) {
      const proxy = new THREE.Mesh(mesh.geometry, this.depthOnly);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.renderOrder = -5;
      this.glass.add(proxy);
      this.attached.push({ mesh: proxy, rig: this.rig(rig), local });
    }
  }

  private addPart(p: Part, rig: RigName): void {
    this.keepGeo(p.geometry);
    this.addMesh(new THREE.Mesh(p.geometry, this.mats.surface(p.spec)), rig, p.at, p.rot, p.noProxy);
  }

  private addCassettePart(p: CassettePart): void {
    this.keepGeo(p.geometry);
    let mat: THREE.ShaderMaterial;
    if (p.spec === 'pack') mat = p.rig === 'packL' ? this.packMaterials.L : this.packMaterials.R;
    else if (p.spec === 'label:A') mat = this.labelMaterials.A;
    else if (p.spec === 'label:B') mat = this.labelMaterials.B;
    else if (p.spec === 'tape') mat = this.mats.surface(PRESET.tape);
    else mat = this.mats.surface(p.spec);
    this.addMesh(new THREE.Mesh(p.geometry, mat), p.rig, p.at, p.rot, p.noProxy);
  }

  private decal(map: THREE.Texture, w: number, h: number, rig: AnyRig, at: [number, number, number], rot: [number, number, number], opacity: number): void {
    const mesh = new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(w, h)), this.mats.decal(map, opacity));
    mesh.renderOrder = 10;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.opaque.add(mesh);
    this.attached.push({ mesh, rig: this.rig(rig), local: this.localMatrix(at, rot) });
  }

  private glassGroup(rods: THREE.BufferGeometry, sheets: THREE.BufferGeometry, absorb: [number, number, number], rig: AnyRig): GlassGroup {
    this.keepGeo(rods);
    this.keepGeo(sheets);
    const rodMat = this.mats.rod(absorb);
    const r = new THREE.Mesh(rods, rodMat);
    const s = new THREE.Mesh(sheets, this.mats.sheet(absorb));
    s.renderOrder = 1;
    for (const m of [r, s]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      this.glass.add(m);
      this.attached.push({ mesh: m, rig: this.rig(rig), local: new THREE.Matrix4() });
    }
    return { meshes: [r, s], rodMaterials: [rodMat], depth: 0 };
  }

  private hit(geometry: THREE.BufferGeometry, rig: AnyRig, at: [number, number, number], data: HitKind): void {
    const m = new THREE.Mesh(this.keepGeo(geometry), this.hitMaterial);
    m.matrixAutoUpdate = false;
    m.userData.hit = data;
    this.hits.add(m);
    this.hitMeshes.push(m);
    this.attached.push({ mesh: m, rig: this.rig(rig), local: this.localMatrix(at) });
  }

  setLabel(side: 'A' | 'B', canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): void {
    const mat = this.labelMaterials[side];
    const old = mat.uniforms.uMap.value as THREE.Texture | null;
    const t = toTexture(canvas, renderer);
    mat.uniforms.uMap.value = t;
    this.textures.push(t);
    if (old) {
      old.dispose();
      const i = this.textures.indexOf(old);
      if (i >= 0) this.textures.splice(i, 1);
    }
  }

  /** Copy every rig's world matrix onto its meshes. Call after posing rigs. */
  sync(): void {
    this.rigRoot.updateMatrixWorld(true);
    for (const a of this.attached) {
      a.mesh.matrixWorld.multiplyMatrices(a.rig.matrixWorld, a.local);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.depthOnly.dispose();
    this.hitMaterial.dispose();
  }
}

export { LABEL, HINGE };
