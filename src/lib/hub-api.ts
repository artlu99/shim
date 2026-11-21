import { fetcher } from "itty-fetcher";
import { retry, sift } from "radash";
import { HAATZ_GATEWAY_ENDPOINT } from "../constants";
import type { User } from "../types";
import type { Hex } from "viem";
import type {
	CastAddMessage,
	LinkAddMessage,
	PaginatedMessagesResponse,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
	VerificationAddAddressMessage,
} from "./farcaster-types";
import { getHaatzProfileByFid } from "./hypersnap";
import redis, { Ttl } from "./redis";
import { isNativeFid, parseGatewayFid } from "./util";

const hub = () => {
	// 20260905 pop.farcaster.xyz and pow.farcaster.xyz are down
	// snap.farcaster.xyz and crackle.farcaster.xyz are working
	return fetcher({
		base: "https://crackle.farcaster.xyz:3381",
		headers: { accept: "application/json" },
	});
};

// Attribute hub-call failures at the source: cache-leg errors carry an
// "lmdis:" prefix from LmdisClient, so anything else reaching a route-level
// catch is the hub call itself — including bare "Failed to parse JSON" from
// a 2xx response with a corrupt body (indistinguishable from a cache outage
// in the 2026-10-30 logs). itty-fetcher attaches .status to its errors, but
// in this runtime they are NOT Error instances (AGENTS.md note), so status
// is sniffed off any object shape — the [200]-vs-[4xx] tell is the point.
const hubFailure = (uri: string, error: unknown): Error => {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? ` [${String((error as { status: unknown }).status)}]`
			: "";
	if (error instanceof Error) {
		error.message = `hub ${uri}${status}: ${error.message}`;
		return error;
	}
	return new Error(`hub ${uri}${status}: ${JSON.stringify(error)}`);
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
		async () => {
			try {
				return await hub().get(uri);
			} catch (error) {
				throw hubFailure(uri, error);
			}
		},
	);

	await cacheClient.set(cacheKey, JSON.stringify(res), { ex: ttl });

	return res as T;
};

// The haatz node serves the same /v1 gateway surface on 443 (see
// constants.ts). User identity lives in both worlds under the fork — a
// Hypersnap-only account has no crackle answer — so user hydration needs
// the same dual-world treatment casts got. Cache keys are haatz:-prefixed:
// the two networks disagree, and one key must not serve the other's
// answer. Cache-leg failures degrade to uncached (same as getCastById);
// gateway failures THROW — the fork-aware caller owns miss-vs-outage.
const haatz = () =>
	fetcher({
		base: HAATZ_GATEWAY_ENDPOINT,
		headers: { accept: "application/json" },
	});

