// Node loader for projects: reads JSON and PNG from the file system, writes PNG.
import fs from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';
import { Bitmap } from '../engine/image.js';

const { PNG } = pngjs;

export function nodeLoader(root) {
  const cache = new Map();
  const full = p => path.resolve(root, p);
  return {
    root,
    full,
    async json(p) {
      const text = fs.readFileSync(full(p), 'utf8');
      try { return JSON.parse(text); } catch (e) { throw new Error(`${p}: kein gültiges JSON (${e.message})`); }
    },
    async image(p) {
      if (!cache.has(p)) cache.set(p, readImage(full(p)));
      return cache.get(p);
    },
    async has(p) { return fs.existsSync(full(p)); },
  };
}

export function readImage(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return new Bitmap(png.width, png.height, new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length));
}

export function writeImage(image, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const png = new PNG({ width: image.w, height: image.h });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  fs.writeFileSync(file, PNG.sync.write(png));
}

// Find the project root: --project, otherwise current directory, otherwise the only project under projects/.
export function findProject(spec, repo) {
  if (spec) return path.resolve(spec);
  if (fs.existsSync('project.json')) return process.cwd();
  const basis = path.join(repo, 'projects');
  // kj is for Cosy projects; projects of other genre modules (e.g. "tactics", tool nt.js) do not count
  const genre = d => { try { return JSON.parse(fs.readFileSync(path.join(basis, d, 'project.json'), 'utf8')).genre || 'cosy'; } catch { return 'cosy'; } };
  const candidates = fs.existsSync(basis) ? fs.readdirSync(basis).filter(d => fs.existsSync(path.join(basis, d, 'project.json')) && genre(d) === 'cosy') : [];
  if (candidates.length === 1) return path.join(basis, candidates[0]);
  throw new Error(`Kein Projekt gefunden. Gib --project <ordner> an. Kandidaten: ${candidates.join(', ') || 'keine'}`);
}
