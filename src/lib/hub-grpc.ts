import {
	getInsecureHubRpcClient,
	type HubEvent,
	HubEventType,
	MessageType,
} from "@farcaster/hub-nodejs";
import { sift } from "radash";
import invariant from "tiny-invariant";
import {
	CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	FARCASTER_EPOCH,
	FEED_DEFAULT_PAGE_SIZE,
	HUB_RPC_DEADLINE_MS,
	MAX_SYNC_MESSAGES,
	VERBOSE_LOGGING,
} from "../constants";
import { livenessFids } from "../static/artlu";
import type { Cast } from "../types";
import type { CastAddMessage } from "./farcaster-types";
import { hydrateText } from "./hydration";
import { upsertCasts } from "./sqlite";
import redis, { Ttl } from "./redis";
import { hexToUint8Array, uin8ArrayToHex } from "./util";

const DO_STREAM = false;

invariant(process.env.HUB_GRPC_ENDPOINT, "HUB_GRPC_ENDPOINT is not set");
const hubRpcEndpoint = process.env.HUB_GRPC_ENDPOINT;

// Tests set this so importing the module does not open a gRPC connection.
// Unset in production. A DEV=FALSE string used to mean the same thing and
// surprised anyone who set DEV=0 or DEV=false.
const hubGrpcDisabled = process.env.HUB_GRPC_DISABLED === "1";

const client = !hubGrpcDisabled
	? getInsecureHubRpcClient(hubRpcEndpoint, {
			"grpc.max_receive_message_length": 20 * 1024 * 1024,
			"grpc.keepalive_time_ms": 30000,
			"grpc.keepalive_timeout_ms": 10000,
			"grpc.http2.min_time_between_pings_ms": 10000,
			"grpc.keepalive_permit_without_calls": 1,
		})
	: undefined;

// hub rpc calls have no built-in deadline reachable through the typed
// client; against a stalled hub node they hang forever, which used to leave
// /refresh (and feed reads) unresolved. The race rejects the caller but
// cannot cancel the underlying RPC at the transport level.
const withDeadline = <T>(rpc: Promise<T>): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`hub rpc deadline exceeded after ${HUB_RPC_DEADLINE_MS}ms`)),
			HUB_RPC_DEADLINE_MS,
		);
		timer.unref?.();
		rpc.then(resolve, reject).finally(() => clearTimeout(timer));
	});

DO_STREAM &&
	client?.$.waitForReady(Date.now() + 5000, async (e) => {
		if (e) {
			console.error(`Failed to connect to ${hubRpcEndpoint}:`, e);
			process.exit(1);
		} else {
			console.log(`Connected to ${hubRpcEndpoint}`);

			const subscribeResult = await client.subscribe({
				eventTypes: [HubEventType.MERGE_MESSAGE],
			});

			if (subscribeResult.isOk()) {
				const stream = subscribeResult.value as unknown as HubEvent[];

				for await (const event of stream) {
					if (
						event?.mergeMessageBody?.message?.data?.type ===
						MessageType.CAST_ADD
					) {
						const message = event?.mergeMessageBody?.message as CastAddMessage;
						const { data } = message;
						if (message && data?.castAddBody) {
							if (livenessFids.includes(data.fid)) {
								const hash: `0x${string}` = `0x${Buffer.from(message.hash).toString("hex")}`;
								const cast = await getCastById(data.fid, hash);
								if (cast) {
									try {
										upsertCasts([cast]); // don't have to await!
									} catch (error) {
										console.error(
											"Error upserting single cast:",
											error instanceof Error
												? error.message
												: JSON.stringify(error),
										);
									}
								}
								const unixTimestampMS =
									(data.timestamp + FARCASTER_EPOCH) * 1000;
								const timestampStr = new Date(unixTimestampMS).toISOString();
								const textDisplay =
									(data.castAddBody.text?.length ?? 0) > 100
										? `${data.castAddBody.text.slice(0, 100)}...`
										: data.castAddBody.text;
								VERBOSE_LOGGING &&
									console.log(`[${timestampStr}] ${data.fid}: ${textDisplay}`);
							}
						}
					}
				}
			}

			client.close();
		}
	});

