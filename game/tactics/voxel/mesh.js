// NomadTactics – voxel models to three.js geometry (diorama look from the stress test):
// ambient occlusion per corner, slight baked light per side, colour variation per voxel,
// attributes for the vehicle shader (edge position, surface kind, which edges are true outer edges).

import * as THREE from 'three';
import { V, PAL, SURFACE } from './models.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SIDE = [0.9, 0.9, 1.0, 0.6, 0.95, 0.82];
const AO = [0.52, 0.68, 0.84, 1.0];
const CORNER = [[0, 0], [1, 0], [1, 1], [0, 1]];
const SOOT = new THREE.Color(0x1c1916);
const hash = (x, y, z) => Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));

function baseColor(kind, x, y, z, team) {
  if (kind === 'team') return team;
  if (typeof kind === 'string' && kind[0] === '#') {
    // own colours from .vox files get a little variation too
    const c = parseInt(kind.slice(1), 16), f = 0.94 + (hash(x, y, z) % 7) * 0.02;
    const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
    return (r << 16) | (g << 8) | b;
  }
  const p = PAL[kind] || [0xff00ff];
  return p[hash(x, y, z) % p.length];
}

// soot (optional): (x, y, z) → 0…1, darkens voxels towards burnt black (damage stages, game/party/unit_life.js)
export function voxelGeometry(W, { team = 0x3a78d8, dark = 1, scale = V, soot = null } = {}) {
  const pos = [], nor = [], col = [], edge = [], mat = [], outer = [];
  const has = (x, y, z) => W.has(`${x},${y},${z}`);
  const c = new THREE.Color();
  for (const [k, kind] of W) {
    const [x, y, z] = k.split(',').map(Number);
    let basis = baseColor(kind, x, y, z, team);
    if (soot) { const f = soot(x, y, z); if (f > 0) basis = c.setHex(basis).lerp(SOOT, f).getHex(); }
    for (let i = 0; i < 6; i++) {
      const d = DIRS[i];
      if (has(x + d[0], y + d[1], z + d[2])) continue;
      const [u, v] = [0, 1, 2].filter((q) => d[q] === 0);
      const ox = x + d[0], oy = y + d[1], oz = z + d[2];
      const e = CORNER.map(([a, b]) => {
        const q = [x, y, z];
        for (let ax = 0; ax < 3; ax++) { if (d[ax]) q[ax] += d[ax] > 0 ? 1 : 0; else q[ax] += ax === u ? a : b; }
        const su = [0, 0, 0], sv = [0, 0, 0]; su[u] = a ? 1 : -1; sv[v] = b ? 1 : -1;
        const s1 = has(ox + su[0], oy + su[1], oz + su[2]), s2 = has(ox + sv[0], oy + sv[1], oz + sv[2]);
        const ck = has(ox + su[0] + sv[0], oy + su[1] + sv[1], oz + su[2] + sv[2]);
        return { p: [q[0] * scale - scale / 2, q[1] * scale, q[2] * scale - scale / 2], ao: s1 && s2 ? 0 : 3 - (s1 + s2 + ck), k: [a, b] };
      });
      // AO-correct diagonal, outward winding
      const quad = e[0].ao + e[2].ao >= e[1].ao + e[3].ao ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
      for (let [i0, i1, i2] of quad) {
        const A = e[i0].p, B = e[i1].p, C = e[i2].p;
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        if ((uy * vz - uz * vy) * d[0] + (uz * vx - ux * vz) * d[1] + (ux * vy - uy * vx) * d[2] < 0) [i1, i2] = [i2, i1];
        for (const j of [i0, i1, i2]) {
          c.setHex(basis).multiplyScalar(SIDE[i] * AO[e[j].ao] * dark);
          pos.push(...e[j].p); nor.push(...d); col.push(c.r, c.g, c.b); edge.push(...e[j].k);
        }
      }
      const nb = (ax, sg) => { const q = [x, y, z]; q[ax] += sg; return has(q[0], q[1], q[2]) ? 0 : 1; };
      const rd = [nb(u, -1), nb(u, 1), nb(v, -1), nb(v, 1)], mt = SURFACE[kind] ?? 5;
      for (let n = 0; n < 6; n++) { mat.push(mt); outer.push(...rd); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 2));
  g.setAttribute('mat', new THREE.Float32BufferAttribute(mat, 1));
  g.setAttribute('outer', new THREE.Float32BufferAttribute(outer, 4));
  g.computeBoundingSphere();
  return g;
}

// Soft edges and fine joints for terrain, trees and buildings
export function voxelMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 edge;\nvarying vec2 vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vEdge;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 kk = min(vEdge, 1.0 - vEdge);
        float r = min(kk.x, kk.y);
        diffuseColor.rgb *= (1.0 + 0.10 * (1.0 - smoothstep(0.03, 0.16, r))) * mix(0.86, 1.0, smoothstep(0.0, 0.035, r));`);
  };
  return m;
}

// Vehicles: paint, camo patches per voxel, edge wear only on true outer edges, dirt from below, metal and glass shine
export function vehicleMaterial(envMap = null, { tint = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, envMap, envMapIntensity: 0.28 });
  if (tint) m.color.setHex(tint);
  // night 0…1: headlights and tail lights glow (set m.userData.night.value; wrecks keep 0)
  m.userData.night = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = m.userData.night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 edge; attribute float mat; attribute vec4 outer;
      varying vec2 vEdge; varying float vMat; varying vec4 vOuter; varying vec3 vLoc; varying vec2 vRun;
      #ifdef USE_INSTANCING
      attribute vec2 aLife;
      #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vEdge = edge; vMat = mat; vOuter = outer; vLoc = position - normal * 0.05;
      #ifdef USE_INSTANCING
      vRun = aLife;
      #else
      vRun = vec2(0.0);
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vEdge; varying float vMat; varying vec4 vOuter; varying vec3 vLoc; varying vec2 vRun;
      float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float gRough = 0.6; float gMetal = 0.0; uniform float uNight;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 kk = min(vEdge, 1.0 - vEdge);
        float rGrid = min(kk.x, kk.y);
        float rOut = 9.0;
        if (vOuter.x > 0.5) rOut = min(rOut, vEdge.x); if (vOuter.y > 0.5) rOut = min(rOut, 1.0 - vEdge.x);
        if (vOuter.z > 0.5) rOut = min(rOut, vEdge.y); if (vOuter.w > 0.5) rOut = min(rOut, 1.0 - vEdge.y);
        diffuseColor.rgb *= mix(0.93, 1.0, smoothstep(0.0, 0.04, rGrid));
        diffuseColor.rgb *= 1.0 + 0.16 * (1.0 - smoothstep(0.02, 0.2, rOut));
        int kind = int(vMat + 0.5);
        vec3 vox = floor((vLoc + vec3(0.2, 0.0, 0.2)) / 0.4);
        float fine = noise3(vLoc * 9.0), coarse = noise3(vLoc * 1.3 + 7.0);
        if (kind == 0 || kind == 5) {
          if (kind == 0) { float t = noise3(vox * 0.42 + 3.1);
            if (t > 0.62) diffuseColor.rgb *= vec3(0.8, 0.7, 0.56); else if (t < 0.32) diffuseColor.rgb *= vec3(0.62, 0.66, 0.56); }
          diffuseColor.rgb *= 0.94 + 0.12 * fine; gRough = 0.62 - 0.14 * coarse;
        } else if (kind == 1) { diffuseColor.rgb *= 0.97 + 0.06 * fine; gRough = 0.3 + 0.1 * fine; }
        else if (kind == 2) { gRough = 0.34 + 0.25 * fine; gMetal = 0.75; }
        else if (kind == 3) { gRough = 0.95; diffuseColor.rgb *= 0.88 + 0.16 * fine;
          // running tracks / wheels (aLife.x = distance driven in m): links slide along, top forward, bottom back
          if (vRun.y > 0.5 && vLoc.y < 0.9) { float dir = vLoc.y > 0.42 ? 1.0 : -1.0;
            float link = fract((vLoc.z - dir * vRun.x) / 0.2); diffuseColor.rgb *= mix(0.62, 1.08, smoothstep(0.12, 0.3, link) * (1.0 - smoothstep(0.7, 0.9, link))); } }
        else { gRough = 0.06; gMetal = 0.25; diffuseColor.rgb *= 0.75; }
        if (kind <= 1 || kind == 5) {
          float wear = (1.0 - smoothstep(0.015, 0.09, rOut)) * step(0.5, noise3(vLoc * 6.0 + 1.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.55), wear * 0.85);
          gMetal = mix(gMetal, 0.85, wear); gRough = mix(gRough, 0.32, wear);
        }
        float dirt = smoothstep(1.4, 0.05, vLoc.y) * (0.4 + 0.6 * noise3(vLoc * 2.2 + 4.0));
        if (kind == 4) dirt *= 0.3;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.19, 0.13), dirt * 0.75);
        gRough = mix(gRough, 0.95, dirt); gMetal *= 1.0 - dirt;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (kind == 6) totalEmissiveRadiance += vec3(1.0, 0.9, 0.68) * (0.15 + uNight * 6.0);
        else if (kind == 7) totalEmissiveRadiance += vec3(1.0, 0.1, 0.06) * uNight * 3.0;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gMetal;');
  };
  return m;
}
