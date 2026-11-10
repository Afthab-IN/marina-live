import type { GridInfo } from '../data/types';

/** Bilinear sampler over a regular grid stored row-major (rows along +z). */
export class Grid {
  constructor(readonly info: GridInfo, readonly data: ArrayLike<number>, readonly scale: number, readonly bias = 0) {}

  at(x: number, z: number): number {
    const { x0, z0, step, cols, rows } = this.info;
    let fx = (x - x0) / step;
    let fz = (z - z0) / step;
    fx = Math.min(Math.max(fx, 0), cols - 1.001);
    fz = Math.min(Math.max(fz, 0), rows - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const d = this.data;
    const i = iz * cols + ix;
    const v = d[i] * (1 - ax) * (1 - az) + d[i + 1] * ax * (1 - az) + d[i + cols] * (1 - ax) * az + d[i + cols + 1] * ax * az;
    return (v - this.bias) * this.scale;
  }
}

/** Terrain heights are stored in centimetres. */
export const terrainGrid = (info: GridInfo, cm: ArrayLike<number>) => new Grid(info, cm, 0.01);

/** Coast distance is stored as 128 + metres / scale: positive at sea, negative on land. */
export const coastGrid = (info: GridInfo & { scale: number }, u8: ArrayLike<number>) => new Grid(info, u8, info.scale, 128);
