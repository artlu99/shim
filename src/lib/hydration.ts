import { HTTP_FAN_OUT_BATCH_SIZE } from "../constants";
import type { User } from "../types";
import { getUserInEitherWorld } from "./hub-api";
import redis, { Ttl } from "./redis";
import { mapBatch } from "./util";
import { getUserPrimaryAddress } from "./warpcast";

// Drop legacy user.proNft from Redis hits written before the field was removed.
// Also used for nested users inside channelFeed:* cache entries.
export const stripLegacyProNft = (
	user: User & { proNft?: unknown },
): User => {
	const { proNft: _removed, ...rest } = user;
	return rest;
};

// lmdis returns the raw string when JSON.parse fails, so verify the
// minimal shape before trusting a cache hit
const isCachedUser = (value: unknown): value is User =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as User).fid === "number";

// coalesce concurrent misses for the same fid into a single fetch
const inFlight = new Map<number, Promise<User>>();

export const getUserByFid = async (fid: number): Promise<User> => {
	const pending = inFlight.get(fid);
	if (pending) {
		return stripLegacyProNft(await pending);
	}

	const fetchUser = (async (): Promise<User> => {
		try {
			const cachedUser = await redis().get<unknown>(`user:${fid}`);
			if (isCachedUser(cachedUser)) {
				return cachedUser;
			}
		} catch (error) {
			console.error(
				"Error reading user cache for fid:",
				fid,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}

		const [hubUser, primaryAddress] = await Promise.all([
			getUserInEitherWorld(fid),
			getUserPrimaryAddress(fid),
		]);

		const user: User = {
			fid,
			username: hubUser?.username ?? null,
			// Stale lmdis entries predate these fields — degrade to null/[],
			// never pretend the hub answered.
			fname: hubUser?.fname ?? null,
			attestations: hubUser?.attestations ?? [],
			displayName: hubUser?.displayName ?? null,
			pfpUrl: hubUser?.pfpUrl ?? null,
			bio: hubUser?.bio ?? null,
			primaryAddress: primaryAddress?.address ?? null,
		};

		// undefined hub user and undefined primary address are fetch failures
		// (a real "no address" result is null). Leave those uncached so the
		// next call retries instead of pinning a blank profile for the TTL.
		if (hubUser && primaryAddress !== undefined) {
			try {
				await redis().set(`user:${fid}`, JSON.stringify(user), {
					ex: Ttl.MEDIUM,
				});
			} catch (error) {
				console.error(
					"Error writing user cache for fid:",
					fid,
					error instanceof Error ? error.message : JSON.stringify(error),
				);
			}
		}

		return user;
	})();

	inFlight.set(fid, fetchUser);

	try {
		return stripLegacyProNft(await fetchUser);
	} finally {
		inFlight.delete(fid);
	}
};

export const getSentFromBySignerKey = async (signerKey: `0x${string}`) => {
	if (!signerKey) {
		return undefined;
	}
	if (
		signerKey ===
		"0x0e10fec94a39c27f6ea39191b310c13c53cb8f6be209b3c48d7278f6688df603"
	) {
		return "neynar";
	}
	if (
		signerKey ===
		"0xc6dab75cc8e1d720a6f8a9aff8c6ae2eb48e5442b3a863b88413331dbde6c206"
	) {
		return "artlu";
	}
	if (
		signerKey ===
		"0x4d25071459be1161bbeb299cecac7668bb04f6009e00498e3606e0839d31e064"
	) {
		return "recaster-fc";
	}
	if (
		signerKey ===
		"0xba30336ba6bed65f11b79a0d5c8f78885b614b95386fcb3734f0d6aa2cb7ea1f"
	) {
		return "warpcast";
	}
	return null;
};

export const hydrateText = async (
	text: string | null,
	mentions: number[] | null,
	mentionsPositions: number[] | null,
): Promise<string | null> => {
	if (!text) {
		return null;
	}

	const usernameMentions = await mapBatch(
		mentions ?? [],
		async (mention) => {
			// fork-aware: a mentioned user may exist only in either world
			const user = await getUserInEitherWorld(mention);
			return user?.username ?? "<unknown>";
		},
		HTTP_FAN_OUT_BATCH_SIZE,
	);

	const byteArray = new TextEncoder().encode(text);
	const pieces: string[] = [];
	let lastIndex = 0;

	// Sort mentions positions to process them in order
	const sortedMentionPositions = [...(mentionsPositions ?? [])].sort(
		(a, b) => a - b,
	);

	// Process each mention position
	for (const mentionPos of sortedMentionPositions) {
		// Add text before the mention
		if (mentionPos > lastIndex) {
			const textBeforeMention = new TextDecoder().decode(
				byteArray.slice(lastIndex, mentionPos),
			);
			pieces.push(textBeforeMention);
		}

		// Add the mention
		const mentionIndex = (mentionsPositions ?? []).indexOf(mentionPos);
		pieces.push(`@${usernameMentions?.[mentionIndex]} `);

		lastIndex = mentionPos + 1;
	}

	// Add any remaining text after the last mention
	if (lastIndex < byteArray.length) {
		const remainingText = new TextDecoder().decode(byteArray.slice(lastIndex));
		pieces.push(remainingText);
	}

	const hydratedText = pieces.join("");

	return hydratedText;
};
