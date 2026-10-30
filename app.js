// app.js — Basic QR : QR d’accès calculé localement, aucun appel réseau.
import {
  DEFAULT_CONSTANT,
  buildPayload,
  maskCard,
  maskDevice,
  parseAny,
  parsePrefill,
  validateCard,
  validateConstant,
  validateDevice,
} from "./src/core.js?v=13";
import { cameraAvailable, decodeFile, startCamera } from "./src/scan.js?v=13";

const STORE = "basicqr.v2";
const LEGACY_STORE = "basicqr.v1";

const GOLDEN = {
  cardNumber: "V00347833",
  deviceId: "8d20fc96-1b0e-4982-8292-e97caed114ec",
  constant: "2L8",
  iat: 1720878864,
};

const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";
const FROZEN = params.get("frozen") === "1";

const $ = (id) => document.getElementById(id);

const els = {
  backBtn: $("backBtn"),
  settingsBtn: $("settingsBtn"),
  cardLabel: $("cardLabel"),
  viewStart: $("viewStart"),
  viewQr: $("viewQr"),

  stepLink: $("stepLink"),
  stepQr: $("stepQr"),
  stepLinkState: $("stepLinkState"),
  stepQrState: $("stepQrState"),
  stepLinkDesc: $("stepLinkDesc"),
  stepQrDesc: $("stepQrDesc"),
  pasteBtn: $("pasteBtn"),
  shotBtn: $("shotBtn"),
  showQrBtn: $("showQrBtn"),
  ctaHint: $("ctaHint"),
  manualBtn: $("manualBtn"),
  installBtn: $("installBtn"),
  linkHelp: $("linkHelp"),
  qrHelp: $("qrHelp"),
  helpBtn: $("helpBtn"),

  qrCard: $("qrCard"),
  qrBox: $("qrBox"),
  canvas: $("qrCanvas"),
  refreshFill: $("refreshFill"),
  refreshLabel: $("refreshLabel"),
  fullscreenBtn: $("fullscreenBtn"),
  wakeBtn: $("wakeBtn"),
  wakeLabel: $("wakeLabel"),
  statusLine: $("statusLine"),
  offlineBadge: $("offlineBadge"),

  dlgPaste: $("dlgPaste"),
  pasteInput: $("pasteInput"),
  pasteNote: $("pasteNote"),
  pasteFromClipboard: $("pasteFromClipboard"),
  pasteValidate: $("pasteValidate"),
  pasteHelp: $("pasteHelp"),

  dlgManual: $("dlgManual"),
  mCard: $("mCard"),
  mDevice: $("mDevice"),
  mConstant: $("mConstant"),
  manualError: $("manualError"),
  manualSave: $("manualSave"),

  dlgScan: $("dlgScan"),
  scanFrame: $("scanFrame"),
  scanVideo: $("scanVideo"),
  scanNote: $("scanNote"),
  scanFile: $("scanFile"),
  scanPick: $("scanPick"),
  scanCam: $("scanCam"),

  dlgSettings: $("dlgSettings"),
  refreshSelect: $("refreshSelect"),
  themeSelect: $("themeSelect"),
  accountBox: $("accountBox"),
  editAccount: $("editAccount"),
  wipeData: $("wipeData"),
  payloadBox: $("payloadBox"),
  copyPayload: $("copyPayload"),

  dlgHelp: $("dlgHelp"),
  helpBody: $("helpBody"),

  dlgInstall: $("dlgInstall"),
  installBody: $("installBody"),
  installNative: $("installNative"),

  toast: $("toast"),
};

/* ------------------------------------------------------------------ état */

function baseState() {
  return {
    cardNumber: "",
    deviceId: "",
    constant: "",
    constantSource: null,
    refreshSec: 5,
    theme: "auto",
  };
}

function load() {
  const state = baseState();
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...state, ...JSON.parse(raw) };
    const legacy = localStorage.getItem(LEGACY_STORE);
    if (legacy) {
      const old = JSON.parse(legacy);
      return {
        ...state,
        cardNumber: old.cardNumber || "",
        deviceId: old.deviceId || "",
        constant: old.constant || "",
        constantSource: old.constant ? "manual" : null,
        refreshSec: Number(old.refreshSec) || 5,
        theme: old.theme === "light" || old.theme === "dark" ? old.theme : "auto",
      };
    }
  } catch {
    /* stockage indisponible : on repart de zéro */
  }
  return state;
}