const cachedHaatzGet = async <T>(uri: string, ttl: Ttl) => {
	let cacheResponse: unknown;
	try {
		cacheResponse = await redis().get(`haatz:${uri}`);
	} catch (error) {
		console.error(
			"Error reading haatz cache:",
			uri,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	if (cacheResponse) {
		return cacheResponse as T;
	}

	const res = await retry(
		{ backoff: (i) => 10 ** i },
		async () => {
			try {
				return await haatz().get<T>(uri);
			} catch (error) {
				throw hubFailure(uri, error);
			}
		},
	);

	try {
		await redis().set(`haatz:${uri}`, JSON.stringify(res), { ex: ttl });
	} catch (error) {
		console.error(
			"Error writing haatz cache:",
			uri,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	return res as T;
};

async function cachedPaginatedGet<T>(
	prefix: "hub" | "haatz",
	getPage: (uri: string) => Promise<PaginatedMessagesResponse<T>>,
	baseUri: string,
	ttl: Ttl,
	pageSize = 100,
	maxPages = 10,
	shortCircut?: { key: string; value?: string },
) {
	const cacheClient = redis();
	// pageSize/maxPages are part of the key so a capped fetch cannot poison
	// the cache for full fetches of the same uri
	const cacheKey = `${prefix}:${baseUri}:${pageSize}:${maxPages}`;

	let cacheResponse: unknown;
	try {
		cacheResponse = await cacheClient.get(cacheKey);
	} catch (error) {
		console.error(
			`Error reading ${prefix} paginated cache:`,
			baseUri,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	if (cacheResponse) {
		return cacheResponse as T[];
	}

	const messages: T[] = [];
	let nextPageToken: string | undefined;

	for (let i = 0; i < maxPages; i++) {
		const uri = `${baseUri}${baseUri.includes("?") ? "&" : "?"}pageSize=${pageSize}${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`;
		const res = await retry({ backoff: (i) => 10 ** i }, async () => {
			try {
				return await getPage(uri);
			} catch (error) {
				throw hubFailure(uri, error);
			}
		});

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
				`Error caching ${prefix} paginated get:`,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}
	}

	return messages;
}

async function cachedFetcherPaginatedGet<T>(
	baseUri: string,
	ttl: Ttl,
	pageSize = 100,
	maxPages = 10,
	shortCircut?: { key: string; value?: string },
) {
	return cachedPaginatedGet<T>(
		"hub",
		(uri) => hub().get<PaginatedMessagesResponse<T>>(uri),
		baseUri,
		ttl,
		pageSize,
		maxPages,
		shortCircut,
	);
}

async function cachedHaatzPaginatedGet<T>(
	baseUri: string,
	ttl: Ttl,
	pageSize = 100,
	maxPages = 10,
) {
	return cachedPaginatedGet<T>(
		"haatz",
		(uri) => haatz().get<PaginatedMessagesResponse<T>>(uri),
		baseUri,
		ttl,
		pageSize,
		maxPages,
	);
}

/**
 * How a gateway answered a name-proof lookup. The gateways answer an
 * unknown name with HTTP 400 (measured 2026-11-16 on both worlds:
 * {"error":"Failed to get username proof","error_detail":"status:
 * NotFound,..."}) — not a 404. A 400/404 is the clean miss; anything
 * else is an outage, never a verdict.
 */
const isNameProofMiss = (error: unknown): boolean => {
	if (typeof error === "object" && error !== null && "status" in error) {
		const status = Number((error as { status: unknown }).status);
		if (status === 400 || status === 404) {
			return true;
		}
	}
	return /username proof not found/i.test(String(error));
};

export interface UsernameResolution {
	fid: number;
	/** which world's registry answered */
	origin: "snapchain" | "hypersnap";
	/**
	 * Hypersnap-world answers are provisional: names are not uniquely
	 * owned there — multiple fids can carry the same name and the
	 * deciding vote is the fid's identity and social standing, not a
	 * registry (multiple "Muhammed Ali"s). A Snapchain answer is
	 * canonical; a Hypersnap answer is the node registry's pick, with
	 * the social signals attached so callers can judge.
	 */
	provisional: boolean;
	/** fork profile follower count — null when the profile leg failed */
	followerCount: number | null;
	/** fork profile username — null when the profile leg failed */
	profileUsername: string | null;
}

/**
 * The fork-aware name primitive — name→fid across both worlds.
 * Snapchain is PRIMARY (its proofs are canonical for the legacy space
 * the registry actually enforces); Hypersnap is the backup for native
 * names, and provisional when it answers. The Hypersnap leg also joins
 * the fork profile (follower count, preferred username) — the social
 * popularity signal the fork world resolves contested names by.
 *
 * undefined is a clean miss on BOTH worlds. A throw means at least one
 * world failed without answering and neither answered with a proof —
 * the verdict is withheld and the route answers 503.
 */
export const getFidByUsernameInEitherWorld = async (
	username: string,
): Promise<UsernameResolution | undefined> => {
	const uri = `/v1/userNameProofByName?name=${encodeURIComponent(username)}`;

	let snapchainError: unknown;
	try {
		// typing is a white lie because it was deserialized over http
		const res = await cachedFetcherGet<UserNameProof>(uri, Ttl.LONG);
		const fid = parseGatewayFid(res?.fid);
		if (fid !== undefined) {
			return { fid, origin: "snapchain", provisional: false, followerCount: null, profileUsername: null };
		}
	} catch (error) {
		snapchainError = error;
		if (!isNameProofMiss(error)) {
			console.error(
				"getFidByUsernameInEitherWorld: snapchain name lookup failed, falling back to hypersnap:",
				username,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}
	}

	let haatzError: unknown;
	try {
		const res = await cachedHaatzGet<UserNameProof>(uri, Ttl.LONG);
		const fid = parseGatewayFid(res?.fid);
		if (fid !== undefined) {
			// enrichment is best-effort: the proof is the answer, the
			// profile is the popularity context
			const profile = await getHaatzProfileByFid(fid).catch(
				() => undefined,
			);
			return {
				fid,
				origin: "hypersnap",
				provisional: true,
				followerCount: profile?.followerCount ?? null,
				profileUsername: profile?.username ?? null,
			};
		}
	} catch (error) {
		haatzError = error;
		if (!isNameProofMiss(error)) {
			console.error(
				"getFidByUsernameInEitherWorld: hypersnap name lookup failed:",
				username,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}
	}

	const realOutages = [snapchainError, haatzError].filter(
		(error) => error !== undefined && !isNameProofMiss(error),
	);
	if (realOutages.length > 0) {
		const parts = realOutages
			.map((error) =>
				error instanceof Error ? error.message : JSON.stringify(error),
			)
			.join(" | ");
		throw new Error(`name lookup outage for ${username}: ${parts}`);
	}

	return undefined;
};

/**
 * Lenient wrapper for the internal callers (refresh's username walk,
 * Warpcast-URI search, allCasts): fork-aware, but outages degrade to
 * undefined like the pre-fork behavior instead of throwing mid-walk.
 */
export const getHubFidByUsername = async (
	username: string,
): Promise<number | undefined> => {
	try {
		return (await getFidByUsernameInEitherWorld(username))?.fid;
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
 * Split the fid's username proofs into the fname and its ENS attestations.
 * fname is the newest USERNAME_TYPE_FNAME proof, one per fid (an older fname
 * may have transferred away). Every other proof type (ENS L1, basename) is
 * an attestation, newest first. The hub's preferred username is not derived
 * here — that is the USER_DATA_TYPE_USERNAME user-data message. The input
 * arrives deserialized over http (typing is a white lie); the node answers
 * with duplicate rows (measured: dwr/fid 3 carries the same fname proof
 * twice), so names are deduped. Its row order is NOT timestamp-sorted
 * (measured, with or without reverse=true), so rows are sorted NEWEST-FIRST
 * here — stable: timestamp ties keep node order — and every field is
 * deterministic regardless of the node.
 */
export const splitUsernameProofs = (
	proofs: UserNameProof[] | undefined,
): {
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
	for (const { row } of rows) {
		if (typeof row.name !== "string" || row.name === "" || seen.has(row.name))
			continue;
		seen.add(row.name);
		// protobuf JSON serializes the enum as its name string; accept the
		// numeric form too (1 = USERNAME_TYPE_FNAME). A non-fname proof is
		// an attestation by definition — verified, attached, decorative.
		const isFname = row.type === "USERNAME_TYPE_FNAME" || row.type === 1;
		(isFname ? fnames : attestations).push(row.name);
	}
	return { fname: fnames[0] ?? null, attestations };
};

// Username is the hub's USER_DATA_TYPE_USERNAME message. Proofs contribute
// the fname and ENS attestations only — a newer ENS proof does not become
// the username.
export const profileNames = (
	proofs: UserNameProof[] | undefined,
	messages: UserDataAddMessage[] | undefined,
): {
	username: string | null;
	fname: string | null;
	attestations: string[];
} => {
	const { fname, attestations } = splitUsernameProofs(proofs);
	const username =
		(messages ?? []).find(
			// @ts-expect-error the typing is a white lie because it was deserialized over http
			(m) => m.data.userDataBody.type === "USER_DATA_TYPE_USERNAME",
		)?.data.userDataBody.value ?? null;
	return { username, fname, attestations };
};

export const getHubUserByFid = async (
	fid: number,
): Promise<User | undefined> => {
	try {
		// typing is a white lie because it was deserialized over http
		const [res0, res] = await Promise.all([
			cachedFetcherGet<{ proofs: UserNameProof[] }>(
				`/v1/userNameProofsByFid?fid=${fid}&reverse=true`,
				Ttl.LONG,
			),
			cachedFetcherGet<PaginatedMessagesResponse<UserDataAddMessage>>(
				`/v1/userDataByFid?fid=${fid}&reverse=true`,
				Ttl.MEDIUM,
			),
		]);
		const messages = res?.messages ?? [];
		const { username, fname, attestations } = profileNames(
			res0.proofs,
			messages,
		);

		if (messages.length === 0 && !fname && attestations.length === 0) {
			return undefined;
		}

		const displayName =
			messages.find(
				// @ts-expect-error the typing is a white lie because it was deserialized over http
				(m) => m.data.userDataBody.type === "USER_DATA_TYPE_DISPLAY",
			)?.data.userDataBody.value ?? null;

		const pfpUrl =
			messages.find(
				// @ts-expect-error the typing is a white lie because it was deserialized over http
				(m) => m.data.userDataBody.type === "USER_DATA_TYPE_PFP",
			)?.data.userDataBody.value ?? null;

		const bio =
			messages.find(
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

/**
 * The user as the Hypersnap world holds them: the same two gateway calls
 * getHubUserByFid makes, against the haatz node, mapped with the same
 * mappers. undefined is a clean miss (both calls answered empty — the
 * live-verified unknown-fid shape); a gateway failure THROWS so the
 * fork-aware caller can withhold the verdict. primaryAddress is null
 * here — hydration fills it from hub verifications (first ETH address)
 * after this returns, same as the Snapchain leg.
 */
export const getHaatzUserByFid = async (
	fid: number,
): Promise<User | undefined> => {
	// typing is a white lie because it was deserialized over http
	const [res0, res] = await Promise.all([
		cachedHaatzGet<{ proofs: UserNameProof[] }>(
			`/v1/userNameProofsByFid?fid=${fid}&reverse=true`,
			Ttl.LONG,
		),
		cachedHaatzGet<PaginatedMessagesResponse<UserDataAddMessage>>(
			`/v1/userDataByFid?fid=${fid}&reverse=true`,
			Ttl.MEDIUM,
		),
	]);
	const messages = res?.messages ?? [];
	const { username, fname, attestations } = profileNames(
		res0.proofs,
		messages,
	);

	if (messages.length === 0 && !fname && attestations.length === 0) {
		return undefined;
	}

	const displayName =
		messages.find(
			// @ts-expect-error the typing is a white lie because it was deserialized over http
			(m) => m.data.userDataBody.type === "USER_DATA_TYPE_DISPLAY",
		)?.data.userDataBody.value ?? null;

	const pfpUrl =
		messages.find(
			// @ts-expect-error the typing is a white lie because it was deserialized over http
			(m) => m.data.userDataBody.type === "USER_DATA_TYPE_PFP",
		)?.data.userDataBody.value ?? null;

	const bio =
		messages.find(
			// @ts-expect-error the typing is a white lie because it was deserialized over http
			(m) => m.data.userDataBody.type === "USER_DATA_TYPE_BIO",
		)?.data.userDataBody.value ?? null;

	return {
		fid,
		username,
		fname,
		attestations,
		displayName,
		pfpUrl,
		bio,
		primaryAddress: null,
	};
};

/**
 * The fork-aware user primitive — the user-side twin of
 * getCastInEitherWorld. Hypersnap is primary; the Snapchain (crackle)
 * answer is consulted on a clean Hypersnap miss or a Hypersnap outage.
 * A native-fid Hypersnap outage THROWS (same contract as cast-sync):
 * Snapchain cannot know the fid, so an empty fallback would be a lie.
 * For legacy fids, crackle still conflates outage with miss
 * (getHubUserByFid answers undefined for both — pre-existing behavior),
 * so a crackle failure cannot upgrade to a throw: the caller sees
 * undefined, the user cache stays unwritten, and the next call retries.
 */
export const getUserInEitherWorld = async (
	fid: number,
): Promise<User | undefined> => {
	let haatzError: unknown;
	try {
		const haatzUser = await getHaatzUserByFid(fid);
		if (haatzUser) return haatzUser;
	} catch (error) {
		haatzError = error;
		console.error(
			"getUserInEitherWorld: haatz gateway unavailable, falling back to snapchain:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	// A native fid cannot exist on Snapchain — the legacy world predates
	// the fork's widened fid space. A clean empty Hypersnap answer is the
	// true miss; a Hypersnap outage must not wear Snapchain's empty answer.
	if (isNativeFid(fid)) {
		if (haatzError !== undefined) {
			throw new Error(
				`user lookup outage for fid ${fid}: ${
					haatzError instanceof Error
						? haatzError.message
						: JSON.stringify(haatzError)
				}`,
			);
		}
		return undefined;
	}

	return getHubUserByFid(fid);
};

export const getUsernameByFid = async (
	fid: number,
): Promise<string | undefined> => {
	const user = await getUserInEitherWorld(fid);
	// Hub preferred name (USER_DATA_TYPE_USERNAME). A missing message is
	// null on the user and undefined here, which /u reports as missing.
	return user?.username ?? undefined;
};

const targetFidsFromLinkMessages = (messages: LinkAddMessage[]): number[] =>
	sift(
		messages.map((m) =>
			// haatz may serialize native target fids as decimal strings
			parseGatewayFid(m.data?.linkBody?.targetFid),
		),
	);

/**
 * The fork-aware following-graph primitive. Hypersnap is primary;
 * Snapchain is consulted on a clean empty haatz answer or a haatz outage
 * — except for native fids, which cannot exist on Snapchain. A total
 * outage THROWS: an empty array used to mean "follows nobody" and hid
 * hub failures from /refresh's username→followees walk.
 */
export const getFollowingByFid = async (
	fid: number,
	maxPages = 10,
): Promise<number[]> => {
	const uri = `/v1/linksByFid?fid=${fid}&reverse=false&link_type=follow`;

	let haatzError: unknown;
	let haatzFollows: number[] | undefined;
	try {
		const messages = await cachedHaatzPaginatedGet<LinkAddMessage>(
			uri,
			Ttl.FEED,
			1000,
			maxPages,
		);
		haatzFollows = targetFidsFromLinkMessages(messages);
		if (haatzFollows.length > 0) {
			return haatzFollows;
		}
	} catch (error) {
		haatzError = error;
		console.error(
			"getFollowingByFid: haatz gateway unavailable, falling back to snapchain:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	if (isNativeFid(fid)) {
		if (haatzError !== undefined) {
			throw new Error(
				`following lookup outage for fid ${fid}: ${
					haatzError instanceof Error
						? haatzError.message
						: JSON.stringify(haatzError)
				}`,
			);
		}
		return haatzFollows ?? [];
	}

	try {
		const messages = await cachedFetcherPaginatedGet<LinkAddMessage>(
			uri,
			Ttl.FEED,
			1000,
			maxPages,
		);
		return targetFidsFromLinkMessages(messages);
	} catch (error) {
		console.error(
			"Error fetching following by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		// Empty haatz sent us here — a crackle outage must not become
		// "follows nobody". If haatz also failed, both worlds are down.
		const parts = [haatzError, error]
			.filter((e) => e !== undefined)
			.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)))
			.join(" | ");
		throw new Error(`following lookup outage for fid ${fid}: ${parts}`);
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

// The body typing is a white lie because it was deserialized over http
// (protobuf JSON emits the protocol enum as its name string, and the
// address as a 0x-prefixed hex string rather than bytes).
const ethAddressesFromVerificationMessages = (
	messages: VerificationAddAddressMessage[],
): Hex[] => {
	const addresses = sift(
		messages.map((m) => {
			const body = (
				m as unknown as {
					data: {
						verificationAddAddressBody?: {
							address?: unknown;
							protocol?: unknown;
						};
					};
				}
			).data.verificationAddAddressBody;
			if (
				!body ||
				typeof body.address !== "string" ||
				!/^0x[0-9a-fA-F]{40}$/.test(body.address)
			) {
				return undefined;
			}
			// protocol may be the explicit enum name or omitted entirely
			// (protobuf default = PROTOCOL_ETHEREUM); the 0x shape check
			// above already excludes solana addresses
			if (
				body.protocol !== undefined &&
				body.protocol !== "PROTOCOL_ETHEREUM"
			) {
				return undefined;
			}
			return body.address.toLowerCase() as Hex;
		}),
	);
	return [...new Set(addresses)];
};

/**
 * Every ETH address the fid has proven ownership of, lowercased and
 * deduped. Solana verifications are filtered out. Fork-aware twin of
 * getUserInEitherWorld: Hypersnap (haatz) is primary; Snapchain (crackle)
 * is consulted on a clean empty haatz answer or a haatz outage — except
 * for native fids, which cannot exist on Snapchain. undefined = the
 * lookup itself failed; [] = the fid has no ETH verifications.
 *
 * LONG TTL: verifications barely churn vs profile fields; primary-address
 * and social-contract share this key, so a longer TTL keeps hub pressure
 * down when user:${fid} expires at MEDIUM.
 */
export const getVerifiedEthAddressesByFid = async (
	fid: number,
): Promise<Hex[] | undefined> => {
	const uri = `/v1/verificationsByFid?fid=${fid}`;

	let haatzAddresses: Hex[] | undefined;
	try {
		const messages =
			await cachedHaatzPaginatedGet<VerificationAddAddressMessage>(
				uri,
				Ttl.LONG,
			);
		haatzAddresses = ethAddressesFromVerificationMessages(messages);
		if (haatzAddresses.length > 0) {
			return haatzAddresses;
		}
	} catch (error) {
		console.error(
			"getVerifiedEthAddressesByFid: haatz gateway unavailable, falling back to snapchain:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	// Empty haatz answer or haatz outage. Native fids have no Snapchain
	// world — return the haatz result ([] = proven none) or undefined
	// (outage, uncached so the next call retries).
	if (isNativeFid(fid)) {
		return haatzAddresses;
	}

	try {
		const messages =
			await cachedFetcherPaginatedGet<VerificationAddAddressMessage>(
				uri,
				Ttl.LONG,
			);
		return ethAddressesFromVerificationMessages(messages);
	} catch (error) {
		console.error(
			"Error fetching verified eth addresses by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		// Empty haatz is only a miss that sent us here — not a proven-none
		// verdict. A crackle outage must stay undefined so social-contract
		// and hydration do not cache primaryAddress:null / signed:false
		// for fids whose verifications live only on Snapchain.
		return undefined;
	}
};

export interface PrimaryAddress {
	fid: number;
	protocol: "ethereum";
	address: Hex;
}

// On-protocol stand-in for the old api.farcaster.xyz /fc/primary-address
// preference (not on the protocol, and that endpoint rate-limits with
// "Use hubs instead!"). A Warpcast miss used to leave hydration uncached,
// so every subsequent request re-hit the public API and amplified 429s.
// First verified ETH address from either world is the hub-backed answer.
//
// null = successful lookup with no address;
// undefined = the lookup itself failed
export const getUserPrimaryAddress = async (
	fid: number,
): Promise<PrimaryAddress | null | undefined> => {
	const addresses = await getVerifiedEthAddressesByFid(fid);
	if (addresses === undefined) {
		return undefined;
	}
	const address = addresses[0];
	if (!address) {
		return null;
	}
	return { fid, protocol: "ethereum", address };
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
