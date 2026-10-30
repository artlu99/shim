import { fetcher } from "itty-fetcher";
import { retry } from "radash";
import type { Hex } from "viem";
import { exceptions } from "../static/channel-exceptions";
import type { Channel } from "../types";
import redis, { Ttl } from "./redis";

const warpcastApi = fetcher({ base: "https://api.farcaster.xyz" });

// Same attribution scheme as hub-api's hubFailure: cache-leg failures carry
// the "lmdis:" prefix and hub calls are labeled "hub <uri>", so
// api.farcaster.xyz failures are labeled "warpcast <uri>" — making any
// route-level catch self-identifying about which upstream leg threw
// (2026-10-30 incident logged both legs as bare "Failed to parse JSON").
// itty-fetcher's errors are not Error instances in this runtime, so status
// is sniffed off any object shape.
const warpcastFailure = (uri: string, error: unknown): Error => {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? ` [${String((error as { status: unknown }).status)}]`
			: "";
	if (error instanceof Error) {
		error.message = `warpcast ${uri}${status}: ${error.message}`;
		return error;
	}
	return new Error(`warpcast ${uri}${status}: ${JSON.stringify(error)}`);
};

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

// lmdis cannot distinguish an absent key from a cached JSON null (both
// deserialize to null, and the miss check is truthiness), so not-found is
// cached as a sentinel object — a plain null write was never honored on read
const NOT_FOUND = { warpcast404: true } as const;

const cachedFetcherGet = async <T>(uri: string, ttl: Ttl) => {
	const cacheClient = redis();
	const cacheKey = `warpcast:${uri}`;

	const cacheResponse = await cacheClient.get(cacheKey);

	if (cacheResponse !== null && cacheResponse !== undefined) {
		if (
			typeof cacheResponse === "object" &&
			"warpcast404" in (cacheResponse as object)
		) {
			return null;
		}
		return cacheResponse as T;
	}

	const res = await retry({ backoff: (i) => 10 ** i }, async () => {
		try {
			return await warpcastApi.get(uri);
		} catch (error) {
			// 404 = "not found" (no primary address, no channel): cache the
			// sentinel and return null. itty-fetcher's errors are NOT Error
			// instances in this runtime (AGENTS.md), so the original
			// `error instanceof Error` form never engaged — every miss
			// retried 4x, was left uncached, and refetched on every request.
			// Detect via the status property.
			if (
				typeof error === "object" &&
				error !== null &&
				"status" in error &&
				(error as { status: unknown }).status === 404
			) {
				await cacheClient.set(cacheKey, NOT_FOUND, { ex: ttl });
				return null;
			}
			// For other errors, label the warpcast leg and let retry handle it
			throw warpcastFailure(uri, error);
		}
	});

	// res === null only via the 404 branch, which already cached the
	// sentinel — a plain null write here would never be honored on read
	if (res !== null) {
		await cacheClient.set(cacheKey, JSON.stringify(res), { ex: ttl });
	}

	return res as T;
};

export interface PrimaryAddress {
	fid: number;
	protocol: "ethereum";
	address: Hex;
}

// null = successful lookup with no address (404 is cached);
// undefined = the lookup itself failed
export const getUserPrimaryAddress = async (
	fid: number,
): Promise<PrimaryAddress | null | undefined> => {
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

		const fullChannel = res?.result?.channel;

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
		// null = cached not-found (404): a channel that does not exist has
		// no banned users
		return res?.result?.bannedUsers ?? [];
	} catch (error) {
		console.error(
			"Error fetching channel banned users:",
			channelId,
			error instanceof Error ? error : JSON.stringify(error),
		);
		throw error;
	}
};
