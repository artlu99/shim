import type { ProNftDetails } from "../types";

/**
 * user.proNft hard sunset.
 *
 * Deprecated: 2026-11-07 — Pro is gone; stop serving real membership data.
 * Remove field after: 2026-12-07 (DATABASE_URL_PRO_NFT, this module, User.proNft).
 * MVR/DWR CSV snapshots already deleted. Until then the field stays on the
 * wire as null with the signals below.
 */
export const PRO_NFT_DEPRECATED_AT = "2026-11-07";
export const PRO_NFT_REMOVE_AFTER = "2026-12-07";

/** RFC 8594 Deprecation: @<unix seconds> for PRO_NFT_DEPRECATED_AT 00:00:00 UTC */
export const PRO_NFT_DEPRECATION_HEADER = "@1794009600";
/** RFC 8594 Sunset: HTTP-date for PRO_NFT_REMOVE_AFTER 00:00:00 GMT */
export const PRO_NFT_SUNSET_HEADER = "Mon, 07 Dec 2026 00:00:00 GMT";

export const PRO_NFT_WARNING =
	`user.proNft is deprecated as of ${PRO_NFT_DEPRECATED_AT} and always null; field will be removed after ${PRO_NFT_REMOVE_AFTER}`;

type HeaderBag = { headers: Record<string, string | number> };

/** Attach Deprecation/Sunset headers for responses that still carry user.proNft. */
export const markProNftDeprecated = (set: HeaderBag): void => {
	set.headers.Deprecation = PRO_NFT_DEPRECATION_HEADER;
	set.headers.Sunset = PRO_NFT_SUNSET_HEADER;
};

/** Headers + top-level warnings[] on any body that embeds a User. */
export const withProNftDeprecation = <T extends Record<string, unknown>>(
	set: HeaderBag,
	body: T,
): T & { warnings: string[] } => {
	markProNftDeprecated(set);
	const existing = Array.isArray(body.warnings)
		? (body.warnings as string[])
		: [];
	return {
		...body,
		warnings: [...existing, PRO_NFT_WARNING],
	};
};

/**
 * Always undefined: membership lookup retired on PRO_NFT_DEPRECATED_AT.
 * Callers should treat a miss as proNft: null.
 */
export const getProNftDetails = async (
	_fid: number,
): Promise<ProNftDetails | undefined> => undefined;
