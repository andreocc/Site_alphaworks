/* ============================================================
   GRAPH.JS — System Field 3D · Mouse-reactive particles
   Partículas que orbitam, fogem e brilham perto do cursor.
   ============================================================ */

import * as THREE from 'three';

/* ── CONFIG ──────────────────────────────── */
const CONFIG = {
  particleCount: 5000,
  fieldResolution: 64,
  fieldScale: 0.006,
  flowSpeed: 0.08,
  particleSize: 1.4,
  formationSpeed: 1.8,
  // Mouse
  mouseRadius: 3.5,        // raio de influência do mouse em world units
  mouseForce: 0.9,         // intensidade da força (0-1)
  mouseVortex: 0.6,        // intensidade do spin tangencial
  mouseGlowRadius: 1.8,    // raio do glow de proximidade
  mouseTrailDecay: 0.92,   // decaimento do rastro (0-1, quanto menor mais rápido some)
  // Colors
  colors: {
    bg: 0x060708,
    grid: 0x1a1d23,
    particleA: new THREE.Color(0x5e6ad2),
    particleB: new THREE.Color(0xa78bfa),
    particleC: new THREE.Color(0x22c55e),
    accent: new THREE.Color(0x8b94e8),   // glow near cursor
    cursor: new THREE.Color(0xc4b5fd),   // very close to cursor
  },
  formations: [
    { name: 'sphere', radius: 3.5 },
    { name: 'torus', radius: 3, tube: 1.2 },
    { name: 'wave', amplitude: 1.2, frequency: 0.8 },
    { name: 'grid', spacing: 0.5 },
    { name: 'helix', radius: 2, height: 4, turns: 2 },
  ],
};

/* ── PRE-ALLOCATED ───────────────────────── */
const _tmpVec3 = new THREE.Vector3();
const _tmpVec3b = new THREE.Vector3();

/* ── STATE ───────────────────────────────── */
let scene, camera, renderer;
let particleGeometry, particleMaterial, particleMesh;
let containerEl = null;
let animFrameId = null;
let isVisible = true;

let scrollY = 0;
let formationProgress = 0;
let currentFormationIndex = 0;
let targetPositions = null;

// Mouse — posição suave com lag para efeito de rastro
let mouseWorld = new THREE.Vector3();        // posição atual (raw)
let mouseWorldSmooth = new THREE.Vector3();  // posição suavizada
let mouseVelocity = new THREE.Vector3();     // velocidade (delta entre frames)
let mouseActive = false;
let mouseActiveTimer = 0;                    // timer para decaimento suave ao sair

let time = 0;
let lastTime = 0;

/* ── PERLIN NOISE ────────────────────────── */
const PERM = new Uint8Array(512);

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

/* ── FORMATION GENERATORS ────────────────── */
function generateFormationPositions(index) {
  const count = CONFIG.particleCount;
  const positions = new Float32Array(count * 3);
  const formation = CONFIG.formations[index % CONFIG.formations.length];
  let idx = 0;

  switch (formation.name) {
    case 'sphere':
      for (let i = 0; i < count; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r = Math.cbrt(Math.random()) * formation.radius;
        positions[idx++] = r * Math.sin(phi) * Math.cos(theta);
        positions[idx++] = r * Math.sin(phi) * Math.sin(theta);
        positions[idx++] = r * Math.cos(phi);
      }
      break;
    case 'torus':
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
    case 'wave':
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 10;
        const z = (Math.random() - 0.5) * 10;
        const y = Math.sin(x * formation.frequency + time) * formation.amplitude;
        positions[idx++] = x;
        positions[idx++] = y;
        positions[idx++] = z;
      }
      break;
    case 'grid':
      const cols = Math.ceil(Math.sqrt(count * 1.5));
      const rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions[idx++] = (col - cols * 0.5) * formation.spacing;
        positions[idx++] = (Math.random() - 0.5) * 0.3;
        positions[idx++] = (row - rows * 0.5) * formation.spacing;
      }
      break;
    case 'helix':
      for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 * formation.turns;
        const r = formation.radius;
        positions[idx++] = r * Math.cos(t);
        positions[idx++] = (i / count - 0.5) * formation.height;
        positions[idx++] = r * Math.sin(t);
      }
      break;
  }
  return positions;
}

/* ── SCENE SETUP ─────────────────────────── */
function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.bg);

  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera = new THREE.PerspectiveCamera(50, w / Math.max(h, 1), 0.1, 100);
  camera.position.set(0, 0.5, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(w, h);
  renderer.setClearColor(CONFIG.colors.bg, 1);
  containerEl.appendChild(renderer.domElement);

  // Subtle grid — mais visível que antes
  const gridGeo = new THREE.PlaneGeometry(30, 30, 40, 40);
  const gridMat = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.grid,
    wireframe: true,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
  });
  const grid = new THREE.Mesh(gridGeo, gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -1.5;
  scene.add(grid);

  createParticles();

  basePositions = particleGeometry.getAttribute('position').array.slice();
  targetPositions = generateFormationPositions(0);
  particleGeometry.setAttribute('aTarget', new THREE.BufferAttribute(targetPositions.slice(), 3));
}

