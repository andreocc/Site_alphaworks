/* ============================================================
   GRAPH.JS — System Field 3D
   Shader-based particle field with flow field, bloom, formations.
   Metáfora: agentes autônomos em campo vetorial — decisão distribuída.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ── CONFIG ──────────────────────────────── */
const CONFIG = {
  particleCount: 8000,
  fieldResolution: 64,
  fieldScale: 0.01,
  flowSpeed: 0.15,
  particleSize: 1.4,
  formationSpeed: 1.2,
  colors: {
    bg: 0x060708,
    grid: 0x1a1d23,
    particleA: new THREE.Color(0x5e6ad2),
    particleB: new THREE.Color(0xa78bfa),
    particleC: new THREE.Color(0x22c55e),
    accent: new THREE.Color(0x00ff88),
    bloom: new THREE.Color(0x5e6ad2),
  },
  formations: [
    { name: 'sphere', radius: 3.5 },
    { name: 'torus', radius: 3, tube: 1.2 },
    { name: 'wave', amplitude: 1.8, frequency: 1.2 },
    { name: 'grid', spacing: 0.45 },
    { name: 'helix', radius: 2.2, height: 5, turns: 2.5 },
  ],
};

/* ── PRE-ALLOCATED ───────────────────────── */
const _tmpVec3 = new THREE.Vector3();
const _noiseOffset = new THREE.Vector2();

/* ── STATE ───────────────────────────────── */
let scene, camera, renderer, composer;
let particleGeometry, particleMaterial, particleMesh;
let containerEl = null;
let animFrameId = null;
let isVisible = true;
let prefersReduced = false;

let scrollY = 0;
let targetFormation = 0;
let formationProgress = 0;
let currentFormationIndex = 0;
let targetPositions = null;
let basePositions = null;

let mouse = new THREE.Vector2(0.5, 0.5);
let mouseWorld = new THREE.Vector3();
let mouseActive = false;

let time = 0;
let lastTime = 0;

/* ── PERLIN NOISE / FLOW FIELD ───────────── */
const PERM = new Uint8Array(512);
const GRAD3 = new Float32Array([
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
  1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
  0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
]);

function initPermutation() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  PERM.set(p);
  PERM.set(p, 256);
}
initPermutation();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }
function grad3(hash, x, y, z) {
  const h = hash % 12;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3d(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad3(PERM[AA], x, y, z), grad3(PERM[BA], x - 1, y, z), u),
         lerp(grad3(PERM[AB], x, y - 1, z), grad3(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad3(PERM[AA + 1], x, y, z - 1), grad3(PERM[BA + 1], x - 1, y, z - 1), u),
         lerp(grad3(PERM[AB + 1], x, y - 1, z - 1), grad3(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w
  );
}

function curlNoise3d(x, y, z, eps = 0.01) {
  const n1 = noise3d(x, y + eps, z) - noise3d(x, y - eps, z);
  const n2 = noise3d(x, y, z + eps) - noise3d(x, y, z - eps);
  const n3 = noise3d(x + eps, y, z) - noise3d(x - eps, y, z);
  const n4 = noise3d(x, y + eps, z) - noise3d(x, y - eps, z);
  const n5 = noise3d(x + eps, y, z) - noise3d(x - eps, y, z);
  const n6 = noise3d(x, y, z + eps) - noise3d(x, y, z - eps);
  return new THREE.Vector3(n2 - n4, n6 - n3, n1 - n5).normalize();
}

/* ── FORMATION GENERATORS ────────────────── */
function generateFormationPositions(index) {
  const count = CONFIG.particleCount;
  const positions = new Float32Array(count * 3);
  const formation = CONFIG.formations[index % CONFIG.formations.length];
  let idx = 0;

  switch (formation.name) {
    case 'sphere': {
      for (let i = 0; i < count; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r = Math.cbrt(Math.random()) * formation.radius;
        positions[idx++] = r * Math.sin(phi) * Math.cos(theta);
        positions[idx++] = r * Math.sin(phi) * Math.sin(theta);
        positions[idx++] = r * Math.cos(phi);
      }
      break;
    }
    case 'torus': {
      for (let i = 0; i < count; i++) {
        const u = Math.random() * Math.PI * 2;
        const v = Math.random() * Math.PI * 2;
        const R = formation.radius;
        const r = formation.tube;
        positions[idx++] = (R + r * Math.cos(v)) * Math.cos(u);
        positions[idx++] = r * Math.sin(v);
        positions[idx++] = (R + r * Math.cos(v)) * Math.sin(u);
      }
      break;
    }
    case 'wave': {
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 12;
        const z = (Math.random() - 0.5) * 12;
        const y = Math.sin(x * formation.frequency + time) * formation.amplitude * 0.5 +
                  Math.cos(z * formation.frequency + time * 0.7) * formation.amplitude * 0.5;
        positions[idx++] = x;
        positions[idx++] = y;
        positions[idx++] = z;
      }
      break;
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count * 1.5));
      const rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions[idx++] = (col - cols * 0.5) * formation.spacing;
        positions[idx++] = (Math.random() - 0.5) * 0.5;
        positions[idx++] = (row - rows * 0.5) * formation.spacing;
      }
      break;
    }
    case 'helix': {
      for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 * formation.turns;
        const r = formation.radius;
        positions[idx++] = r * Math.cos(t);
        positions[idx++] = (i / count - 0.5) * formation.height;
        positions[idx++] = r * Math.sin(t);
      }
      break;
    }
  }
  return positions;
}

