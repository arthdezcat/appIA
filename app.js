import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const canvas = document.getElementById("stage");
const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const toggleCameraBtn = document.getElementById("toggleCamera");
const presetSelect = document.getElementById("presetSelect");
const primaryColorInput = document.getElementById("primaryColor");
const secondaryColorInput = document.getElementById("secondaryColor");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070c14, 0.042);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.4, 6.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.enableZoom = false;

const ambient = new THREE.AmbientLight(0x9cc9ff, 0.55);
scene.add(ambient);

const pointLight = new THREE.PointLight(0x66ddff, 1.2, 25);
pointLight.position.set(2.5, 3, 4);
scene.add(pointLight);

const GROUP_SIZE = 5000;
const particleGeom = new THREE.BufferGeometry();
const positions = new Float32Array(GROUP_SIZE * 3);
const colors = new Float32Array(GROUP_SIZE * 3);
const scales = new Float32Array(GROUP_SIZE);

for (let i = 0; i < GROUP_SIZE; i++) {
  positions[i * 3 + 0] = (Math.random() - 0.5) * 3;
  positions[i * 3 + 1] = (Math.random() - 0.5) * 3;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
  scales[i] = Math.random();
}

particleGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
particleGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
particleGeom.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

const particleMat = new THREE.PointsMaterial({
  size: 0.05,
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const points = new THREE.Points(particleGeom, particleMat);
scene.add(points);

const clock = new THREE.Clock();
const tempV = new THREE.Vector3();

let targetTemplate = [];
let jitterStrength = 0.008;
let globalScale = 1;
let impulse = 0;
let handLandmarker;
let cameraActive = false;
let mediaStream;
let lastVideoTime = -1;

let gestureState = {
  handOpen: 0.5,
  pinch: 0,
  moveX: 0,
  moveY: 0,
  twoHandScale: 1,
  detectedHands: 0,
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mapPointsFrom2D(list, z = 0) {
  return list.map((p) => new THREE.Vector3(p[0], p[1], z));
}

function buildHeartPoints(count = GROUP_SIZE) {
  const raw = [];
  for (let i = 0; i < 1400; i++) {
    const t = (i / 1400) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    raw.push([x * 0.08, y * 0.08]);
  }
  const map = mapPointsFrom2D(raw, 0);
  return fillTemplate(map, count, 0.28);
}

function buildFlowerPoints(count = GROUP_SIZE) {
  const raw = [];
  const petals = 6;
  for (let i = 0; i < 2200; i++) {
    const a = (i / 2200) * Math.PI * 2;
    const r = 1.1 * Math.sin(petals * a) + 0.8;
    raw.push([Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15]);
  }
  const map = mapPointsFrom2D(raw, 0);
  return fillTemplate(map, count, 0.32);
}

function buildSaturnPoints(count = GROUP_SIZE) {
  const pts = [];
  for (let i = 0; i < 2500; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(2 * Math.random() - 1);
    const r = 1.2 + (Math.random() - 0.5) * 0.15;
    pts.push(
      new THREE.Vector3(
        r * Math.sin(v) * Math.cos(u),
        r * Math.cos(v),
        r * Math.sin(v) * Math.sin(u)
      )
    );
  }
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * Math.PI * 2;
    const ringR = 2 + (Math.random() - 0.5) * 0.34;
    pts.push(
      new THREE.Vector3(
        Math.cos(a) * ringR,
        (Math.random() - 0.5) * 0.08,
        Math.sin(a) * ringR * 0.8
      )
    );
  }
  return fillTemplate(pts, count, 0.12);
}

function buildFireworksPoints(count = GROUP_SIZE) {
  const pts = [];
  const bursts = 7;
  for (let b = 0; b < bursts; b++) {
    const center = new THREE.Vector3(
      (Math.random() - 0.5) * 3.5,
      (Math.random() - 0.2) * 2.8,
      (Math.random() - 0.5) * 2
    );
    const burstCount = Math.floor(count / bursts);
    for (let i = 0; i < burstCount; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      const dist = Math.random() * 1.25;
      pts.push(center.clone().add(dir.multiplyScalar(dist)));
    }
  }
  return fillTemplate(pts, count, 0.22);
}

function buildJarvisPoints(count = GROUP_SIZE) {
  const pts = [];
  const ringCount = 14;
  for (let r = 0; r < ringCount; r++) {
    const ringR = 0.45 + r * 0.16;
    const y = (r - ringCount / 2) * 0.06;
    const seg = 120 + r * 8;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const pulse = 1 + Math.sin(a * 4 + r) * 0.05;
      pts.push(new THREE.Vector3(Math.cos(a) * ringR * pulse, y, Math.sin(a) * ringR));
    }
  }
  for (let i = 0; i < 1200; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 0.9;
    pts.push(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 1.8, Math.sin(a) * r));
  }
  return fillTemplate(pts, count, 0.18);
}

