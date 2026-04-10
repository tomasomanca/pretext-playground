import { prepareWithSegments, layoutWithLines, type LayoutLine } from "@chenglou/pretext";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ─── Config ───────────────────────────────────────────────────────────────────

const FONT_SIZE = 18;
const LINE_HEIGHT = 28;
const CANVAS_FONT = `${FONT_SIZE}px PPNeueMontreal, sans-serif`;

const MAX_DISPLACEMENT = 72;
const EASE = 0.13;

const MEDIAPIPE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// ─── Text ─────────────────────────────────────────────────────────────────────

const TEXT =
  "Typography is the art and technique of arranging type to make written language legible, readable, and appealing. The arrangement of type involves selecting typefaces, point sizes, line lengths, and letter-spacing. Good typography is invisible — it serves the text without calling attention to itself, quietly shaping how every sentence lands in the mind of the reader. The white space between words is as deliberate as the ink itself, a breathing room where the eye rests before continuing forward through the line. Each character is a small vessel carrying both sound and meaning, and the distances between them determine the rhythm of the whole.";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CharState {
  el: HTMLSpanElement;
  restX: number;
  restY: number;
  currentX: number;
  currentY: number;
}

// ─── DOM ──────────────────────────────────────────────────────────────────────

const container = document.getElementById("text-container") as HTMLDivElement;
const statusEl  = document.getElementById("hand-status")     as HTMLSpanElement;
// Debug overlay — position: fixed elements in <body>, viewport-absolute coords
const debugIndex = document.getElementById("debug-index")     as HTMLDivElement; // pink — lm 8
const debugThumb = document.getElementById("debug-thumb")     as HTMLDivElement; // yellow — lm 4
const debugLine  = document.getElementById("debug-line")      as HTMLDivElement; // green line index→thumb

// ─── Canvas measurement ───────────────────────────────────────────────────────

const measureCanvas = document.createElement("canvas");
const ctx = measureCanvas.getContext("2d")!;

// ─── State ────────────────────────────────────────────────────────────────────

let chars: CharState[] = [];

// Bounding rect of the container, viewport-relative (refreshed on layout + scroll)
let containerRect: DOMRect = container.getBoundingClientRect();

// Active cursor position in container-local coordinates.
// Set by hand landmarks (primary) or mouse (fallback).
let cursorX = -99999;
let cursorY = -99999;
let activeRadius = 60; // updated every frame from pixel distance index→thumb
let cursorActive = false; // true while a hand (or mouse) is in frame

// Viewport-absolute positions for the debug overlay (position: fixed dots + line).
// ix/iy = INDEX_FINGER_TIP (lm 8) — cursor + line end A (pink dot)
// tx/ty = THUMB_TIP         (lm 4) — radius endpoint  + line end B (yellow dot)
const dbg = { ix: 0, iy: 0, tx: 0, ty: 0 };

// Smoothed positions used only for rendering the debug overlay.
// A light lerp removes MediaPipe jitter without making the dots feel laggy.
const SMOOTH = 0.35;
const sdbg = { ix: 0, iy: 0, tx: 0, ty: 0 };

// MediaPipe
let handLandmarker: HandLandmarker | null = null;
let video: HTMLVideoElement | null = null;
let lastVideoTime = -1;

// True once we fall back to mouse (permanent for the session)
let usingMouseFallback = false;

// ─── Layout ───────────────────────────────────────────────────────────────────

function buildLayout(): void {
  container.querySelectorAll("span:not(#hand-indicator)").forEach((s) => s.remove());
  chars = [];
  ctx.font = CANVAS_FONT;

  const maxWidth = container.clientWidth;
  if (maxWidth <= 0) return;

  const prepared = prepareWithSegments(TEXT, CANVAS_FONT);
  const { lines, height } = layoutWithLines(prepared, maxWidth, LINE_HEIGHT);
  container.style.height = `${height}px`;

  const fragment = document.createDocumentFragment();

  lines.forEach((line, lineIndex) => {
    const lineText = (line as LayoutLine).text;
    const restY = lineIndex * LINE_HEIGHT;
    let charIndex = 0;

    for (const char of lineText) {
      if (char !== " " && char !== "\u00A0") {
        const prefix = lineText.slice(0, charIndex);
        const restX = ctx.measureText(prefix).width;

        const span = document.createElement("span");
        span.textContent = char;
        span.style.transform = `translate(${restX}px,${restY}px)`;
        fragment.appendChild(span);

        chars.push({ el: span, restX, restY, currentX: restX, currentY: restY });
      }
      charIndex++;
    }
  });

  container.appendChild(fragment);
  container.classList.remove("loading");
  containerRect = container.getBoundingClientRect();
}