let state = load();
let current = null;
let wakeLock = null;
let wakeWanted = true;
let tickHandle = null;
let nextAt = 0;
let lastRenderKey = "";
let installPrompt = null;
let camera = null;
let toastTimer = null;

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* mode privé : l’appli reste utilisable, sans mémoire */
  }
}

const hasAccount = () => validateCard(state.cardNumber) && validateDevice(state.deviceId);
const hasConstant = () => validateConstant(state.constant);

/* ------------------------------------------------------------- utilitaires */

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2400);
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  dialog?.close?.();
}

function applyTheme() {
  const auto = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const resolved = state.theme === "auto" ? auto : state.theme;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "light" ? "#f3f0e8" : "#131210");
}

/* ------------------------------------------------------------------- vues */

function showView(name) {
  const isQr = name === "qr";
  els.viewStart.hidden = isQr;
  els.viewQr.hidden = !isQr;
  els.backBtn.hidden = !isQr;
  els.settingsBtn.hidden = false;
  document.body.classList.toggle("view-qr-mode", isQr);
  els.cardLabel.textContent = hasAccount() ? maskCard(state.cardNumber) : "";
  if (!isQr) renderStart();
}

function renderStart() {
  const card = validateCard(state.cardNumber);
  const device = validateDevice(state.deviceId);
  const constant = hasConstant();
  const linked = Boolean(card && device);

  els.stepLink.dataset.done = String(linked);
  els.stepQr.dataset.done = String(constant);
  els.stepQr.dataset.state = !constant && linked ? "warn" : "";
  els.stepLinkState.textContent = linked ? "fait" : "à faire";
  els.stepQrState.textContent = constant ? "fait" : "à faire";

  if (linked) {
    els.stepLinkDesc.textContent = `Carte ${maskCard(state.cardNumber)} · appareil ${maskDevice(
      state.deviceId
    )}`;
  } else if (card) {
    els.stepLinkDesc.textContent = "Carte reconnue, mais il manque l’identifiant de l’appareil.";
  } else if (device) {
    els.stepLinkDesc.textContent = "Appareil reconnu, mais il manque le numéro de carte.";
  } else {
    els.stepLinkDesc.textContent =
      "Colle le lien affiché quand tu te connectes dans l’appli Basic-Fit.";
  }

  if (constant) {
    els.stepQrDesc.textContent =
      state.constantSource === "qr"
        ? `Clé ${state.constant} lue dans le QR de l’appli.`
        : `Clé ${state.constant} enregistrée.`;
  } else if (linked) {
    els.stepQrDesc.textContent =
      "Pas encore lue. Sans clé, le portique peut refuser.";
  } else {
    els.stepQrDesc.textContent =
      "Basic-Fit bloque les captures : photographie l’écran avec un autre téléphone.";
  }

  els.showQrBtn.disabled = !linked;
  els.showQrBtn.textContent = "Afficher mon QR";
  els.ctaHint.textContent = !linked
    ? "Commence par l’étape 1."
    : constant
      ? ""
      : "Tu peux quand même continuer.";
}

/* --------------------------------------------------------------- rendu QR */

