// Offline suite for splitUsernameProofs — the fname-primary/attestations
// split behind /user/{fid}. Fixtures are real node answers (probed Oct 2026
// against /v1/userNameProofsByFid), including dwr's duplicate fname rows.
import { describe, expect, test } from "bun:test";
import { splitUsernameProofs } from "../../lib/hub-api";

// arfonzo (fid 191503): the ENS is the NEWER proof — which is why the
// newest-proof username answers arfonzo.eth while the fname stays arfonzo.
const ARFONZO = [
	{
		timestamp: 1745928425,
		name: "arfonzo.eth",
		type: "USERNAME_TYPE_ENS_L1",
	},
	{
		timestamp: 1698272500,
		name: "arfonzo",
		type: "USERNAME_TYPE_FNAME",
	},
];

// dwr (fid 3): two L1 attestations AND the same fname proof duplicated —
// the node really answers like this.
const DWR = [
	{ timestamp: 1690215011, name: "dwr.eth", type: "USERNAME_TYPE_ENS_L1" },
	{
		timestamp: 1690298541,
		name: "danromero.eth",
		type: "USERNAME_TYPE_ENS_L1",
	},
	{
		timestamp: 1623910375,
		name: "dwr",
		type: "USERNAME_TYPE_FNAME",
		owner: "0x74232bf61e994655592747e20bdf6fa9b9476f79",
	},
	{
		timestamp: 1623910375,
		name: "dwr",
		type: "USERNAME_TYPE_FNAME",
		owner: "0x74232bf61e994655592747e20bdf6fa9b9476f79",
	},
];

describe("splitUsernameProofs", () => {
	test("fname is primary; the newer ENS is only an attestation", () => {
		expect(splitUsernameProofs(ARFONZO as never)).toEqual({
			fname: "arfonzo",
			attestations: ["arfonzo.eth"],
		});
	});

	test("multiple attestations keep node order; rows dedupe", () => {
		expect(splitUsernameProofs(DWR as never)).toEqual({
			fname: "dwr",
			attestations: ["dwr.eth", "danromero.eth"],
		});
	});

	test("numeric protobuf enum form still reads as fname", () => {
		expect(
			splitUsernameProofs([
				{ name: "someone", type: 1 },
				{ name: "someone.eth", type: 2 },
			] as never),
		).toEqual({ fname: "someone", attestations: ["someone.eth"] });
	});

	test("basename (L2) proofs are attestations too", () => {
		expect(
			splitUsernameProofs([
				{ name: "someone", type: "USERNAME_TYPE_FNAME" },
				{ name: "someone.base.eth", type: "USERNAME_TYPE_ENS_L2" },
			] as never),
		).toEqual({ fname: "someone", attestations: ["someone.base.eth"] });
	});

	test("empty, missing, and malformed rows degrade honestly", () => {
		expect(splitUsernameProofs([])).toEqual({ fname: null, attestations: [] });
		expect(splitUsernameProofs(undefined)).toEqual({
			fname: null,
			attestations: [],
		});
		expect(
			splitUsernameProofs([
				{},
				{ name: "", type: "USERNAME_TYPE_FNAME" },
				{ name: 42, type: "USERNAME_TYPE_FNAME" },
			] as never),
		).toEqual({ fname: null, attestations: [] });
	});
});
