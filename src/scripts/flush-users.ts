import redis from "../lib/redis";

// Delete cached user entities so the next /user/{fid} fetch rebuilds them
// from the hub. Run this whenever the cached User shape changes — a stale
// entry serves its old shape until its TTL expires (12h), and hydration
// trusts whatever is in the cache.
//
//   bun run user:flush            # flush every user:{fid}
//   bun run user:flush 191503 3   # flush specific fids
//
// Flush AFTER the new code is deployed, never before: the running (old)
// service would just re-cache the old shape with a fresh TTL.
const pattern = process.argv[2] ? null : "user:*";
const fids = process.argv.slice(2);

const client = redis();

const keys =
	pattern === null
		? fids.map((fid) => `user:${fid}`)
		: await client.keys(pattern);

if (keys.length === 0) {
	console.log("no user:* keys matched — nothing to flush");
} else {
	const removed = await client.del(...keys);
	console.log(`flushed ${removed}/${keys.length} user cache keys`);
}