function renderQr(payload) {
  if (!payload) return 0;
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4;
  const total = count + quiet * 2;

  const rect = els.qrBox.getBoundingClientRect();
  const avail = Math.max(80, Math.min(rect.width, rect.height));
  const dpr = window.devicePixelRatio || 1;
  const module = Math.max(1, Math.floor((avail * dpr) / total));
  const size = module * total;

  els.canvas.width = size;
  els.canvas.height = size;
  els.canvas.style.width = `${Math.floor(size / dpr)}px`;
  els.canvas.style.height = `${Math.floor(size / dpr)}px`;

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

function alignedIat() {
  if (FROZEN) return GOLDEN.iat;
  const period = Math.max(1, state.refreshSec);
  return Math.floor(Date.now() / 1000 / period) * period;
}

async function refreshCode() {
  if (!hasAccount()) return null;
  if (!globalThis.crypto?.subtle) {
    els.statusLine.textContent = "Contexte non sécurisé : ouvre l’appli en HTTPS.";
    els.statusLine.dataset.warn = "true";
    return null;
  }
  const iat = alignedIat();
  const res = await buildPayload({
    cardNumber: state.cardNumber,
    deviceId: state.deviceId,
    constant: DEMO && FROZEN ? GOLDEN.constant : state.constant || DEFAULT_CONSTANT,
    iat,
  });
  current = res;

  if (res.payload !== lastRenderKey) {
    renderQr(res.payload);
    lastRenderKey = res.payload;
    els.payloadBox.textContent = res.payload;
    const heure = new Date(res.iat * 1000).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (hasConstant()) {
      els.statusLine.textContent = `Renouvelé à ${heure}`;
      els.statusLine.dataset.warn = "false";
    } else {
      els.statusLine.textContent = "Clé non vérifiée — le portique peut refuser.";
      els.statusLine.dataset.warn = "true";
    }
  }
  return res;
}

function onTick() {
  const period = Math.max(1, state.refreshSec) * 1000;
  const now = Date.now();
  if (!nextAt) nextAt = (Math.floor(now / period) + 1) * period;
  if (now >= nextAt) {
    nextAt = (Math.floor(now / period) + 1) * period;
    refreshCode();
  }
  const left = Math.max(0, nextAt - now);
  els.refreshFill.style.transform = `scaleX(${Math.min(1, left / period).toFixed(3)})`;
  els.refreshLabel.textContent = `${Math.ceil(left / 1000)} s`;
}

function startTicker() {
  clearInterval(tickHandle);
  const period = Math.max(1, state.refreshSec) * 1000;
  nextAt = (Math.floor(Date.now() / period) + 1) * period;
  tickHandle = setInterval(onTick, 200);
  onTick();
}

function stopTicker() {
  clearInterval(tickHandle);
  tickHandle = null;
}

/* ------------------------------------------------------------ plein écran */

async function setFullscreen(on) {
  document.body.classList.toggle("fs-mode", on);
  try {
    if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    /* refusé ou non supporté : le mode CSS suffit */
  }
  requestAnimationFrame(() => {
    if (current) renderQr(current.payload);
  });
}

function toggleFullscreen() {
  setFullscreen(!document.body.classList.contains("fs-mode"));
}

/* --------------------------------------------------------------- wake lock */

async function acquireWake() {
  if (!("wakeLock" in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      if (document.visibilityState === "visible") wakeLock = null;
    });
    els.wakeBtn.setAttribute("aria-pressed", "true");
    return true;
  } catch {
    els.wakeBtn.setAttribute("aria-pressed", "false");
    return false;
  }
}

async function releaseWake() {
  await wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  els.wakeBtn.setAttribute("aria-pressed", "false");
}

async function setWakeLock(on) {
  wakeWanted = on;
  return on ? acquireWake() : releaseWake();
}

/* ------------------------------------------------------------ entrée QR */

async function enterQrView() {
  showView("qr");
  lastRenderKey = "";
  await refreshCode();
  startTicker();
  if (wakeWanted) setWakeLock(true);
}

async function leaveQrView() {
  stopTicker();
  await releaseWake();
  if (document.body.classList.contains("fs-mode")) setFullscreen(false);
  showView("start");
}

/* ----------------------------------------------------------- intégration */

function applyParsed(parsed) {
  let touched = false;
  if (parsed.cardNumber && parsed.cardNumber !== state.cardNumber) {
    state.cardNumber = parsed.cardNumber;
    touched = true;
  }
  if (parsed.deviceId && parsed.deviceId !== state.deviceId) {
    state.deviceId = parsed.deviceId;
    touched = true;
  }
  if (parsed.constant && parsed.constant !== state.constant) {
    state.constant = parsed.constant;
    state.constantSource = parsed.sources?.includes("qr") ? "qr" : "manual";
    touched = true;
  }
  if (touched) save();
  renderStart();
  els.cardLabel.textContent = hasAccount() ? maskCard(state.cardNumber) : "";
  return touched;
}

