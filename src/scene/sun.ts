import * as THREE from 'three';

/** The sun and sky fill light, with a shadow camera fitted to whatever is on screen. */
export class Sun {
  readonly light: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  readonly dir = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
  private readonly tmp = new THREE.Vector3();
  private readonly view = new THREE.Matrix4();

  constructor(scene: THREE.Scene, mapSize: number) {
    this.light = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(mapSize, mapSize);
    this.light.shadow.bias = -0.00025;
    this.light.shadow.normalBias = 0.5;
    this.fill = new THREE.HemisphereLight(0xdce8f4, 0xb8ab98, 1.15);
    this.light.shadow.radius = 2;
    scene.add(this.light, this.light.target, this.fill);
  }

  /** azimuth: compass degrees the sun stands in (90 = east); elevation in degrees. */
  setAngles(azimuthDeg: number, elevationDeg: number) {
    const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
    // compass: north = -z, east = +x
    this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  }

  /** Fit the shadow camera around the visible ground, snapped to whole texels so edges do not shimmer. */
  fit(points: THREE.Vector3[]) {
    const center = new THREE.Vector3();
    for (const p of points) center.add(p);
    center.multiplyScalar(1 / points.length);
    const cam = this.light.shadow.camera as THREE.OrthographicCamera;
    this.light.target.position.copy(center);
    this.light.position.copy(center).addScaledVector(this.dir, 3000);
    this.light.updateMatrixWorld();
    this.light.target.updateMatrixWorld();
    this.view.lookAt(this.light.position, center, THREE.Object3D.DEFAULT_UP).setPosition(this.light.position).invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      this.tmp.copy(p).applyMatrix4(this.view);
      minX = Math.min(minX, this.tmp.x); maxX = Math.max(maxX, this.tmp.x);
      minY = Math.min(minY, this.tmp.y); maxY = Math.max(maxY, this.tmp.y);
      minZ = Math.min(minZ, this.tmp.z); maxZ = Math.max(maxZ, this.tmp.z);
    }
    const size = Math.max(maxX - minX, maxY - minY) + 40;
    const texel = size / this.light.shadow.mapSize.x;
    const cx = Math.round((minX + maxX) / 2 / texel) * texel, cy = Math.round((minY + maxY) / 2 / texel) * texel;
    cam.left = cx - size / 2; cam.right = cx + size / 2;
    cam.bottom = cy - size / 2; cam.top = cy + size / 2;
    cam.near = Math.max(1, -maxZ - 400);
    cam.far = -minZ + 400;
    cam.updateProjectionMatrix();
  }
}
