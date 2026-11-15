import type { CastTypeName, ChainCast } from "../types";

/*
	Map CastAddBody.type / formatVersion / chain from the three cast
	sources onto shim's Cast. Protocol CastType is CAST | LONG_CAST |
	TEN_K_CAST (JSON string or protobuf enum). Hypersnap's client API
	exposes format_version + chain but not CastType — its own `type`
	field means cast vs cast-reply and must not be mapped here.
*/

const CAST_TYPE_NAMES = new Set<string>(["CAST", "LONG_CAST", "TEN_K_CAST"]);

export const asCastTypeName = (value: unknown): CastTypeName | undefined => {
	if (typeof value === "string" && CAST_TYPE_NAMES.has(value)) {
		return value as CastTypeName;
	}
	if (value === 0) return "CAST";
	if (value === 1) return "LONG_CAST";
	if (value === 2) return "TEN_K_CAST";
	return undefined;
};

export const asFormatVersion = (value: unknown): number | undefined => {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		return undefined;
	}
	return value;
};

const with0x = (hash: string): `0x${string}` =>
	`0x${hash.replace(/^0x/, "").toLowerCase()}`;

/**
 * Normalize a ChainCast from gateway JSON, gRPC protobuf, or Hypersnap
 * client shape. `root` is absent on index 0; when present it must carry
 * a same-fid CastId. Invalid shapes are dropped rather than trusted.
 */
export const asChain = (raw: unknown): ChainCast | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined;
	const chain = raw as {
		root?: { fid?: number; hash?: string | Uint8Array } | null;
		index?: number;
		count?: number;
	};
	if (typeof chain.index !== "number" || !Number.isInteger(chain.index)) {
		return undefined;
	}
	if (typeof chain.count !== "number" || !Number.isInteger(chain.count)) {
		return undefined;
	}
	if (chain.index < 0 || chain.count < 0) return undefined;

	let root: ChainCast["root"];
	if (chain.root && typeof chain.root === "object") {
		const fid = chain.root.fid;
		const hash = chain.root.hash;
		if (typeof fid !== "number") return undefined;
		if (typeof hash === "string" && hash !== "") {
			root = { fid, hash: with0x(hash) };
		} else if (hash instanceof Uint8Array && hash.length > 0) {
			root = {
				fid,
				hash: `0x${Buffer.from(hash).toString("hex")}` as `0x${string}`,
			};
		} else {
			return undefined;
		}
	}

	return root
		? { root, index: chain.index, count: chain.count }
		: { index: chain.index, count: chain.count };
};
