import { Elysia, t } from "elysia";
import { URI_SEARCH_LOOKBACK } from "../constants";
import { getCastInEitherWorld } from "../lib/cast-lookup";
import { syncCastsByFid } from "../lib/cast-sync";
import { getHubFidByUsername } from "../lib/hub-api";
import { getUserByFid } from "../lib/hydration";
import { getCastByShortHash } from "../lib/sqlite";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { type Cast, CastSchema } from "../types";

export const getCastByWarpcastUri = new Elysia().get(
	"/wc/:username/:shortHash",
	async ({ params: { username, shortHash }, set }) => {
		const fid = await getHubFidByUsername(username);
		if (!fid) {
			return {
				success: false,
				error: "getHubFidByUsername: Username not found",
			};
		}

		let cast: Cast | undefined;
		const castDbObj = await getCastByShortHash(shortHash);
		if (castDbObj) {
			// fork-aware: a warm row whose cast lives only in the Hypersnap
			// world is still valid
			try {
				const result = await getCastInEitherWorld(
					fid,
					castDbObj.hash as `0x${string}`,
				);
				cast = result?.cast;
			} catch (error) {
				console.error(
					"getCastFromUri: cast lookup outage:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
				set.status = 503;
				return {
					success: false,
					error: "getCastFromUri: cast lookup outage",
				};
			}
		} else {
			// the lookback walk must search the fid's casts in BOTH worlds —
			// the cast behind a Warpcast URI may only exist in either one
			let casts: Cast[];
			try {
				({ casts } = await syncCastsByFid(fid, URI_SEARCH_LOOKBACK));
			} catch (error) {
				console.error(
					"getCastFromUri: cast sync outage:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
				set.status = 503;
				return {
					success: false,
					error: "getCastFromUri: cast sync outage",
				};
			}
			if (!casts) {
				console.error(
					`getCastFromUri: No casts found for username: ${username}`,
				);
				return undefined;
			}

			cast = casts.find((cast) => cast.hash.startsWith(shortHash));
			if (!cast) {
				console.error(
					`getCastFromUri: Cast not found for username: ${username} and shortHash: ${shortHash} in ${casts.length} casts`,
				);
				return undefined;
			}
		}
		if (!cast) {
			console.error(
				`getCastFromUri: Cast not found for username: ${username} and shortHash: ${shortHash}`,
			);
			return undefined;
		}

		const user = await getUserByFid(fid);
		const channelId = cast.parentUrl
			? getChannelIdFromUrl(cast.parentUrl)
			: undefined;
		const channel = channelId ? await getChannel(channelId) : undefined;

		return {
			success: true,
			cast: { ...cast, user, channel },
		};
	},
	{
		params: t.Object({
			username: t.String(),
			shortHash: t.String(),
		}),
		detail: {
			tags: ["Cast"],
			summary: "Get a cast by username and short hash",
			responses: {
				200: {
					description: "Returns a cast",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								cast: CastSchema,
							}),
						},
					},
				},
			},
		},
	},
);
