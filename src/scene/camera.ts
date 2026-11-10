import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Classic isometric tilt: the camera looks down at 35.26 degrees above the horizon. */
export const ISO_POLAR = Math.acos(1 / Math.sqrt(3));
const ISO_DIST = 5000;
const FOV = 32;

export type Mode = 'iso' | 'orbit';
export interface View { x: number; z: number; span?: number; azimuth?: number }
interface Pose { x: number; z: number; scale: number; az: number }

/**
 * Two cameras sharing one target: an orthographic isometric view (drag pans, right-drag turns)
 * and a perspective orbit view (drag orbits, right-drag pans). Scroll zooms in both.
 */
export class CameraRig {
  readonly iso: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  readonly isoControls: OrbitControls;
  readonly orbitControls: OrbitControls;
  /** metres across the screen at iso zoom 1 */
  readonly viewWidth = 2400;
  mode: Mode = 'iso';
  private width = 1;
  private height = 1;
  private fly: { t: number; dur: number; from: Pose; to: Pose } | null = null;

  constructor(dom: HTMLElement, readonly frame: [number, number, number, number]) {
    this.iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);
    this.persp = new THREE.PerspectiveCamera(FOV, 1, 1, 12000);
    const ic = new OrbitControls(this.iso, dom);
    ic.enableDamping = true;
    ic.dampingFactor = 0.12;
    ic.screenSpacePanning = false;
    ic.zoomToCursor = true;
    ic.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    ic.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    ic.minPolarAngle = ic.maxPolarAngle = ISO_POLAR;
    ic.minZoom = 0.3;
    ic.maxZoom = 45;
    const oc = new OrbitControls(this.persp, dom);
    oc.enableDamping = true;
    oc.dampingFactor = 0.12;
    oc.screenSpacePanning = false;
    oc.zoomToCursor = true;
    oc.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    oc.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    oc.minPolarAngle = 0.12;
    oc.maxPolarAngle = Math.PI / 2 - 0.05;
    oc.minDistance = 25;
    oc.maxDistance = 7000;
    oc.enabled = false;
    for (const c of [ic, oc]) c.addEventListener('start', () => { this.fly = null; });
    this.isoControls = ic;
    this.orbitControls = oc;
  }

  get cam(): THREE.OrthographicCamera | THREE.PerspectiveCamera { return this.mode === 'iso' ? this.iso : this.persp; }
  get controls(): OrbitControls { return this.mode === 'iso' ? this.isoControls : this.orbitControls; }
  get azimuth() { return this.controls.getAzimuthalAngle(); }
  get aspect() { return this.width / this.height; }
  get target() { return this.controls.target; }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    const half = this.viewWidth / 2;
    this.iso.left = -half;
    this.iso.right = half;
    this.iso.top = (half * h) / w;
    this.iso.bottom = -this.iso.top;
    this.iso.updateProjectionMatrix();
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
  }

  private scaleFor(span: number) {
    if (this.mode === 'iso') {
      const across = this.aspect >= 1 ? span * this.aspect : span;
      return THREE.MathUtils.clamp(this.viewWidth / across, this.isoControls.minZoom, this.isoControls.maxZoom);
    }
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.min(1, this.aspect);
    return THREE.MathUtils.clamp((span / t) * 1.15, this.orbitControls.minDistance, this.orbitControls.maxDistance);
  }

  private pose(): Pose {
    const t = this.target;
    const scale = this.mode === 'iso' ? this.iso.zoom : this.persp.position.distanceTo(t);
    return { x: t.x, z: t.z, scale, az: this.azimuth };
  }

  private place(p: Pose, polar?: number) {
    const c = this.controls;
    const t = c.target;
    t.set(p.x, 5, p.z);
    if (this.mode === 'iso') {
      const s = Math.sin(ISO_POLAR);
      this.iso.position.set(p.x + Math.sin(p.az) * s * ISO_DIST, 5 + Math.cos(ISO_POLAR) * ISO_DIST, p.z + Math.cos(p.az) * s * ISO_DIST);
      this.iso.zoom = p.scale;
      this.iso.updateProjectionMatrix();
      this.iso.lookAt(t);
    } else {
      const ph = polar ?? c.getPolarAngle();
      this.persp.position.set(p.x + Math.sin(p.az) * Math.sin(ph) * p.scale, 5 + Math.cos(ph) * p.scale, p.z + Math.cos(p.az) * Math.sin(ph) * p.scale);
      this.persp.lookAt(t);
    }
    c.update();
  }

  /** Switch between the isometric and orbit cameras, keeping the target, heading and rough scale. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    const p = this.pose();
    const across = this.mode === 'iso' ? this.viewWidth / p.scale / Math.max(1, this.aspect) : p.scale / 1.6;
    this.fly = null;
    this.isoControls.enabled = mode === 'iso';
    this.orbitControls.enabled = mode === 'orbit';
    this.mode = mode;
    this.place({ ...p, scale: this.scaleFor(THREE.MathUtils.clamp(across, 40, 6000)) }, mode === 'orbit' ? 1.05 : undefined);
  }

  /** Jump straight to a view. */
  set(v: View) {
    this.fly = null;
    const p = this.pose();
    this.place({ x: v.x, z: v.z, scale: v.span ? this.scaleFor(v.span) : p.scale, az: v.azimuth ?? p.az });
  }

  /** Smoothly fly to a view (interrupted by any drag or scroll). */
  flyTo(v: View, dur = 1.4) {
    const from = this.pose();
    let az = v.azimuth ?? from.az;
    while (az - from.az > Math.PI) az -= 2 * Math.PI;
    while (az - from.az < -Math.PI) az += 2 * Math.PI;
    this.fly = { t: 0, dur, from, to: { x: v.x, z: v.z, scale: v.span ? this.scaleFor(v.span) : from.scale, az } };
  }

  rotateBy(delta: number) {
    const t = this.target;
    this.flyTo({ x: t.x, z: t.z, azimuth: this.azimuth + delta }, 0.7);
  }

  update(dt: number) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      // zoom or distance eases in log space so the flight feels even
      const scale = Math.exp(Math.log(f.from.scale) + (Math.log(f.to.scale) - Math.log(f.from.scale)) * e);
      this.place({ x: f.from.x + (f.to.x - f.from.x) * e, z: f.from.z + (f.to.z - f.from.z) * e, scale, az: f.from.az + (f.to.az - f.from.az) * e });
      if (f.t >= 1) this.fly = null;
    } else {
      this.controls.update();
    }
    const [x0, z0, x1, z1] = this.frame;
    const t = this.target;
    const cx = THREE.MathUtils.clamp(t.x, x0, x1), cz = THREE.MathUtils.clamp(t.z, z0, z1);
    if (cx !== t.x || cz !== t.z) {
      const cam = this.cam;
      cam.position.x += cx - t.x; cam.position.z += cz - t.z;
      t.x = cx; t.z = cz;
    }
    if (this.mode === 'orbit') {
      const d = this.persp.position.distanceTo(t);
      this.persp.near = THREE.MathUtils.clamp(d * 0.02, 0.5, 40);
      this.persp.far = d * 3 + 9000;
      this.persp.updateProjectionMatrix();
    }
  }

  /** Metres per CSS pixel at the target. */
  metresPerPixel() {
    if (this.mode === 'iso') return (this.iso.right - this.iso.left) / this.iso.zoom / this.width;
    const d = this.persp.position.distanceTo(this.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / this.height;
  }
}
