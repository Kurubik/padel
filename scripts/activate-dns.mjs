// Create the public A record for the game from the current Infisical secret.
// The token is read via the host resolver and never printed or written to disk.
import { spawnSync } from "node:child_process";

const RESOLVER = process.env.INFISICAL_RESOLVER || "/root/.openclaw/bin/infisical-secret-ref-resolver.mjs";
const ZONE = "xtr.sh";
const NAME = process.env.PADEL_HOST || "padel.xtr.sh";
const ORIGIN = process.env.PADEL_ORIGIN || "89.167.56.86";

function token() {
  const res = spawnSync(process.execPath, [RESOLVER], {
    input: JSON.stringify({ protocolVersion: 1, ids: ["CLOUDFLARE_API_TOKEN"] }),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error("resolver failed: " + (res.stderr || "").slice(0, 200));
  const parsed = JSON.parse(res.stdout);
  const value = parsed && parsed.values && parsed.values.CLOUDFLARE_API_TOKEN;
  if (!value) throw new Error("token not returned");
  return value;
}

async function cf(path, init, t) {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...init,
    headers: { authorization: "Bearer " + t, "content-type": "application/json", ...(init && init.headers) },
  });
  const body = await r.json();
  if (!body.success) throw new Error("CF error: " + JSON.stringify(body.errors).slice(0, 300));
  return body.result;
}

const t = token();
const zones = await cf("/zones?name=" + ZONE, undefined, t);
if (!zones.length) throw new Error("zone not found: " + ZONE);
const zoneId = zones[0].id;
const existing = await cf("/zones/" + zoneId + "/dns_records?name=" + NAME, undefined, t);
if (existing.length) {
  console.log(JSON.stringify({ ok: true, action: "exists", record: { id: existing[0].id, name: existing[0].name, type: existing[0].type, content: existing[0].content, proxied: existing[0].proxied } }, null, 2));
} else {
  const rec = await cf("/zones/" + zoneId + "/dns_records", {
    method: "POST",
    body: JSON.stringify({ type: "A", name: NAME, content: ORIGIN, proxied: true, ttl: 1, comment: "PADEL//CLUB" }),
  }, t);
  console.log(JSON.stringify({ ok: true, action: "created", record: { id: rec.id, name: rec.name, type: rec.type, content: rec.content, proxied: rec.proxied } }, null, 2));
}
