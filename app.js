// app.js — Basic QR : génération locale du QR d'accès Basic-Fit (aucun réseau).
import {
  buildPayload,
  maskCard,
  parseCredentials,
  parsePrefill,
  validateCard,
  validateConstant,
  validateDevice,
} from "./src/core.js";

const STORE_KEY = "basicqr.v1";
// Constante observée dans les QR de l'application officielle (fixe pour un compte/club).
const DEFAULT_CONSTANT = "QII";
const GOLDEN = {
  cardNumber: "V00347833",
  deviceId: "8d20fc96-1b0e-4982-8292-e97caed114ec",
  guid: "2L8",
  iat: 1720878864,
};

const $ = (id) => document.getElementById(id);
const els = {
  cardLabel: $("cardLabel"),
  viewSetup: $("viewSetup"),
  viewQr: $("viewQr"),
  setupForm: $("setupForm"),
  magicUrl: $("magicUrl"),
  extractBtn: $("extractBtn"),
  cardNumber: $("cardNumber"),
  deviceId: $("deviceId"),
  constant: $("constant"),
  setupError: $("setupError"),
  canvas: $("qrCanvas"),
  refreshFill: $("refreshFill"),
  refreshLabel: $("refreshLabel"),
  statusLine: $("statusLine"),
  fullscreenBtn: $("fullscreenBtn"),
  wakeBtn: $("wakeBtn"),
  wakeLabel: $("wakeLabel"),
  sheet: $("sheet"),
  sheetBackdrop: $("sheetBackdrop"),
  openSettings: $("openSettings"),
  closeSettings: $("closeSettings"),
  refreshSelect: $("refreshSelect"),
  themeSelect: $("themeSelect"),
  payloadBox: $("payloadBox"),
  copyPayload: $("copyPayload"),
  editAccount: $("editAccount"),
  wipeData: $("wipeData"),
  offlineBadge: $("offlineBadge"),
  toast: $("toast"),
};

const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";
const FROZEN = params.get("frozen") === "1"; // horloge figée (tests)

let state = load();
let current = null; // { payload, iat, guid }
let wakeLock = null;
let tickHandle = null;
let lastRenderKey = "";

/* ------------------------------------------------------------------ état */

function load() {
  const base = {
    cardNumber: "",
    deviceId: "",
    constant: DEFAULT_CONSTANT,
    refreshSec: 5,
    theme: "dark",
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function nowSec() {
  return FROZEN ? GOLDEN.iat : Math.floor(Date.now() / 1000);
}

/* -------------------------------------------------------------- rendu QR */

function renderQr(payload) {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4;
  const total = count + quiet * 2;
  const isFs = document.body.classList.contains("fs-mode");
  const avail = isFs
    ? Math.min(window.innerWidth - 24, window.innerHeight - 24)
    : Math.min(els.canvas.parentElement.clientWidth - 36, 420);
  const cssWidth = Math.max(160, avail);
  const module = Math.max(2, Math.floor((cssWidth * (window.devicePixelRatio || 1)) / total));
  const size = module * total;

  els.canvas.width = size;
  els.canvas.height = size;
  els.canvas.style.width = `${Math.round(size / (window.devicePixelRatio || 1))}px`;

  const ctx = els.canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue;
      ctx.fillRect((c + quiet) * module, (r + quiet) * module, module, module);
    }
  }
  return count;
}

async function refreshCode(force = false) {
  const iat = nowSec();
  const guid = DEMO && FROZEN ? GOLDEN.guid : null;
  const res = await buildPayload({
    cardNumber: state.cardNumber,
    deviceId: state.deviceId,
    constant: state.constant,
    guid: guid || undefined,
    iat,
  });
  current = res;
  const key = res.payload;
  if (key !== lastRenderKey || force) {
    const modules = renderQr(res.payload);
    lastRenderKey = key;
    els.payloadBox.textContent = res.payload;
    els.statusLine.textContent = `QR ${modules}x${modules} · renouvelé à ${new Date(
      res.iat * 1000
    ).toLocaleTimeString("fr-FR")}`;
  }
  return res;
}

