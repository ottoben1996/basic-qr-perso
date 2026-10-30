import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONSTANT,
  buildPayload,
  generateHash,
  maskCard,
  maskDevice,
  parseAny,
  parseCredentials,
  parsePayload,
  parsePrefill,
  validateCard,
  validateConstant,
  validateDevice,
} from "../src/core.js";

const GOLDEN = {
  cardNumber: "V00347833",
  deviceId: "8d20fc96-1b0e-4982-8292-e97caed114ec",
  constant: "2L8",
  iat: 1720878864,
  hash: "E587E5E8",
  payload: "GM2:V00347833:2L8:1720878864:E587E5E8",
};

test("generateHash reproduit le vecteur de référence", async () => {
  const hash = await generateHash(
    GOLDEN.cardNumber,
    GOLDEN.constant,
    GOLDEN.iat,
    GOLDEN.deviceId
  );
  assert.equal(hash, GOLDEN.hash);
});

test("buildPayload produit la charge utile attendue", async () => {
  const res = await buildPayload(GOLDEN);
  assert.equal(res.payload, GOLDEN.payload);
  assert.equal(res.hash, GOLDEN.hash);
});

test("buildPayload horodate à la seconde demandée", async () => {
  const res = await buildPayload({ ...GOLDEN, iat: 1700000000 });
  assert.match(res.payload, /^GM2:V00347833:2L8:1700000000:[0-9A-F]{8}$/);
});

test("validation des identifiants", () => {
  assert.ok(validateCard("V012345678"));
  assert.ok(validateCard("v012345678"));
  assert.ok(!validateCard("012345678"));
  assert.ok(!validateCard("V123"));

  assert.ok(validateDevice("8d20fc96-1b0e-4982-8292-e97caed114ec"));
  assert.ok(validateDevice("J0123456789abcdef0123456789abcdef"));
  assert.ok(!validateDevice("pas-un-identifiant"));

  assert.ok(validateConstant("QII"));
  assert.ok(!validateConstant("Q"));
});

test("parsePayload lit une charge utile GM2", () => {
  const parsed = parsePayload(GOLDEN.payload);
  assert.deepEqual(parsed, {
    cardNumber: GOLDEN.cardNumber,
    constant: GOLDEN.constant,
    iat: GOLDEN.iat,
    hash: GOLDEN.hash,
  });
  assert.equal(parsePayload("GM2:cassé"), null);
  assert.equal(parsePayload("https://example.com"), null);
});

test("parseCredentials lit une URL de connexion", () => {
  const parsed = parseCredentials(
    "https://www.basic-fit.com/fr-fr/login?card-Number=V012345678&deviceID=8d20fc96-1b0e-4982-8292-e97caed114ec&state=abc"
  );
  assert.equal(parsed.cardNumber, "V012345678");
  assert.equal(parsed.deviceId, "8d20fc96-1b0e-4982-8292-e97caed114ec");
});

test("parseCredentials lit un fragment et un JSON", () => {
  const frag = parseCredentials(
    "https://x.test/#cardNumber=V012345678&deviceID=J0123456789abcdef0123456789abcdef"
  );
  assert.equal(frag.cardNumber, "V012345678");
  assert.equal(frag.deviceId, "J0123456789abcdef0123456789abcdef");

  const json = parseCredentials(
    '{"cardNumber":"V012345678","deviceID":"8d20fc96-1b0e-4982-8292-e97caed114ec"}'
  );
  assert.equal(json.cardNumber, "V012345678");
  assert.equal(json.deviceId, "8d20fc96-1b0e-4982-8292-e97caed114ec");
});

test("parseCredentials accepte deux valeurs nues", () => {
  const parsed = parseCredentials("V012345678 8d20fc96-1b0e-4982-8292-e97caed114ec");
  assert.equal(parsed.cardNumber, "V012345678");
  assert.equal(parsed.deviceId, "8d20fc96-1b0e-4982-8292-e97caed114ec");
});

test("parseCredentials ne confond pas un identifiant technique avec l'appareil", () => {
  const parsed = parseCredentials(
    "https://x.test/login?bfa-trace-id=8d20fc96-1b0e-4982-8292-e97caed114ec&nonce=1"
  );
  assert.equal(parsed.deviceId, null);
});

test("parseAny privilégie le QR, puis le lien, puis la constante seule", () => {
  const qr = parseAny(GOLDEN.payload);
  assert.equal(qr.cardNumber, GOLDEN.cardNumber);
  assert.equal(qr.constant, GOLDEN.constant);
  assert.deepEqual(qr.sources, ["qr"]);

  const link = parseAny("https://x.test/login?card-Number=V012345678&deviceID=J0123456789abcdef0123456789abcdef");
  assert.equal(link.deviceId, "J0123456789abcdef0123456789abcdef");
  assert.deepEqual(link.sources, ["link"]);

  const constant = parseAny("QII");
  assert.equal(constant.constant, "QII");
  assert.deepEqual(constant.sources, ["constant"]);

  const empty = parseAny("bonjour");
  assert.equal(empty.cardNumber, null);
  assert.deepEqual(empty.sources, []);
});

test("parsePrefill ne retient que les valeurs valides", () => {
  assert.deepEqual(parsePrefill("?card=V012345678&device=8d20fc96-1b0e-4982-8292-e97caed114ec"), {
    cardNumber: "V012345678",
    deviceId: "8d20fc96-1b0e-4982-8292-e97caed114ec",
  });
  assert.deepEqual(parsePrefill("?card=invalid"), {});
  assert.deepEqual(parsePrefill(""), {});
});

test("les valeurs sensibles sont masquées", () => {
  assert.equal(maskCard("V012345678"), "V0123•••••");
  assert.equal(maskDevice("8d20fc96-1b0e-4982-8292-e97caed114ec"), "8d20…14ec");
  assert.equal(maskCard(""), "");
});

test("la constante par défaut est QII", () => {
  assert.equal(DEFAULT_CONSTANT, "QII");
});