function missingMessage() {
  const card = validateCard(state.cardNumber);
  const device = validateDevice(state.deviceId);
  if (card && device) return "";
  if (card) return "Carte reconnue. Il manque l’identifiant de l’appareil.";
  if (device) return "Appareil reconnu. Il manque le numéro de carte.";
  return "Rien de reconnu dans ce texte.";
}

/* ------------------------------------------------------------------ coller */

async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      els.pasteInput.value = text;
      updatePasteNote(text);
      return true;
    }
  } catch {
    /* permission refusée : on laisse l’utilisateur coller à la main */
  }
  return false;
}

function updatePasteNote(text) {
  if (!text.trim()) {
    els.pasteNote.textContent = "";
    els.pasteNote.className = "field-note";
    return;
  }
  const parsed = parseAny(text);
  const parts = [];
  if (parsed.cardNumber) parts.push(`carte ${maskCard(parsed.cardNumber)}`);
  if (parsed.deviceId) parts.push(`appareil ${maskDevice(parsed.deviceId)}`);
  if (parsed.constant) parts.push(`clé ${parsed.constant}`);
  if (parts.length) {
    els.pasteNote.textContent = `Reconnu : ${parts.join(" · ")}`;
    els.pasteNote.className = "field-note ok";
  } else {
    els.pasteNote.textContent = "Rien de reconnu pour l’instant.";
    els.pasteNote.className = "field-note";
  }
}

els.pasteBtn.addEventListener("click", async () => {
  els.pasteInput.value = "";
  updatePasteNote("");
  openDialog(els.dlgPaste);
  setTimeout(() => els.pasteInput.focus(), 120);
  await readClipboard();
});

els.pasteFromClipboard.addEventListener("click", async () => {
  const ok = await readClipboard();
  if (!ok) {
    toast("Colle le lien à la main");
    els.pasteInput.focus();
  }
});

els.pasteInput.addEventListener("input", () => updatePasteNote(els.pasteInput.value));

els.pasteValidate.addEventListener("click", () => {
  const parsed = parseAny(els.pasteInput.value);
  if (!parsed.cardNumber && !parsed.deviceId && !parsed.constant) {
    els.pasteNote.textContent = "Rien de reconnu. Colle le lien complet de la page de connexion.";
    els.pasteNote.className = "field-note danger";
    return;
  }
  applyParsed(parsed);
  closeDialog(els.dlgPaste);
  if (hasAccount() && !hasConstant()) {
    // Enchaîne directement sur la dernière étape : c’est la seule qui reste.
    setTimeout(() => openScan("file"), 280);
    toast("Dernière étape : le QR de l’appli");
    return;
  }
  toast(missingMessage() || "Compte enregistré");
});

/* --------------------------------------------------------- saisie manuelle */

function openManual() {
  els.mCard.value = state.cardNumber;
  els.mDevice.value = state.deviceId;
  els.mConstant.value = state.constant;
  els.manualError.hidden = true;
  openDialog(els.dlgManual);
}

els.manualBtn.addEventListener("click", openManual);

els.manualSave.addEventListener("click", () => {
  const card = els.mCard.value.trim().toUpperCase();
  const device = els.mDevice.value.trim();
  const constant = els.mConstant.value.trim().toUpperCase();
  if (card && !validateCard(card)) {
    els.manualError.textContent = "Numéro de carte invalide (attendu : V012345678).";
    els.manualError.hidden = false;
    return;
  }
  if (device && !validateDevice(device)) {
    els.manualError.textContent = "Identifiant d’appareil invalide (UUID ou J…).";
    els.manualError.hidden = false;
    return;
  }
  if (constant && !validateConstant(constant)) {
    els.manualError.textContent = "Clé invalide (2 à 6 caractères A–Z / 0–9).";
    els.manualError.hidden = false;
    return;
  }
  state.cardNumber = card;
  state.deviceId = device;
  state.constant = constant;
  state.constantSource = constant ? "manual" : null;
  save();
  closeDialog(els.dlgManual);
  renderStart();
  els.cardLabel.textContent = hasAccount() ? maskCard(state.cardNumber) : "";
  toast(missingMessage() || "Enregistré");
});

