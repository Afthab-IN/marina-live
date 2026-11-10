import { clock, MONTHS, sunTimes } from '../sky/solar';
import type { LightState } from '../sky/lighting';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

export interface TimeState { hour: number; month: number }

/** Time of day and season controls (the panel at the bottom of the screen). */
export function lightPanel(root: HTMLElement, state: TimeState, onChange: (s: TimeState) => void) {
  root.hidden = false;
  root.innerHTML = `
  <div class="row">
    <label for="time">Time</label>
    <div>
      <div class="value"><b id="time-label"></b><span class="note" id="sun-note"></span></div>
      <input id="time" type="range" min="5" max="23" step="0.05" aria-label="Time of day in Chennai">
      <div class="quick">
        <button data-time="morning">Morning</button><button data-time="afternoon">Afternoon</button>
        <button data-time="golden">Golden hour</button><button data-time="night">Night</button>
      </div>
    </div>
  </div>
  <details id="more">
    <summary>Season</summary>
    <div class="row">
      <label for="month">Season</label>
      <div>
        <div class="value"><b id="month-label"></b><span class="note" id="month-note"></span></div>
        <input id="month" type="range" min="0" max="11.99" step="0.01" aria-label="Month of the year">
      </div>
    </div>
    <p class="sun-fact">The sun path follows the month. At Chennai's latitude it stands straight overhead at noon around 25 April and 18 August.</p>
  </details>`;
  const time = root.querySelector<HTMLInputElement>('#time')!;
  const month = root.querySelector<HTMLInputElement>('#month')!;
  const more = root.querySelector<HTMLDetailsElement>('#more')!;
  if (innerWidth > 720) more.open = true;

  const quick = (k: string) => {
    const t = sunTimes(state.month);
    return k === 'morning' ? t.rise + 0.9 : k === 'afternoon' ? 14.5 : k === 'golden' ? t.set - 0.55 : 20.5;
  };
  const set = (s: Partial<TimeState>) => { Object.assign(state, s); onChange(state); };
  time.addEventListener('input', () => set({ hour: Number(time.value) }));
  month.addEventListener('input', () => set({ month: Number(month.value) }));
  root.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((b) =>
    b.addEventListener('click', () => set({ hour: quick(b.dataset.time!) })));

  return {
    quick,
    /** reflect the current state in the controls and labels */
    show(light: LightState) {
      time.value = String(state.hour);
      month.value = String(state.month);
      const t = sunTimes(state.month);
      root.querySelector('#time-label')!.textContent = `${clock(state.hour)} · ${light.label}`;
      root.querySelector('#sun-note')!.textContent = light.elevation > 0
        ? `sun ${Math.round(light.elevation)}° up in the ${compass(light.azimuth)}`
        : 'sun below the horizon';
      root.querySelector('#month-label')!.textContent = MONTHS[Math.floor(state.month) % 12];
      root.querySelector('#month-note')!.textContent = `sunrise ${clock(t.rise)} · sunset ${clock(t.set)}`;
    },
  };
}
