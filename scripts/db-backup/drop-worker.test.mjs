// Unit test for drop-worker.js against an in-memory bucket.
// Run: node scripts/db-backup/drop-worker.test.mjs
import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a instanceof ArrayBuffer ? new Uint8Array(a) : a), Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b));
const { default: worker } = await import("./drop-worker.js");
const store = new Map();
const BUCKET = {
  async head(k) { return store.has(k) ? { key: k } : null; },
  async list({ prefix }) { return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ key: k, size: store.get(k).length, uploaded: new Date() })), truncated: false }; },
  async put(k, body, opts) {
    const buf = typeof body === "string" ? Buffer.from(body) : Buffer.from(await new Response(body).arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex") !== opts.sha256) throw new Error("sha mismatch");
    store.set(k, buf); return { key: k, size: buf.length, etag: "e", uploaded: new Date() };
  },
  async get(k) { const b = store.get(k); return b && { body: b, size: b.length, httpEtag: '"e"', writeHttpMetadata() {} }; },
};
const h = t => createHash("sha256").update(t).digest("hex");
const env = { BUCKET, UPLOAD_TOKEN_SHA256: h("up"), READ_TOKEN_SHA256: h("rd") };
const day = new Date().toISOString().slice(0, 10);
const key = `nightly/${day}/bard-${day}T230000Z`;
const sha = b => createHash("sha256").update(b).digest("hex");
const req = (method, path, { tok, body, sha256 } = {}) => worker.fetch(new Request("https://x" + path, {
  method, body, headers: { ...(tok && { authorization: `Bearer ${tok}` }), ...(sha256 && { "x-sha256": sha256 }), ...(body && { "content-length": String(Buffer.byteLength(body)) }) } }), env);
const s = async (p) => (await p).status;
const enc = "\x85encrypted";
assert.equal(await s(req("PUT", `/put/${key}.dump.gpg`, { tok: "rd", body: enc, sha256: sha(enc) })), 403, "read token cannot upload");
assert.equal(await s(req("PUT", `/put/${key}.dump.gpg`, { body: enc, sha256: sha(enc) })), 403, "no token");
assert.equal(await s(req("PUT", `/put/${key}.json.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 409, "manifest before copy");
assert.equal(await s(req("PUT", `/put/nightly/2020-01-01/bard-2020-01-01T000000Z.dump.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 400, "old date");
assert.equal(await s(req("PUT", `/put/nightly/${day}/../x.dump.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 400, "bad key");
assert.equal(await s(req("PUT", `/put/${key}.dump.gpg`, { tok: "up", body: enc })), 400, "missing sha");
assert.equal(await s(req("PUT", `/put/${key}.dump.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 201, "upload");
assert.equal(await s(req("PUT", `/put/${key}.dump.gpg`, { tok: "up", body: "x", sha256: sha("x") })), 409, "no overwrite");
assert.equal(await s(req("PUT", `/put/${key}.json.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 201, "encrypted manifest");
assert.equal(await s(req("GET", "/latest", { tok: "up" })), 403, "upload token cannot read");
const latest = await (await req("GET", "/latest", { tok: "rd" })).json();
assert.equal(latest.manifest, `${key}.json.gpg`);
const got = await req("GET", `/get/${key}.dump.gpg`, { tok: "rd" });
assert.equal(Buffer.from(await got.arrayBuffer()).toString("utf8"), enc);
assert.equal(await s(req("DELETE", `/get/${key}.dump.gpg`, { tok: "up" })), 404, "no delete route");
for (let i = 1; i < 9; i++) await req("PUT", `/put/${key.replace("230000", "23000" + i)}.dump.gpg`, { tok: "up", body: enc, sha256: sha(enc) });
assert.equal(await s(req("PUT", `/put/${key.replace("230000", "235959")}.dump.gpg`, { tok: "up", body: enc, sha256: sha(enc) })), 429, "daily cap");
console.log("all worker checks passed");
