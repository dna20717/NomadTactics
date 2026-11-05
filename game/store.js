// Storage for editor changes.
// In the artifact: database (collection "stand", one document per project file) and asset storage for new PNGs.
// Locally (without claude.use): localStorage as a fallback.
// Ava takes the documents from "stand" into the repository and deletes them afterwards.

const COLLECTION = 'drafts';
const docId = file => file.replace(/\//g, '~');
const LS = 'nomadhouse-drafts:';

// opt.project: separate area per project (Tactics workshop); Cosy calls without it and stays with the old key
export async function openStore(opt = {}) {
  let db = null, assets = null;
  if (globalThis.claude?.use) {
    try { db = await Promise.race([claude.use('db'), new Promise(r => setTimeout(() => r(null), 10000))]); } catch { db = null; }
    if (!opt.withoutAssets) try { assets = await Promise.race([claude.use('assets'), new Promise(r => setTimeout(() => r(null), 10000))]); } catch { assets = null; }
  }
  return db ? databaseStore(db, assets, opt.collection || COLLECTION) : localStore(opt.project ? `${opt.project}-drafts:` : LS);
}

function databaseStore(db, assets, COLLECTION) {
  return {
    kind: 'artifact',
    async all() {
      const snap = await db.collection(COLLECTION).get();
      const m = new Map();
      for (const d of snap.docs) { const x = d.data(); if (x?.file && typeof x.json === 'string') m.set(x.file, JSON.parse(x.json)); }
      return m;
    },
    async persist(file, content) {
      const json = JSON.stringify(content);
      if (json.length > 250000) throw new Error(`${file} ist zu groß für einen Speicherplatz (${Math.round(json.length / 1024)} KiB).`);
      await db.doc(`${COLLECTION}/${docId(file)}`).set({ file, json, time: new Date().toISOString() });
    },
    async discard(file) { await db.doc(`${COLLECTION}/${docId(file)}`).delete(); },
    async loadUp(blob, name) {
      if (assets) { const r = await assets.upload(blob); return r.url || `/_blob/${r.id}`; }
      return asDataUrl(blob, name);
    },
  };
}

function localStore(LS) {
  const ls = (() => { try { return globalThis.localStorage; } catch { return null; } })();
  return {
    kind: 'local',
    async all() {
      const m = new Map();
      if (!ls) return m;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith(LS)) try { m.set(k.slice(LS.length), JSON.parse(ls.getItem(k))); } catch { /* kaputt: ignorieren */ }
      }
      return m;
    },
    async persist(file, content) { ls?.setItem(LS + file, JSON.stringify(content)); },
    async discard(file) { ls?.removeItem(LS + file); },
    async loadUp(blob, name) { return asDataUrl(blob, name); },
  };
}

async function asDataUrl(blob) {
  if (blob.size > 180000) throw new Error('Bild zu groß für den Speicher ohne Asset-Ablage (max. ca. 180 KB).');
  return new Promise((ok, error) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = error; r.readAsDataURL(blob); });
}

// Wrap the loader so that saved drafts override the files from the repository.
export function withDrafts(loader, drafts) {
  return { ...loader, async json(p) { return drafts.has(p) ? structuredClone(drafts.get(p)) : loader.json(p); } };
}
