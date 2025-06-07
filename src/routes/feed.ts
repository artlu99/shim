import { Elysia, t } from "elysia";
import { sift } from "radash";
import { getCastById, rawChannelFeed } from "../lib/hub-grpc";
import { getSentFromBySignerKey, getUserByFid } from "../lib/hydration";
import { getReverseChronFeed } from "../lib/postgres";
import redis, { Ttl } from "../lib/redis";
import {
	getChannel,
	getChannelBannedUsers,
	getChannelIdFromUrl,
} from "../lib/warpcast";
import { type Cast, CastSchema, type HydratedCast } from "../types";
import { FEED_DEFAULT_PAGE_SIZE } from "./../constants";

const hydrateCast = async (cast: Cast): Promise<HydratedCast> => {
	const user = await getUserByFid(cast.fid);
	const channelId = cast?.parentUrl
		? getChannelIdFromUrl(cast.parentUrl)
		: undefined;
	const channel = channelId ? await getChannel(channelId) : undefined;
	const sentBy = await getSentFromBySignerKey(cast.signer);

	return {
		...cast,
		user,
		channel,
		sentBy,
	};
};

async function fetchAndHydrateFeed(
	channelId: string,
	channelUrl: string,
	limit: number,
): Promise<HydratedCast[]> {
	const bannedUsers = await getChannelBannedUsers(channelId);
	const bannedUserFids = bannedUsers.map((bu) => bu.fid);
	const { casts } = await rawChannelFeed(channelUrl, limit);

	const filteredCasts = casts.filter(
		(cast) => !bannedUserFids.includes(cast.fid),
	);

	return Promise.all(filteredCasts.map(hydrateCast));
}

export const postReverseChronFeed = new Elysia().post(
	"/reverse-chron",
	async ({ body }) => {
		const { fids, limit = 10, cursor } = body;
		if (!fids || fids.length === 0) {
			return {
				success: false,
				error: "Fids are required",
			};
		}
		const { items: feedIdentifiers, nextCursor } = await getReverseChronFeed(
			fids,
			limit,
			cursor,
		);

		const feed: HydratedCast[] = sift(
			await Promise.all(
				feedIdentifiers.map(async (fi) => {
					const cast = await getCastById(
						fi.fid,
						`0x${fi.hash.replace("0x", "")}`,
					);
					if (!cast) {
						return undefined;
					}
					const user = await getUserByFid(fi.fid);
					const channelId = cast?.parentUrl
						? getChannelIdFromUrl(cast.parentUrl)
						: undefined;
					const channel = channelId ? await getChannel(channelId) : undefined;

					const sentBy = await getSentFromBySignerKey(cast.signer);

					const hydratedCast: HydratedCast = {
						...cast,
						user,
						channel,
						sentBy,
					};
					return hydratedCast;
				}),
			),
		);

		return {
			success: true,
			casts: feed,
			cursor: nextCursor,
		};
	},
	{
		body: t.Object({
			fids: t.Array(t.Number()),
			limit: t.Optional(t.Number({ default: 10 })),
			cursor: t.Optional(t.String()),
		}),
		detail: {
			tags: ["Feed"],
			summary: "Reverse chron feed",
			responses: {
				200: {
					description: "Returns a reverse chronological feed",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								casts: t.Array(CastSchema),
								cursor: t.Optional(t.String()),
							}),
						},
					},
				},
			},
		},
	},
);

export const getReverseChronChannelFeed = new Elysia().get(
	"/channel/:channelId/reverse-chron",
	async ({ params: { channelId, limit = FEED_DEFAULT_PAGE_SIZE } }) => {
		if (!channelId) {
			return {
				success: false,
				error: "Channel id is required",
			};
		}
		const channel = await getChannel(channelId);
		if (!channel) {
			return {
				success: false,
				error: "Unable to map channelId to Channel",
			};
		}

		const cacheClient = redis();
		const cacheKey = `channelFeed:${channelId}:${limit}`;

		// Get cached data if available
		const cacheResponse = await cacheClient.get(cacheKey);
		let feed: HydratedCast[] = cacheResponse
			? (cacheResponse as HydratedCast[])
			: [];

		// If we have cached data, trigger background revalidation
		if (cacheResponse) {
			// Fire and forget background revalidation
			(async () => {
				try {
					const freshFeed = await fetchAndHydrateFeed(
						channelId,
						channel.url,
						limit,
					);
					await cacheClient.set(cacheKey, JSON.stringify(freshFeed), {
						ex: Ttl.FEED,
					});
				} catch (error) {
					console.error("Background revalidation failed:", error);
				}
			})();

			return {
				success: true,
				casts: feed,
				cursor: undefined,
				stale: true,
			};
		}

		// If no cache, fetch fresh data
		feed = await fetchAndHydrateFeed(channelId, channel.url, limit);
		await cacheClient.set(cacheKey, JSON.stringify(feed), { ex: Ttl.FEED });

		return {
			success: true,
			casts: feed,
			cursor: undefined,
			stale: false,
		};
	},
	{
		params: t.Object({
			channelId: t.String(),
			limit: t.Optional(t.Number({ default: FEED_DEFAULT_PAGE_SIZE })),
		}),
		detail: {
			tags: ["Feed"],
			summary: "Channel feed (unfiltered)",
			responses: {
				200: {
					description:
						"Returns a reverse chronological feed of all casts in channel",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								casts: t.Array(CastSchema),
								cursor: t.Optional(t.String()),
								stale: t.Boolean(),
							}),
						},
					},
				},
			},
		},
	},
);
