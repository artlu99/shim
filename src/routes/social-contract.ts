import { Elysia, t } from "elysia";
import { hasFidSignedSocialContract } from "../lib/social-contract";

export const socialContract = new Elysia().get(
	"/signed/:fid",
	async ({ params: { fid } }) => {
		const signed = await hasFidSignedSocialContract(fid);
		return {
			success: true,
			signed,
		};
	},
	{
		params: t.Object({
			fid: t.Number(),
		}),
		detail: {
			tags: ["Social Contract"],
			summary: "Whether a fid has signed the social contract",
			responses: {
				200: {
					description:
						"Returns whether the fid has signed the social contract",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								signed: t.Boolean(),
							}),
						},
					},
				},
			},
		},
	},
);
