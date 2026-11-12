import { Elysia, t } from "elysia";
import { getHubFidByUsername } from "../lib/hub-api";
import { syncCastsByFid } from "../lib/cast-sync";
import { CastSchema } from "../types";

export const getAllCastsAndRepliesByUsername = new Elysia().get(
	"/:username/casts-and-replies",
	async ({ params: { username }, query: { limit }, set }) => {
		const fid = await getHubFidByUsername(username);

		if (!fid) {
			return {
				success: false,
				error: "getHubFidByUsername: User not found",
			};
		}

		let casts;
		try {
			({ casts } = await syncCastsByFid(fid, limit));
		} catch (error) {
			console.error(
				"casts-and-replies: cast sync outage:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
			set.status = 503;
			return {
				success: false,
				error: "casts-and-replies: cast sync outage",
			};
		}

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