function refreshContainerRect(): void {
  containerRect = container.getBoundingClientRect();
}

// ─── MediaPipe init ───────────────────────────────────────────────────────────

async function initMediaPipe(): Promise<void> {
  setStatus("Initializing camera…", "neutral");

  try {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    setStatus("No hand detected", "inactive");
  } catch (err) {
    console.warn("Camera unavailable, falling back to mouse:", err);
    usingMouseFallback = true;
    setupMouseFallback();
  }
}

// ─── Mouse fallback ───────────────────────────────────────────────────────────

function setupMouseFallback(): void {
  activeRadius = 80;
  setStatus("Camera unavailable — using mouse", "warn");

  container.addEventListener("mousemove", (e: MouseEvent) => {
    cursorX = e.clientX - containerRect.left;
    cursorY = e.clientY - containerRect.top;
    cursorActive = true;
  });

  container.addEventListener("mouseleave", () => {
    cursorActive = false;
  });
}

// ─── Coordinate mapping ───────────────────────────────────────────────────────

// Maps a normalised landmark coord [0,1] to a viewport-absolute pixel position,
// preserving the video's aspect ratio (contain fit, centered) and mirroring X.
function getScreenPos(nx: number, ny: number): { x: number; y: number } {
  const vw = video?.videoWidth  || 640;
  const vh = video?.videoHeight || 480;
  const videoAR    = vw / vh;
  const viewportAR = window.innerWidth / window.innerHeight;

  let dW: number, dH: number, padX: number, padY: number;
  if (videoAR > viewportAR) {
    dW = window.innerWidth;  dH = dW / videoAR;
    padX = 0;                padY = (window.innerHeight - dH) / 2;
  } else {
    dH = window.innerHeight; dW = dH * videoAR;
    padX = (window.innerWidth - dW) / 2; padY = 0;
  }

  return { x: (1 - nx) * dW + padX, y: ny * dH + padY }; // mirror X
}

// ─── Hand detection (called every rAF) ────────────────────────────────────────

