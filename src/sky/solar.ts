// Sun position for Chennai (NOAA general solar position equations).
// Times are Indian Standard Time (UTC+5:30); months run 0 (January) to 11.99.

export const LAT = 13.062;
export const LON = 80.279;
const TZ = 5.5;
const RAD = Math.PI / 180;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Day of year (1..365) for a fractional month, e.g. 10.5 = mid November. */
export function dayOfYear(month: number): number {
  const m = ((month % 12) + 12) % 12;
  return 1 + m * (365 / 12);
}

function terms(doy: number, hour: number) {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqTime, decl, offset: eqTime + 4 * LON - 60 * TZ };
}

/** Elevation and compass azimuth (degrees, clockwise from north) of the sun. */
export function sunPosition(month: number, hour: number): { elevation: number; azimuth: number; declination: number } {
  const doy = dayOfYear(month);
  const { decl, offset } = terms(doy, hour);
  const tst = hour * 60 + offset;
  const ha = (tst / 4 - 180) * RAD;
  const phi = LAT * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  const az = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: 90 - zen / RAD, azimuth: ((az / RAD) + 360) % 360, declination: decl / RAD };
}

/** Sunrise and sunset in decimal IST hours for the month. */
export function sunTimes(month: number): { rise: number; set: number; noon: number } {
  const doy = dayOfYear(month);
  const { decl, offset } = terms(doy, 12);
  const phi = LAT * RAD;
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  const h0 = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
  const noon = (720 - offset) / 60;
  return { rise: noon - (4 * h0) / 60, set: noon + (4 * h0) / 60, noon };
}

export function clock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60) % 60;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h >= 12 && h < 24 ? 'pm' : 'am'}`;
}
