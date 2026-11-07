import { Elysia, t } from "elysia";
import { getHubFidByUsername, getUsernameByFid } from "../lib/hub-api";
import { getUserByFid } from "../lib/hydration";
import { withProNftDeprecation } from "../lib/pro-nft";

export const fu = new Elysia()
	.get(
		"/u/:fid",
		async ({ params: { fid } }) => {
			const username = await getUsernameByFid(fid);
			return {
				success: true,
				username,
			};
		},
		{
			params: t.Object({
				fid: t.Number(),
			}),
			detail: {
				tags: ["F 👉👈 U"],
				summary: "Get username by fid",
				responses: {
					200: {
						description: "Returns username",
						content: {
							"application/json": {
								schema: t.Object({
									success: t.Boolean(),
									username: t.String(),
								}),
							},
						},
					},
				},
			},
		},
	)
	.get(
		"/f/:username",
		async ({ params: { username } }) => {
			const fid = await getHubFidByUsername(username);
			return {
				success: true,
				fid,
			};
		},
		{
			params: t.Object({
				username: t.String(),
			}),
			detail: {
				tags: ["F 👉👈 U"],
				summary: "Get fid by username",
				responses: {
					200: {
						description: "Returns fid",
						content: {
							"application/json": {
								schema: t.Object({
									success: t.Boolean(),
									username: t.String(),
								}),
							},
						},
					},
				},
			},
		},
	)
	.get(
		"/user/:fid",
		async ({ params: { fid }, set }) => {
			const user = await getUserByFid(fid);
			return withProNftDeprecation(set, {
				success: true,
				user,
			});
		},
		{
			params: t.Object({
				fid: t.Number(),
			}),
			detail: {
				tags: ["F 👉👈 U"],
				summary: "Get hydrated user by fid",
				responses: {
					200: {
						description: "Returns a hydrated user",
						content: {
							"application/json": {
								schema: t.Object({
									success: t.Boolean(),
									warnings: t.Array(t.String()),
									user: Object({
										fid: t.Number(),
										username: t.Union([t.String(), t.Null()]),
										fname: t.Union([t.String(), t.Null()]),
										attestations: t.Array(t.String()),
										displayName: t.String(),
										pfpUrl: t.String(),
										primaryAddress: t.String(),
										// deprecated 2026-11-07; always null; remove after 2026-12-07
										proNft: t.Nullable(
											t.Object({
												order: t.Number(),
												subscribed_at: t.String(),
												expires_at: t.String(),
												status: t.Enum({
													subscribed: "subscribed",
													unsubscribed: "unsubscribed",
												}),
											}),
										),
									}),
								}),
							},
						},
					},
				},
			},
		},
	);