/* ------------------------------------------------------------------- scan */

function stopCamera() {
  camera?.stop?.();
  camera = null;
  els.scanFrame.hidden = true;
}

function openScan(mode = "file") {
  els.scanNote.textContent = "";
  els.scanNote.className = "field-note";
  openDialog(els.dlgScan);
  if (mode === "camera") startScanCamera();
}

async function startScanCamera() {
  if (camera) return;
  if (!cameraAvailable()) {
    els.scanNote.textContent = "Caméra indisponible : choisis plutôt une image.";
    els.scanNote.className = "field-note danger";
    return;
  }
  els.scanNote.textContent = "Vise le QR…";
  els.scanFrame.hidden = false;
  try {
    camera = await startCamera(els.scanVideo, (value) => {
      stopCamera();
      handleScanResult(value);
    });
  } catch (err) {
    els.scanFrame.hidden = true;
    els.scanNote.textContent =
      err?.name === "NotAllowedError"
        ? "Accès caméra refusé. Tu peux importer une image."
        : "Caméra indisponible. Tu peux importer une image.";
    els.scanNote.className = "field-note danger";
  }
}

function handleScanResult(value) {
  const parsed = parseAny(value);
  if (!parsed.cardNumber && !parsed.constant) {
    els.scanNote.textContent = "Ce QR n’est pas un QR Basic-Fit.";
    els.scanNote.className = "field-note danger";
    return;
  }
  applyParsed(parsed);
  closeDialog(els.dlgScan);
  toast(
    parsed.constant
      ? `Clé ${parsed.constant} lue`
      : `Carte ${maskCard(parsed.cardNumber)} reconnue`
  );
}

els.shotBtn.addEventListener("click", () => openScan("file"));
els.scanPick.addEventListener("click", () => els.scanFile.click());
els.scanCam.addEventListener("click", startScanCamera);

els.scanFile.addEventListener("change", async () => {
  const file = els.scanFile.files?.[0];
  els.scanFile.value = "";
  if (!file) return;
  els.scanNote.textContent = "Lecture de l’image…";
  els.scanNote.className = "field-note";
  const value = await decodeFile(file);
  if (!value) {
    els.scanNote.textContent =
      "QR illisible. Recadre l’image sur le QR, ou refais la photo avec l’écran bien droit.";
    els.scanNote.className = "field-note danger";
    return;
  }
  handleScanResult(value);
});

/* --------------------------------------------------------------- réglages */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function renderSettings() {
  els.refreshSelect.value = String(state.refreshSec);
  els.themeSelect.value = state.theme;

  const rows = [
    ["Carte", state.cardNumber ? maskCard(state.cardNumber) : "non renseignée", !state.cardNumber],
    ["Appareil", state.deviceId ? maskDevice(state.deviceId) : "non renseigné", !state.deviceId],
    [
      "Clé du QR",
      hasConstant() ? state.constant : `${DEFAULT_CONSTANT} (par défaut)`,
      !hasConstant(),
    ],
  ];
  els.accountBox.innerHTML = rows
    .map(
      ([label, value, warn]) =>
        `<div class="account-row"><span>${escapeHtml(label)}</span><b class="${
          warn ? "warn" : ""
        }">${escapeHtml(value)}</b></div>`
    )
    .join("");
  els.payloadBox.textContent = current?.payload || "—";
}

els.settingsBtn.addEventListener("click", () => {
  renderSettings();
  openDialog(els.dlgSettings);
});

els.refreshSelect.addEventListener("change", () => {
  state.refreshSec = Number(els.refreshSelect.value) || 5;
  save();
  if (!els.viewQr.hidden) {
    lastRenderKey = "";
    refreshCode();
    startTicker();
  }
});

els.themeSelect.addEventListener("change", () => {
  state.theme = els.themeSelect.value;
  save();
  applyTheme();
});

els.editAccount.addEventListener("click", () => {
  closeDialog(els.dlgSettings);
  openManual();
});

