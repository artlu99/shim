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

interface HypersnapMentionProfile {
	fid?: number;
	username?: string;
}

interface HypersnapMentionRange {
	start?: number;
	end?: number;
}

interface HypersnapCast {
	hash?: string;
	text?: string;
	timestamp?: string;
	embeds?: HypersnapEmbed[];
	mentioned_profiles?: HypersnapMentionProfile[];
	mentioned_profiles_ranges?: HypersnapMentionRange[];
	parent_hash?: string;
	parent_url?: string | null;
	parent_author?: { fid?: number | null };
	author?: { fid?: number };
}

const with0x = (hash: string): `0x${string}` =>
	`0x${hash.replace(/^0x/, "").toLowerCase()}`;

/**
 * Splice @username into UTF-8 text at each mentioned_profiles_ranges entry.
 * Offsets are byte indexes (same as protocol mentionsPositions). Pair
 * profile i with range i; replace the [start, end) byte span. A
 * zero-width range inserts without consuming. Apply highest offset first
 * so earlier offsets stay valid regardless of the order the API lists
 * ranges in. Invalid or out-of-bounds ranges are skipped.
 */
const spliceMentionUsernames = (
	text: string,
	profiles: HypersnapMentionProfile[],
	ranges: HypersnapMentionRange[],
): { text: string; mentionsPositions: number[] } => {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let bytes = encoder.encode(text);
	const mentionsPositions: number[] = [];
	const splices: Array<{ start: number; end: number; handle: string }> = [];

	const pairCount = Math.min(profiles.length, ranges.length);
	for (let i = 0; i < pairCount; i++) {
		const start = ranges[i]?.start;
		const end = ranges[i]?.end;
		if (typeof start !== "number" || typeof end !== "number") continue;
		if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
		if (start < 0 || end < start || end > bytes.length) continue;

		const username = profiles[i]?.username;
		const handle =
			typeof username === "string" && username !== ""
				? username
				: "<unknown>";
		mentionsPositions.push(start);
		splices.push({ start, end, handle });
	}

	// walk the highest offset first so earlier offsets stay valid — reverse
	// array order only guaranteed that when the API listed ranges in text order
	splices.sort((a, b) => b.start - a.start || b.end - a.end);
	for (let i = 0; i < splices.length; i++) {
		const { start, end, handle } = splices[i]!;
		const insertion = encoder.encode(`@${handle}`);
		const next = new Uint8Array(
			bytes.length - (end - start) + insertion.length,
		);
		next.set(bytes.subarray(0, start), 0);
		next.set(insertion, start);
		next.set(bytes.subarray(end), start + insertion.length);
		bytes = next;
	}

	return { text: decoder.decode(bytes), mentionsPositions };
};

/**
 * Map the Warpcast-client-shaped cast to shim's canonical Cast.
 *
 * The shape is lossy versus the protocol: no signer pubkey, no raw
 * mention-placeholder text. Haatz sometimes returns text with mentions
 * already inlined, and sometimes returns unresolved text plus
 * mentioned_profiles_ranges — in the latter case usernames are spliced
 * in here at those UTF-8 byte offsets, and mentionsPositions records the
 * range starts. Callers should prefer re-fetching the canonical cast from
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

	const profiles = cast.mentioned_profiles ?? [];
	const ranges = cast.mentioned_profiles_ranges;
	let text: string | null = cast.text ?? null;
	let mentionsPositions: number[] = [];
	if (text != null && ranges != null && ranges.length > 0) {
		const spliced = spliceMentionUsernames(text, profiles, ranges);
		text = spliced.text;
		mentionsPositions = spliced.mentionsPositions;
	}

	return {
		fid,
		hash: with0x(cast.hash),
		text,
		// no protocol-raw mention-placeholder form is available from this API
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
		mentions: profiles
			.map((profile) => profile.fid)
			.filter((fid): fid is number => typeof fid === "number"),
		mentionsPositions,
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

/**
 * Resolve by fid + full hash against the node's hash-only index — the
 * Hypersnap-world leg of the fork-aware lookup. The index is globally
 * keyed by hash, so a hit naming a different author means the hash
 * belongs to another fid's cast: a clean miss for this lookup, not an
 * error. Propagates getHypersnapCastByHash's contract — undefined on an
 * authoritative 404, throw on outage or malformed answer.
 */
export const getHypersnapCastByFidAndHash = async (
	fid: number,
	rawHash: `0x${string}`,
): Promise<Cast | undefined> => {
	const cast = await getHypersnapCastByHash(rawHash);
	if (!cast) return undefined;
	return cast.fid === fid ? cast : undefined;
};
