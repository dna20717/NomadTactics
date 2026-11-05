// NomadTactics – where the game data comes from (party page and launcher).
// Online (Cloudflare): live from the workshop, i.e. the current main branch via /api/files.
// LAN party server or a plain file server: the files it serves. Returns { json, online, commit }.
export const DATA = 'projects/nomadtactics/';

export async function gameData() {
  let online = null;
  try {
    const s = await fetch('/api/session', { cache: 'no-store' });
    const session = s.ok ? await s.json() : null;
    if (session?.lan) online = { lan: true };
    if (session?.user) {
      online = session;
      const r = await fetch('/api/files', { cache: 'no-store' });
      if (r.ok) {
        const { files, commit } = await r.json();
        return { online, commit, json: async (p) => { if (!files[p]) throw new Error(p + ' fehlt im Repo'); return files[p].content; } };
      }
    }
  } catch { /* LAN or offline: static files */ }
  return { online, commit: null, json: async (p) => { const r = await fetch(DATA + p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.json(); } };
}