/* ── SCENE SETUP ─────────────────────────── */
function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.bg);

  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 100);
  camera.position.set(0, 0.8, 12);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(CONFIG.colors.bg, 1);
  containerEl.appendChild(renderer.domElement);

  // Post-processing chain
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.6,   // strength
    0.25,  // radius
    0.35   // threshold
  );
  composer.addPass(bloomPass);

  const filmPass = new FilmPass(0.06, 0.01, 2048, false);
  composer.addPass(filmPass);

  // Chromatic aberration
  const chromaticShader = {
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.0005 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uAmount;
      varying vec2 vUv;
      void main(){
        vec2 offset = uAmount * vec2(1.0, -1.0);
        float r = texture2D(tDiffuse, vUv + offset).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv - offset).b;
        gl_FragColor = vec4(r, g, b, 1.0);
      }
    `,
  };
  composer.addPass(new ShaderPass(chromaticShader));

  // Subtle grid floor
  const gridGeo = new THREE.PlaneGeometry(40, 40, 80, 80);
const gridMat = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.grid,
    wireframe: true,
    transparent: true,
    opacity: 0.03,
    side: THREE.DoubleSide,
  });
  const grid = new THREE.Mesh(gridGeo, gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -2.5;
  scene.add(grid);

  // Axis lines (system UI feel)
  const axisGeo = new THREE.BufferGeometry();
  const axisCount = 20;
  const axisPositions = new Float32Array(axisCount * 6 * 3);
  let ai = 0;
  for (let i = 0; i < axisCount; i++) {
    const x = (i - axisCount * 0.5) * 2;
    axisPositions[ai++] = x; axisPositions[ai++] = -2.5; axisPositions[ai++] = -20;
    axisPositions[ai++] = x; axisPositions[ai++] = -2.5; axisPositions[ai++] = 20;
    axisPositions[ai++] = -20; axisPositions[ai++] = -2.5; axisPositions[ai++] = x;
    axisPositions[ai++] = 20; axisPositions[ai++] = -2.5; axisPositions[ai++] = x;
  }
  axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPositions, 3));
  const axisMat = new THREE.LineBasicMaterial({ color: CONFIG.colors.grid, transparent: true, opacity: 0.02 });
  const axisLines = new THREE.LineSegments(axisGeo, axisMat);
  scene.add(axisLines);

  // Particles
  createParticles();

  // Initial formation targets
  basePositions = particleGeometry.getAttribute('position').array.slice();
  targetPositions = generateFormationPositions(0);
  particleGeometry.setAttribute('aTarget', new THREE.BufferAttribute(targetPositions.slice(), 3));
}

/* ── PARTICLES (GPU SHADER) ── */
const PARTICLE_VS = `
  attribute vec3 aTarget;
  attribute float aIndex;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uFormationProgress;
  uniform float uFlowSpeed;
  uniform vec2 uFieldResolution;
  uniform sampler2D uFieldTexture;
  uniform vec3 uMouseWorld;
  uniform float uMouseActive;
  uniform float uParticleSize;
  varying vec3 vColor;
  varying float vVelocity;
  varying float vFormation;

  vec3 sampleField(vec3 pos) {
    vec2 uv = (pos.xz * 0.5 + 0.5) * uFieldResolution;
    vec4 field = texture2D(uFieldTexture, uv / uFieldResolution);
    return vec3(field.r - 0.5, 0.0, field.g - 0.5) * 2.0;
  }

  void main() {
    vColor = aColor;
    vFormation = uFormationProgress;

    vec3 pos = position;
    vec3 target = aTarget;

    // Flow field influence
    vec3 flow = sampleField(pos + uTime * uFlowSpeed);
    pos += flow * 0.15 * (1.0 - uFormationProgress);

    // Mouse repulsion
    if (uMouseActive > 0.5) {
      vec3 toMouse = pos - uMouseWorld;
      float dist = length(toMouse);
      if (dist < 4.0) {
        pos += normalize(toMouse) * (4.0 - dist) * 0.08;
      }
    }

    // Formation morph
    pos = mix(pos, target, uFormationProgress);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uParticleSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FS = `
  uniform float uTime;
  varying vec3 vColor;
  varying float vVelocity;
  varying float vFormation;

  void main() {
    float dist = length(gl_PointCoord - 0.5);
    if (dist > 0.5) discard;

    // Soft circular falloff with bloom-friendly core
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    alpha = pow(alpha, 1.5);

    // Pulse based on formation progress
    float pulse = 0.7 + 0.3 * sin(uTime * 2.0 + vFormation * 10.0);
    alpha *= pulse;

    // Color with subtle shift near center
    vec3 color = vColor;
    float centerDist = length(gl_PointCoord - 0.5) * 2.0;
    color = mix(color, vec3(1.0), (1.0 - centerDist) * 0.3 * (1.0 - vFormation));

    gl_FragColor = vec4(color, alpha * 0.7);
  }
`;

function createParticles() {
  const count = CONFIG.particleCount;
  particleGeometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices = new Float32Array(count);

  // Initial positions: distributed in sphere
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = Math.cbrt(Math.random()) * 8;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Assign to one of 3 color groups
    const group = i % 3;
    const color = group === 0 ? CONFIG.colors.particleA :
                  group === 1 ? CONFIG.colors.particleB : CONFIG.colors.particleC;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    indices[i] = i;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
  particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));

  particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFormationProgress: { value: 0 },
      uFlowSpeed: { value: CONFIG.flowSpeed },
      uFieldResolution: { value: new THREE.Vector2(CONFIG.fieldResolution, CONFIG.fieldResolution) },
      uFieldTexture: { value: null },
      uMouseWorld: { value: new THREE.Vector3() },
      uMouseActive: { value: 0 },
      uParticleSize: { value: CONFIG.particleSize },
    },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });

  particleMesh = new THREE.Points(particleGeometry, particleMaterial);
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);

  // Generate flow field texture
  generateFlowFieldTexture();
}

