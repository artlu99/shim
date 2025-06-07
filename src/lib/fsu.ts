import { SnapChainClient } from 'farcaster-snapchain-utils'

const client = new SnapChainClient();

export const getFidByUsername = async (username: string) => {
	const res = await client.getFidFromUsername(username);
	return res;
};
