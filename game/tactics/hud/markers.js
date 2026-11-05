// NomadTactics – markers on the ground (selection, idle, target), readable without disturbing the diorama.
// One InstancedMesh with a distance shader: double line (light inside, dark outside), fixed stroke width in
// screen pixels (no matter how far zoomed), immune to fog and tone mapping, shapes ring or corner angles.
// A second pass without depth test draws occluded markers dashed through houses and trees (x-ray view).
// THREE is passed in so that the module is not tied to any scene.

export const FORM = { ring: 0, corners: 1 };

export class Markers {
  constructor(THREE, scene, camera, max = 600) {
    this.T = THREE; this.camera = camera; this.max = max; this.time = 0;
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.aForm = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);   // halbX, halbZ, form, puls
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);  // r, g, b, alpha
    this.aGr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);     // Quad half-size, world per pixel, occluded, dashed
    for (const a of [this.aForm, this.aColor, this.aGr]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aForm', this.aForm); geo.setAttribute('aColor', this.aColor); geo.setAttribute('aGr', this.aGr);
    this.uniforms = { time: { value: 0 }, dark: { value: new THREE.Color(0x0b0d12) } };
    const make = xray => {
      const m = new THREE.ShaderMaterial({
        uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: !xray, toneMapped: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
        vertexShader: `attribute vec4 aForm; attribute vec4 aColor; attribute vec4 aGr;
          varying vec2 vP; varying vec4 vForm; varying vec4 vFarbe; varying vec4 vGr;
          void main(){ vP = position.xz * aGr.x; vForm = aForm; vFarbe = aColor; vGr = aGr;
            vec3 p = vec3(position.x * aGr.x, 0.0, position.z * aGr.x);
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform float time; uniform vec3 dark; varying vec2 vP; varying vec4 vForm; varying vec4 vFarbe; varying vec4 vGr;
          float segment(vec2 q, vec2 a, vec2 b){ vec2 pa = q - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
          void main(){
            ${xray ? 'if (vGr.z < 0.5) discard;' : ''}
            float wpp = vGr.y, puls = vForm.w;
            vec2 h = vForm.xy * (1.0 + 0.22 * puls);
            float d, laufweg;
            if (vForm.z < 0.5) { float r = length(vP); d = abs(r - h.x); laufweg = atan(vP.y, vP.x) * h.x; }
            else {
              vec2 q = abs(vP); float L = min(min(h.x, h.y) * 0.55, max(1.2, 14.0 * wpp));
              d = min(segment(q, vec2(h.x, h.y - L), h), segment(q, vec2(h.x - L, h.y), h));
              laufweg = q.x + q.y;
            }
            float innen = 1.15 * wpp, aussen = innen + 1.4 * wpp;
            float aA = 1.0 - smoothstep(aussen - wpp, aussen, d);
            float aI = 1.0 - smoothstep(innen - wpp, innen, d);
            if (aA < 0.01) discard;
            vec3 c = mix(dark, vFarbe.rgb, aI);
            float a = aA * vFarbe.a * (1.0 + 0.6 * puls);
            ${xray ? 'a *= step(0.45, fract(laufweg / (9.0 * wpp) - time * 0.6)) * 0.55;' : ''}
            if (vGr.w > 0.5) a *= step(0.4, fract(laufweg / (7.0 * wpp) - time * 0.9));
            gl_FragColor = vec4(c, min(a, 1.0));
          }`,
      });
      const im = new THREE.InstancedMesh(geo, m, max);
      im.frustumCulled = false; im.renderOrder = xray ? 9 : 10; im.count = 0; im.castShadow = im.receiveShadow = false;
      scene.add(im); return im;
    };
    this.normal = make(false); this.xray = make(true);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.e = new THREE.Vector3(1, 1, 1); this.top = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color();
  }

  // liste: [{ x, y, z, rot, hx, hz, form, color ('#hex' or THREE.Color), alpha, pulse (0–1), hidden, dashed }]
  set(list, heightPx, dt = 0) {
    this.time += dt; this.uniforms.time.value = this.time;
    const K = this.camera, tanH = Math.tan(K.fov * Math.PI / 360), n = Math.min(list.length, this.max);
    for (let i = 0; i < n; i++) {
      const o = list[i];
      const dist = this.v.set(o.x, o.y, o.z).distanceTo(K.position);
      const wpp = 2 * dist * tanH / Math.max(1, heightPx);
      const size = Math.max(o.hx, o.hz) * 1.3 + 5 * wpp;
      this.m.compose(this.v.set(o.x, o.y + 0.12, o.z), this.q.setFromAxisAngle(this.top, o.red || 0), this.e);
      this.normal.setMatrixAt(i, this.m); this.xray.setMatrixAt(i, this.m);
      this.aForm.setXYZW(i, o.hx, o.hz, o.form || 0, o.pulse || 0);
      if (typeof o.color === 'string') this.color.set(o.color); else this.color.copy(o.color);
      this.aColor.setXYZW(i, this.color.r, this.color.g, this.color.b, o.alpha ?? 1);
      this.aGr.setXYZW(i, size, wpp, o.hidden ? 1 : 0, o.dashed ? 1 : 0);
    }
    this.normal.count = this.xray.count = n;
    for (const a of [this.aForm, this.aColor, this.aGr]) a.needsUpdate = true;
    this.normal.instanceMatrix.needsUpdate = this.xray.instanceMatrix.needsUpdate = true;
  }
  dark(hex) { this.uniforms.dark.value.set(hex); }
}
