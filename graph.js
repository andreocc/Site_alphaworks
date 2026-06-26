/* ============================================================
   GRAPH.JS — Arquitetura de Decisão 3D
   Three.js: planos horizontais concêntricos + eixo central.

   Metáfora: um sistema de decisão como arquitetura.
   - 5 anéis horizontais em alturas diferentes (camadas de decisão)
   - Raio ampulheta: informação entra, converge no centro, expande em ação
   - Eixo central vertical representando o fluxo de decisão
   - Mouse inclina a perspectiva; scroll dissolve o grafo
   - Nós respiram sutilmente com fase individual

   Performance:
   - ~80 nós, ~140 arestas, 1 eixo
   - MeshBasicMaterial + LineBasicMaterial (sem iluminação)
   - Pausa quando off-screen (IntersectionObserver)
   - Pixel ratio cap em 2
   ============================================================ */

import * as THREE from 'three';

/* ── CONFIG ───────────────────────────── */
const RINGS = [
  { y: -3.6, radius: 3.8, nodes: 16, color: '#5e6ad2', opacity: .55 },  // topo — entrada de informação
  { y: -1.8, radius: 3.0, nodes: 14, color: '#7b83de', opacity: .60 },  // filtro
  { y:  0.0, radius: 1.8, nodes: 12, color: '#a78bfa', opacity: .70 },  // centro — ponto de decisão
  { y:  1.8, radius: 2.8, nodes: 14, color: '#8b94e8', opacity: .60 },  // expansão
  { y:  3.6, radius: 3.6, nodes: 16, color: '#6b74d8', opacity: .55 },  // base — ação
];

const CONNECTIONS_BETWEEN_RINGS = 3;   // cada nó conecta com N vizinhos mais próximos no anel adjacente
const AXIS_EXTEND = 4.8;               // quanto o eixo se estende além dos anéis
const MOUSE_INFLUENCE = 0.6;           // sensibilidade do tilt com mouse
const SCROLL_FADE_END = 1200;          // px de scroll para fade total (mais lento — o grafo acompanha a leitura)
const BREATH_AMPLITUDE = 0.06;         // amplitude da respiração dos nós
const BREATH_SPEED = 0.8;              // velocidade base da respiração

/* ── STATE ────────────────────────────── */
let scene, camera, renderer;
let ringNodes = [];       // array de arrays: ringNodes[ringIndex][nodeIndex] = mesh
let edgeLines = [];       // array de LineSegments por anel
let axisLine = null;      // linha central
let containerEl = null;
let animFrameId = null;
let isVisible = true;
let scrollOpacity = 1;
let mouseX = 0.5, mouseY = 0.5;
let targetTiltX = 0, targetTiltY = 0;
let currentTiltX = 0, currentTiltY = 0;
let lastTime = 0;

/* ── CREATE SCENE ─────────────────────── */
function createScene() {
  scene = new THREE.Scene();

  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera = new THREE.PerspectiveCamera(40, w / Math.max(h, 1), 0.5, 60);
  camera.position.set(0, 0.3, 13);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);
  containerEl.appendChild(renderer.domElement);

  /* ── Create ring nodes ──────────────── */
  const nodeGeom = new THREE.SphereGeometry(0.055, 10, 10);

  for (let ri = 0; ri < RINGS.length; ri++) {
    const ring = RINGS[ri];
    const nodes = [];

    for (let i = 0; i < ring.nodes; i++) {
      const angle = (i / ring.nodes) * Math.PI * 2;
      // Slight angular offset per ring for visual variety
      const angleOffset = ri * 0.15;
      const x = Math.cos(angle + angleOffset) * ring.radius;
      const z = Math.sin(angle + angleOffset) * ring.radius;

      const color = new THREE.Color(ring.color);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: ring.opacity,
      });

      const mesh = new THREE.Mesh(nodeGeom, mat);
      mesh.position.set(x, ring.y, z);

      mesh.userData = {
        baseX: x,
        baseY: ring.y,
        baseZ: z,
        ringIndex: ri,
        ringColor: ring.color,
        ringOpacity: ring.opacity,
        phase: Math.random() * Math.PI * 2,
        speed: BREATH_SPEED * (0.6 + Math.random() * 0.8),
      };

      scene.add(mesh);
      nodes.push(mesh);
    }

    ringNodes.push(nodes);
  }

  /* ── Create edges between adjacent rings ─ */
  for (let ri = 0; ri < RINGS.length - 1; ri++) {
    const upperNodes = ringNodes[ri];
    const lowerNodes = ringNodes[ri + 1];

    const positions = [];

    for (let i = 0; i < upperNodes.length; i++) {
      const uPos = upperNodes[i].position;

      // Find CONNECTIONS_BETWEEN_RINGS closest nodes in the next ring
      const distances = lowerNodes.map((node, j) => ({
        j,
        d: uPos.distanceTo(node.position),
      }));
      distances.sort((a, b) => a.d - b.d);

      for (let c = 0; c < CONNECTIONS_BETWEEN_RINGS; c++) {
        const lPos = lowerNodes[distances[c].j].position;
        positions.push(uPos.x, uPos.y, uPos.z, lPos.x, lPos.y, lPos.z);
      }
    }

    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x5e6ad2,
      transparent: true,
      opacity: 0.06,
      linewidth: 1,
    });

    const lines = new THREE.LineSegments(edgeGeom, edgeMat);
    scene.add(lines);
    edgeLines.push({ mesh: lines, fromRing: ri, toRing: ri + 1 });
  }

  /* ── Central axis ───────────────────── */
  const axisGeom = new THREE.BufferGeometry();
  axisGeom.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -AXIS_EXTEND, 0,
    0,  AXIS_EXTEND, 0,
  ], 3));

  const axisMat = new THREE.LineBasicMaterial({
    color: 0x5e6ad2,
    transparent: true,
    opacity: 0.10,
    linewidth: 1,
  });

  axisLine = new THREE.LineSegments(axisGeom, axisMat);
  scene.add(axisLine);
}

