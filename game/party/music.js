// NomadTactics – music and the „Now Playing“ chip (Daniel 06.11.: CC0 music for intro and game,
// „Now Playing“ discreet in the HUD of both). One playlist for launcher and battle; the chip shows title and
// artist for a few seconds when a track starts, then shrinks to a note with moving bars; hover/tap opens it.
// Settings shared with the launcher options: volume `nomadtactics-volume` (0–100), on/off `nomadtactics-music`.
// Browsers only play sound after a tap or key press, so the music waits for the first one.

import { icon } from '../icons.js';

export const PLAYLIST = [
  { title: 'On Patrol', artist: 'Section 31 – Tech', credit: 's31tech.org', license: 'Public Domain',
    src: [['game/audio/on_patrol.m4a', 'audio/mp4'], ['game/audio/on_patrol.ogg', 'audio/ogg']] },
];
const VOLUME_KEY = 'nomadtactics-volume', ON_KEY = 'nomadtactics-music';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export function musicVolume() { const v = Number(read(VOLUME_KEY)); return read(VOLUME_KEY) == null || Number.isNaN(v) ? 60 : Math.max(0, Math.min(100, v)); }
export function setMusicVolume(v) { write(VOLUME_KEY, String(Math.round(v))); for (const m of players) m.applyVolume(); }
const players = new Set();

// level: share of the volume on this page (launcher 1, battle 0.55 so the explosions stay on top)
export function createMusic({ level = 1 } = {}) {
  const audio = new Audio();
  audio.preload = 'auto';
  let index = 0, on = read(ON_KEY) !== 'off', fade = 0, wanted = 0, started = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const track = () => PLAYLIST[index];
  function load(i) {
    index = (i + PLAYLIST.length) % PLAYLIST.length;
    const t = track();
    const src = t.src.find(([, type]) => audio.canPlayType(type)) || t.src[0];
    audio.src = src[0];
    emit();
  }
  audio.addEventListener('ended', () => { load(index + 1); if (on) play(); });
  audio.addEventListener('play', emit); audio.addEventListener('pause', emit);
  const target = () => (musicVolume() / 100) * level;
  function tick() {
    // fades in/out without a timer library
    const want = wanted * target();
    const v = audio.volume + Math.sign(want - audio.volume) * Math.min(Math.abs(want - audio.volume), 0.02);
    audio.volume = Math.max(0, Math.min(1, v));
    if (wanted === 0 && audio.volume <= 0.001 && !audio.paused) audio.pause();
    if (Math.abs(audio.volume - want) > 0.001 || (wanted === 0 && !audio.paused)) fade = requestAnimationFrame(tick); else fade = 0;
  }
  function play() {
    if (!audio.src) load(index);
    wanted = 1;
    const p = audio.play();
    if (p?.then) p.then(() => { started = true; emit(); }, () => waitForGesture());
    else started = true;
    if (!fade) fade = requestAnimationFrame(tick);
  }
  function stop() { wanted = 0; if (!fade) fade = requestAnimationFrame(tick); emit(); }
  let waiting = false;
  function waitForGesture() {
    if (waiting) return; waiting = true;
    const go = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); waiting = false; if (on) play(); };
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  }
  const api = {
    audio,
    get on() { return on; },
    get playing() { return !audio.paused && wanted > 0; },
    get started() { return started; },
    track,
    start() { if (on) { audio.volume = 0; play(); } },
    toggle() { on = !on; write(ON_KEY, on ? 'on' : 'off'); if (on) play(); else stop(); emit(); },
    next() { load(index + 1); if (on) play(); },
    applyVolume() { if (!fade) fade = requestAnimationFrame(tick); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    dispose() { stop(); players.delete(api); },
  };
  players.add(api);
  load(0);
  return api;
}

// The chip: note + bars, opens to „title · artist“ with play/pause. Place it with a class from the page.
export function nowPlaying(music, host, { className = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'np ' + className;
  el.innerHTML = '<button class="np-btn" type="button"></button><span class="np-bars"><i></i><i></i><i></i></span><span class="np-text"><b></b><small></small></span>';
  const btn = el.querySelector('.np-btn'), b = el.querySelector('b'), small = el.querySelector('small');
  btn.onclick = (e) => { e.stopPropagation(); music.toggle(); };
  el.onpointerdown = (e) => e.stopPropagation();
  let shut = 0;
  const open = (ms) => { el.classList.add('open'); clearTimeout(shut); shut = setTimeout(() => el.classList.remove('open'), ms); };
  el.onmouseenter = () => { clearTimeout(shut); el.classList.add('open'); };
  el.onmouseleave = () => open(1200);
  el.onclick = () => open(5000);
  let lastTitle = '';
  const draw = () => {
    const t = music.track();
    el.classList.toggle('playing', music.playing);
    el.classList.toggle('off', !music.on);
    btn.replaceChildren(icon(music.on ? 'loudspeaker' : 'muted', 13));
    btn.title = music.on ? 'Musik aus' : 'Musik an';
    b.textContent = t.title; small.textContent = `${t.artist} · ${t.credit}`;
    el.title = `${t.title} – ${t.artist} (${t.license}, ${t.credit})`;
    if (music.playing && t.title !== lastTitle) { lastTitle = t.title; open(6500); }
  };
  music.subscribe(draw); draw();
  host.append(el);
  return el;
}
