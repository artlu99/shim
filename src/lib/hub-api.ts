import { fetcher } from "itty-fetcher";
import { retry, sift } from "radash";
import { VERBOSE_LOGGING } from "../constants";
import type { User } from "../types";
import type {
	CastAddMessage,
	LinkAddMessage,
	PaginatedMessagesResponse,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
} from "./farcaster-types";
import redis, { Ttl } from "./redis";

const hub = () => {
	// 20260905 pop.farcaster.xyz and pow.farcaster.xyz are down
	// snap.farcaster.xyz and crackle.farcaster.xyz are working
	VERBOSE_LOGGING && console.log("using crackle.farcaster.xyz");
	return fetcher({
		base: "https://crackle.farcaster.xyz:3381",
		headers: { accept: "application/json" },
	});
};

const cachedFetcherGet = async <T>(uri: string, ttl: Ttl) => {
	const cacheClient = redis();
	const cacheKey = `hub:${uri}`;

	const cacheResponse = await cacheClient.get(cacheKey);

	if (cacheResponse) {
		return cacheResponse as T;
	}

	const res = await retry(
		{ backoff: (i) => 10 ** i },
		async () => await hub().get(uri),
	);

	await cacheClient.set(cacheKey, JSON.stringify(res), { ex: ttl });

	return res as T;
};

