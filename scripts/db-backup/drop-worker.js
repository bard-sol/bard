// bard-db-backup: the only way into the R2 bucket that holds Bard's
// nightly database copies (TRAA-452).
//
// The upload token (held by the GitHub job) can add a copy, never overwrite or
// delete one, and only under today's (or yesterday's) date, at most
// MAX_PER_DAY objects a day. The read token can list and download.
// The worker only holds SHA-256 hashes of the two tokens (UPLOAD_TOKEN_SHA256,
// READ_TOKEN_SHA256), so its settings never reveal a usable token. There is no
// delete route: copies leave only through the bucket's 30-day lifecycle rule.
//
// Deployed by hand through the Cloudflare API; see README.md in this folder.
//
// Routes:
//   PUT /put/nightly/<YYYY-MM-DD>/bard-<YYYY-MM-DD>T<HHMMSS>Z.(dump.gpg|json.gpg)
//       headers: Authorization: Bearer <upload token>, x-sha256: <hex>
//   GET /latest        newest copy that has a manifest
//   GET /list          every stored object
//   GET /get/<key>     download one object
//       headers: Authorization: Bearer <read token>

const KEY_RE =
  /^nightly\/(\d{4}-\d{2}-\d{2})\/bard-(\d{4}-\d{2}-\d{2})T\d{6}Z\.(dump\.gpg|json\.gpg)$/;
const MAX_PER_DAY = 10;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    if (request.method === "PUT" && path.startsWith("/put/")) {
      if (!(await authorized(request, env.UPLOAD_TOKEN_SHA256))) return text(403, "forbidden");
      return put(request, env, path.slice("/put/".length));
    }
    if (request.method === "GET") {
      if (!(await authorized(request, env.READ_TOKEN_SHA256))) return text(403, "forbidden");
      if (path === "/latest") return latest(env);
      if (path === "/list") return json(200, await listAll(env, "nightly/"));
      if (path.startsWith("/get/")) return get(env, path.slice("/get/".length));
    }
    return text(404, "not found");
  },
};

async function put(request, env, key) {
  const match = KEY_RE.exec(key);
  if (!match || match[1] !== match[2]) return text(400, "bad key");
  const day = match[1];
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (day !== isoDay(today) && day !== isoDay(yesterday)) return text(400, "bad date");

  const sha256 = (request.headers.get("x-sha256") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return text(400, "x-sha256 required");
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) return text(411, "content-length required");

  if (await env.BUCKET.head(key)) return text(409, "already stored");
  const sameDay = await env.BUCKET.list({ prefix: `nightly/${day}/` });
  if (sameDay.objects.length >= MAX_PER_DAY) return text(429, "daily limit reached");

  let body = request.body;
  // The manifest is OpenPGP ciphertext (.json.gpg), not plaintext JSON.
  // Bard's repo is public, so table names and row counts stay inside that
  // ciphertext. The backup script refuses to upload it unless it is encrypted
  // to our key. The worker only checks size, order and the checksum.
  if (key.endsWith(".json.gpg")) {
    if (length > MAX_MANIFEST_BYTES) return text(413, "manifest too large");
    if (!(await env.BUCKET.head(key.replace(/\.json\.gpg$/, ".dump.gpg")))) {
      return text(409, "copy not stored yet");
    }
  }

  // R2 checks the sha256 and rejects the write if the bytes don't match.
  const stored = await env.BUCKET.put(key, body, {
    sha256,
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return json(201, { key: stored.key, size: stored.size, etag: stored.etag, uploaded: stored.uploaded });
}

async function latest(env) {
  const objects = await listAll(env, "nightly/");
  const manifests = objects.filter((o) => o.key.endsWith(".json.gpg")).sort((a, b) => (a.key < b.key ? -1 : 1));
  const newest = manifests.at(-1);
  if (!newest) return text(404, "no copies yet");
  return json(200, { manifest: newest.key, copy: newest.key.replace(/\.json\.gpg$/, ".dump.gpg"), uploaded: newest.uploaded });
}

async function get(env, key) {
  if (!KEY_RE.test(key)) return text(400, "bad key");
  const object = await env.BUCKET.get(key);
  if (!object) return text(404, "not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function authorized(request, expectedHex) {
  if (!/^[0-9a-f]{64}$/.test(expectedHex || "")) return false;
  const given = request.headers.get("authorization") || "";
  if (!given.startsWith("Bearer ")) return false;
  const actual = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(given.slice(7)));
  const expected = new Uint8Array(expectedHex.match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.timingSafeEqual(actual, expected);
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function text(status, body) {
  return new Response(body + "\n", { status, headers: { "content-type": "text/plain" } });
}

function json(status, body) {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json" },
  });
}