const getCastFromAddMessage = async (
	cast: CastAddMessage,
): Promise<Cast | undefined> => {
	if (cast.data.castAddBody) {
		const enrichedText = await hydrateText(
			cast.data.castAddBody?.text,
			cast.data.castAddBody?.mentions,
			cast.data.castAddBody?.mentionsPositions,
		);
		return {
			fid: cast.data.fid,
			hash: uin8ArrayToHex(cast.hash),
			text: enrichedText,
			rawText: cast.data.castAddBody?.text,
			embeds: cast.data.castAddBody?.embeds
				? cast.data.castAddBody.embeds.map((e) => {
						return {
							url: e.url,
							castId: e.castId
								? {
										fid: e.castId.fid,
										hash: uin8ArrayToHex(e.castId.hash),
									}
								: undefined,
						};
					})
				: [],
			mentions: cast.data.castAddBody?.mentions,
			mentionsPositions: cast.data.castAddBody?.mentionsPositions,
			parentCastId: cast.data.castAddBody?.parentCastId
				? {
						fid: cast.data.castAddBody.parentCastId.fid,
						hash: uin8ArrayToHex(cast.data.castAddBody.parentCastId.hash),
					}
				: undefined,
			parentUrl: cast.data.castAddBody?.parentUrl,
			timestamp: FARCASTER_EPOCH + cast.data.timestamp,
			signer: uin8ArrayToHex(cast.signer),
		};
	}
	return undefined;
};

/**
 * Is this error the hub's clean "the key (fid, hash) does not exist here"
 * answer, as opposed to a transport failure, deadline, or malformed
 * reply? A clean not_found is a verdict about the answering network only
 * — under the Snapchain/Hypersnap fork, callers must consult the other
 * world before treating it as "this cast does not exist".
 */
export const isHubNotFound = (error: unknown): boolean => {
	const errCode = (error as { errCode?: unknown } | null)?.errCode;
	if (typeof errCode === "string") return errCode === "not_found";
	// some paths surface the error already stringified; match the code
	return /not_found|not found/i.test(String(error));
};

/**
 * The cast as canonical Snapchain holds it, or undefined on a clean
 * not_found — which under the fork means "not in Snapchain's world",
 * not "deleted" and not "invalid". Any other failure throws: an outage
 * must never read as a miss, because "not on Snapchain" is only half
 * the validity question. Cast-removes also come back undefined here
 * (the message exists but carries no castAddBody) — a removed cast is
 * gone from Snapchain's world even if a fork peer still has it.
 */
