import { Elysia, t } from "elysia";
import { getFidByUsername } from "../lib/fsu";
import { getUsernameByFid } from "../lib/hub-api";
import { getUserByFid } from "../lib/hydration";

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
			const fid = await getFidByUsername(username);
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
		async ({ params: { fid } }) => {
			const user = await getUserByFid(fid);
			return {
				success: true,
				user,
			};
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
									user: Object({
										fid: t.Number(),
										username: t.String(),
										displayName: t.String(),
										pfpUrl: t.String(),
										primaryAddress: t.String(),
										proNftOrder: t.Number(),
									}),
								}),
							},
						},
					},
				},
			},
		},
	);
