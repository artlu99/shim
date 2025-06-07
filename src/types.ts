import { t } from "elysia";

export const CastSchema = Object({
	fid: t.Number(),
	hash: t.String(),
	text: t.Union([t.String(), t.Null()]),
	embeds: t.Array(
		t.Object({
			url: t.Optional(t.String()),
			castId: t.Optional(
				t.Object({
					fid: t.Number(),
					hash: t.String(),
				}),
			),
		}),
	),
	mentions: t.Array(t.Number()),
	mentionsPositions: t.Array(t.Number()),
	parentCastId: t.Optional(
		t.Object({
			fid: t.Number(),
			hash: t.String(),
		}),
	),
	parentUrl: t.Optional(t.String()),
	timestamp: t.Number(),
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
}

export interface User {
	fid: number;
	username: string | null;
	displayName: string | null;
	pfpUrl: string | null;
	bio: string | null;
	primaryAddress: `0x${string}` | null;
	proNft: { order: number; timestamp: number } | null;
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
