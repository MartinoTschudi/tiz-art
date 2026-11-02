/**
 * Full-screen image viewer for artwork pages (markup: ImageViewer.astro). No dependencies.
 *
 * - Opens from any `[data-viewer-open="<index>"]` link inside the same `[data-viewer-gallery]`.
 *   The links point to the full-size JPEG, so without JavaScript they simply open the photo.
 * - <dialog>.showModal(): the rest of the page is inert (focus stays inside), Esc closes,
 *   focus returns to the link that opened it.
 * - Keyboard: ← → previous/next (pan when zoomed, also ↑ ↓), + − zoom, 0 reset.
 * - Touch/mouse: swipe to change image, tap/click the painting to zoom in/out at that point,
 *   pinch or wheel to zoom, drag to pan; tap outside the painting closes.
 * - Zooming swaps in the full-size (largest) file.
 */

interface ViewerImage {
  srcset: string;
  full: string;
  width: number;
  height: number;
  alt: string;
}

interface Point {
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'drag'; start: Point; last: Point; startTime: number; moved: boolean }
  | { kind: 'pinch'; startDistance: number; startScale: number; lastMid: Point };

const TAP_ZOOM = 2.5;
const MAX_ZOOM = 6;
const SWIPE_DISTANCE = 60; // px a swipe must travel to change image
const TAP_SLOP = 8; // px a tap may move
const TAP_TIME = 350; // ms
const KEY_PAN = 80; // px per arrow key when zoomed

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

class ImageViewer {
  readonly #dialog: HTMLDialogElement;
  readonly #stage: HTMLElement;
  readonly #image: HTMLImageElement;
  readonly #images: ViewerImage[];
  readonly #counter: HTMLElement | null;
  readonly #announcer: HTMLElement;
  readonly #zoomButton: HTMLButtonElement;

  #index = 0;
  #opener: HTMLElement | null = null;
  /** Size of the image at zoom 1 and of the stage it is centred in. */
  #fit = { width: 0, height: 0, stageWidth: 0, stageHeight: 0 };
  #scale = 1;
  #x = 0;
  #y = 0;
  #pointers = new Map<number, Point>();
  #gesture: Gesture | null = null;
  #fullLoaded = new Set<number>();

