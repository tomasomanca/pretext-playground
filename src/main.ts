import { prepareWithSegments, layoutWithLines, type LayoutLine } from "@chenglou/pretext";

// ─── Config ──────────────────────────────────────────────────────────────────

const FONT_SIZE = 18; // px
const LINE_HEIGHT = 28; // px  (CSS line-height equivalent for layout)
const CANVAS_FONT = `${FONT_SIZE}px PPNeueMontreal, sans-serif`;

const RADIUS = 80; // px — influence radius
const MAX_DISPLACEMENT = 72; // px — max push distance
const EASE = 0.13; // lerp factor — higher = snappier return

// ─── Text ─────────────────────────────────────────────────────────────────────

const TEXT =
  "Typography is the art and technique of arranging type to make written language legible, readable, and appealing. The arrangement of type involves selecting typefaces, point sizes, line lengths, and letter-spacing. Good typography is invisible — it serves the text without calling attention to itself, quietly shaping how every sentence lands in the mind of the reader. The white space between words is as deliberate as the ink itself, a breathing room where the eye rests before continuing forward through the line. Each character is a small vessel carrying both sound and meaning, and the distances between them determine the rhythm of the whole.";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CharState {
  el: HTMLSpanElement;
  restX: number;
  restY: number;
  currentX: number;
  currentY: number;
}

// ─── DOM refs ────────────────────────────────────────────────────────────────

const container = document.getElementById("text-container") as HTMLDivElement;

// ─── Off-screen canvas for text measurement ──────────────────────────────────

const measureCanvas = document.createElement("canvas");
const ctx = measureCanvas.getContext("2d")!;

function setMeasureFont() {
  ctx.font = CANVAS_FONT;
}

// ─── State ───────────────────────────────────────────────────────────────────

let chars: CharState[] = [];

// Mouse coords relative to the container's top-left
let mouseX = -99999;
let mouseY = -99999;

// Container offset from viewport (updated on layout + scroll)
let containerOffsetX = 0;
let containerOffsetY = 0;

// ─── Layout ──────────────────────────────────────────────────────────────────

function buildLayout(): void {
  // Remove existing spans
  container.querySelectorAll("span").forEach((s) => s.remove());
  chars = [];

  // Pretext needs the font loaded — call setMeasureFont so canvas is in sync
  setMeasureFont();

  const maxWidth = container.clientWidth;
  if (maxWidth <= 0) return;

  const prepared = prepareWithSegments(TEXT, CANVAS_FONT);
  const { lines, height } = layoutWithLines(prepared, maxWidth, LINE_HEIGHT);

  // Reserve vertical space so parent doesn't collapse
  container.style.height = `${height}px`;

  const fragment = document.createDocumentFragment();

  lines.forEach((line, lineIndex) => {
    const lineText: string = (line as LayoutLine).text;
    const restY = lineIndex * LINE_HEIGHT;

    // For each character, compute X by measuring the prefix up to that index.
    // This accounts for kerning more faithfully than summing individual widths.
    let charIndex = 0;
    for (const char of lineText) {
      if (char !== " " && char !== "\u00A0") {
        // Measure the substring up to (not including) this character for X
        const prefix = lineText.slice(0, charIndex);
        const restX = ctx.measureText(prefix).width;

        const span = document.createElement("span");
        span.textContent = char;
        span.style.transform = `translate(${restX}px,${restY}px)`;
        fragment.appendChild(span);

        chars.push({
          el: span,
          restX,
          restY,
          currentX: restX,
          currentY: restY,
        });
      }
      charIndex++;
    }
  });

  container.appendChild(fragment);
  container.classList.remove("loading");

  updateContainerOffset();
}

function updateContainerOffset(): void {
  const rect = container.getBoundingClientRect();
  containerOffsetX = rect.left + window.scrollX;
  containerOffsetY = rect.top + window.scrollY;
}

// ─── Mouse tracking ──────────────────────────────────────────────────────────

container.addEventListener("mousemove", (e: MouseEvent) => {
  // Coords relative to container (accounting for page scroll)
  mouseX = e.clientX - (containerOffsetX - window.scrollX);
  mouseY = e.clientY - (containerOffsetY - window.scrollY);
});

container.addEventListener("mouseleave", () => {
  mouseX = -99999;
  mouseY = -99999;
});

window.addEventListener("scroll", updateContainerOffset, { passive: true });

// ─── Animation loop ──────────────────────────────────────────────────────────

const RADIUS_SQ = RADIUS * RADIUS; // avoid sqrt when outside radius

function animate(): void {
  const len = chars.length;

  for (let i = 0; i < len; i++) {
    const c = chars[i];

    // Approximate character center (half of a typical glyph width / height)
    const cx = c.restX + FONT_SIZE * 0.3;
    const cy = c.restY + FONT_SIZE * 0.5;

    const dx = cx - mouseX;
    const dy = cy - mouseY;
    const distSq = dx * dx + dy * dy;

    let targetX = c.restX;
    let targetY = c.restY;

    if (distSq < RADIUS_SQ && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      // Force tapers linearly from MAX_DISPLACEMENT at dist=0 to 0 at dist=RADIUS
      const force = (1 - dist / RADIUS) * MAX_DISPLACEMENT;
      targetX = c.restX + (dx / dist) * force;
      targetY = c.restY + (dy / dist) * force;
    }

    // Lerp toward target
    const newX = c.currentX + (targetX - c.currentX) * EASE;
    const newY = c.currentY + (targetY - c.currentY) * EASE;

    // Skip DOM write if movement is sub-pixel
    if (Math.abs(newX - c.currentX) > 0.02 || Math.abs(newY - c.currentY) > 0.02) {
      c.currentX = newX;
      c.currentY = newY;
      c.el.style.transform = `translate(${newX}px,${newY}px)`;
    }
  }

  requestAnimationFrame(animate);
}

// ─── Resize handling (debounced) ─────────────────────────────────────────────

let resizeTimer: ReturnType<typeof setTimeout>;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    buildLayout();
  }, 150);
});

// ─── Boot ────────────────────────────────────────────────────────────────────

// Wait for PPNeueMontreal to be loaded so canvas measurements are accurate
document.fonts.ready.then(() => {
  buildLayout();
  requestAnimationFrame(animate);
});
