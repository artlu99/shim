import { HYPERSNAP_API_ENDPOINT, HYPERSNAP_TIMEOUT_MS } from "../constants";
import type { Cast } from "../types";

/*
	Hypersnap (Quilibrium's Snapchain fork) serves a Warpcast-client-shaped
	HTTP API on the node itself. Its /v2/farcaster/cast?type=hash endpoint is
	the only open network source of hash-only cast resolution: canonical
	Snapchain (HTTP gateway and gRPC) is keyed fid + hash everywhere, because
	the protocol's message key is (fid, hash) — the 20-byte hash is unique
	per fid, not globally. This client is shim's bridge from "only a hash"
	to "fid + hash", which the hub can then answer canonically.

	The node indexes the chain, so its 404 is an authoritative miss; a
	transport failure or malformed 200 is an outage, never a verdict — those
	throw, and the route answers 503.
*/

interface HypersnapEmbed {
	url?: string;
	cast_id?: { fid?: number; hash?: string };
}

interface HypersnapCast {
	hash?: string;
	text?: string;
	timestamp?: string;
	embeds?: HypersnapEmbed[];
	mentioned_profiles?: Array<{ fid?: number }>;
	parent_hash?: string;
	parent_url?: string | null;
	parent_author?: { fid?: number | null };
	author?: { fid?: number };
}

const with0x = (hash: string): `0x${string}` =>
	`0x${hash.replace(/^0x/, "").toLowerCase()}`;

/**
 * Map the Warpcast-client-shaped cast to shim's canonical Cast.
 *
 * The shape is lossy versus the protocol: no signer pubkey, no raw
 * mention-placeholder text, and mention positions are not exposed (the
 * client API resolves mentions into display names inline), so positions
 * are empty. Callers should prefer re-fetching the canonical cast from
 * the hub once the fid is known — this mapping exists for the fallback
 * answer and for upserting the hash → fid row into SQLite.
 */
export const hypersnapCastToCast = (raw: unknown): Cast | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined;
	const cast = raw as HypersnapCast;
	const fid = cast.author?.fid;
	if (typeof fid !== "number") return undefined;
	if (typeof cast.hash !== "string" || cast.hash === "") return undefined;
	const timestamp = cast.timestamp
		? Math.floor(Date.parse(cast.timestamp) / 1000)
		: Number.NaN;
	if (Number.isNaN(timestamp)) return undefined;

	return {
		fid,
		hash: with0x(cast.hash),
		text: cast.text ?? null,
		// the client API has already resolved mentions into the text —
		// there is no raw mention-placeholder form to recover
		rawText: null,
		embeds: (cast.embeds ?? []).map((embed) => ({
			url: embed.url,
			castId:
				embed.cast_id && typeof embed.cast_id.fid === "number"
					? {
							fid: embed.cast_id.fid,
							hash: with0x(embed.cast_id.hash ?? ""),
						}
					: undefined,
		})),
		mentions: (cast.mentioned_profiles ?? [])
			.map((profile) => profile.fid)
			.filter((fid): fid is number => typeof fid === "number"),
		// see above — not exposed by the client-API shape
		mentionsPositions: [],
		parentCastId:
			cast.parent_hash && typeof cast.parent_author?.fid === "number"
				? {
						fid: cast.parent_author.fid,
						hash: with0x(cast.parent_hash),
					}
				: undefined,
		parentUrl: cast.parent_url ?? undefined,
		timestamp,
		// not exposed by the client API; not stored and not in CastSchema
		signer: "" as `0x${string}`,
	};
};

/**
 * Resolve a cast by full hash alone against the node's hash-only index.
 *
 * Resolves undefined on an authoritative miss (HTTP 404) and throws on a
 * transport failure or a malformed answer — callers must treat a throw as
 * an outage (503), never as "cast not found".
 */
export const getHypersnapCastByHash = async (
	rawHash: `0x${string}`,
): Promise<Cast | undefined> => {
	// normalize at the boundary — the route lowercases too, but this
	// client must not depend on every caller having done it
	const hash = with0x(rawHash);
	const url = `${HYPERSNAP_API_ENDPOINT}/v2/farcaster/cast?identifier=${hash}&type=hash`;
	const res = await fetch(url, {
		signal: AbortSignal.timeout(HYPERSNAP_TIMEOUT_MS),
	});
	if (res.status === 404) return undefined;
	if (!res.ok) {
		throw new Error(`Hypersnap answered ${res.status}`);
	}

	const data = (await res.json().catch(() => undefined)) as
		| { cast?: unknown }
		| undefined;
	if (!data) {
		throw new Error("Hypersnap answer did not parse");
	}

	const cast = hypersnapCastToCast(data.cast);
	if (!cast) {
		throw new Error("Hypersnap answer was malformed");
	}
	if (cast.hash !== hash) {
		throw new Error(
			`Hypersnap answered a different cast: ${cast.hash} != ${hash}`,
		);
	}
	return cast;
};