  constructor(gallery: HTMLElement, dialog: HTMLDialogElement) {
    this.#dialog = dialog;
    this.#stage = this.#part('stage');
    this.#image = this.#part<HTMLImageElement>('image');
    this.#announcer = this.#part('announcer');
    this.#zoomButton = this.#part<HTMLButtonElement>('zoom');
    this.#counter = dialog.querySelector('[data-viewer-counter]');
    this.#images = JSON.parse(dialog.dataset.images ?? '[]');

    gallery.querySelectorAll<HTMLAnchorElement>('[data-viewer-open]').forEach((link) => {
      link.addEventListener('click', (event) => {
        // Let modified clicks (new tab, download…) keep the browser's default.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        this.open(Number(link.dataset.viewerOpen), link);
      });
    });

    this.#part('close').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-viewer-prev]')?.addEventListener('click', () => this.#show(this.#index - 1));
    dialog.querySelector('[data-viewer-next]')?.addEventListener('click', () => this.#show(this.#index + 1));
    this.#zoomButton.addEventListener('click', () => this.#toggleZoom());

    dialog.addEventListener('keydown', (event) => this.#onKey(event));
    dialog.addEventListener('close', () => {
      this.#resetZoom();
      this.#opener?.focus();
    });

    dialog.addEventListener('pointerdown', (event) => this.#onPointerDown(event));
    dialog.addEventListener('pointermove', (event) => this.#onPointerMove(event));
    dialog.addEventListener('pointerup', (event) => this.#onPointerUp(event));
    dialog.addEventListener('pointercancel', (event) => this.#onPointerUp(event, true));
    dialog.addEventListener('wheel', (event) => this.#onWheel(event), { passive: false });
    new ResizeObserver(() => this.#dialog.open && this.#layout()).observe(this.#stage);
  }

  open(index: number, opener: HTMLElement) {
    this.#opener = opener;
    this.#dialog.showModal();
    this.#show(index);
  }

  #part<T extends HTMLElement = HTMLElement>(name: string): T {
    const element = this.#dialog.querySelector<T>(`[data-viewer-${name}]`);
    if (!element) throw new Error(`Image viewer: [data-viewer-${name}] is missing`);
    return element;
  }

  #show(index: number) {
    const count = this.#images.length;
    this.#index = ((index % count) + count) % count;
    const image = this.#images[this.#index];
    this.#resetZoom();
    this.#layout();
    this.#image.removeAttribute('src');
    if (this.#fullLoaded.has(this.#index)) {
      this.#image.removeAttribute('srcset');
    } else {
      this.#image.srcset = image.srcset;
    }
    this.#image.src = image.full;
    this.#image.alt = image.alt;
    if (this.#counter) this.#counter.textContent = `${this.#index + 1} / ${count}`;
    this.#announcer.textContent = count > 1 ? `Immagine ${this.#index + 1} di ${count}: ${image.alt}` : image.alt;
    this.#preloadNeighbours();
  }

  /** Fits the image in the stage (never larger than its own pixels) and picks the srcset size. */
  #layout() {
    const image = this.#images[this.#index];
    const stage = this.#stage.getBoundingClientRect();
    const ratio = image.width / image.height;
    let width = Math.min(stage.width, image.width);
    let height = width / ratio;
    if (height > stage.height) {
      height = stage.height;
      width = height * ratio;
    }
    this.#fit = { width, height, stageWidth: stage.width, stageHeight: stage.height };
    this.#image.sizes = `${Math.ceil(width)}px`;
    this.#image.style.width = `${width}px`;
    this.#image.style.height = `${height}px`;
    this.#clampPan();
    this.#apply();
  }

  #preloadNeighbours() {
    if (this.#images.length < 2) return;
    for (const offset of [1, -1]) {
      const neighbour = this.#images[(this.#index + offset + this.#images.length) % this.#images.length];
      const preload = new Image();
      preload.sizes = this.#image.sizes;
      preload.srcset = neighbour.srcset;
    }
  }

  // ── Zoom & pan ────────────────────────────────────────────

  #maxZoom() {
    return clamp(this.#images[this.#index].width / this.#fit.width, TAP_ZOOM, MAX_ZOOM);
  }

  /** Zooms keeping the painting point under (clientX, clientY) where it is. */
  #zoomTo(scale: number, clientX: number, clientY: number) {
    const stage = this.#stage.getBoundingClientRect();
    // Point relative to the stage centre (= the image centre when not panned).
    const px = clientX - (stage.left + stage.width / 2);
    const py = clientY - (stage.top + stage.height / 2);
    const next = clamp(scale, 1, this.#maxZoom());
    this.#x = px - ((px - this.#x) * next) / this.#scale;
    this.#y = py - ((py - this.#y) * next) / this.#scale;
    this.#scale = next;
    this.#clampPan();
    this.#apply();
    if (next > 1) this.#loadFull();
  }

  #zoomAtCentre(scale: number) {
    const stage = this.#stage.getBoundingClientRect();
    this.#zoomTo(scale, stage.left + stage.width / 2, stage.top + stage.height / 2);
  }

  #toggleZoom(at?: Point) {
    if (this.#scale > 1) {
      this.#resetZoom();
      this.#apply();
    } else if (at) {
      this.#zoomTo(TAP_ZOOM, at.x, at.y);
    } else {
      this.#zoomAtCentre(TAP_ZOOM);
    }
  }

  #resetZoom() {
    this.#scale = 1;
    this.#x = 0;
    this.#y = 0;
  }

  /** A zoomed image may move only until its edges reach the stage edges. */
  #clampPan() {
    const maxX = Math.max(0, (this.#fit.width * this.#scale - this.#fit.stageWidth) / 2);
    const maxY = Math.max(0, (this.#fit.height * this.#scale - this.#fit.stageHeight) / 2);
    this.#x = clamp(this.#x, -maxX, maxX);
    this.#y = clamp(this.#y, -maxY, maxY);
  }

  #apply() {
    this.#image.style.transform = `translate(${this.#x}px, ${this.#y}px) scale(${this.#scale})`;
    const zoomed = this.#scale > 1;
    this.#dialog.classList.toggle('is-zoomed', zoomed);
    this.#zoomButton.setAttribute('aria-pressed', String(zoomed));
  }

  /** Swaps in the full-size file once it is downloaded (no flash: same size, same position). */
  #loadFull() {
    const index = this.#index;
    if (this.#fullLoaded.has(index)) return;
    this.#fullLoaded.add(index);
    const full = new Image();
    full.src = this.#images[index].full;
    full
      .decode()
      .then(() => {
        if (this.#index !== index) return;
        this.#image.removeAttribute('srcset');
        this.#image.src = full.src;
      })
      .catch(() => this.#fullLoaded.delete(index));
  }

  // ── Input ─────────────────────────────────────────────────

  #onKey(event: KeyboardEvent) {
    const zoomed = this.#scale > 1;
    const pan = (dx: number, dy: number) => {
      this.#x += dx;
      this.#y += dy;
      this.#clampPan();
      this.#apply();
    };
    const actions: Record<string, () => void> = {
      ArrowLeft: () => (zoomed ? pan(KEY_PAN, 0) : this.#show(this.#index - 1)),
      ArrowRight: () => (zoomed ? pan(-KEY_PAN, 0) : this.#show(this.#index + 1)),
      ArrowUp: () => zoomed && pan(0, KEY_PAN),
      ArrowDown: () => zoomed && pan(0, -KEY_PAN),
      '+': () => this.#zoomAtCentre(this.#scale * 1.5),
      '=': () => this.#zoomAtCentre(this.#scale * 1.5),
      '-': () => this.#zoomAtCentre(this.#scale / 1.5),
      '0': () => {
        this.#resetZoom();
        this.#apply();
      },
    };
    const action = actions[event.key];
    // Arrow keys on a focused button still belong to the viewer; other keys keep their default.
    if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    action();
  }

  #onPointerDown(event: PointerEvent) {
    if ((event.target as Element).closest('button')) return;
    this.#dialog.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.#startGesture();
  }

  /**
   * One pointer = drag (swipe or pan), two = pinch. A drag that continues a pinch is never a tap
   * (lifting the last finger must not undo the zoom).
   */
  #startGesture(afterPinch = false) {
    const points = [...this.#pointers.values()];
    this.#dialog.classList.add('is-dragging');
    if (points.length >= 2) {
      this.#gesture = {
        kind: 'pinch',
        startDistance: distance(points[0], points[1]) || 1,
        startScale: this.#scale,
        lastMid: midpoint(points[0], points[1]),
      };
    } else if (points.length === 1) {
      this.#gesture = { kind: 'drag', start: points[0], last: points[0], startTime: performance.now(), moved: afterPinch };
    }
  }

  #onPointerMove(event: PointerEvent) {
    if (!this.#pointers.has(event.pointerId) || !this.#gesture) return;
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...this.#pointers.values()];
    const gesture = this.#gesture;

    if (gesture.kind === 'pinch' && points.length >= 2) {
      const mid = midpoint(points[0], points[1]);
      this.#x += mid.x - gesture.lastMid.x;
      this.#y += mid.y - gesture.lastMid.y;
      gesture.lastMid = mid;
      this.#zoomTo((gesture.startScale * distance(points[0], points[1])) / gesture.startDistance, mid.x, mid.y);
      return;
    }
    if (gesture.kind !== 'drag') return;

    const point = points[0];
    if (distance(point, gesture.start) > TAP_SLOP) gesture.moved = true;
    if (this.#scale > 1) {
      // Pan the zoomed painting.
      this.#x += point.x - gesture.last.x;
      this.#y += point.y - gesture.last.y;
      this.#clampPan();
    } else if (this.#images.length > 1) {
      // Swipe: the painting follows the finger horizontally.
      this.#x = point.x - gesture.start.x;
    }
    gesture.last = point;
    this.#apply();
  }

  #onPointerUp(event: PointerEvent, cancelled = false) {
    if (!this.#pointers.has(event.pointerId)) return;
    this.#pointers.delete(event.pointerId);
    const gesture = this.#gesture;
    this.#gesture = null;
    this.#dialog.classList.remove('is-dragging');

    // Pinch ended with one finger still down: continue as a pan with that finger.
    if (gesture?.kind === 'pinch') {
      if (this.#pointers.size > 0) this.#startGesture(true);
      return;
    }
    if (!gesture || cancelled) return this.#settle();

    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    const isTap = !gesture.moved && performance.now() - gesture.startTime < TAP_TIME;

    if (isTap) {
      // Hit-test by position: with pointer capture the event target is always the dialog.
      const box = this.#image.getBoundingClientRect();
      const onImage =
        event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (onImage) this.#toggleZoom({ x: event.clientX, y: event.clientY });
      else if (this.#scale === 1) this.#dialog.close();
      return;
    }
    if (this.#scale === 1 && Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      this.#show(this.#index + (dx < 0 ? 1 : -1));
      return;
    }
    this.#settle();
  }

  /** Back to rest after an incomplete swipe. */
  #settle() {
    if (this.#scale === 1) this.#x = 0;
    this.#apply();
  }

  #onWheel(event: WheelEvent) {
    event.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel has large ones.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
    this.#zoomTo(this.#scale * factor, event.clientX, event.clientY);
  }
}

/** Sets up every gallery on the page. */
export function initImageViewers() {
  document.querySelectorAll<HTMLElement>('[data-viewer-gallery]').forEach((gallery) => {
    const dialog = gallery.querySelector<HTMLDialogElement>('dialog[data-viewer]');
    if (dialog) new ImageViewer(gallery, dialog);
  });
}