function fillTemplate(basePoints, count, zSpread = 0.2) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const src = basePoints[i % basePoints.length];
    out[i] = src.clone();
    out[i].z += (Math.random() - 0.5) * zSpread;
  }
  return out;
}

function applyTemplate(name) {
  if (name === "heart") targetTemplate = buildHeartPoints();
  else if (name === "flower") targetTemplate = buildFlowerPoints();
  else if (name === "saturn") targetTemplate = buildSaturnPoints();
  else if (name === "fireworks") targetTemplate = buildFireworksPoints();
  else targetTemplate = buildJarvisPoints();
}

function refreshColors(time) {
  const c1 = new THREE.Color(primaryColorInput.value);
  const c2 = new THREE.Color(secondaryColorInput.value);
  const colorAttr = particleGeom.getAttribute("color");
  for (let i = 0; i < GROUP_SIZE; i++) {
    const t = (Math.sin(time * 0.9 + i * 0.015) + 1) * 0.5;
    tempV.set(lerp(c1.r, c2.r, t), lerp(c1.g, c2.g, t), lerp(c1.b, c2.b, t));
    colorAttr.setXYZ(i, tempV.x, tempV.y, tempV.z);
  }
  colorAttr.needsUpdate = true;
}

function handDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function updateGestures(result) {
  const landmarks = result?.landmarks ?? [];
  gestureState.detectedHands = landmarks.length;

  if (!landmarks.length) {
    gestureState.handOpen = lerp(gestureState.handOpen, 0.5, 0.1);
    gestureState.pinch = lerp(gestureState.pinch, 0, 0.15);
    gestureState.moveX = lerp(gestureState.moveX, 0, 0.1);
    gestureState.moveY = lerp(gestureState.moveY, 0, 0.1);
    gestureState.twoHandScale = lerp(gestureState.twoHandScale, 1, 0.06);
    return;
  }

  const hand = landmarks[0];
  const wrist = hand[0];
  const indexTip = hand[8];
  const middleTip = hand[12];
  const ringTip = hand[16];
  const pinkyTip = hand[20];
  const thumbTip = hand[4];

  const opennessRaw =
    (handDistance(indexTip, wrist) +
      handDistance(middleTip, wrist) +
      handDistance(ringTip, wrist) +
      handDistance(pinkyTip, wrist)) /
    4;
  const openness = THREE.MathUtils.clamp((opennessRaw - 0.18) / 0.18, 0, 1);
  gestureState.handOpen = lerp(gestureState.handOpen, openness, 0.25);

  const pinchDistance = handDistance(indexTip, thumbTip);
  const pinch = THREE.MathUtils.clamp((0.11 - pinchDistance) / 0.07, 0, 1);
  gestureState.pinch = lerp(gestureState.pinch, pinch, 0.25);

  gestureState.moveX = lerp(gestureState.moveX, (wrist.x - 0.5) * -2.2, 0.25);
  gestureState.moveY = lerp(gestureState.moveY, (0.5 - wrist.y) * 1.8, 0.25);

  if (landmarks.length > 1) {
    const handA = landmarks[0][9];
    const handB = landmarks[1][9];
    const d = handDistance(handA, handB);
    const scale = THREE.MathUtils.clamp(0.4 + d * 2.2, 0.65, 2.4);
    gestureState.twoHandScale = lerp(gestureState.twoHandScale, scale, 0.18);
  } else {
    gestureState.twoHandScale = lerp(gestureState.twoHandScale, 1, 0.07);
  }
}

