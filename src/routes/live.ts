import { Elysia, t } from "elysia";
import { getMutualsByFids } from "../lib/mutuals";
import { sort } from "radash";

export const mutuals = new Elysia().get(
	"/mutuals/:fid1/:fid2",
	async ({ params }) => {
		const { fid1, fid2 } = params;

		const mutualFids = await getMutualsByFids([Number(fid1), Number(fid2)]);
		const sortedMutuals = sort(mutualFids, (item) => item);

		return {
			success: true,
			mutuals: {
				count: mutualFids.length,
				fids: sortedMutuals,
			},
		};
	},
	{
		detail: {
			tags: ["Stats"],
			summary: "Get mutuals",
			params: t.Object({
				fid1: t.String({ pattern: "^\\d+$" }),
				fid2: t.String({ pattern: "^\\d+$" }),
			}),
			responses: {
				200: {
					description: "Returns mutual followers",
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
);
