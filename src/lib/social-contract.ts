import { fetcher } from "itty-fetcher";
import { retry } from "radash";
import type { Hex } from "viem";
import { getVerifiedEthAddressesByFid } from "./hub-api";
import redis, { Ttl } from "./redis";
import { getUserPrimaryAddress } from "./warpcast";

// Soulbound ERC-721 ("Network School Farcaster client") minted to whichever
// of a user's verified addresses signed the Farcaster social contract —
// not necessarily the Warpcast-designated primary (fid 3 / dwr minted to
// 0x187c…8899 while its primary is 0x6ce0…fea5).
// Live view: https://farcasterstats.onchain.cooking/?tab=votes
const SOCIAL_CONTRACT_NFT =
	"0x4ecfed276c566aeb49da1f3a888e8dbb7263028d" as const;

// v2: the check expanded from primary-address-only to every verified ETH
// address; the bump invalidates cached negatives produced by the old logic
const CACHE_KEY_PREFIX = "social-contract:v2";

const baseRpc = fetcher({
	base: process.env.BASE_RPC_URL || "https://mainnet.base.org",
});

// keccak256("balanceOf(address)") — the only ERC-721 method we need
const BALANCE_OF_SELECTOR = "0x70a08231";

const encodeAddressArg = (address: Hex) =>
	address.slice(2).toLowerCase().padStart(64, "0");

const getSocialContractBalance = async (address: Hex): Promise<bigint> => {
	const res = (await retry({ backoff: (i) => 10 ** i }, async () => {
		return await baseRpc.post("", {
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [
				{
					to: SOCIAL_CONTRACT_NFT,
					data: `${BALANCE_OF_SELECTOR}${encodeAddressArg(address)}`,
				},
				"latest",
			],
		});
	})) as {
		result?: string;
		error?: { message: string };
	};

	if (res.error || !res.result) {
		throw new Error(
			res.error?.message ?? "eth_call balanceOf returned no result",
		);
	}

	return BigInt(res.result);
};

// coalesce concurrent misses for the same fid into a single lookup
const inFlight = new Map<number, Promise<boolean>>();

// Every address whose holding proves the fid signed: all ETH addresses the
// fid has verified on the hub, falling back to the Warpcast primary address
// alone when the hub lookup fails.
const getSigningAddressesForFid = async (fid: number): Promise<Hex[]> => {
	const verified = await getVerifiedEthAddressesByFid(fid);
	// undefined = hub lookup failed → degrade to the single primary address.
	// [] = genuinely no verifications → stop there: a primary address is
	// derived from verifications, so looking it up would be a doomed call.
	if (verified !== undefined) {
		return verified;
	}
	const primaryAddress = await getUserPrimaryAddress(fid);
	return primaryAddress?.address ? [primaryAddress.address] : [];
};

// positives are rare (~8 in 10k fids) and the token can be burned, so `true`
// is cached MEDIUM (new signers are the only way it goes stale)
export const hasFidSignedSocialContract = async (
	fid: number,
): Promise<boolean> => {
	const pending = inFlight.get(fid);
	if (pending) {
		return pending;
	}

	const lookup = (async (): Promise<boolean> => {
		const cacheClient = redis();

		let cached: unknown;
		try {
			cached = await cacheClient.get<unknown>(`${CACHE_KEY_PREFIX}:${fid}`);
		} catch (error) {
			console.error(
				"Error reading social contract cache for fid:",
				fid,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}
		// lmdis returns raw strings when JSON.parse fails, so only trust
		// real booleans — anything else is treated as a miss
		if (typeof cached === "boolean") {
			return cached;
		}

		const addresses = await getSigningAddressesForFid(fid);
		if (addresses.length === 0) {
			// no wallet attached (no verifications / lookup 404): cannot have
			// signed. MEDIUM bounds staleness if the lookup itself was flaky.
			const signed = false;
			try {
				await cacheClient.set(
					`${CACHE_KEY_PREFIX}:${fid}`,
					JSON.stringify(signed),
					{ ex: Ttl.MEDIUM },
				);
			} catch (error) {
				console.error(
					"Error writing social contract cache for fid:",
					fid,
					error instanceof Error ? error.message : JSON.stringify(error),
				);
			}
			return signed;
		}

		const balances = await Promise.all(
			addresses.map((address) => getSocialContractBalance(address)),
		);
		const signed = balances.some((balance) => balance > 0n);
		try {
			await cacheClient.set(
				`${CACHE_KEY_PREFIX}:${fid}`,
				JSON.stringify(signed),
				{ ex: Ttl.MEDIUM },
			);
		} catch (error) {
			console.error(
				"Error writing social contract cache for fid:",
				fid,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}

		return signed;
	})();

	inFlight.set(fid, lookup);

	try {
		return await lookup;
	} finally {
		inFlight.delete(fid);
	}
};
