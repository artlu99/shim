import type {
	CastAddMessage,
	LinkAddMessage,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
	VerificationAddAddressMessage,
} from "@farcaster/core";

export type {
	CastAddMessage,
	LinkAddMessage,
	SignerOnChainEvent,
	UserDataAddMessage,
	UserNameProof,
	VerificationAddAddressMessage,
};

export type PaginatedMessagesResponse<T> = {
	messages: T[];
	nextPageToken?: string;
};
