// scan.js — lecture d'un QR depuis une image (capture d'écran) ou la caméra.
// Deux moteurs : BarcodeDetector quand il existe (Chrome/Android), sinon jsQR
// chargé à la demande (Safari, Firefox, bureau). Aucun appel réseau hors du
// chargement du script local.

const MAX_SIDE = 1400;

let jsQrPromise = null;

function loadJsQr() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  if (!jsQrPromise) {
    jsQrPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./src/jsQR.js?v=12";
      s.onload = () => (globalThis.jsQR ? resolve(globalThis.jsQR) : reject(new Error("jsQR indisponible")));
      s.onerror = () => reject(new Error("jsQR introuvable"));
      document.head.appendChild(s);
    });
  }
  return jsQrPromise;
}

function hasBarcodeDetector() {
  return typeof globalThis.BarcodeDetector === "function";
}

async function detectNative(source) {
  if (!hasBarcodeDetector()) return null;
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats();
    if (!supported.includes("qr_code")) return null;
    const detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
    const codes = await detector.detect(source);
    return codes.length ? codes[0].rawValue : null;
  } catch {
    return null;
  }
}

function drawScaled(source, maxSide = MAX_SIDE) {
  const sw = source.width || source.videoWidth || 0;
  const sh = source.height || source.videoHeight || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

function invert(image) {
  const copy = new Uint8ClampedArray(image.data);
  for (let i = 0; i < copy.length; i += 4) {
    copy[i] = 255 - copy[i];
    copy[i + 1] = 255 - copy[i + 1];
    copy[i + 2] = 255 - copy[i + 2];
  }
  return copy;
}

async function detectJsQr(source) {
  const jsQR = await loadJsQr();
  const drawn = drawScaled(source);
  if (!drawn) return null;
  const image = drawn.ctx.getImageData(0, 0, drawn.w, drawn.h);
  const first = jsQR(image.data, drawn.w, drawn.h, { inversionAttempts: "attemptBoth" });
  if (first?.data) return first.data;
  // Dernier recours : image inversée (QR clair sur fond sombre).
  const flipped = jsQR(invert(image), drawn.w, drawn.h, { inversionAttempts: "dontInvert" });
  return flipped?.data || null;
}

/** Décode un QR depuis une image (File, Blob, ImageBitmap, HTMLImageElement…). */
export async function decodeImage(source) {
  let bitmap = source;
  let owned = false;
  if (source instanceof Blob) {
    try {
      bitmap = await createImageBitmap(source);
      owned = true;
    } catch {
      return null;
    }
  }
  try {
    return (await detectNative(bitmap)) || (await detectJsQr(bitmap));
  } finally {
    if (owned) bitmap.close?.();
  }
}

/** Décode un QR depuis un fichier choisi par l'utilisateur. */
export async function decodeFile(file) {
  if (!file) return null;
  return decodeImage(file);
}

/**
 * Démarre la caméra arrière et appelle `onResult` dès qu'un QR est lu.
 * Renvoie un objet `{ stop() }` — toujours appeler stop() en quittant.
 */
export async function startCamera(video, onResult, { interval = 220 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play().catch(() => {});

  let stopped = false;
  let handle = 0;
  let busy = false;

  const tick = async () => {
    if (stopped || busy) return;
    if (video.readyState < 2) {
      handle = setTimeout(tick, interval);
      return;
    }
    busy = true;
    try {
      const value = (await detectNative(video)) || (await detectJsQr(video));
      if (value && !stopped) {
        onResult(value);
        return;
      }
    } catch {
      /* frame illisible : on réessaie */
    } finally {
      busy = false;
    }
    if (!stopped) handle = setTimeout(tick, interval);
  };
  handle = setTimeout(tick, 300);

  return {
    stop() {
      stopped = true;
      clearTimeout(handle);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

export function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}
