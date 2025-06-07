import { Elysia, t } from "elysia";
import { URI_SEARCH_LOOKBACK } from "../constants";
import { getFidByUsername } from "../lib/fsu";
import { getCastById, getCastsByFid } from "../lib/hub-grpc";
import { getUserByFid } from "../lib/hydration";
import { getCastByShortHash } from "../lib/postgres";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { type Cast, CastSchema } from "../types";

export const getCastByWarpcastUri = new Elysia().get(
	"/wc/:username/:shortHash",
	async ({ params: { username, shortHash } }) => {
		const fid = await getFidByUsername(username);
		if (!fid) {
			return {
				success: false,
				error: "getFidByUsername: Username not found",
			};
		}

		let cast: Cast | undefined;
		const castDbObj = await getCastByShortHash(shortHash);
		if (castDbObj) {
			cast = await getCastById(fid, castDbObj.hash as `0x${string}`);
		} else {
			const { casts } = await getCastsByFid(fid, URI_SEARCH_LOOKBACK);
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
