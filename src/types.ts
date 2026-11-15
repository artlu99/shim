import { t } from "elysia";

// Protocol CastType (CastAddBody.type). Distinct from Hypersnap's client
// `type` field (cast / cast-reply), which is not this enum.
export type CastTypeName = "CAST" | "LONG_CAST" | "TEN_K_CAST";

// ChainCast: ordered segments of one author's cast chain (Articles).
// `root` is absent on index 0; present on later casts.
export interface ChainCast {
	root?: {
		fid: number;
		hash: `0x${string}`;
	};
	index: number;
	count: number;
}

const CastIdSchema = t.Object({
	fid: t.Number(),
	hash: t.String(),
});

const ChainCastSchema = t.Object({
	root: t.Optional(CastIdSchema),
	index: t.Number(),
	count: t.Number(),
});

export const CastSchema = Object({
	fid: t.Number(),
	hash: t.String(),
	text: t.Union([t.String(), t.Null()]),
	rawText: t.Union([t.String(), t.Null()]),
	embeds: t.Array(
		t.Object({
			url: t.Optional(t.String()),
			castId: t.Optional(CastIdSchema),
		}),
	),
	mentions: t.Array(t.Number()),
	mentionsPositions: t.Array(t.Number()),
	parentCastId: t.Optional(CastIdSchema),
	parentUrl: t.Optional(t.String()),
	timestamp: t.Number(),
	// Articles / chained casts (CastAddBody fields). Ordinary casts carry
	// type "CAST" from gRPC/Haatz (proto3 default) and no chain.
	type: t.Optional(
		t.Union([
			t.Literal("CAST"),
			t.Literal("LONG_CAST"),
			t.Literal("TEN_K_CAST"),
		]),
	),
	formatVersion: t.Optional(t.Number()),
	chain: t.Optional(ChainCastSchema),
});

export interface Cast {
	fid: number;
	hash: `0x${string}`;
	text: string | null;
	rawText: string | null;
	embeds: {
		url?: string;
		castId?: {
			fid: number;
			hash: `0x${string}`;
		};
	}[];
	mentions: number[];
	mentionsPositions: number[];
	parentCastId?: {
		fid: number;
		hash: `0x${string}`;
	};
	parentUrl?: string;
	timestamp: number;
	signer: `0x${string}`;
	/** Protocol CastType. Absent when the source does not expose it (Hypersnap). */
	type?: CastTypeName;
	/** How to read the text: 0 = plain, 1 = article Markdown. */
	formatVersion?: number;
	/** Set on every cast that belongs to a chain (e.g. an Article). */
	chain?: ChainCast;
}

export interface User {
	fid: number;
	/** Hub preferred name: the USER_DATA_TYPE_USERNAME user-data message. */
	username: string | null;
	/** Newest fname proof for this fid. */
	fname: string | null;
	/** Verified non-fname username proofs (ENS L1 and basenames), newest first. */
	attestations: string[];
	displayName: string | null;
	pfpUrl: string | null;
	bio: string | null;
	primaryAddress: `0x${string}` | null;
}

export interface Channel {
	id: string;
	url: string;
	name: string;
	imageUrl?: string;
}

export interface HydratedCast extends Cast {
	user: User;
	channel?: Channel;
	sentBy?: string | null;
}
