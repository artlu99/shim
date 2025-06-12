import {
	type HubEvent,
	HubEventType,
	MessageType,
	getInsecureHubRpcClient,
} from "@farcaster/hub-nodejs";
import { sift } from "radash";
import {
	CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	FARCASTER_EPOCH,
	FEED_DEFAULT_PAGE_SIZE,
	VERBOSE_LOGGING,
} from "../constants";
import { streamingFids } from "../static/artlu";
import type { Cast } from "../types";
import type { CastAddMessage } from "./farcaster-types";
import { hydrateText } from "./hydration";
import { upsertCasts } from "./postgres";
import redis, { Ttl } from "./redis";
import { hexToUint8Array, uin8ArrayToHex } from "./util";

const DEV = process.env.DEV === "FALSE";
const DO_STREAM = false;

const hubRpcEndpoint = "hub.merv.fun:3383";

const client =
	DO_STREAM && !DEV
		? getInsecureHubRpcClient(hubRpcEndpoint, {
				"grpc.max_receive_message_length": 20 * 1024 * 1024,
				"grpc.keepalive_time_ms": 30000,
				"grpc.keepalive_timeout_ms": 10000,
				"grpc.http2.min_time_between_pings_ms": 10000,
				"grpc.keepalive_permit_without_calls": 1,
			})
		: undefined;

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
					event?.mergeMessageBody?.message?.data?.type === MessageType.CAST_ADD
				) {
					const message = event?.mergeMessageBody?.message as CastAddMessage;
					const { data } = message;
					if (message && data?.castAddBody) {
						if (streamingFids.includes(data.fid)) {
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
							const unixTimestampMS = (data.timestamp + FARCASTER_EPOCH) * 1000;
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

export const getCastById = async (
	fid: number,
	hash: `0x${string}`,
): Promise<Cast | undefined> => {
	if (!client) {
		return undefined;
	}
	try {
		const cacheClient = redis();
		const cacheKey = `grpc:${fid}:${hash}`;

		const cacheResponse = await cacheClient.get(cacheKey);

		if (cacheResponse) {
			return cacheResponse as Cast;
		}

		const cast = await client.getCast({ fid, hash: hexToUint8Array(hash) });

		if (!cast.isOk()) {
			console.log("throw!");
			throw new Error(cast._unsafeUnwrapErr().toString());
		}

		const unsafe = cast._unsafeUnwrap();
		if (unsafe.data?.castAddBody) {
			const res = await getCastFromAddMessage(unsafe as CastAddMessage);

			await cacheClient.set(cacheKey, JSON.stringify(res), { ex: Ttl.LONG });

			return res;
		}
	} catch (error) {
		console.error(
			"Error fetching cast by fid and hash:",
			fid,
			hash,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return undefined;
	}
};

export const getCastsByFid = async (
	fid: number,
	limit = CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
) => {
	if (!client) {
		return { casts: [], numNew: 0 };
	}
	try {
		let casts: Cast[] = [];

		const castsRpcResponse = await client.getAllCastMessagesByFid({
			fid,
			reverse: true,
			pageSize: limit,
		});

		if (!castsRpcResponse.isOk()) {
			throw new Error(castsRpcResponse._unsafeUnwrapErr().toString());
		}

		const unsafeMessages = castsRpcResponse._unsafeUnwrap();
		const res = sift(
			unsafeMessages.messages.map((m) => {
				if (m.data?.castAddBody) {
					return m as CastAddMessage;
				}
			}),
		);
		casts = sift(await Promise.all(res.map(getCastFromAddMessage)));
		console.log(`got ${casts.length} casts from rpc for fid ${fid}`);

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
			"Error fetching casts by fid:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
		return { casts: [], modified: 0 };
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

		const castsRpcResponse = await client.getCastsByParent({
			parentUrl,
			reverse: true,
			pageSize: limit,
		});

		if (!castsRpcResponse.isOk()) {
			throw new Error(castsRpcResponse._unsafeUnwrapErr().toString());
		}

		const unsafeMessages = castsRpcResponse._unsafeUnwrap();
		const res = sift(
			unsafeMessages.messages.map((m) => {
				if (m.data?.castAddBody) {
					return m as CastAddMessage;
				}
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
		return { casts: [], modified: 0 };
	}
};
