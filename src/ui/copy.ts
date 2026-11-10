// On-screen copy. Strings only: the numbers come from public/data/scene.json at runtime.
// House style: short and plain, no em dashes or double hyphens.

export interface Counts {
  buildings: number;
  heightsGooglePct: number; heightsOsmPct: number; heightsEstimatedPct: number;
  treesMapped: number; treesIllustrated: number;
  lampsMapped: number; lampsIllustrated: number;
}

const n = (v: number) => v.toLocaleString('en-IN');
const OSM = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

export const copy = {
  /** loading screen line while the data downloads */
  loading: 'Raising the Marina corridor…',
  /** loading screen line while the geometry is built */
  raising: (c: Counts) => `Raising ${n(c.buildings)} buildings along the Marina…`,
  /** status line under the title once ready */
  status: (c: Counts) =>
    `${n(c.buildings)} buildings · ${n(c.treesMapped)} mapped and ${n(c.treesIllustrated)} illustrated trees · ${n(c.lampsMapped)} mapped street lamps`,
  /** full credits panel (wide screens) */
  credits: (c: Counts) =>
    `${OSM} · Overture Maps (Google Open Buildings, Microsoft) · Google Open Buildings 2.5D heights · Mapzen terrain · three.js. `
    + `Mapped: footprints, roads, rail, coastline, water, parks, ${n(c.treesMapped)} trees and ${n(c.lampsMapped)} street lamps. `
    + `Heights: ${c.heightsGooglePct}% Google 2.5D, ${c.heightsOsmPct}% OSM, ${c.heightsEstimatedPct}% estimated. `
    + `Illustrated: landmark models, facades, rooftop tanks, beach stalls and boats, traffic, trains, waves, ${n(c.treesIllustrated)} extra trees and ${n(c.lampsIllustrated)} extra lamps.`,
  /** compact credits shown inside the light panel on narrow screens */
  creditsShort: () =>
    `${OSM} · Overture Maps · Google Open Buildings 2.5D heights · Mapzen terrain · three.js. Trees, lamps and traffic beyond the mapped ones are illustrated.`,
  /** legend shown with the Sources toggle */
  sourcesTitle: 'Where the data comes from',
  sourcesLegend: {
    osmHeight: 'OSM height', osmLevels: 'OSM levels', google: 'Google 2.5D', estimated: 'estimated',
    treeMapped: 'mapped tree', treeIllustrated: 'illustrated tree',
    illustrated: 'traffic and trains: illustrated',
  },
  /** tooltip on the Traffic toggle */
  trafficNote: 'Vehicles and trains are illustrated, not live data.',
};