/* ── UPDATE NODE POSITIONS (rotation) ──── */
function updateRotations(tiltX, tiltY) {
  // Apply tilt to all nodes — rotate around world origin
  for (let ri = 0; ri < ringNodes.length; ri++) {
    for (const node of ringNodes[ri]) {
      const { baseX, baseY, baseZ } = node.userData;

      // Apply Y rotation first, then X
      const cosY = Math.cos(tiltY), sinY = Math.sin(tiltY);
      const x1 = baseX * cosY - baseZ * sinY;
      const z1 = baseX * sinY + baseZ * cosY;

      const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
      const y2 = baseY * cosX - z1 * sinX;
      const z2 = baseY * sinX + z1 * cosX;

      node.position.set(x1, y2, z2);
    }
  }

  // Rotate edge lines
  for (const edge of edgeLines) {
    edge.mesh.rotation.x = tiltX;
    edge.mesh.rotation.y = tiltY;
  }

  // Rotate axis
  if (axisLine) {
    axisLine.rotation.x = tiltX;
    axisLine.rotation.y = tiltY;
  }
}

/* ── ANIMATION LOOP ───────────────────── */
function animate(time) {
  animFrameId = requestAnimationFrame(animate);

  if (!isVisible) {
    lastTime = time;
    return;
  }

  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  /* Tilt target from mouse */
  targetTiltX = (mouseY - 0.5) * Math.PI * MOUSE_INFLUENCE;
  targetTiltY = (mouseX - 0.5) * Math.PI * MOUSE_INFLUENCE;

  // Auto-rotation: subtle slow drift
  const drift = time * 0.00008;
  targetTiltY += Math.sin(drift) * 0.25;

  // Smooth towards target
  const lerpSpeed = 2.5;
  currentTiltX += (targetTiltX - currentTiltX) * Math.min(lerpSpeed * dt, 1);
  currentTiltY += (targetTiltY - currentTiltY) * Math.min(lerpSpeed * dt, 1);

  /* Update rotations */
  updateRotations(currentTiltX, currentTiltY);

  /* Animate individual nodes — subtle breathing */
  for (const ring of ringNodes) {
    for (const node of ring) {
      const { phase, speed } = node.userData;
      const breathe = 1 + Math.sin(time * 0.001 * speed + phase) * BREATH_AMPLITUDE / node.userData.baseY;
      node.scale.setScalar(breathe);

      // Opacity variation
      const opacityVar = 0.8 + Math.sin(time * 0.0012 * speed + phase) * 0.2;
      node.material.opacity = (node.userData.ringOpacity * opacityVar) * scrollOpacity;
    }
  }

  /* Edge opacity */
  for (const edge of edgeLines) {
    edge.mesh.material.opacity = 0.06 * scrollOpacity;
  }

  /* Axis opacity */
  if (axisLine) {
    axisLine.material.opacity = 0.10 * scrollOpacity;
  }

  renderer.render(scene, camera);
}

/* ── RESIZE ───────────────────────────── */
function onResize() {
  if (!renderer || !containerEl) return;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

/* ── MOUSE ────────────────────────────── */
function onMouseMove(e) {
  if (!containerEl) return;
  const rect = containerEl.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) / rect.width;
  mouseY = (e.clientY - rect.top) / rect.height;
}

/* ── SCROLL FADE ──────────────────────── */
function onScroll() {
  const sy = window.scrollY;
  if (sy <= 0) {
    scrollOpacity = 1;
  } else if (sy >= SCROLL_FADE_END) {
    scrollOpacity = 0;
  } else {
    scrollOpacity = 1 - sy / SCROLL_FADE_END;
  }
  // Ease cubic
  scrollOpacity = scrollOpacity * scrollOpacity * (3 - 2 * scrollOpacity);
}

/* ── PUBLIC API ───────────────────────── */

/**
 * Initialize the graph inside a container element.
 * @param {HTMLElement} container
 */
export function initGraph(container) {
  containerEl = container;
  createScene();

  // Enable mouse tracking on the container
  container.style.pointerEvents = 'auto';
  container.addEventListener('mousemove', onMouseMove, { passive: true });

  // Scroll and resize
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  // Pause when off-screen
  const observer = new IntersectionObserver((entries) => {
    isVisible = entries[0].isIntersecting;
  }, { threshold: 0.01 });
  observer.observe(container);

  // Initial scroll state
  onScroll();

  // Start render loop
  animFrameId = requestAnimationFrame(animate);
}

/**
 * Clean up the graph completely.
 */
export function disposeGraph() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);

  if (containerEl) {
    containerEl.removeEventListener('mousemove', onMouseMove);
    containerEl.style.pointerEvents = '';
  }

  // Dispose Three.js resources
  for (const ring of ringNodes) {
    for (const node of ring) {
      node.geometry?.dispose();
      node.material?.dispose();
    }
  }
  ringNodes = [];

  for (const edge of edgeLines) {
    edge.mesh.geometry?.dispose();
    edge.mesh.material?.dispose();
  }
  edgeLines = [];

  if (axisLine) {
    axisLine.geometry?.dispose();
    axisLine.material?.dispose();
    axisLine = null;
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