els.wipeData.addEventListener("click", () => {
  if (!confirm("Effacer la carte, l’appareil et la clé de ce téléphone ?")) return;
  const theme = state.theme;
  state = { ...baseState(), theme };
  try {
    localStorage.removeItem(STORE);
    localStorage.removeItem(LEGACY_STORE);
  } catch {
    /* ignore */
  }
  closeDialog(els.dlgSettings);
  leaveQrView();
  renderStart();
  els.cardLabel.textContent = "";
  toast("Données effacées");
});

els.copyPayload.addEventListener("click", async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.payload);
    toast("Code copié");
  } catch {
    toast("Copie impossible");
  }
});

/* -------------------------------------------------------------------- aide */

const HELP = {
  link: {
    title: "Où trouver le lien de connexion",
    body: `
      <p>Le lien de la page de connexion Basic-Fit contient ton numéro de carte et
      l’identifiant de ton téléphone. Il ne sert qu’une fois.</p>
      <ol>
        <li>Ouvre l’appli Basic-Fit et déconnecte-toi (Profil → Déconnexion).</li>
        <li>Appuie sur « Se connecter ».</li>
        <li>Quand la page de connexion s’affiche, copie son adresse : elle commence
        par <code>https://</code> et contient <code>card-Number=</code>.</li>
        <li>Reviens ici, appuie sur « Coller le lien ».</li>
      </ol>
      <p>Si l’adresse n’est pas visible dans l’appli, ouvre la page dans Chrome
      (menu ⋮ → « Ouvrir dans le navigateur ») puis copie l’URL.</p>
    `,
  },
  qr: {
    title: "À quoi sert le QR de l’appli",
    body: `
      <p>Chaque QR Basic-Fit contient une clé propre à ton compte. C’est le
      3ᵉ champ de la chaîne : <code>GM2:carte:clé:horodatage:hash</code>.</p>
      <p>Elle ne change pas : une seule lecture suffit, définitivement.</p>
      <p><strong>L’appli Basic-Fit bloque les captures d’écran.</strong> Deux façons
      de lire la clé :</p>
      <ol>
        <li>Affiche ton QR dans l’appli Basic-Fit sur un autre appareil (tablette,
        ancien téléphone), puis scanne-le avec la caméra.</li>
        <li>Ou photographie l’écran avec un autre téléphone, puis importe la photo
        ici.</li>
      </ol>
      <p>Sans clé, Basic QR utilise <code>QII</code> : ça peut suffire, mais le
      portique peut refuser.</p>
    `,
  },
  trouble: {
    title: "Ça ne marche pas ?",
    body: `
      <section>
        <h3>Le portique refuse le QR</h3>
        <p>La clé est probablement fausse. Refais l’étape 2 avec une photo
        récente de l’écran du QR de l’appli officielle.</p>
      </section>
      <section>
        <h3>Le QR ne s’affiche pas</h3>
        <p>Recharge la page. Si tu as changé de téléphone ou réinstallé l’appli
        Basic-Fit, l’identifiant d’appareil a changé : refais l’étape 1.</p>
      </section>
      <section>
        <h3>Le code change tout le temps</h3>
        <p>C’est normal : il se renouvelle toutes les quelques secondes, comme
        dans l’appli officielle. Laisse-le affiché au moment de passer.</p>
      </section>
      <section>
        <h3>L’écran s’éteint</h3>
        <p>Garde Basic QR au premier plan et laisse « Écran allumé » activé.</p>
      </section>
    `,
  },
};

function renderHelp(topic = "trouble") {
  const blocks = topic === "trouble" ? ["trouble"] : [topic, "trouble"];
  els.helpBody.innerHTML = blocks
    .map((key) => {
      const section = HELP[key];
      return `<section><h3>${section.title}</h3>${section.body}</section>`;
    })
    .join("");
}

els.helpBtn.addEventListener("click", () => {
  renderHelp("trouble");
  openDialog(els.dlgHelp);
});
els.linkHelp.addEventListener("click", () => {
  renderHelp("link");
  openDialog(els.dlgHelp);
});
els.pasteHelp.addEventListener("click", () => {
  closeDialog(els.dlgPaste);
  renderHelp("link");
  openDialog(els.dlgHelp);
});
els.qrHelp.addEventListener("click", () => {
  renderHelp("qr");
  openDialog(els.dlgHelp);
});

