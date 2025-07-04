import { Elysia, t } from "elysia";
import { getMutuals, updateMutuals } from "../lib/mutuals";

export const mutuals = new Elysia().get(
	"/mutuals/:fid",
	async ({ params }) => {
		const fids = await getMutuals(Number(params.fid));
		return { success: true, mutuals: { count: fids.length, fids } };
	},
	{
		detail: {
			tags: ["Follows"],
			summary: "Get mutuals. Static data.",
			params: t.Object({
				fid: t.String({ pattern: "^\\d+$" }),
			}),
			responses: {
				200: {
					description: "Returns a list of mutual FIDs (follows, is followed by). Does NOT hit Snapchain.",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								mutuals: Object({
									fids: t.Array(t.Number()),
									count: t.Number(),
								}),
							}),
						},
					},
				},
			},
		},
	},
).get(
	"/checkMutuals/:fid1/:fid2",
	async ({ params }) => {
		const isMutual = await updateMutuals([Number(params.fid1), Number(params.fid2)]);
		return { success: true, isMutual };
	},
	{
		detail: {
			tags: ["Follows"],
			summary: "Check if two fids are mutual. Live.",
			params: t.Object({
				fid1: t.String({ pattern: "^\\d+$" }),
				fid2: t.String({ pattern: "^\\d+$" }),
			}),
			responses: {
				200: {
					description: "Returns true if the two fids are mutuals",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								isMutual: t.Boolean(),
							}),
						},
					},
				},
			},
		},
	},
);
