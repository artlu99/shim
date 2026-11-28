import { Elysia, t } from "elysia";
import {
	getFidByUsernameInEitherWorld,
	getUsernameByFid,
} from "../lib/hub-api";
import { getUserByFid } from "../lib/hydration";
import { hasFidSignedSocialContract } from "../lib/social-contract";
import { parseFid } from "../lib/util";

// fid params arrive as strings. They are parsed with parseFid — never
// Number()-coerced (t.Number() here would silently round above 2^53 and
// serve a neighboring fid's data) — and anything unparseable answers 400.
export const fu = new Elysia()
	.get(
		"/u/:fid",
		async ({ params: { fid }, set }) => {
			const parsedFid = parseFid(fid);
			if (parsedFid === undefined) {
				set.status = 400;
				return {
					success: false,
					error: "fid must be a decimal integer within the exact range",
				};
			}
			const username = await getUsernameByFid(parsedFid);
			return {
				success: true,
				// null, never a dropped key — native users commonly have no
				// username and clients read the field off the response
				username: username ?? null,
			};
		},
		{
			params: t.Object({
				fid: t.String(),
			}),
			detail: {
				tags: ["F 👉👈 U"],
				summary: "Get username by fid",
				responses: {
					200: {
						description: "Returns username",
						content: {
							"application/json": {
								// Object, not t.Object: the bare constructor keeps
								// t.Union assignable to the OpenAPI response type
								schema: Object({
									success: t.Boolean(),
									username: t.Union([t.String(), t.Null()]),
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
	)
	.get(
		"/f/:username",
		async ({ params: { username }, set }) => {
			let resolution;
			try {
				resolution = await getFidByUsernameInEitherWorld(username);
			} catch (error) {
				console.error(
					"/f: name lookup outage:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
				set.status = 503;
				return {
					success: false,
					error: "/f: name lookup outage",
				};
			}
			return {
				success: true,
				fid: resolution?.fid ?? null,
				origin: resolution?.origin ?? null,
				provisional: resolution?.provisional ?? false,
				followerCount: resolution?.followerCount ?? null,
				profileUsername: resolution?.profileUsername ?? null,
			};
		},
		{
			params: t.Object({
				username: t.String(),
			}),
			detail: {
				tags: ["F 👉👈 U"],
				summary: "Get fid by username (fork-aware)",
				description:
					"Snapchain is primary and canonical; Hypersnap answers only " +
					"on a Snapchain miss and is provisional — names are not " +
					"uniquely owned in Hypersnap world (collisions are decided " +
					"by fid and social popularity), so its answers carry the " +
					"fork profile's follower count and username for judging. " +
					"An outage answers 503, never a false miss.",
				responses: {
					200: {
						description:
							"Returns the resolved fid, or null when both registries miss",
						content: {
							"application/json": {
								// Object, not t.Object: the bare constructor keeps
								// t.Union assignable to the OpenAPI response type
								schema: Object({
									success: t.Boolean(),
									fid: t.Union([t.Number(), t.Null()]),
									origin: t.Union([
										t.Literal("snapchain"),
										t.Literal("hypersnap"),
										t.Null(),
									]),
									provisional: t.Boolean(),
									followerCount: t.Union([t.Number(), t.Null()]),
									profileUsername: t.Union([t.String(), t.Null()]),
								}),
							},
						},
					},
					503: {
						description:
							"A name registry failed without answering — an outage, not a miss",
					},
				},
			},
		},
	)
	.get(
		"/user/:fid",
		async ({ params: { fid }, set }) => {
			const parsedFid = parseFid(fid);
			if (parsedFid === undefined) {
				set.status = 400;
				return {
					success: false,
					error: "fid must be a decimal integer within the exact range",
				};
			}
			const [user, signed] = await Promise.all([
				getUserByFid(parsedFid),
				hasFidSignedSocialContract(parsedFid),
			]);
			return {
				success: true,
				user: { ...user, signed },
			};
		},
		{
			params: t.Object({
				fid: t.String(),
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
										username: t.Union([t.String(), t.Null()]),
										fname: t.Union([t.String(), t.Null()]),
										attestations: t.Array(t.String()),
										displayName: t.String(),
										pfpUrl: t.String(),
										primaryAddress: t.String(),
										signed: t.Boolean(),
									}),
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
