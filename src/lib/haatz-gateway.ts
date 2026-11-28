import { sift } from "radash";
import {
	CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	FARCASTER_EPOCH,
	HAATZ_GATEWAY_ENDPOINT,
	HAATZ_GATEWAY_TIMEOUT_MS,
	HTTP_FAN_OUT_BATCH_SIZE,
	MAX_SYNC_MESSAGES,
} from "../constants";
import type { Cast } from "../types";
import { asCastTypeName, asChain, asFormatVersion } from "./cast-fields";
import { collectPagedMessages } from "./paging";
import { hydrateText } from "./hydration";
import { upsertCasts } from "./sqlite";
import { mapBatch, parseGatewayFid } from "./util";

/*
	The haatz node serves the snapchain /v1 HTTP JSON gateway on 443 — the
	same surface snapchain exposes on 3381 (crackle.farcaster.xyz). Corpus
	sync and channel feeds travel over HTTPS /v1:

	- /v1/castsByFid carries BOTH cast adds and removes, full message
	  shape (signer, mentions + positions), reverse=true newest-first,
	  startTimestamp inclusive of the watermark second.
	- /v1/castsByParent answers channel feeds.
	- An unknown fid is 200 with zero messages and an empty page token —
	  a clean miss. Any non-ok answer is an outage and THROWS; cast-sync
	  wraps that as a sync/feed outage.

	Field shapes are protobuf JSON as measured live (2026-11-12): hashes
	and signers are 0x-prefixed hex strings; the mapper validates before
	trusting, same discipline as hypersnap.ts. Fids are u64 and arrive as
	JSON numbers for legacy fids but DECIMAL STRINGS for native fids
	(measured 2026-11-16, e.g. "fid":"4294967296") — every fid goes
	through parseGatewayFid, which accepts both forms; a typeof-number
	check here used to silently drop every native cast.
*/

interface GatewayEmbed {
	url?: string;
	cast_id?: { fid?: unknown; hash?: string };
}

interface GatewayCastAddBody {
	text?: string;
	embeds?: GatewayEmbed[];
	mentions?: unknown[];
	mentionsPositions?: unknown[];
	parentCastId?: { fid?: unknown; hash?: string };
	parentUrl?: string | null;
	type?: string;
	formatVersion?: number;
	chain?: unknown;
}

interface GatewayMessage {
	hash?: string;
	signer?: string;
	data?: {
		type?: string;
		fid?: unknown;
		timestamp?: number;
		castAddBody?: GatewayCastAddBody;
	};
}

const with0x = (value: string): `0x${string}` =>
	`0x${value.replace(/^0x/, "").toLowerCase()}`;

/**
 * Validate and map one protobuf-JSON gateway message onto shim's canonical
 * Cast. Removes are filtered at the caller (no castAddBody); anything
 * without an author fid, hash, signer, and timestamp is unusable and
 * dropped rather than trusted. Mentions are hydrated into display text
 * exactly like the gRPC path (getCastFromAddMessage) — the JSON text
 * carries placeholders, not names.
 */
export const gatewayCastToCast = async (raw: unknown): Promise<Cast | undefined> => {
	if (typeof raw !== "object" || raw === null) return undefined;
	const message = raw as GatewayMessage;
	const fid = parseGatewayFid(message.data?.fid);
	const timestamp = message.data?.timestamp;
	const body = message.data?.castAddBody;
	if (fid === undefined) return undefined;
	if (typeof timestamp !== "number") return undefined;
	if (typeof message.hash !== "string" || message.hash === "") return undefined;
	if (typeof message.signer !== "string" || message.signer === "") return undefined;
	if (!body) return undefined;

	// parsed per element, order-preserving — a native mention arrives as a
	// decimal string and must survive alongside its mentionsPositions
	// entry or hydrateText's index pairing misaligns
	const mentions = (body.mentions ?? [])
		.map(parseGatewayFid)
		.filter((fid): fid is number => fid !== undefined);
	const mentionsPositions = (body.mentionsPositions ?? []).filter(
		(position): position is number => typeof position === "number",
	);
	const rawText = body.text ?? "";
	const enrichedText = await hydrateText(rawText, mentions, mentionsPositions);

	return {
		fid,
		hash: with0x(message.hash),
		text: enrichedText,
		rawText,
		embeds: (body.embeds ?? []).map((embed) => {
			const castIdFid = embed.cast_id
				? parseGatewayFid(embed.cast_id.fid)
				: undefined;
			return {
				url: embed.url,
				castId:
					castIdFid !== undefined
						? {
								fid: castIdFid,
								hash: with0x(embed.cast_id?.hash ?? ""),
							}
						: undefined,
			};
		}),
		mentions,
		mentionsPositions,
		parentCastId: (() => {
			const parentFid = body.parentCastId
				? parseGatewayFid(body.parentCastId.fid)
				: undefined;
			return parentFid !== undefined
				? {
						fid: parentFid,
						hash: with0x(body.parentCastId?.hash ?? ""),
					}
				: undefined;
		})(),
		parentUrl: body.parentUrl ?? undefined,
		// hub-time seconds since the Farcaster epoch — same as the gRPC path
		timestamp: FARCASTER_EPOCH + timestamp,
		signer: with0x(message.signer),
		type: asCastTypeName(body.type),
		formatVersion: asFormatVersion(body.formatVersion),
		chain: asChain(body.chain),
	};
};