/* --------------------------------------------------------------- installer */

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

function renderInstall() {
  els.installBody.innerHTML = isIOS
    ? `<p>Sur iPhone, l’installation passe par Safari :</p>
       <ol>
         <li>Appuie sur le bouton <strong>Partager</strong> (le carré avec une flèche).</li>
         <li>Choisis <strong>Sur l’écran d’accueil</strong>.</li>
         <li>Appuie sur <strong>Ajouter</strong>.</li>
       </ol>
       <p>L’appli s’ouvrira ensuite en plein écran, comme une vraie application.</p>`
    : `<p>Pour garder Basic QR sous la main :</p>
       <ol>
         <li>Ouvre le menu <strong>⋮</strong> de Chrome.</li>
         <li>Choisis <strong>Ajouter à l’écran d’accueil</strong> (ou « Installer l’application »).</li>
         <li>Confirme.</li>
       </ol>
       <p>Elle fonctionnera ensuite hors ligne, même sans réseau.</p>`;
  els.installNative.hidden = !installPrompt;
}

els.installBtn.addEventListener("click", () => {
  renderInstall();
  openDialog(els.dlgInstall);
});

els.installNative.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  els.installNative.hidden = true;
  closeDialog(els.dlgInstall);
});

/* ------------------------------------------------------------------ events */

els.showQrBtn.addEventListener("click", () => {
  if (!hasAccount()) return;
  enterQrView();
});

els.backBtn.addEventListener("click", () => leaveQrView());
els.fullscreenBtn.addEventListener("click", toggleFullscreen);
els.wakeBtn.addEventListener("click", () => {
  setWakeLock(els.wakeBtn.getAttribute("aria-pressed") !== "true");
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("fs-mode")) {
    document.body.classList.remove("fs-mode");
    requestAnimationFrame(() => current && renderQr(current.payload));
  }
});

document.addEventListener("visibilitychange", async () => {
  els.offlineBadge.hidden = navigator.onLine;
  if (document.visibilityState !== "visible") return;
  if (!els.viewQr.hidden) {
    lastRenderKey = "";
    await refreshCode();
    startTicker();
    if (wakeWanted && !wakeLock) setWakeLock(true);
  }
});

window.addEventListener("online", () => (els.offlineBadge.hidden = true));
window.addEventListener("offline", () => (els.offlineBadge.hidden = false));

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (els.viewQr.hidden) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => current && renderQr(current.payload), 120);
});

window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);

for (const dialog of document.querySelectorAll("dialog.sheet")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    if (event.clientY < dialog.getBoundingClientRect().top) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog === els.dlgScan) stopCamera();
  });
  for (const btn of dialog.querySelectorAll("[data-close]")) {
    btn.addEventListener("click", () => dialog.close());
  }
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  applyTheme();

  // Pré-remplissage ponctuel (?card=…&device=…&constant=…), puis nettoyage de
  // l’URL pour ne pas laisser les identifiants dans la barre d’adresse.
  const prefill = parsePrefill(location.search || location.hash);
  if (Object.keys(prefill).length) {
    state = { ...state, ...prefill };
    if (prefill.constant) state.constantSource = "manual";
    save();
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* sans importance */
    }
  }

  if (DEMO) state = { ...state, ...GOLDEN, constantSource: "qr" };

  els.offlineBadge.hidden = navigator.onLine;
  if (!("wakeLock" in navigator)) els.wakeBtn.hidden = true;
  renderStart();

  if (hasAccount()) {
    await enterQrView();
  } else {
    showView("start");
  }

  if (!globalThis.crypto?.subtle) {
    toast("Ouvre l’appli en HTTPS pour que le calcul fonctionne");
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    els.installBtn.hidden = false;
    els.installNative.hidden = false;
  });
  if (matchMedia("(display-mode: standalone)").matches) {
    els.installBtn.hidden = true;
  } else if (!installPrompt) {
    els.installBtn.hidden = false;
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
  parseAny,
  golden: GOLDEN,
  renderQr,
  showView,
  enterQrView,
};

boot();
