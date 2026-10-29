import { cluster } from "radash";

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
