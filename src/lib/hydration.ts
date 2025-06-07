import type { User } from "../types";
import { getHubUserByFid } from "./hub-api";
import { getProNftDetails } from "./pro-nft";
import { getUserPrimaryAddress } from "./warpcast";

export const getUserByFid = async (fid: number) => {
	const hubUser = await getHubUserByFid(fid);

	const primaryAddress = await getUserPrimaryAddress(fid);

	const proNftDetails = getProNftDetails(fid);

	const user: User = {
		fid,
		username: hubUser?.username ?? null,
		displayName: hubUser?.displayName ?? null,
		pfpUrl: hubUser?.pfpUrl ?? null,
		bio: hubUser?.bio ?? null,
		primaryAddress: primaryAddress?.address ?? null,
		proNft: proNftDetails
			? { order: proNftDetails.order, timestamp: proNftDetails.timestamp }
			: null,
	};

	return user;
};

export const getSentFromBySignerKey = async (signerKey: `0x${string}`) => {
	if (!signerKey) {
		return undefined;
	}
	if (
		signerKey ===
		"0x0e10fec94a39c27f6ea39191b310c13c53cb8f6be209b3c48d7278f6688df603"
	) {
		return "neynar";
	}
	if (
		signerKey ===
		"0xc6dab75cc8e1d720a6f8a9aff8c6ae2eb48e5442b3a863b88413331dbde6c206"
	) {
		return "artlu";
	}
	if (
		signerKey ===
		"0x4d25071459be1161bbeb299cecac7668bb04f6009e00498e3606e0839d31e064"
	) {
		return "recaster-fc";
	}
	if (
		signerKey ===
		"0xba30336ba6bed65f11b79a0d5c8f78885b614b95386fcb3734f0d6aa2cb7ea1f"
	) {
		return "warpcast";
	}
	return null;
};

export const hydrateText = async (
	text: string | null,
	mentions: number[] | null,
	mentionsPositions: number[] | null,
): Promise<string | null> => {
	if (!text) {
		return null;
	}

	const usernameMentions = await Promise.all(
		(mentions ?? []).map(async (mention) => {
			const user = await getHubUserByFid(mention);
			return user?.username ?? "<unknown>";
		}),
	);

	const byteArray = new TextEncoder().encode(text);
	const pieces: string[] = [];
	let lastIndex = 0;

	// Sort mentions positions to process them in order
	const sortedMentionPositions = [...(mentionsPositions ?? [])].sort(
		(a, b) => a - b,
	);

	// Process each mention position
	for (const mentionPos of sortedMentionPositions) {
		// Add text before the mention
		if (mentionPos > lastIndex) {
			const textBeforeMention = new TextDecoder().decode(
				byteArray.slice(lastIndex, mentionPos),
			);
			pieces.push(textBeforeMention);
		}

		// Add the mention
		const mentionIndex = (mentionsPositions ?? []).indexOf(mentionPos);
		pieces.push(`@${usernameMentions?.[mentionIndex]} `);

		lastIndex = mentionPos + 1;
	}

	// Add any remaining text after the last mention
	if (lastIndex < byteArray.length) {
		const remainingText = new TextDecoder().decode(byteArray.slice(lastIndex));
		pieces.push(remainingText);
	}

	const hydratedText = pieces.join("");

	return hydratedText;
};