function generateFlowFieldTexture() {
  const res = CONFIG.fieldResolution;
  const data = new Uint8Array(res * res * 4);

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const wx = (x / res - 0.5) * 40;
      const wz = (y / res - 0.5) * 40;
      const curl = curlNoise3d(wx * CONFIG.fieldScale, 0, wz * CONFIG.fieldScale);

      // Normalize to 0-1 range
      const nx = Math.floor((curl.x * 0.5 + 0.5) * 255);
      const nz = Math.floor((curl.z * 0.5 + 0.5) * 255);

      const idx = (y * res + x) * 4;
      data[idx] = nx;
      data[idx + 1] = nz;
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  particleMaterial.uniforms.uFieldTexture.value = texture;
}

/* ── FORMATION CYCLE ─────────────────────── */
function updateFormation(dt) {
  const speed = CONFIG.formationSpeed * dt;

  if (formationProgress < 1) {
    formationProgress = Math.min(formationProgress + speed, 1);
    particleMaterial.uniforms.uFormationProgress.value = formationProgress;
  }

  if (formationProgress >= 1) {
    // Move to next formation
    currentFormationIndex = (currentFormationIndex + 1) % CONFIG.formations.length;
    targetPositions = generateFormationPositions(currentFormationIndex);
    particleGeometry.setAttribute('aTarget', new THREE.BufferAttribute(targetPositions.slice(), 3));
    particleGeometry.attributes.aTarget.needsUpdate = true;
    formationProgress = 0;
    particleMaterial.uniforms.uFormationProgress.value = 0;
  }
}

