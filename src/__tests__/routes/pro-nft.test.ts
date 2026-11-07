import { describe, expect, it } from "bun:test";
import {
	PRO_NFT_DEPRECATION_HEADER,
	PRO_NFT_DEPRECATED_AT,
	PRO_NFT_REMOVE_AFTER,
	PRO_NFT_SUNSET_HEADER,
	PRO_NFT_WARNING,
	getProNftDetails,
	markProNftDeprecated,
	withProNftDeprecation,
} from "../../lib/pro-nft";

describe("Pro NFT hard sunset", () => {
	it("getProNftDetails always returns undefined (lookup retired)", async () => {
		expect(await getProNftDetails(1077239)).toBeUndefined();
		expect(await getProNftDetails(549521)).toBeUndefined();
		expect(await getProNftDetails(1)).toBeUndefined();
	});

	it("exposes self-explanatory deprecate / remove-after dates", () => {
		expect(PRO_NFT_DEPRECATED_AT).toBe("2026-11-07");
		expect(PRO_NFT_REMOVE_AFTER).toBe("2026-12-07");
		expect(PRO_NFT_WARNING).toContain(PRO_NFT_DEPRECATED_AT);
		expect(PRO_NFT_WARNING).toContain("always null");
		expect(PRO_NFT_WARNING).toContain(PRO_NFT_REMOVE_AFTER);
	});

	it("markProNftDeprecated sets RFC 8594 Deprecation and Sunset headers", () => {
		const set = { headers: {} as Record<string, string | number> };
		markProNftDeprecated(set);
		expect(set.headers.Deprecation).toBe(PRO_NFT_DEPRECATION_HEADER);
		expect(set.headers.Sunset).toBe(PRO_NFT_SUNSET_HEADER);
	});

	it("withProNftDeprecation adds warnings and headers", () => {
		const set = { headers: {} as Record<string, string | number> };
		const body = withProNftDeprecation(set, { success: true });
		expect(body.warnings).toEqual([PRO_NFT_WARNING]);
		expect(set.headers.Deprecation).toBe(PRO_NFT_DEPRECATION_HEADER);
		expect(set.headers.Sunset).toBe(PRO_NFT_SUNSET_HEADER);
	});
});