async function cachedFetcherPaginatedGet<T>(
	baseUri: string,
	ttl: Ttl,
	pageSize = 100,
	maxPages = 10,
	shortCircut?: { key: string; value?: string },
) {
	const cacheClient = redis();
	// pageSize/maxPages are part of the key so a capped fetch cannot poison
	// the cache for full fetches of the same uri
	const cacheKey = `hub:${baseUri}:${pageSize}:${maxPages}`;

	const cacheResponse = await cacheClient.get(cacheKey);

	if (cacheResponse) {
		return cacheResponse as T[];
	}

	const messages: T[] = [];
	let nextPageToken: string | undefined;

	for (let i = 0; i < maxPages; i++) {
		const uri = `${baseUri}${baseUri.includes("?") ? "&" : "?"}pageSize=${pageSize}${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`;
		const res = await retry(
			{ backoff: (i) => 10 ** i },
			async () => await hub().get<PaginatedMessagesResponse<T>>(uri),
		);

		if (res.messages.length === 0) {
			break;
		}

		if (shortCircut) {
			const shortCircutMessage = res.messages.find((m) => {
				if (shortCircut.key === "hash") {
					const message = m as unknown as CastAddMessage;
					const messageHash = message.hash as unknown as `0x${string}`;
					return shortCircut.value && messageHash.startsWith(shortCircut.value);
				}
				return m[shortCircut.key as keyof T] === shortCircut.value;
			});
			if (shortCircutMessage) {
				messages.push(shortCircutMessage);
				break;
			}
		}

		messages.push(...res.messages);
		nextPageToken = res.nextPageToken;
		if (!nextPageToken) {
			break;
		}
	}

	if (shortCircut === undefined) {
		try {
			await cacheClient.set(cacheKey, JSON.stringify(messages), { ex: ttl });
		} catch (error) {
			console.error(
				"Error caching paginated get:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}
	}

	return messages;
}

export const getHubFidByUsername = async (
	username: string,
): Promise<number | undefined> => {
	try {
		// typing is a white lie because it was deserialized over http
		const res = await cachedFetcherGet<UserNameProof>(
			`/v1/userNameProofByName?name=${username}`,
			Ttl.LONG,
		);
		const fid = res.fid;
		return fid;
	} catch (error) {
		console.error(
			"Error fetching fid by username:",
			username,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return undefined;
	}
};

/**
 * Split the fid's username proofs into the USERNAME, the PRIMARY name and
 * its ATTESTATIONS (identity law, 2026-10-27 forkcaster profile rethink):
 * username is the NEWEST proof of any type — the historical /user/{fid}
 * contract (proofs[0] under reverse=true). fname is the account's primary
 * handle — the NEWEST fname proof, one per fid (an older fname may have
 * transferred away) — while any number of ENS names (L1 or L2/basenames)
 * are verified attestations, displayed alongside the primary and never
 * load-bearing. The input arrives deserialized over http (typing is a
 * white lie); the node answers with duplicate rows (measured: dwr/fid 3
 * carries the same fname proof twice), so names are deduped. Its row
 * order is NOT timestamp-sorted (measured, with or without reverse=true),
 * so rows are sorted NEWEST-FIRST here — stable: timestamp ties keep node
 * order — and every field is deterministic regardless of the node.
 */
export const splitUsernameProofs = (
	proofs: UserNameProof[] | undefined,
): {
	username: string | null;
	fname: string | null;
	attestations: string[];
} => {
	// timestamp is typed number but arrives over http — treat non-numbers
	// as 0; the index tiebreak keeps ties in node answer order.
	const rows = (proofs ?? [])
		.map(
			(proof) =>
				proof as unknown as {
					name?: unknown;
					type?: unknown;
					timestamp?: unknown;
				},
		)
		.map((row, i) => ({
			row,
			i,
			ts: typeof row.timestamp === "number" ? row.timestamp : 0,
		}))
		.sort((a, b) => b.ts - a.ts || a.i - b.i);
	const seen = new Set<string>();
	const fnames: string[] = [];
	const attestations: string[] = [];
	let username: string | null = null;
	for (const { row } of rows) {
		if (typeof row.name !== "string" || row.name === "" || seen.has(row.name))
			continue;
		seen.add(row.name);
		if (username === null) username = row.name;
		// protobuf JSON serializes the enum as its name string; accept the
		// numeric form too (1 = USERNAME_TYPE_FNAME). A non-fname proof is
		// an attestation by definition — verified, attached, decorative.
		const isFname = row.type === "USERNAME_TYPE_FNAME" || row.type === 1;
		(isFname ? fnames : attestations).push(row.name);
	}
	return { username, fname: fnames[0] ?? null, attestations };
};

export const getHubUserByFid = async (
	fid: number,
): Promise<User | undefined> => {
	try {
		// typing is a white lie because it was deserialized over http
		const res0 = await cachedFetcherGet<{ proofs: UserNameProof[] }>(
			`/v1/userNameProofsByFid?fid=${fid}&reverse=true`,
			Ttl.LONG,
		);
		const { username, fname, attestations } = splitUsernameProofs(
			res0.proofs,
		);

		if (!username) {
			return undefined;
		}

		const res = await cachedFetcherGet<
			PaginatedMessagesResponse<UserDataAddMessage>
		>(`/v1/userDataByFid?fid=${fid}&reverse=true`, Ttl.MEDIUM);

		const displayName =
			res?.messages.find(
				// @ts-expect-error the typing is a white lie because it was deserialized over http
				(m) => m.data.userDataBody.type === "USER_DATA_TYPE_DISPLAY",
			)?.data.userDataBody.value ?? null;

		const pfpUrl =
			res?.messages.find(
				// @ts-expect-error the typing is a white lie because it was deserialized over http
				(m) => m.data.userDataBody.type === "USER_DATA_TYPE_PFP",
			)?.data.userDataBody.value ?? null;

		const bio =
			res?.messages.find(
				// @ts-expect-error the typing is a white lie because it was deserialized over http
				(m) => m.data.userDataBody.type === "USER_DATA_TYPE_BIO",
			)?.data.userDataBody.value ?? null;

		const userBeforeOffHubHydration: User = {
			fid,
			username,
			fname,
			attestations,
			displayName,
			pfpUrl,
			bio,
			primaryAddress: null,
			proNft: null,
		};

		return userBeforeOffHubHydration;
	} catch (error) {
		console.error(
			"Error fetching username by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return undefined;
	}
};

export const getUsernameByFid = async (
	fid: number,
): Promise<string | undefined> => {
	const user = await getHubUserByFid(fid);
	// Identity law (2026-10-27): the fname is the primary handle — /u
	// answers it first, falling back to the newest-proof username.
	const username = user?.fname ?? user?.username ?? undefined;

	return username;
};

export const getFollowingByFid = async (
	fid: number,
	maxPages = 10,
): Promise<number[]> => {
	try {
		const res = await cachedFetcherPaginatedGet<LinkAddMessage>(
			`/v1/linksByFid?fid=${fid}&reverse=false&link_type=follow`,
			Ttl.FEED,
			1000,
			maxPages,
		);
		return sift(res.map((m) => m.data.linkBody.targetFid));
	} catch (error) {
		console.error(
			"Error fetching following by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return [];
	}
};

export const getSignersByFid = async (
	fid: number,
	signer: string,
): Promise<
	| {
			chainId: number | undefined;
			timestamp: number | undefined;
			humanReadableTimestamp: string | undefined;
			txnHash: Uint8Array<ArrayBufferLike> | undefined;
	  }
	| undefined
> => {
	try {
		const res = await cachedFetcherGet<{ events: SignerOnChainEvent[] }>(
			`/v1/onChainSignersByFid?fid=${fid}`,
			Ttl.LONG,
		);
		const matchedEvent = res.events.find((e) => {
			const key = e.signerEventBody.key as unknown as `0x${string}`;
			return key === signer;
		});
		const timestampStr = new Date(
			(matchedEvent?.blockTimestamp ?? 0) * 1000,
		).toISOString();
		return {
			chainId: matchedEvent?.chainId,
			timestamp: matchedEvent?.blockTimestamp,
			humanReadableTimestamp: timestampStr,
			txnHash: matchedEvent?.transactionHash,
		};
	} catch (error) {
		console.error(
			"Error fetching signers by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return undefined;
	}
};

export const getStorageByFid = async (fid: number) => {
	try {
		const res = await cachedFetcherGet<{
			limits: {
				storeType:
					| "Casts"
					| "Links"
					| "Reactions"
					| "UserData"
					| "Verifications"
					| "UsernameProofs";
				name:
					| "CASTS"
					| "LINKS"
					| "REACTIONS"
					| "USER_DATA"
					| "VERIFICATIONS"
					| "USERNAME_PROOFS";
				limit: number;
				used: number;
				earliestTimestamp: number;
				earliestHash: string[];
			}[];
			units: number;
			unitDetails: {
				unitType: "UnitTypeLegacy" | "UnitType2024";
				unitSize: number;
			}[];
			tierDetails: {
				tierType: "TierTypeNone" | "TierTypePro";
				expires_at: number;
			}[];
		}>(`/v1/storageLimitsByFid?fid=${fid}`, Ttl.MEDIUM);
		return {
			limits: res.limits,
			units: res.units,
			unitDetails: res.unitDetails,
		};
	} catch (error) {
		console.error(
			"Error fetching storage by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return undefined;
	}
};