/* ── SCROLL TRIGGER ──────────────────────── */
function onScroll() {
  const sy = window.scrollY;
  const threshold = 300;

  if (sy > threshold && formationProgress < 0.5) {
    // Accelerate formation transition on scroll
    formationProgress = Math.min(formationProgress + 0.15, 1);
    particleMaterial.uniforms.uFormationProgress.value = formationProgress;
  }
}

/* ── MOUSE ───────────────────────────────── */
function onMouseMove(e) {
  if (!containerEl) return;
  const rect = containerEl.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
  mouseActive = true;

  // Convert to world space
  const ndcX = (mouse.x * 2 - 1);
  const ndcY = -(mouse.y * 2 - 1);
  mouseWorld.set(ndcX * 8, ndcY * 5, 0);
  particleMaterial.uniforms.uMouseWorld.value.copy(mouseWorld);
  particleMaterial.uniforms.uMouseActive.value = 1;
}

function onMouseLeave() {
  mouseActive = false;
  particleMaterial.uniforms.uMouseActive.value = 0;
}

/* ── ANIMATION LOOP ──────────────────────── */
function animate(currentTime) {
  animFrameId = requestAnimationFrame(animate);

  if (!isVisible) {
    lastTime = currentTime;
    return;
  }

  const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;
  time += dt;

  // Update uniforms
  particleMaterial.uniforms.uTime.value = time;

  // Formation cycle
  updateFormation(dt);

  // Render via composer
  composer.render();

  // Performance: skip if tab hidden
  if (document.hidden) return;
}

/* ── RESIZE ──────────────────────────────── */
function onResize() {
  if (!renderer || !containerEl) return;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  particleMaterial.uniforms.uFieldResolution.value.set(CONFIG.fieldResolution, CONFIG.fieldResolution);
}

/* ── PUBLIC API ──────────────────────────── */

export function initGraph(container) {
  containerEl = container;

  prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

  if (prefersReduced || isMobile || isLowEnd) {
    // Fallback: static gradient background
    container.style.background = 'linear-gradient(135deg, #060708 0%, #0a0f1a 50%, #060708 100%)';
    return;
  }

  createScene();

  container.style.pointerEvents = 'auto';
  container.addEventListener('mousemove', onMouseMove, { passive: true });
  container.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  const observer = new IntersectionObserver((entries) => {
    isVisible = entries[0].isIntersecting;
  }, { threshold: 0.01 });
  observer.observe(container);

  lastTime = performance.now();
  animFrameId = requestAnimationFrame(animate);
}

export function disposeGraph() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);

  if (containerEl) {
    containerEl.removeEventListener('mousemove', onMouseMove);
    containerEl.removeEventListener('mouseleave', onMouseLeave);
    containerEl.style.pointerEvents = '';
  }

  if (particleMesh) {
    particleGeometry?.dispose();
    particleMaterial?.dispose();
    scene?.remove(particleMesh);
  }

  if (composer) {
    composer.passes.forEach(pass => {
      if (pass.dispose) pass.dispose();
    });
  }

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement?.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  scene = null;
  camera = null;
  composer = null;
  containerEl = null;
}