export const getCastById = async (
	fid: number,
	hash: `0x${string}`,
): Promise<Cast | undefined> => {
	if (!client) {
		return undefined;
	}
	const cacheClient = redis();
	const cacheKey = `grpc:${fid}:${hash}`;

	let cacheResponse: unknown;
	try {
		cacheResponse = await cacheClient.get(cacheKey);
	} catch (error) {
		console.error(
			"Error reading cast cache:",
			fid,
			hash,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	if (cacheResponse) {
		return cacheResponse as Cast;
	}

	const cast = await withDeadline(client.getCast({ fid, hash: hexToUint8Array(hash) }));

	if (!cast.isOk()) {
		const err = cast._unsafeUnwrapErr();
		if (isHubNotFound(err)) {
			return undefined;
		}
		console.error(
			"Error fetching cast by fid and hash:",
			fid,
			hash,
			err.toString(),
		);
		throw new Error(err.toString());
	}

	const unsafe = cast._unsafeUnwrap();
	if (unsafe.data?.castAddBody) {
		const res = await getCastFromAddMessage(unsafe as CastAddMessage);

		await cacheClient.set(cacheKey, JSON.stringify(res), { ex: Ttl.LONG });

		return res;
	}
	return undefined;
};

// Walk hub pages until `maxMessages` or the hub runs dry. pageSize is the
// RPC page, not the caller's cap. An empty page ends the walk even when a
// token is attached — a non-advancing token would otherwise spin to the cap.
export const collectPagedMessages = async <T>(
	fetchPage: (request: {
		pageToken?: Uint8Array;
		pageSize: number;
	}) => Promise<{ messages: T[]; nextPageToken?: Uint8Array }>,
	maxMessages: number,
	pageSize: number,
): Promise<T[]> => {
	if (maxMessages <= 0 || pageSize <= 0) {
		return [];
	}

	const collected: T[] = [];
	let pageToken: Uint8Array | undefined;

	while (collected.length < maxMessages) {
		const requestSize = Math.min(pageSize, maxMessages - collected.length);
		const page = await fetchPage({ pageToken, pageSize: requestSize });
		if (page.messages.length === 0) {
			break;
		}

		collected.push(...page.messages.slice(0, maxMessages - collected.length));
		if (collected.length >= maxMessages) {
			break;
		}

		pageToken =
			page.nextPageToken && page.nextPageToken.length > 0
				? page.nextPageToken
				: undefined;
		if (!pageToken) {
			break;
		}
	}

	return collected;
};

export const getCastsByFid = async (
	fid: number,
	maxMessages = CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	sinceTimestamp?: number,
	options?: { upsert?: boolean },
) => {
	if (!client) {
		return { casts: [], numNew: 0 };
	}
	try {
		// incremental: the hub filters server-side via startTimestamp (hub-time
		// seconds since the Farcaster epoch), so steady-state refreshes only
		// pull and hydrate genuinely new casts. The filter is inclusive of the
		// watermark second — overlap is fine because upsert dedupes by hash.
		//
		// maxMessages is a result cap. The RPC page size stays fixed, so a
		// request for 10 casts is one small page — not a 10k sync in pages
		// of 10. Upsert is off unless asked: only /refresh writes. A bounded
		// read that stored its newest page would seal the watermark, and
		// incremental refresh would never backfill behind it.
		const startTimestamp =
			sinceTimestamp !== undefined ? sinceTimestamp - FARCASTER_EPOCH : undefined;
		const messageCap = Math.min(Math.max(0, maxMessages), MAX_SYNC_MESSAGES);

		const unsafeMessages = await collectPagedMessages(
			async ({ pageToken, pageSize }) => {
				const castsRpcResponse = await withDeadline(
					client.getAllCastMessagesByFid({
						fid,
						reverse: true,
						pageSize,
						startTimestamp,
						pageToken,
					}),
				);

				if (!castsRpcResponse.isOk()) {
					throw new Error(castsRpcResponse._unsafeUnwrapErr().toString());
				}

				const page = castsRpcResponse._unsafeUnwrap();
				return {
					messages: page.messages,
					nextPageToken: page.nextPageToken,
				};
			},
			messageCap,
			CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
		);

		const res = sift(
			unsafeMessages.map((m) => {
				if (m.data?.castAddBody) {
					return m as CastAddMessage;
				}
				return undefined;
			}),
		);

		const casts = sift(await Promise.all(res.map(getCastFromAddMessage)));
		console.log(`got ${casts.length} casts from rpc for fid ${fid}`);

		let numNew = 0;
		if (options?.upsert) {
			try {
				numNew = await upsertCasts(casts);
			} catch (error) {
				console.error(
					"Error upserting casts:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
				throw error;
			}
		}

		return { casts, numNew };
	} catch (error) {
		console.error(
			"Error fetching casts by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return { casts: [], numNew: 0 };
	}
};

export const rawChannelFeed = async (
	parentUrl: string,
	limit = FEED_DEFAULT_PAGE_SIZE,
) => {
	if (!client) {
		return { casts: [], numNew: 0 };
	}
	try {
		let casts: Cast[] = [];

		const castsRpcResponse = await withDeadline(
			client.getCastsByParent({
				parentUrl,
				reverse: true,
				pageSize: limit,
			}),
		);

		if (!castsRpcResponse.isOk()) {
			throw new Error(castsRpcResponse._unsafeUnwrapErr().toString());
		}

		const unsafeMessages = castsRpcResponse._unsafeUnwrap();
		const res = sift(
			unsafeMessages.messages.map((m) => {
				if (m.data?.castAddBody) {
					return m as CastAddMessage;
				}
				return undefined;
			}),
		);
		casts = sift(await Promise.all(res.map(getCastFromAddMessage)));
		VERBOSE_LOGGING &&
			console.log(
				`got ${casts.length} casts from rpc for parentUrl ${parentUrl}`,
			);

		let numNew = 0;
		try {
			numNew = await upsertCasts(casts);
		} catch (error) {
			console.error(
				"Error upserting casts:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
			throw error;
		}

		return { casts, numNew };
	} catch (error) {
		console.error(
			"Error fetching casts by parentUrl:",
			parentUrl,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return { casts: [], numNew: 0 };
	}
};
