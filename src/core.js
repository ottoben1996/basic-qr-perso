// core.js — logique pure du QR d'accès. Aucune dépendance, aucun appel réseau.
// Testable sous Node (WebCrypto global) et dans le navigateur.

const GUID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Numéros de carte observés : « V » suivi de 8 à 10 chiffres.
const CARD_RE = /^V\d{8,10}$/i;

// Deux formats d'identifiant d'appareil observés dans l'application :
//  - UUID v4 (ancienne version, ex. 8d20fc96-1b0e-4982-8292-e97caed114ec)
//  - identifiant « THIS_DEVICE_ID_V2 » (version actuelle) : J + 36 hexadécimaux
const DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_J_RE = /^J[0-9a-f]{16,48}$/i;

/** Constante de club/région présente dans le QR (3 caractères observés, ex. « QII »). */
const CONSTANT_RE = /^[A-Z0-9]{2,6}$/;

/** Charge utile telle qu'encodée dans le QR : GM2:<carte>:<constante>:<iat>:<hash>. */
const PAYLOAD_RE = /^GM2:([^:]+):([^:]+):(\d{9,12}):([0-9A-F]{8})$/i;

/** Valeur par défaut quand la constante n'a pas pu être lue. */
export const DEFAULT_CONSTANT = "QII";

/** Identifiant aléatoire court (3 caractères) régénéré à chaque scan. */
export function randomGuid(len = 3, rng = Math.random) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += GUID_CHARS[Math.floor(rng() * GUID_CHARS.length)];
  }
  return out;
}

/** Hash du QR : SHA-256(card + guid + iat + deviceId), 8 derniers caractères, majuscules. */
export async function generateHash(cardNumber, guid, iat, deviceId) {
  const data = `${cardNumber}${guid}${iat}${deviceId}`;
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return hex.slice(-8);
}

/**
 * Charge utile encodée dans le QR : GM2:<carte>:<constante>:<timestamp>:<hash>.
 * Si la constante est absente, on retombe sur un tirage aléatoire.
 */
export async function buildPayload({ cardNumber, deviceId, constant, iat }) {
  const c = String(constant || "").trim() || randomGuid();
  const ts = iat || Math.floor(Date.now() / 1000);
  const hash = await generateHash(cardNumber, c, ts, deviceId);
  return { payload: `GM2:${cardNumber}:${c}:${ts}:${hash}`, constant: c, iat: ts, hash };
}