function startTicker() {
  clearInterval(tickHandle);
  let elapsed = 0;
  els.refreshFill.style.transform = "scaleX(1)";
  tickHandle = setInterval(async () => {
    elapsed += 0.25;
    const ratio = Math.max(0, 1 - elapsed / state.refreshSec);
    els.refreshFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    const left = Math.max(0, state.refreshSec - elapsed);
    els.refreshLabel.textContent = `renouvelé dans ${left.toFixed(1)}s`;
    if (elapsed >= state.refreshSec) {
      elapsed = 0;
      await refreshCode();
    }
  }, 250);
}

/* ------------------------------------------------------------------ vues */

function showView(name) {
  const hasAccount = validateCard(state.cardNumber) && validateDevice(state.deviceId);
  els.viewSetup.hidden = name !== "setup";
  els.viewQr.hidden = name !== "qr";
  els.cardLabel.textContent = hasAccount ? maskCard(state.cardNumber) : "aucun compte";
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function setupError(message) {
  els.setupError.textContent = message || "";
  els.setupError.hidden = !message;
}

/* --------------------------------------------------------------- réglages */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f5f6f8" : "#0b0d10");
}

function openSheet(open) {
  els.sheet.hidden = !open;
  els.sheetBackdrop.hidden = !open;
}

/* -------------------------------------------------------------- plein écran */

async function toggleFullscreen() {
  const on = document.body.classList.toggle("fs-mode");
  updateCanvasForViewport();
  if (on) {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* refusé : le mode CSS suffit */
    }
  } else if (document.fullscreenElement) {
    await document.exitFullscreen?.().catch(() => {});
  }
}

function updateCanvasForViewport() {
  if (current) {
    lastRenderKey = "";
    renderQr(current.payload);
    lastRenderKey = current.payload;
  }
}

/* --------------------------------------------------------------- wake lock */

async function setWakeLock(on) {
  if (on && "wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        if (document.visibilityState === "visible") wakeLock = null;
      });
      els.wakeBtn.setAttribute("aria-pressed", "true");
      els.wakeLabel.textContent = "Écran allumé";
      toast("Écran maintenu allumé");
    } catch {
      toast("Écran allumé refusé par le navigateur");
    }
  } else {
    await wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    els.wakeBtn.setAttribute("aria-pressed", "false");
    els.wakeLabel.textContent = "Écran allumé";
  }
  return Boolean(wakeLock);
}

/* ------------------------------------------------------------------ events */

els.setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const card = els.cardNumber.value.trim().toUpperCase();
  const device = els.deviceId.value.trim();
  const constant = els.constant.value.trim().toUpperCase() || DEFAULT_CONSTANT;
  if (!validateCard(card)) return setupError("Numéro de carte invalide (attendu : V012345678).");
  if (!validateDevice(device)) return setupError("Device ID invalide (UUID ou identifiant « J… » attendu).");
  if (!validateConstant(constant)) return setupError("Constante invalide (2 à 6 caractères A-Z / 0-9).");
  setupError("");
  state = { ...state, cardNumber: card, deviceId: device, constant };
  save();
  await enterQrView();
});

els.extractBtn.addEventListener("click", () => {
  const { cardNumber, deviceId } = parseCredentials(els.magicUrl.value);
  if (cardNumber) els.cardNumber.value = cardNumber;
  if (deviceId) els.deviceId.value = deviceId;
  if (!cardNumber && !deviceId) {
    return setupError("Rien à extraire : colle l'URL complète de la page de connexion.");
  }
  if (cardNumber && !deviceId) {
    setupError(
      "Numéro de carte trouvé, mais ce lien ne contient pas le Device ID : il faut " +
        "la valeur deviceID (un UUID) — voir la procédure juste au-dessus."
    );
    return toast("Carte trouvée · Device ID manquant");
  }
  if (!cardNumber && deviceId) {
    setupError("Device ID trouvé, mais le numéro de carte (V…) est absent.");
    return toast("Device ID trouvé · carte manquante");
  }
  setupError("");
  toast("Carte et Device ID extraits");
});

