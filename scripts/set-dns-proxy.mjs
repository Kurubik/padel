// Flip the proxied flag on the game's A record. Used only around first-time
// certificate issuance. Token comes from the host resolver, never printed.
import { spawnSync } from "node:child_process";
const RESOLVER = process.env.INFISICAL_RESOLVER || "/root/.openclaw/bin/infisical-secret-ref-resolver.mjs";
const NAME = process.env.PADEL_HOST || "padel.xtr.sh";
const proxied = process.argv[2] === "true";
const res = spawnSync(process.execPath, [RESOLVER], { input: JSON.stringify({ protocolVersion: 1, ids: ["CLOUDFLARE_API_TOKEN"] }), encoding: "utf8" });
const t = JSON.parse(res.stdout).values.CLOUDFLARE_API_TOKEN;
const zone = (await (await fetch("https://api.cloudflare.com/client/v4/zones?name=xtr.sh", { headers: { authorization: "Bearer " + t } })).json()).result[0].id;
const recs = (await (await fetch("https://api.cloudflare.com/client/v4/zones/" + zone + "/dns_records?name=" + NAME, { headers: { authorization: "Bearer " + t } })).json()).result;
if (!recs.length) throw new Error("record not found");
const r = await (await fetch("https://api.cloudflare.com/client/v4/zones/" + zone + "/dns_records/" + recs[0].id, {
  method: "PATCH",
  headers: { authorization: "Bearer " + t, "content-type": "application/json" },
  body: JSON.stringify({ proxied }),
})).json();
console.log(JSON.stringify({ ok: r.success, name: r.result.name, proxied: r.result.proxied }));