const isCastAdd = (message: unknown): boolean =>
	(message as GatewayMessage)?.data?.type === "MESSAGE_TYPE_CAST_ADD";

const gatewayGet = async (uri: string): Promise<unknown> => {
	const res = await fetch(`${HAATZ_GATEWAY_ENDPOINT}${uri}`, {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(HAATZ_GATEWAY_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`haatz gateway answered ${res.status} for ${uri}`);
	}
	return res.json();
};

interface GatewayPage<T> {
	messages: T[];
	nextPageToken?: string;
}

/**
 * The fid's casts as the Hypersnap world holds them: incremental via the
 * watermark (server-side startTimestamp), result-capped, removes filtered,
 * upsert off unless asked. Throws on outage — an empty message list is
 * the only miss.
 */
export const getHaatzCastsByFid = async (
	fid: number,
	maxMessages = CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	sinceTimestamp?: number,
	options?: { upsert?: boolean },
): Promise<{ casts: Cast[]; numNew: number }> => {
	const startTimestamp =
		sinceTimestamp !== undefined ? sinceTimestamp - FARCASTER_EPOCH : undefined;
	const messageCap = Math.min(Math.max(0, maxMessages), MAX_SYNC_MESSAGES);

	const messages = await collectPagedMessages<unknown, string>(
		async ({ pageToken, pageSize }) => {
			const params = new URLSearchParams({
				fid: String(fid),
				pageSize: String(pageSize),
				reverse: "true",
			});
			if (startTimestamp !== undefined) {
				params.set("startTimestamp", String(startTimestamp));
			}
			if (pageToken) {
				params.set("pageToken", pageToken);
			}
			const json = (await gatewayGet(`/v1/castsByFid?${params}`)) as
				| GatewayPage<unknown>
				| undefined;
			return {
				messages: Array.isArray(json?.messages) ? json.messages : [],
				nextPageToken:
					typeof json?.nextPageToken === "string" && json.nextPageToken !== ""
						? json.nextPageToken
						: undefined,
			};
		},
		messageCap,
		CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE,
	);

	const adds = messages.filter(isCastAdd);
	// hydrateText fans out per mention — bound the page wave like feeds do
	const casts = sift(
		await mapBatch(adds, gatewayCastToCast, HTTP_FAN_OUT_BATCH_SIZE),
	);
	console.log(`got ${casts.length} casts from haatz gateway for fid ${fid}`);

	let numNew = 0;
	if (options?.upsert) {
		numNew = await upsertCasts(casts);
	}

	return { casts, numNew };
};

/**
 * The channel feed as the Hypersnap world holds it. One page of `limit`;
 * upserts so the corpus grows behind the feed. Throws on outage.
 */
export const getHaatzChannelFeed = async (
	parentUrl: string,
	limit = 25,
): Promise<{ casts: Cast[]; numNew: number }> => {
	const params = new URLSearchParams({
		url: parentUrl,
		pageSize: String(limit),
		reverse: "true",
	});
	const json = (await gatewayGet(`/v1/castsByParent?${params}`)) as
		| GatewayPage<unknown>
		| undefined;

	const messages = Array.isArray(json?.messages) ? json.messages : [];
	const adds = messages.filter(isCastAdd);
	const casts = sift(
		await mapBatch(adds, gatewayCastToCast, HTTP_FAN_OUT_BATCH_SIZE),
	);
	console.log(
		`got ${casts.length} casts from haatz gateway for parentUrl ${parentUrl}`,
	);

	const numNew = await upsertCasts(casts);

	return { casts, numNew };
};
