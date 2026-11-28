import { Elysia, t } from "elysia";
import { hasFidSignedSocialContract } from "../lib/social-contract";
import { parseFid } from "../lib/util";

export const socialContract = new Elysia().get(
	"/signed/:fid",
	async ({ params: { fid }, set }) => {
		const parsedFid = parseFid(fid);
		if (parsedFid === undefined) {
			set.status = 400;
			return {
				success: false,
				error: "fid must be a decimal integer within the exact range",
			};
		}
		const signed = await hasFidSignedSocialContract(parsedFid);
		return {
			success: true,
			signed,
		};
	},
	{
		params: t.Object({
			fid: t.String(),
		}),
		detail: {
			tags: ["Social Contract"],
			summary: "Whether a fid has signed the social contract",
			responses: {
				200: {
					description: "Returns whether the fid has signed the social contract",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								signed: t.Boolean(),
							}),
						},
					},
				},
				400: {
					description: "fid is not a canonical decimal integer",
				},
			},
		},
	},
);