/* ── PARTICLES (GPU SHADER) ──
   Mouse interaction model:
   - Attraction suave na borda externa do raio
   - Repulsão forte no centro (evita aglomeração)
   - Força tangencial (vórtice) perpendicular ao vetor mouse→partícula
   - Glow: partículas perto do cursor ficam maiores e mudam de cor
*/
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
  uniform vec3 uMouseVelocity;
  uniform float uMouseActive;
  uniform float uMouseRadius;
  uniform float uMouseForce;
  uniform float uMouseVortex;
  uniform float uParticleSize;
  varying vec3 vColor;
  varying vec3 vPosition;
  varying float vMouseProximity;

  vec3 sampleField(vec3 pos) {
    vec2 uv = (pos.xz * 0.5 + 0.5) * uFieldResolution;
    vec4 field = texture2D(uFieldTexture, uv / uFieldResolution);
    return vec3(field.r - 0.5, 0.0, field.g - 0.5) * 1.5;
  }

  void main() {
    vec3 pos = position;
    vec3 target = aTarget;

    // ── Flow field ──────────────────────────
    vec3 flow = sampleField(pos + uTime * uFlowSpeed * 100.0);
    pos += flow * 0.08 * (1.0 - uFormationProgress * 0.5);

    // ══════════════════════════════════════════
    // ── MOUSE INTERACTION ────────────────────
    // ══════════════════════════════════════════
    float mouseProximity = 0.0;
    if (uMouseActive > 0.01) {
      vec3 toMouse = pos - uMouseWorld;
      float dist = length(toMouse);
      float radius = uMouseRadius;

      if (dist < radius && dist > 0.001) {
        vec3 dirToMouse = toMouse / dist;

        // Proximity factor — 1 no centro, 0 na borda
        float prox = 1.0 - smoothstep(0.0, radius, dist);
        mouseProximity = prox;

        // ── Força radial: attrai na borda, repele no centro ──
        // Cria um anel de equilíbrio ~30% do raio
        float radialZone = dist / radius;          // 0 = centro, 1 = borda
        float radialForce;
        if (radialZone < 0.25) {
          // Núcleo: repulsão forte
          radialForce = (0.25 - radialZone) / 0.25 * 1.2;
        } else if (radialZone < 0.6) {
          // Zona de atração
          radialForce = -(radialZone - 0.25) / 0.35 * 1.0;
        } else {
          // Borda externa: atração suave decaindo
          radialForce = -(1.0 - radialZone) / 0.4 * 0.5;
        }

        // ── Força tangencial (vórtice) ──
        // Perpendicular ao vetor mouse→partícula no plano XZ
        vec3 tangent = vec3(-dirToMouse.z, 0.0, dirToMouse.x);
        float vortexStrength = uMouseVortex * prox * (1.0 - abs(radialZone - 0.4) * 2.5);
        vortexStrength = max(vortexStrength, 0.0);

        // ── Força de arrasto pela velocidade do mouse ──
        float velInfluence = length(uMouseVelocity) * prox * 0.5;

        // Aplica todas as forças
        float totalForce = uMouseForce * uMouseActive * prox;
        pos -= dirToMouse * radialForce * totalForce * 0.15;
        pos += tangent * vortexStrength * totalForce * 0.1;
        pos += uMouseVelocity * velInfluence * 0.02 * uMouseActive;

        // ── Elevação sutil no eixo Y perto do cursor ──
        pos.y += prox * uMouseActive * 0.3;
      }
    }

    // ── Formation morph ─────────────────────
    pos = mix(pos, target, uFormationProgress);

    vColor = aColor;
    vPosition = pos;
    vMouseProximity = mouseProximity;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    // Partículas perto do mouse ficam maiores
    float sizeBoost = 1.0 + mouseProximity * uMouseActive * 2.5;
    gl_PointSize = uParticleSize * sizeBoost * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FS = `
  uniform float uTime;
  uniform vec3 uAccentColor;   // cor de glow a média distância
  uniform vec3 uCursorColor;   // cor de glow muito perto
  uniform float uMouseActive;
  varying vec3 vColor;
  varying vec3 vPosition;
  varying float vMouseProximity;

  void main() {
    float dist = length(gl_PointCoord - 0.5);
    if (dist > 0.5) discard;

    // Alpha base — borda suave circular
    float alpha = 1.0 - smoothstep(0.0, 0.48, dist);

    // Pulse sutil
    float pulse = 0.82 + 0.12 * sin(uTime * 3.0 + vPosition.y * 2.0);
    alpha *= pulse;

    // ══════════════════════════════════════════
    // ── MOUSE GLOW ───────────────────────────
    // ══════════════════════════════════════════
    vec3 color = vColor;

    if (vMouseProximity > 0.0 && uMouseActive > 0.01) {
      float glow = vMouseProximity * uMouseActive;

      // Transição de cor: original → accent → cursor (quanto mais perto, mais quente)
      if (glow > 0.6) {
        // Muito perto do cursor — branco/quente
        color = mix(vColor, uCursorColor, (glow - 0.6) / 0.4);
      } else {
        // Distância média — accent color
        color = mix(vColor, uAccentColor, glow / 0.6);
      }

      // Brilho extra — partículas perto do cursor são mais opacas
      alpha = mix(alpha, alpha * 1.6, glow);
    }

    alpha *= 0.65;

    gl_FragColor = vec4(color, alpha);
  }
`;

let basePositions = null;

function createParticles() {
  const count = CONFIG.particleCount;
  particleGeometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Start in sphere
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = Math.cbrt(Math.random()) * 6;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const group = i % 3;
    const color = group === 0 ? CONFIG.colors.particleA :
                  group === 1 ? CONFIG.colors.particleB : CONFIG.colors.particleC;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    indices[i] = i;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
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
      uMouseVelocity: { value: new THREE.Vector3() },
      uMouseActive: { value: 0 },
      uMouseRadius: { value: CONFIG.mouseRadius },
      uMouseForce: { value: CONFIG.mouseForce },
      uMouseVortex: { value: CONFIG.mouseVortex },
      uParticleSize: { value: CONFIG.particleSize },
      uAccentColor: { value: CONFIG.colors.accent },
      uCursorColor: { value: CONFIG.colors.cursor },
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

  createFlowFieldTexture();
}

function createFlowFieldTexture() {
  const res = CONFIG.fieldResolution;
  const data = new Uint8Array(res * res * 4);

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const wx = (x / res - 0.5) * 30;
      const wz = (y / res - 0.5) * 30;
      const t = time * 0.05;
      const n1 = noise3d(wx * 0.008, t, wz * 0.008);
      const n2 = noise3d(wx * 0.008 + 100.0, t, wz * 0.008);
      const nx = n1;
      const nz = n2;

      const idx = (y * res + x) * 4;
      data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((nz * 0.5 + 0.5) * 255);
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
  const threshold = 200;

  if (sy > threshold && formationProgress < 0.7) {
    formationProgress = Math.min(formationProgress + 0.2, 1);
    particleMaterial.uniforms.uFormationProgress.value = formationProgress;
  }
}

/* ── MOUSE — com suavização e rastro ─────── */
function onMouseMove(e) {
  if (!containerEl) return;
  const rect = containerEl.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;

  const ndcX = (mx * 2 - 1);
  const ndcY = -(my * 2 - 1);

  // Posição no espaço mundo (plano Z=0, escala pela view)
  const worldX = ndcX * 6;
  const worldY = ndcY * 4;

  // Velocidade = delta desde o último frame
  mouseVelocity.set(
    worldX - mouseWorld.x,
    worldY - mouseWorld.y,
    0
  );

  mouseWorld.set(worldX, worldY, 0);
  mouseActive = true;
  mouseActiveTimer = 1.0;

  // Snap do smooth no primeiro movimento após inatividade
  if (mouseWorldSmooth.length() < 0.01) {
    mouseWorldSmooth.copy(mouseWorld);
  }
}

function onMouseLeave() {
  mouseActive = false;
  // Não zera — deixa decair naturalmente
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

  // ── Mouse smooth follow (rastro) ──────────
  if (mouseActive) {
    // Lerp rápido — segue o mouse com lag
    mouseWorldSmooth.lerp(mouseWorld, 1 - Math.exp(-12 * dt));
  } else {
    // Decaimento lento — partículas voltam ao estado natural gradualmente
    mouseActiveTimer = Math.max(mouseActiveTimer - dt * 1.5, 0);
  }

  // Atualiza uniforms
  particleMaterial.uniforms.uTime.value = time;
  particleMaterial.uniforms.uMouseWorld.value.copy(mouseWorldSmooth);
  particleMaterial.uniforms.uMouseVelocity.value.copy(mouseVelocity);

  // Mouse active com decaimento suave
  const activeLevel = mouseActive ? 1.0 : Math.max(mouseActiveTimer, 0);
  particleMaterial.uniforms.uMouseActive.value = activeLevel;

  // Amortece a velocidade quando mouse está parado
  if (mouseActive && mouseVelocity.length() < 0.02) {
    mouseVelocity.multiplyScalar(0.9);
  }

  // ── Flow field update (a cada 2 segundos) ─
  if (Math.floor(time) % 2 === 0 && Math.floor((time - dt)) % 2 !== 0) {
    createFlowFieldTexture();
  }

  updateFormation(dt);
  renderer.render(scene, camera);
}

/* ── RESIZE ──────────────────────────────── */
function onResize() {
  if (!renderer || !containerEl) return;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

/* ── PUBLIC API ──────────────────────────── */
export function initGraph(container) {
  containerEl = container;

  if (skipGraph) {
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

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement?.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  scene = null;
  camera = null;
  containerEl = null;
}

// Re-exportado para uso externo (main.js)
export const skipGraph = (() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  return prefersReducedMotion || isMobile || isLowEnd;
})();
