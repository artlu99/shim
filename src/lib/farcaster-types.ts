import type {
	CastAddMessage,
	LinkAddMessage,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
} from "@farcaster/core";

export type {
	CastAddMessage,
	LinkAddMessage,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
};

export type PaginatedMessagesResponse<T> = {
	messages: T[];
	nextPageToken?: string;
};
