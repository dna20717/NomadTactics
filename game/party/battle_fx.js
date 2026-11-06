// NomadTactics – image effects for the 3D view (Fidelity step 1 „Licht & Atmosphäre“, Daniel 06.11.).
// Optics only. Chain: scene (HDR, 4× MSAA) → ambient occlusion (only quality „Schön“) → bloom → tone mapping/sRGB
// → colour grade (gain, lift, saturation, contrast, vignette). The grade values come from battle_3d.js
// (climate, time of day, weather) and are eased there.
// three.js addons are vendored in game/vendor/addons (MIT, see THIRD_PARTY.md), loaded through the import map.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'NomadGrade',
  uniforms: {
    tDiffuse: { value: null },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 gain; uniform vec3 lift; uniform float saturation; uniform float contrast; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * gain + lift * (1.0 - c.rgb);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.42) * contrast + 0.42;   // pivot a bit below middle grey: more punch without darkening the board
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.12, 0.5, dot(d, d) * 1.6);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export async function createFx({ renderer, scene, camera, quality }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (quality === 'beautiful') {
    const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
    ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.5, scale: 1, samples: 12 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
  }
  // only really bright things glow: fire, tracers, flashes (their colours are pushed above 1 while the effects run)
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.75, 0.55, 2.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    quality,
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    grade(g) {
      const u = grade.uniforms;
      u.gain.value.set(...g.gain); u.lift.value.set(...g.lift);
      u.saturation.value = g.saturation; u.contrast.value = g.contrast; u.vignette.value = g.vignette;
      bloom.strength = g.bloom;
    },
    dispose() { composer.dispose(); target.dispose(); ao?.dispose?.(); bloom.dispose?.(); },
  };
}
