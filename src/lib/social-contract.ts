import { fetcher } from "itty-fetcher";
import { retry } from "radash";
import type { Hex } from "viem";
import redis, { Ttl } from "./redis";
import { getUserPrimaryAddress } from "./warpcast";

// Soulbound ERC-721 ("Network School Farcaster client") minted to a user's
// primary address when they accept the Farcaster social contract.
// Live view: https://farcasterstats.onchain.cooking/?tab=votes
const SOCIAL_CONTRACT_NFT =
	"0x4ecfed276c566aeb49da1f3a888e8dbb7263028d" as const;

const baseRpc = fetcher({
	base: process.env.BASE_RPC_URL || "https://mainnet.base.org",
});

// keccak256("balanceOf(address)") — the only ERC-721 method we need
const BALANCE_OF_SELECTOR = "0x70a08231";

const encodeAddressArg = (address: Hex) =>
	address.slice(2).toLowerCase().padStart(64, "0");

const getSocialContractBalance = async (address: Hex): Promise<bigint> => {
	const res = (await retry({ backoff: (i) => 10 ** i }, async () => {
		return await baseRpc.post("/", {
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

// true is cached LONG (the token is soulbound: a signature can't be undone);
// false is cached MEDIUM (accounts keep signing over time)
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
			cached = await cacheClient.get<unknown>(`social-contract:${fid}`);
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

		const primaryAddress = await getUserPrimaryAddress(fid);
		if (!primaryAddress?.address) {
			// null or undefined (no wallet attached / lookup 404): cannot have
			// signed. MEDIUM bounds staleness if the lookup itself was flaky.
			const signed = false;
			try {
				await cacheClient.set(`social-contract:${fid}`, JSON.stringify(signed), {
					ex: Ttl.MEDIUM,
				});
			} catch (error) {
				console.error(
					"Error writing social contract cache for fid:",
					fid,
					error instanceof Error ? error.message : JSON.stringify(error),
				);
			}
			return signed;
		}

		const signed = (await getSocialContractBalance(primaryAddress.address)) > 0n;
		try {
			await cacheClient.set(`social-contract:${fid}`, JSON.stringify(signed), {
				ex: signed ? Ttl.LONG : Ttl.MEDIUM,
			});
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
