import { Elysia, t } from "elysia";
import { cluster } from "radash";
import {
	MAX_FOLLOWERS,
	REFRESH_CASTS_SIZE,
	REFRESH_PARALLEL_BATCHES,
} from "../constants";
import { getFidByUsername } from "../lib/fsu";
import { getFollowingByFid } from "../lib/hub-api";
import { getCastsByFid } from "../lib/hub-grpc";

export const processFids = async (allFids: number[]) => {
	// Process FIDs in parallel batches of REFRESH_PARALLEL_BATCHES (20)
	const results = [];
	for (const batch of cluster(allFids, REFRESH_PARALLEL_BATCHES)) {
		const batchResults = await Promise.all(
			batch.map(async (fid: number) => getCastsByFid(fid, REFRESH_CASTS_SIZE)),
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
			const fid = await getFidByUsername(username);
			if (!fid) {
				return {
					success: false,
					error: `Fid not found for ${username}`,
				};
			}
			const following = await getFollowingByFid(fid);
			for (const followingFid of following.slice(0, MAX_FOLLOWERS)) {
				allFids.add(followingFid);
			}
			allFids.add(fid);
		}

		const res = processFids(Array.from(allFids));

		return res;
	},
	{
		body: t.Object({
			username: t.Optional(t.String()),
			fids: t.Optional(t.Array(t.Number())),
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
								}),
							}),
						},
					},
				},
			},
		},
	},
);
