// Rank chevrons for experience tiers: stacked V shapes pointing down (like on a uniform sleeve).
// chevronsSvg(n) → SVG string (HUD tiles), chevronsEl(n) → element (workshop). Colour = currentColor.
export function chevronsSvg(n, size = 1) {
  if (!n) return '';
  const step = 3.6, h = 5 + (n - 1) * step + 1;
  const lines = Array.from({ length: n }, (_, i) => `<polyline points="1.5,${1.5 + i * step} 6,${5 + i * step} 10.5,${1.5 + i * step}"/>`).join('');
  return `<svg class="chevrons" viewBox="0 0 12 ${h}" width="${12 * size}" height="${h * size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${n}. Stufe">${lines}</svg>`;
}
export function chevronsEl(n, size = 1, cls = '') {
  const s = document.createElement('span');
  s.className = ('chevrons-box ' + cls).trim();
  s.innerHTML = chevronsSvg(n, size);
  return s;
}
