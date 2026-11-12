import { Elysia, t } from "elysia";
import { cluster } from "radash";
import {
	MAX_FOLLOWERS,
	MAX_REFRESH_FIDS,
	MAX_SYNC_MESSAGES,
	REFRESH_PARALLEL_BATCHES,
} from "../constants";
import { getFollowingByFid, getHubFidByUsername } from "../lib/hub-api";
import { syncCastsByFid } from "../lib/cast-sync";
import { getLatestCastTimestamps } from "../lib/sqlite";

export const processFids = async (allFids: number[]) => {
	// incremental: users we already have casts for only pull new messages
	// (server-side startTimestamp filter); unknown users sync up to
	// MAX_SYNC_MESSAGES. This is the only writer — a bounded read that
	// upserts the newest casts seals the watermark, and this path never
	// walks back behind it. Sync is fork-aware: Hypersnap /v1 primary,
	// Snapchain gRPC on a clean miss.
	const watermarks = await getLatestCastTimestamps(allFids);

	// Process FIDs in parallel batches of REFRESH_PARALLEL_BATCHES (20).
	// A fid where BOTH worlds are unreachable is counted, not silently
	// treated as an empty world — the stats carry the failure.
	let failedFids = 0;
	const results = [];
	for (const batch of cluster(allFids, REFRESH_PARALLEL_BATCHES)) {
		const batchResults = await Promise.all(
			batch.map(async (fid: number) => {
				try {
					return await syncCastsByFid(
						fid,
						MAX_SYNC_MESSAGES,
						watermarks.get(fid),
						{ upsert: true },
					);
				} catch (error) {
					failedFids += 1;
					console.error(
						"processFids: cast sync outage:",
						fid,
						error instanceof Error ? error.message : JSON.stringify(error),
					);
					return { casts: [], numNew: 0 };
				}
			}),
		);
		results.push(...batchResults);
	}

	// Sum up the results
	const totalCount = results.reduce(
		(sum: number, { casts }) => sum + casts.length,
		0,
	);
	const totalNewCasts = results.reduce(
		(sum: number, { numNew }) => sum + (numNew ?? 0),
		0,
	);
	return {
		success: true,
		message: "OK",
		stats: {
			totalFids: allFids.length,
			totalNewCasts: totalNewCasts,
			totalCasts: totalCount,
			failedFids,
		},
	};
};

export const postRefresh = new Elysia().post(
	"/refresh",
	async ({ body }) => {
		const { username, fids } = body;
		if (!username && !fids) {
			return {
				success: false,
				error: "Fids are required",
			};
		}

		// Get following FIDs if username is provided
		const allFids = new Set(fids);
		if (username) {
			const fid = await getHubFidByUsername(username);
			if (!fid) {
				return {
					success: false,
					error: `Fid not found for ${username}`,
				};
			}
			// refresh only consumes the first MAX_FOLLOWERS entries, so one page
			// of 1000 covers it without pulling the whole following graph
			const following = await getFollowingByFid(fid, 1);
			for (const followingFid of following.slice(0, MAX_FOLLOWERS)) {
				allFids.add(followingFid);
			}
			allFids.add(fid);
		}

		const res = await processFids(Array.from(allFids));

		return res;
	},
	{
		body: t.Object({
			username: t.Optional(t.String()),
			fids: t.Optional(t.Array(t.Number(), { maxItems: MAX_REFRESH_FIDS })),
		}),
		detail: {
			tags: ["Feed"],
			summary: "Refresh feed",
			responses: {
				200: {
					description: "Refresh completed",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								message: t.String(),
								stats: Object({
									totalFids: t.Number(),
									totalNewCasts: t.Number(),
									totalCasts: t.Number(),
									failedFids: t.Number(),
								}),
							}),
						},
					},
				},
			},
		},
	},
);
