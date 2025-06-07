import { fetcher } from "itty-fetcher";
import { retry } from "radash";
import type { Hex } from "viem";
import { exceptions } from "../static/channel-exceptions";
import type { Channel } from "../types";
import redis, { Ttl } from "./redis";

const warpcastApi = fetcher({ base: "https://api.farcaster.xyz" });

export interface FullChannel {
	id: string;
	url: string;
	name: string;
	description: string;
	descriptionMentions: number[];
	descriptionMentionsPositions: number[];
	imageUrl?: string;
	headerImageUrl?: string;
	leadFid: number;
	moderatorFids: number[];
	createdAt: number;
	followerCount: number;
	memberCount: number;
	pinnedCastHash?: string;
	publicCasting: boolean;
	externalLink?: {
		title: string;
		url: string;
	};
}
interface ChannelWarpcastApiResponse {
	result: { channel: FullChannel };
}

export interface ChannelBannedUser {
	fid: number;
	channelId: string;
	bannedAt: number;
}
interface ChannelBannedUserWarpcastApiResponse {
	result: { bannedUsers: ChannelBannedUser[] };
	next: { cursor: string };
}

const cachedFetcherGet = async <T>(uri: string, ttl: Ttl) => {
	const cacheClient = redis();
	const cacheKey = `warpcast:${uri}`;

	const cacheResponse = await cacheClient.get(cacheKey);

	if (cacheResponse) {
		return cacheResponse as T;
	}

	const res = await retry({ backoff: (i) => 10 ** i }, async () => {
		try {
			return await warpcastApi.get(uri);
		} catch (error) {
			// If it's a 404, cache null and return it
			if (error instanceof Error && "status" in error && error.status === 404) {
				await cacheClient.set(cacheKey, JSON.stringify(null), { ex: ttl });
				return null;
			}
			// For other errors, let retry handle it
			throw error;
		}
	});

	await cacheClient.set(cacheKey, JSON.stringify(res), { ex: ttl });

	return res as T;
};

export const getUserPrimaryAddress = async (fid: number) => {
	try {
		const res = await cachedFetcherGet<{
			result: {
				address: {
					fid: number;
					protocol: "ethereum";
					address: Hex;
				};
			};
		}>(`/fc/primary-address?fid=${fid}&protocol=ethereum`, Ttl.MEDIUM);

		return res?.result?.address ?? null;
	} catch (error) {
		console.error(
			"Error fetching user primary address for fid:",
			fid,
			error instanceof Error ? error : JSON.stringify(error),
		);
		return undefined;
	}
};

export const getChannel = async (
	channelId: string,
): Promise<Channel | undefined> => {
	if (!channelId) {
		return undefined;
	}

	try {
		const res = await cachedFetcherGet<ChannelWarpcastApiResponse>(
			`/v1/channel?channelId=${channelId}`,
			Ttl.LONG,
		);

		const fullChannel = res.result.channel;

		return fullChannel
			? {
					id: fullChannel.id,
					url: fullChannel.url,
					name: fullChannel.name,
					imageUrl: fullChannel.imageUrl,
				}
			: undefined;
	} catch (error) {
		console.error(
			"Error fetching channel:",
			channelId,
			error instanceof Error ? error : JSON.stringify(error),
		);
		return undefined;
	}
};

export const getChannelIdFromUrl = (url: string | null): string | undefined => {
	// later nomenclature
	if (url?.startsWith("https://farcaster.xyz/~/channel/")) {
		return url.split("https://farcaster.xyz/~/channel/")[1];
	}
	if (url?.startsWith("https://warpcast.com/~/channel/")) {
		return url.split("https://warpcast.com/~/channel/")[1];
	}

	// earliest nomenclature
	if (url?.startsWith("https://farcaster.group/")) {
		return url.split("https://farcaster.group/")[1];
	}

	// 99 known exceptions
	const channel = exceptions.find((e: { url: string }) => url === e.url);
	if (channel) {
		return channel.channelId;
	}

	return undefined;
};

export const getChannelBannedUsers = async (channelId: string) => {
	// this is not paginated (yet)
	try {
		const res = await cachedFetcherGet<ChannelBannedUserWarpcastApiResponse>(
			`/fc/channel-bans?channelId=${channelId}`,
			Ttl.MEDIUM,
		);
		return res.result.bannedUsers;
	} catch (error) {
		console.error(
			"Error fetching channel banned users:",
			channelId,
			error instanceof Error ? error : JSON.stringify(error),
		);
		throw error;
	}
};
