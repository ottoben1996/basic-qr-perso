// core.js — logique pure de génération du QR d'accès Basic-Fit.
// Aucune dépendance, aucun appel réseau. Testable sous Node (WebCrypto global).

const GUID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Convention observée sur les numéros de carte Basic-Fit : « V » suivi de 8 à 10 chiffres.
const CARD_RE = /^V\d{8,10}$/i;
// Deux formats de deviceId observés dans l'application officielle :
//  - UUID v4 (ancienne version, ex. 8d20fc96-1b0e-4982-8292-e97caed114ec)
//  - identifiant « THIS_DEVICE_ID_V2 » (version actuelle) : J + 36 hexadécimaux
const DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_J_RE = /^J[0-9a-f]{16,48}$/i;

/** Constante de club/région présente dans le QR (3 caractères observés, ex. « QII »). */
const CONSTANT_RE = /^[A-Z0-9]{2,6}$/;

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
 * La constante est la valeur observée dans les QR de l'application (fixe pour un
 * compte/club) ; si elle est absente, on retombe sur un tirage aléatoire comme dans
 * la première analyse publique du format.
 */
export async function buildPayload({ cardNumber, deviceId, constant, iat }) {
  const c = String(constant || "").trim() || randomGuid();
  const ts = iat || Math.floor(Date.now() / 1000);
  const hash = await generateHash(cardNumber, c, ts, deviceId);
  return { payload: `GM2:${cardNumber}:${c}:${ts}:${hash}`, constant: c, iat: ts, hash };
}

export function validateCard(value) {
  return CARD_RE.test(String(value || "").trim());
}

export function validateDevice(value) {
  const v = String(value || "").trim();
  return DEVICE_UUID_RE.test(v) || DEVICE_J_RE.test(v);
}

export function validateConstant(value) {
  return CONSTANT_RE.test(String(value || "").trim().toUpperCase());
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
  const card = (params.get("card") || params.get("carte") || "").trim().toUpperCase();
  const device = (params.get("device") || params.get("deviceId") || params.get("dev") || "").trim();
  const constant = (params.get("constant") || params.get("const") || "").trim().toUpperCase();
  if (validateCard(card)) out.cardNumber = card;
  if (validateDevice(device)) out.deviceId = device;
  if (validateConstant(constant)) out.constant = constant;
  return out;
}

/**
 * Extrait carte + deviceId depuis :
 *  - une URL de connexion Basic-Fit (liens `card-Number=` / `deviceID=` / hash `#...`)
 *  - ou une saisie libre "V012345678 8d20fc96-1b0e-4982-8292-e97caed114ec"
 */
export function parseCredentials(raw) {
  const input = String(raw || "").trim();
  if (!input) return { cardNumber: null, deviceId: null };

  const found = { cardNumber: null, deviceId: null };
  const collect = (key, value) => {
    if (!value) return;
    const k = String(key).toLowerCase().replace(/[^a-z]/g, "");
    const clean = decodeURIComponent(String(value)).replace(/^["']|["']$/g, "").trim();
    if (k.includes("card") && !found.cardNumber && validateCard(clean)) {
      found.cardNumber = clean.toUpperCase();
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

export function maskCard(cardNumber) {
  if (!cardNumber) return "";
  return cardNumber.slice(0, 5) + "•".repeat(Math.max(0, cardNumber.length - 5));
}