export function normalizeCard(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function validateCard(value) {
  return CARD_RE.test(normalizeCard(value));
}

export function validateDevice(value) {
  const v = String(value || "").trim();
  return DEVICE_UUID_RE.test(v) || DEVICE_J_RE.test(v);
}

export function validateConstant(value) {
  return CONSTANT_RE.test(String(value || "").trim().toUpperCase());
}

/**
 * Lit une charge utile GM2 (celle qu'on trouve dans le QR de l'application
 * officielle). Sert à récupérer la carte et surtout la constante du compte.
 */
export function parsePayload(text) {
  const m = String(text || "").trim().match(PAYLOAD_RE);
  if (!m) return null;
  const [, card, constant, iat, hash] = m;
  if (!validateCard(card)) return null;
  return {
    cardNumber: normalizeCard(card),
    constant: constant.toUpperCase(),
    iat: Number(iat),
    hash: hash.toUpperCase(),
  };
}

/**
 * Pré-remplissage depuis une URL : ?card=…&device=…&constant=…
 * Seules les valeurs valides sont retenues — jamais de valeur inventée ni de
 * remplacement de la configuration existante par du vide.
 */
export function parsePrefill(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || "").replace(/^[?#]/, ""));
  } catch {
    return {};
  }
  const out = {};
  const card = normalizeCard(params.get("card") || params.get("carte") || "");
  const device = (params.get("device") || params.get("deviceId") || params.get("dev") || "").trim();
  const constant = (params.get("constant") || params.get("const") || "").trim().toUpperCase();
  if (validateCard(card)) out.cardNumber = card;
  if (validateDevice(device)) out.deviceId = device;
  if (validateConstant(constant)) out.constant = constant;
  return out;
}

/**
 * Extrait carte + deviceId depuis :
 *  - une URL de connexion (liens `card-Number=` / `deviceID=` / hash `#...`)
 *  - un JSON collé depuis les données locales de l'application
 *  - ou une saisie libre "V012345678 8d20fc96-1b0e-4982-8292-e97caed114ec"
 */
export function parseCredentials(raw) {
  const input = String(raw || "").trim();
  if (!input) return { cardNumber: null, deviceId: null };

  const found = { cardNumber: null, deviceId: null };
  const collect = (key, value) => {
    if (!value) return;
    const k = String(key).toLowerCase().replace(/[^a-z]/g, "");
    let clean;
    try {
      clean = decodeURIComponent(String(value)).replace(/^["']|["']$/g, "").trim();
    } catch {
      clean = String(value).replace(/^["']|["']$/g, "").trim();
    }
    if (k.includes("card") && !found.cardNumber && validateCard(clean)) {
      found.cardNumber = normalizeCard(clean);
    } else if (k.includes("device") && !found.deviceId && validateDevice(clean)) {
      found.deviceId = clean;
    }
  };

  // 1. paramètres de requête (?card-Number=...&deviceID=...)
  for (const [k, v] of new URLSearchParams(input.split(/[?#]/).slice(1).join("&"))) {
    collect(k, v);
  }
  // 2. paramètres de fragment (#card-Number=...&deviceID=...)
  const frag = input.includes("#") ? input.slice(input.indexOf("#") + 1) : "";
  if (frag && !frag.startsWith("/")) {
    for (const [k, v] of new URLSearchParams(frag)) collect(k, v);
  }
  // 3. paires clé/valeur libres (JSON ou texte)
  const pairRe = /["'\s,&]?([A-Za-z_\-]*?(?:card|device)[A-Za-z_\-]*?)["'\s]*[:=]\s*["']?([^"'\s,&]+)/gi;
  let m;
  while ((m = pairRe.exec(input)) !== null) collect(m[1], m[2]);
  // 4. valeurs nues — uniquement si l'entrée ne contient aucune paire clé/valeur,
  //    pour ne jamais confondre un identifiant technique (ex. bfa-trace-id, state,
  //    nonce) avec le deviceId, ce qui produirait un QR invalide en silence.
  const looksKeyed = /[A-Za-z_][A-Za-z0-9_-]*\s*[:=]/.test(input);
  if (!looksKeyed) {
    const cardBare = input.match(/\bV\d{6,12}\b/i);
    if (cardBare) collect("card", cardBare[0]);
    const devBare = input.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
    );
    if (devBare) collect("device", devBare[0]);
  }

  return found;
}

/**
 * Point d'entrée unique : accepte à peu près tout ce que l'utilisateur peut
 * coller ou scanner, et renvoie ce qui a pu être reconnu.
 * `sources` indique d'où vient chaque valeur, pour le diagnostic.
 */
export function parseAny(raw) {
  const text = String(raw || "").trim();
  const out = { cardNumber: null, deviceId: null, constant: null, sources: [] };
  if (!text) return out;

  const payload = parsePayload(text);
  if (payload) {
    out.cardNumber = payload.cardNumber;
    out.constant = payload.constant;
    out.sources.push("qr");
    return out;
  }

  const creds = parseCredentials(text);
  out.cardNumber = creds.cardNumber;
  out.deviceId = creds.deviceId;
  if (creds.cardNumber || creds.deviceId) out.sources.push("link");

  // Une constante collée seule (« QII ») n'est acceptée que si l'entrée ne
  // contient rien d'autre : sinon le risque de fausse détection est trop grand.
  if (!out.cardNumber && !out.deviceId && validateConstant(text)) {
    out.constant = text.toUpperCase();
    out.sources.push("constant");
  }

  return out;
}

export function maskCard(cardNumber) {
  if (!cardNumber) return "";
  return cardNumber.slice(0, 5) + "•".repeat(Math.max(0, cardNumber.length - 5));
}

export function maskDevice(deviceId) {
  if (!deviceId) return "";
  if (deviceId.length <= 8) return "•".repeat(deviceId.length);
  return deviceId.slice(0, 4) + "…" + deviceId.slice(-4);
}
