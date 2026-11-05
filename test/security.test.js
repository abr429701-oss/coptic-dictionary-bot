import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, hotp, totpVerify, generateSecret, otpauthUri } from "../src/security.js";

// RFC 4648 base32 test vectors.
test("base32 encode/decode round-trip", () => {
  const cases = ["", "f", "fo", "foo", "foob", "fooba", "foobar"];
  for (const c of cases) {
    const bytes = new TextEncoder().encode(c);
    const encoded = base32Encode(bytes);
    const decoded = base32Decode(encoded);
    assert.equal(new TextDecoder().decode(decoded), c, `round-trip failed for "${c}"`);
  }
});

test("base32 decode tolerates padding and lowercase", () => {
  // "foobar" -> MZXW6YTBOI====== (RFC 4648)
  const decoded = base32Decode("mzxw6ytboi======");
  assert.equal(new TextDecoder().decode(decoded), "foobar");
});

// RFC 6238 Appendix B test vector (SHA1): seed ASCII "12345678901234567890".
// At T=59s (step=1) the TOTP is 287082.
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of "12345678901234567890"
test("hotp matches RFC 4226 counter 1", async () => {
  const secret = base32Decode(RFC_SECRET_B32);
  assert.equal(await hotp(secret, 1), "287082");
});

test("totpVerify accepts RFC 6238 vector at T=59s", async () => {
  assert.equal(await totpVerify(RFC_SECRET_B32, "287082", 59 * 1000, 0), true);
});

test("totpVerify rejects wrong code and malformed input", async () => {
  assert.equal(await totpVerify(RFC_SECRET_B32, "000000", 59 * 1000, 0), false);
  assert.equal(await totpVerify(RFC_SECRET_B32, "1234", 59 * 1000, 0), false); // not 6 digits
  assert.equal(await totpVerify("!!!not-base32!!!", "287082", 59 * 1000, 0), false);
});

test("totpVerify with ±1 window accepts adjacent period", async () => {
  // At T=29s (step=0) code differs, but window=1 should still accept step=1 code 287082.
  assert.equal(await totpVerify(RFC_SECRET_B32, "287082", 29 * 1000, 1), true);
  // Window 0 must reject it.
  assert.equal(await totpVerify(RFC_SECRET_B32, "287082", 29 * 1000, 0), false);
});

test("generateSecret produces valid base32 and otpauthUri is well-formed", () => {
  const s = generateSecret(20);
  assert.match(s, /^[A-Z2-7]+$/);
  assert.equal(base32Decode(s).length, 20);
  const uri = otpauthUri(s, "Test:alice", "Issuer");
  assert.ok(uri.startsWith("otpauth://totp/Test%3Aalice?secret="));
  assert.ok(uri.includes("issuer=Issuer"));
  assert.ok(uri.includes("algorithm=SHA1"));
});
