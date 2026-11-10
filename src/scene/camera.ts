import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Classic isometric tilt: the camera looks down at 35.26 degrees above the horizon. */
export const ISO_POLAR = Math.acos(1 / Math.sqrt(3));
const DIST = 5000;

export interface View { x: number; z: number; span?: number; azimuth?: number; y?: number }

export class CameraRig {
  readonly cam: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  /** metres across the screen at zoom 1 */
  readonly viewWidth = 2400;
  private width = 1;
  private height = 1;
  private fly: { t: number; dur: number; from: { x: number; z: number; zoom: number; az: number }; to: { x: number; z: number; zoom: number; az: number } } | null = null;

  constructor(dom: HTMLElement, readonly frame: [number, number, number, number]) {
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);
    const c = new OrbitControls(this.cam, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.minPolarAngle = c.maxPolarAngle = ISO_POLAR;
    c.minZoom = 0.3;
    c.maxZoom = 45;
    c.addEventListener('start', () => { this.fly = null; });
    this.controls = c;
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    const half = this.viewWidth / 2;
    this.cam.left = -half;
    this.cam.right = half;
    this.cam.top = (half * h) / w;
    this.cam.bottom = -this.cam.top;
    this.cam.updateProjectionMatrix();
  }

  get azimuth() { return this.controls.getAzimuthalAngle(); }
  get aspect() { return this.width / this.height; }

  private place(x: number, z: number, zoom: number, az: number, y = 5) {
    const t = this.controls.target;
    t.set(x, y, z);
    const s = Math.sin(ISO_POLAR);
    this.cam.position.set(x + Math.sin(az) * s * DIST, y + Math.cos(ISO_POLAR) * DIST, z + Math.cos(az) * s * DIST);
    this.cam.zoom = zoom;
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(t);
    this.controls.update();
  }

  private zoomFor(span: number) {
    // span is the width in metres that should fit the narrower screen axis
    const across = this.aspect >= 1 ? span * this.aspect : span;
    return THREE.MathUtils.clamp(this.viewWidth / across, this.controls.minZoom, this.controls.maxZoom);
  }

  /** Jump straight to a view. */
  set(v: View) {
    this.fly = null;
    this.place(v.x, v.z, v.span ? this.zoomFor(v.span) : this.cam.zoom, v.azimuth ?? this.azimuth);
  }

  /** Smoothly fly to a view (interrupted by any drag or scroll). */
  flyTo(v: View, dur = 1.4) {
    const t = this.controls.target;
    let az = v.azimuth ?? this.azimuth;
    const cur = this.azimuth;
    while (az - cur > Math.PI) az -= 2 * Math.PI;
    while (az - cur < -Math.PI) az += 2 * Math.PI;
    this.fly = {
      t: 0, dur,
      from: { x: t.x, z: t.z, zoom: this.cam.zoom, az: cur },
      to: { x: v.x, z: v.z, zoom: v.span ? this.zoomFor(v.span) : this.cam.zoom, az },
    };
  }

  rotateBy(delta: number) {
    const t = this.controls.target;
    this.flyTo({ x: t.x, z: t.z, azimuth: this.azimuth + delta }, 0.7);
  }

  update(dt: number) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      // zoom eases in log space so the flight feels even
      const zoom = Math.exp(Math.log(f.from.zoom) + (Math.log(f.to.zoom) - Math.log(f.from.zoom)) * e);
      this.place(f.from.x + (f.to.x - f.from.x) * e, f.from.z + (f.to.z - f.from.z) * e, zoom, f.from.az + (f.to.az - f.from.az) * e);
      if (f.t >= 1) this.fly = null;
      return;
    }
    this.controls.update();
    const [x0, z0, x1, z1] = this.frame;
    const t = this.controls.target;
    const cx = THREE.MathUtils.clamp(t.x, x0, x1), cz = THREE.MathUtils.clamp(t.z, z0, z1);
    if (cx !== t.x || cz !== t.z) {
      const dx = cx - t.x, dz = cz - t.z;
      t.x = cx; t.z = cz;
      this.cam.position.x += dx; this.cam.position.z += dz;
    }
  }

  /** Metres per CSS pixel at the current zoom. */
  metresPerPixel() {
    return (this.cam.right - this.cam.left) / this.cam.zoom / this.width;
  }
}