els.canvas.parentElement.addEventListener("click", toggleFullscreen);
els.fullscreenBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFullscreen();
});
els.wakeBtn.addEventListener("click", () => {
  setWakeLock(els.wakeBtn.getAttribute("aria-pressed") !== "true");
});
els.openSettings.addEventListener("click", () => openSheet(true));
els.closeSettings.addEventListener("click", () => openSheet(false));
els.sheetBackdrop.addEventListener("click", () => openSheet(false));

els.refreshSelect.addEventListener("change", () => {
  state.refreshSec = Number(els.refreshSelect.value);
  save();
  startTicker();
});

els.themeSelect.addEventListener("change", () => {
  state.theme = els.themeSelect.value;
  save();
  applyTheme(state.theme);
});

els.copyPayload.addEventListener("click", async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.payload);
    toast("Charge utile copiée");
  } catch {
    toast("Copie impossible");
  }
});

els.editAccount.addEventListener("click", () => {
  openSheet(false);
  els.cardNumber.value = state.cardNumber;
  els.deviceId.value = state.deviceId;
  els.constant.value = state.constant;
  showView("setup");
});

els.wipeData.addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  state = { cardNumber: "", deviceId: "", constant: DEFAULT_CONSTANT, refreshSec: 5, theme: state.theme };
  els.cardNumber.value = "";
  els.deviceId.value = "";
  els.constant.value = DEFAULT_CONSTANT;
  els.magicUrl.value = "";
  openSheet(false);
  clearInterval(tickHandle);
  showView("setup");
  toast("Données effacées");
});

document.addEventListener("visibilitychange", async () => {
  els.offlineBadge.hidden = navigator.onLine;
  if (document.visibilityState === "visible") {
    if (state.cardNumber && !els.viewQr.hidden) await refreshCode(true);
    if (els.wakeBtn.getAttribute("aria-pressed") === "true" && !wakeLock) {
      await setWakeLock(true);
    }
  }
});
window.addEventListener("online", () => (els.offlineBadge.hidden = true));
window.addEventListener("offline", () => (els.offlineBadge.hidden = false));
window.addEventListener("resize", () => {
  if (!els.viewQr.hidden) updateCanvasForViewport();
});

/* -------------------------------------------------------------------- boot */

async function enterQrView() {
  showView("qr");
  await refreshCode(true);
  startTicker();
  await setWakeLock(true);
}

async function boot() {
  applyTheme(state.theme);

  // Pré-remplissage ponctuel par lien (?card=…&device=…&constant=…), puis nettoyage
  // de l'URL pour ne pas laisser les identifiants dans la barre d'adresse.
  // Le fragment (#…) est accepté et préférable : il n'est jamais envoyé au serveur.
  const prefill = parsePrefill(location.search || location.hash);
  if (Object.keys(prefill).length) {
    state = { ...state, ...prefill };
    save();
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* sans importance */
    }
  }

  els.refreshSelect.value = String(state.refreshSec);
  els.themeSelect.value = state.theme;
  els.cardNumber.value = state.cardNumber;
  els.deviceId.value = state.deviceId;
  els.constant.value = state.constant;
  els.offlineBadge.hidden = navigator.onLine;

  if (DEMO) {
    state = { ...state, ...GOLDEN };
  }

  if (validateCard(state.cardNumber) && validateDevice(state.deviceId)) {
    await enterQrView();
    if (DEMO && FROZEN) await refreshCode(true);
  } else {
    showView("setup");
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

// surface de test / debug
window.__basicqr = {
  get state() {
    return { ...state };
  },
  get current() {
    return current ? { ...current } : null;
  },
  refreshCode,
  parseCredentials,
  golden: GOLDEN,
  renderQr,
};

boot();
