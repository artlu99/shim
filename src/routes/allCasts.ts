import { Elysia, t } from "elysia";
import { getFidByUsername } from "../lib/fsu";
import { getCastsByFid } from "../lib/hub-grpc";
import { CastSchema } from "../types";

export const getAllCastsAndRepliesByUsername = new Elysia().get(
	"/:username/casts-and-replies",
	async ({ params: { username }, query: { limit } }) => {
		const fid = await getFidByUsername(username);

		if (!fid) {
			return {
				success: false,
				error: "getFidByUserName: User not found",
			};
		}

		const { casts } = await getCastsByFid(fid, limit);

		return {
			success: true,
			casts: casts.slice(0, limit),
		};
	},
	{
		params: t.Object({
			username: t.String(),
		}),
		query: t.Object({
			limit: t.Number({ default: 10 }),
		}),
		detail: {
			tags: ["Cast"],
			summary: "Get N latest casts and replies by username",
			responses: {
				200: {
					description: "Returns all casts and replies",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								casts: t.Array(CastSchema),
							}),
						},
					},
				},
			},
		},
	},
);
