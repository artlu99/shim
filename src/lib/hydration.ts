import {
	HTTP_FAN_OUT_BATCH_SIZE,
	REMEMBERED_USER_MAX_ENTRIES,
} from "../constants";
import type { User } from "../types";
import { getUserInEitherWorld, getUserPrimaryAddress } from "./hub-api";
import redis, { Ttl } from "./redis";
import { mapBatch } from "./util";

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

// Best knowledge of a fid for this process, kept for the same four hours
// as user:${fid}. A resolved profile lands here even when the lmdis write
// times out — otherwise the next mention misses, asks Hypersnap again,
// and a page of casts that share an author becomes one write per cast.
// Capped like HotCache: a wide feed / mention storm must not retain
// unbounded profiles in-process for the TTL.
const USER_MEMORY_MS = Ttl.MEDIUM * 1000;
const remembered = new Map<number, { user: User; until: number }>();

const rememberedUser = (fid: number): User | undefined => {
	const entry = remembered.get(fid);
	if (!entry) {
		return undefined;
	}
	if (Date.now() >= entry.until) {
		remembered.delete(fid);
		return undefined;
	}
	// Map insertion order is recency — re-insert on hit so eviction drops LRU
	remembered.delete(fid);
	remembered.set(fid, entry);
	return entry.user;
};

const evictRemembered = () => {
	const now = Date.now();
	for (const [fid, entry] of remembered) {
		if (now >= entry.until) {
			remembered.delete(fid);
		}
		if (remembered.size < REMEMBERED_USER_MAX_ENTRIES) {
			return;
		}
	}
	const oldest = remembered.keys().next();
	if (!oldest.done) {
		remembered.delete(oldest.value);
	}
};

const rememberUser = (user: User) => {
	remembered.delete(user.fid);
	if (remembered.size >= REMEMBERED_USER_MAX_ENTRIES) {
		evictRemembered();
	}
	remembered.set(user.fid, { user, until: Date.now() + USER_MEMORY_MS });
};

// Tests share this process. A profile remembered by one case must not
// answer the next.
export const clearRememberedUsers = () => {
	remembered.clear();
};

export const getUserByFid = async (fid: number): Promise<User> => {
	const known = rememberedUser(fid);
	if (known) {
		return stripLegacyProNft(known);
	}

	const pending = inFlight.get(fid);
	if (pending) {
		return stripLegacyProNft(await pending);
	}

	const fetchUser = (async (): Promise<User> => {
		try {
			const cachedUser = await redis().get<unknown>(`user:${fid}`);
			if (isCachedUser(cachedUser)) {
				return stripLegacyProNft(cachedUser);
			}
		} catch (error) {
			console.error(
				"Error reading user cache for fid:",
				fid,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}

		// Primary address is hub-derived (first verified ETH address on
		// either world — Hypersnap primary, Snapchain on miss/outage).
		// getUserInEitherWorld throws on a native-fid Hypersnap outage so
		// direct callers can 503; here we soft-degrade to a blank uncached
		// profile so mention hydration does not abort a whole cast page.
		const [hubUser, primaryAddress] = await Promise.all([
			getUserInEitherWorld(fid).catch((error) => {
				console.error(
					"getUserByFid: user lookup outage:",
					fid,
					error instanceof Error ? error.message : JSON.stringify(error),
				);
				return undefined;
			}),
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
		// The process-local copy is taken before the lmdis write: a timeout
		// there must not forget a profile we already resolved.
		if (hubUser && primaryAddress !== undefined) {
			rememberUser(user);
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
			// either-world best knowledge, one flight per fid. A page of
			// casts that mention the same author shares this lookup instead
			// of each opening the raw Hypersnap documents.
			const user = await getUserByFid(mention);
			return user.username ?? "<unknown>";
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
