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
	// snap, crackle, pop, pow
	VERBOSE_LOGGING && console.log("using pop.farcaster.xyz");
	return fetcher({
		base: "https://pop.farcaster.xyz:3381",
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
	const cacheKey = `hub:${baseUri}`;

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

export const getHubFidByUsername = async (username: string) => {
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
}

export const getHubUserByFid = async (fid: number) => {
	try {
		// typing is a white lie because it was deserialized over http
		const res0 = await cachedFetcherGet<{ proofs: UserNameProof[] }>(
			`/v1/userNameProofsByFid?fid=${fid}&reverse=true`,
			Ttl.LONG,
		);
		const username = res0.proofs?.[0]?.name
			? (res0.proofs[0].name as unknown as string)
			: undefined;

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

export const getUsernameByFid = async (fid: number) => {
	const user = await getHubUserByFid(fid);
	const username = user?.username ?? undefined;

	return username;
};

export const getFollowingByFid = async (fid: number) => {
	try {
		const res = await cachedFetcherPaginatedGet<LinkAddMessage>(
			`/v1/linksByFid?fid=${fid}&reverse=false&link_type=follow`,
			Ttl.FEED,
			1000,
			10,
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

export const getSignersByFid = async (fid: number, signer: string) => {
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