async function setupHandTracking() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minTrackingConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
  });
}

async function startCamera() {
  if (cameraActive) return;

  if (!handLandmarker) {
    statusEl.textContent = "Cargando detector de manos...";
    await setupHandTracking();
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 960, height: 540, facingMode: "user" },
    audio: false,
  });

  video.srcObject = mediaStream;
  await video.play();
  cameraActive = true;
  statusEl.textContent = "Cámara activa · detectando manos";
  toggleCameraBtn.textContent = "Detener cámara";
}

function stopCamera() {
  if (!cameraActive) return;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  cameraActive = false;
  statusEl.textContent = "Cámara inactiva";
  toggleCameraBtn.textContent = "Iniciar cámara";
  gestureState.detectedHands = 0;
}

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  if (cameraActive && handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    updateGestures(result);
  }

  const opennessScale = lerp(0.55, 1.45, gestureState.handOpen);
  const dynamicScale = opennessScale * gestureState.twoHandScale * globalScale;

  impulse = lerp(impulse, gestureState.pinch, 0.2);
  const impulseBoost = 1 + impulse * 1.8;

  const posAttr = particleGeom.getAttribute("position");
  for (let i = 0; i < GROUP_SIZE; i++) {
    const t = targetTemplate[i];
    const ix = i * 3;

    const targetX = t.x * dynamicScale + gestureState.moveX;
    const targetY = t.y * dynamicScale + gestureState.moveY;
    const targetZ = t.z * dynamicScale;

    positions[ix + 0] = lerp(
      positions[ix + 0],
      targetX + (Math.random() - 0.5) * jitterStrength * impulseBoost,
      0.08
    );
    positions[ix + 1] = lerp(
      positions[ix + 1],
      targetY + (Math.random() - 0.5) * jitterStrength * impulseBoost,
      0.08
    );
    positions[ix + 2] = lerp(
      positions[ix + 2],
      targetZ + (Math.random() - 0.5) * jitterStrength * impulseBoost,
      0.08
    );
  }
  posAttr.needsUpdate = true;

  points.rotation.y += 0.002 + impulse * 0.01;
  points.rotation.x = Math.sin(elapsed * 0.35) * 0.12 + gestureState.moveY * 0.1;

  if (presetSelect.value === "fireworks") {
    points.rotation.z += 0.004 + impulse * 0.02;
    jitterStrength = lerp(jitterStrength, 0.03, 0.05);
  } else if (presetSelect.value === "jarvis") {
    points.rotation.y += 0.01;
    jitterStrength = lerp(jitterStrength, 0.012, 0.07);
  } else {
    jitterStrength = lerp(jitterStrength, 0.008, 0.07);
  }

  refreshColors(elapsed);
  controls.update();
  renderer.render(scene, camera);
}

toggleCameraBtn.addEventListener("click", async () => {
  try {
    if (cameraActive) stopCamera();
    else await startCamera();
  } catch (error) {
    statusEl.textContent = "No se pudo iniciar la cámara";
    console.error(error);
  }
});

presetSelect.addEventListener("change", () => {
  applyTemplate(presetSelect.value);
});

window.addEventListener("resize", () => {
  const panel = document.querySelector(".panel");
  const panelHeight = window.innerWidth <= 900 ? panel.offsetHeight : 0;
  const width = window.innerWidth;
  const height = window.innerHeight - panelHeight;
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
});

applyTemplate("heart");
animate();
