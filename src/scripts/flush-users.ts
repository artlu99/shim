import redis from "../lib/redis";

// Delete cached user entities so the next /user/{fid} fetch rebuilds them
// from the hub. Run this whenever the cached User shape changes — a stale
// entry serves its old shape until its TTL expires (4h), and hydration
// trusts whatever is in the cache.
//
// Also flushes channelFeed:* when doing a full flush, since those embed
// nested user objects that may predate a User shape change.
//
//   bun run user:flush            # flush every user:{fid} + channelFeed:*
//   bun run user:flush 191503 3   # flush specific fids (users only)
//
// Flush AFTER the new code is deployed, never before: the running (old)
// service would just re-cache the old shape with a fresh TTL.
const specificFids = process.argv.slice(2);
const client = redis();

const userKeys =
	specificFids.length > 0
		? specificFids.map((fid) => `user:${fid}`)
		: await client.keys("user:*");

const feedKeys =
	specificFids.length > 0 ? [] : await client.keys("channelFeed:*");

const keys = [...userKeys, ...feedKeys];

if (keys.length === 0) {
	console.log("no matching cache keys — nothing to flush");
} else {
	const removed = await client.del(...keys);
	console.log(
		`flushed ${removed}/${keys.length} keys (${userKeys.length} user:*, ${feedKeys.length} channelFeed:*)`,
	);
}
