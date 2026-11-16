import { cluster } from "radash";

// The hard fork allocates native fids above the legacy uint32 ceiling
// (2^32) to avoid colliding with pre-fork Farcaster fids. The legacy
// worlds — Snapchain/crackle and the Warpcast backend — predate the
// widened space and cannot know a native fid BY CONSTRUCTION, not by
// policy: consulting them for one is doomed work, and letting their
// (definitionally empty) answers stand in during a Hypersnap outage
// would dress an outage up as a clean miss.
export const NATIVE_FID_MIN = 2 ** 32;

export const isNativeFid = (fid: number): boolean => fid >= NATIVE_FID_MIN;

// Route params arrive as strings and used to be coerced with Number(),
// which silently rounds above Number.MAX_SAFE_INTEGER — /user/9007199254740993
// answered as fid 9007199254740992, serving a different fid's data, and
// floats/negatives/exponent forms sailed through. Accept only canonical
// decimal digits, and only within the exact double range; everything else
// is a 400, never a neighboring fid. JS numbers stay exact up to 2^53-1,
// far past the native range — so no BigInt anywhere: the string boundary
// plus one validation is the whole job.
export const parseFid = (value: string): number | undefined => {
	if (!/^\d+$/.test(value)) {
		return undefined;
	}
	const fid = Number(value);
	return Number.isSafeInteger(fid) ? fid : undefined;
};

// The fork's gateways serialize fids inconsistently: protobuf JSON makes
// uint64 a decimal string, and both the haatz /v1 gateway and its /v2
// client API emit small (legacy) fids as JSON numbers but native fids —
// past the uint32 ceiling — as strings ("fid":"4294967296"). A
// typeof-number check therefore silently drops every native fid (casts,
// mentions, proofs) while passing legacy ones. Accept both forms, exact
// only: anything outside the safe-integer range is undefined, never a
// rounded neighbor.
export const parseGatewayFid = (value: unknown): number | undefined => {
	if (typeof value === "number") {
		return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
	}
	if (typeof value === "string") {
		return parseFid(value);
	}
	return undefined;
};

export const pluralize = (count: number, word: string, suffix = "s") => {
	if (count === 1) {
		return `${count} ${word}`;
	}
	return `${count} ${word}${suffix}`;
};

export const uin8ArrayToHex = (arr: Uint8Array): `0x${string}` => {
	return `0x${Buffer.from(arr).toString("hex")}`;
};

export const hexToUint8Array = (hex: `0x${string}`) => {
	return new Uint8Array(Buffer.from(hex.slice(2), "hex"));
};

// Fan async fetches through bounded batches instead of one unbounded
// Promise.all. A cold feed page hydrates every cast, mention and user at
// once — hundreds of simultaneous sockets to a single hub host — which is
// what produced the 20261029 "socket connection was closed unexpectedly"
// bursts. Batched, at most `size` are in flight per request. Order
// preserving; each batch waits for its slowest member (negligible at
// ~150ms/call). Same idiom as refresh.ts's cluster batches.
export const mapBatch = async <T, R>(
	items: readonly T[],
	fn: (item: T) => Promise<R>,
	size: number,
): Promise<R[]> => {
	const results: R[] = [];
	for (const batch of cluster(items, size)) {
		results.push(...(await Promise.all(batch.map(fn))));
	}
	return results;
};
