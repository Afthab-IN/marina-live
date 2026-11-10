// St Mary's Church, Fort St George (1680), the oldest Anglican church east of Suez.
// A white, flat-roofed, thick-walled ("bomb-proof") nave and aisles with tall round-headed windows,
// 19th-century vestries at the east end, and the west tower (added 1701) with its spire (rebuilt 1795).
// Footprint parts follow OSM way 28746263; heights and the spire's shape are illustrated.
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { Soup } from './_stadium';

/** Plan parts in the model frame (+x = east along the nave), from the OSM outline. */
const NAVE = { x0: -12.3, x1: 14.7, z0: -10.3, z1: 10.5, h: 11 };
const VESTRY = { x0: 14.5, x1: 23.0, z0: -5.1, z1: 4.7, h: 8 };
const LINK = { x0: -15.4, x1: -12.2, z0: -4.1, z1: 4.1, h: 9 };
const TOWER = { x0: -24.1, x1: -15.3, z0: -5.2, z1: 5.2 };

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const T = kit.THREE;
  const group = new T.Group();
  group.name = lm.key;
  const s = new Soup();
  const block = (m: MatName, b: { x0: number; x1: number; z0: number; z1: number }, y0: number, y1: number, inset = 0) =>
    s.box(m, (b.x0 + b.x1) / 2, (y0 + y1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0 - 2 * inset, y1 - y0, b.z1 - b.z0 - 2 * inset);

  // plinth, walls, cornice and balustraded parapet for the three low blocks
  for (const b of [NAVE, VESTRY, LINK]) {
    block('stone', b, -1.5, 0.9, -0.15);
    block('white', b, 0.9, b.h);
    block('offwhite', b, b.h, b.h + 0.6, -0.35); // cornice
    // parapet ring (four thin walls) on the flat roof
    const t = 0.45, ph = 1.1, y = b.h + 0.6;
    s.box('white', (b.x0 + b.x1) / 2, y + ph / 2, b.z0 + t / 2, b.x1 - b.x0, ph, t);
    s.box('white', (b.x0 + b.x1) / 2, y + ph / 2, b.z1 - t / 2, b.x1 - b.x0, ph, t);
    s.box('white', b.x0 + t / 2, y + ph / 2, (b.z0 + b.z1) / 2, t, ph, b.z1 - b.z0 - 2 * t);
    s.box('white', b.x1 - t / 2, y + ph / 2, (b.z0 + b.z1) / 2, t, ph, b.z1 - b.z0 - 2 * t);
    // roof terrace
    block('offwhite', b, y, y + 0.15, 0.4);
  }

  // nave: pilasters and tall round-headed windows on both long sides
  const bays = 5;
  const bw = (NAVE.x1 - NAVE.x0) / bays;
  for (const zs of [NAVE.z0, NAVE.z1]) {
    const out = zs < 0 ? -1 : 1;
    for (let i = 0; i <= bays; i++) s.box('offwhite', NAVE.x0 + i * bw, NAVE.h / 2 + 0.5, zs + out * 0.2, 0.9, NAVE.h - 0.4, 0.5);
    for (let i = 0; i < bays; i++) {
      const cx = NAVE.x0 + (i + 0.5) * bw;
      s.box('windowLit', cx, 5.6, zs + out * 0.06, 2.0, 5.2, 0.2);
      s.box('windowLit', cx, 8.45, zs + out * 0.06, 1.3, 0.6, 0.2); // the arch head, stepped
      s.box('offwhite', cx, 2.75, zs + out * 0.2, 2.6, 0.35, 0.45); // sill
    }
  }
  // east end windows (vestries) and the east window of the nave above them
  for (const zs of [VESTRY.z0, VESTRY.z1]) {
    const out = zs < 0 ? -1 : 1;
    for (const cx of [16.8, 20.7]) s.box('windowLit', cx, 4.6, zs + out * 0.06, 1.5, 3.6, 0.2);
  }
  s.box('windowLit', VESTRY.x1 + 0.06, 4.6, -0.2, 0.2, 3.6, 2.2);
  for (const zc of [-7.6, 7.8]) s.box('windowLit', NAVE.x1 + 0.06, 6.0, zc, 0.2, 5.0, 2.0);

  // west tower: stair block, square tower, belfry, octagonal spire
  const tcx = (TOWER.x0 + TOWER.x1) / 2, tcz = (TOWER.z0 + TOWER.z1) / 2;
  block('stone', TOWER, -1.5, 0.9, -0.15);
  block('white', TOWER, 0.9, 12);
  s.box('offwhite', tcx, 12.3, tcz, 9.4, 0.6, 11.0);
  s.box('white', tcx, 16.6, tcz, 7.2, 8.0, 7.2);
  s.box('offwhite', tcx, 20.9, tcz, 7.8, 0.6, 7.8);
  s.box('white', tcx, 23.4, tcz, 6.2, 4.4, 6.2); // belfry
  s.box('offwhite', tcx, 25.9, tcz, 6.9, 0.6, 6.9);
  // belfry openings and a west door
  for (const [dx, dz, sx, sz] of [[3.12, 0, 0.2, 1.6], [-3.12, 0, 0.2, 1.6], [0, 3.12, 1.6, 0.2], [0, -3.12, 1.6, 0.2]]) {
    s.box('black', tcx + dx, 23.3, tcz + dz, sx, 2.8, sz);
  }
  s.box('windowLit', TOWER.x0 - 0.06, 2.9, tcz, 0.2, 4.0, 2.2);
  s.box('windowLit', TOWER.x0 - 0.06, 8.4, tcz, 0.2, 2.6, 1.4);
  // corner pinnacles and the spire
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) s.box('white', tcx + dx * 3.1, 27.0, tcz + dz * 3.1, 0.7, 1.6, 0.7);
  const spire = new T.ConeGeometry(2.6, 13.5, 8, 1).rotateY(Math.PI / 8).translate(tcx, 26.2 + 6.75, tcz);
  s.add('white', spire);
  spire.dispose();
  s.post('gold', tcx, tcz, 39.7, 41.2, 0.12, 0.12, 4);
  s.box('gold', tcx, 40.7, tcz, 0.12, 0.12, 0.9); // the cross
  s.box('gold', tcx, 40.95, tcz, 0.12, 0.5, 0.12);

  s.build(kit, group);
  return { group, notes: 'Footprint from OSM; heights, the three tower stages and the octagonal spire (about 41 m) are illustrated.' };
}