function detectHand(): void {
  if (!handLandmarker || !video || video.readyState < 2) return;

  const now = performance.now();
  if (now === lastVideoTime) return; // same timestamp, skip
  lastVideoTime = now;

  const results = handLandmarker.detectForVideo(video, now);

  if (results.landmarks.length > 0) {
    cursorActive = true;
    const lm        = results.landmarks[0];
    const thumbTip  = lm[4];  // THUMB_TIP         — yellow dot, radius endpoint
    const indexTip  = lm[8];  // INDEX_FINGER_TIP  — pink dot, cursor + radius endpoint

    // Viewport-absolute positions (used by position:fixed debug overlay)
    const iPos = getScreenPos(indexTip.x, indexTip.y);
    const tPos = getScreenPos(thumbTip.x,  thumbTip.y);
    dbg.ix = iPos.x;  dbg.iy = iPos.y;
    dbg.tx = tPos.x;  dbg.ty = tPos.y;

    // Field center = midpoint between index and thumb (screen space → container-local)
    cursorX = (iPos.x + tPos.x) / 2 - containerRect.left;
    cursorY = (iPos.y + tPos.y) / 2 - containerRect.top;

    // Field radius = half the pixel distance between index and thumb
    // (diameter == length of green line, center == midpoint of green line)
    const pdx = iPos.x - tPos.x;
    const pdy = iPos.y - tPos.y;
    activeRadius = Math.sqrt(pdx * pdx + pdy * pdy) / 2;

    setStatus("Hand detected", "active");
  } else {
    cursorActive = false;
    setStatus("No hand detected", "inactive");
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

type StatusState = "active" | "inactive" | "warn" | "neutral";

const STATUS_COLORS: Record<StatusState, string> = {
  active: "#4ade80",
  inactive: "#f87171",
  warn: "#fb923c",
  neutral: "rgba(255,255,255,0.3)",
};

let lastStatus = "";

function setStatus(text: string, state: StatusState): void {
  if (text === lastStatus) return; // avoid redundant DOM writes
  lastStatus = text;
  statusEl.textContent = text;
  statusEl.style.color = STATUS_COLORS[state];
}

// ─── Animation loop ───────────────────────────────────────────────────────────

function animate(): void {
  // 1 — detect hand (no-op if not ready or using mouse fallback)
  if (!usingMouseFallback) detectHand();

  const radiusSq = activeRadius * activeRadius;
  const len = chars.length;

  // 2 — repel characters
  for (let i = 0; i < len; i++) {
    const c = chars[i];

    // Approximate glyph centre
    const cx = c.restX + FONT_SIZE * 0.3;
    const cy = c.restY + FONT_SIZE * 0.5;

    const dx = cx - cursorX;
    const dy = cy - cursorY;
    const distSq = dx * dx + dy * dy;

    let targetX = c.restX;
    let targetY = c.restY;

    if (cursorActive && distSq < radiusSq && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const force = (1 - dist / activeRadius) * MAX_DISPLACEMENT;
      targetX = c.restX + (dx / dist) * force;
      targetY = c.restY + (dy / dist) * force;
    }

    const newX = c.currentX + (targetX - c.currentX) * EASE;
    const newY = c.currentY + (targetY - c.currentY) * EASE;

    if (Math.abs(newX - c.currentX) > 0.02 || Math.abs(newY - c.currentY) > 0.02) {
      c.currentX = newX;
      c.currentY = newY;
      c.el.style.transform = `translate(${newX}px,${newY}px)`;
    }
  }

  // 3 — debug overlay (position: fixed → viewport-absolute, only with MediaPipe)
  if (cursorActive && !usingMouseFallback) {
    // Smooth raw landmark positions to kill MediaPipe jitter
    sdbg.ix += (dbg.ix - sdbg.ix) * SMOOTH;
    sdbg.iy += (dbg.iy - sdbg.iy) * SMOOTH;
    sdbg.tx += (dbg.tx - sdbg.tx) * SMOOTH;
    sdbg.ty += (dbg.ty - sdbg.ty) * SMOOTH;

    const R = 5; // dot half-size in px

    debugIndex.style.transform = `translate(${sdbg.ix - R}px,${sdbg.iy - R}px)`;
    debugThumb.style.transform = `translate(${sdbg.tx - R}px,${sdbg.ty - R}px)`;

    // Green line uses the same smoothed endpoints → no jitter on the line either
    const ldx   = sdbg.tx - sdbg.ix;
    const ldy   = sdbg.ty - sdbg.iy;
    const len   = Math.sqrt(ldx * ldx + ldy * ldy);
    const angle = Math.atan2(ldy, ldx) * (180 / Math.PI);
    debugLine.style.width     = `${len}px`;
    debugLine.style.transform = `translate(${sdbg.ix}px,${sdbg.iy}px) rotate(${angle}deg)`;

    debugIndex.classList.add("visible");
    debugThumb.classList.add("visible");
    debugLine.classList.add("visible");
  } else {
    debugIndex.classList.remove("visible");
    debugThumb.classList.remove("visible");
    debugLine.classList.remove("visible");
  }

  requestAnimationFrame(animate);
}

// ─── Resize ───────────────────────────────────────────────────────────────────

let resizeTimer: ReturnType<typeof setTimeout>;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(buildLayout, 150);
});

window.addEventListener("scroll", refreshContainerRect, { passive: true });

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.fonts.ready.then(() => {
  buildLayout();
  requestAnimationFrame(animate);
  initMediaPipe(); // async — rAF starts immediately, MediaPipe loads in background
});
