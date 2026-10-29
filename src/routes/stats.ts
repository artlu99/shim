import { Elysia, t } from "elysia";
import { HTTP_FAN_OUT_BATCH_SIZE } from "../constants";
import { getUsernameByFid } from "../lib/hub-api";
import { getStats } from "../lib/postgres";
import { mapBatch } from "../lib/util";

const formatTimestamp = (ts: string) =>
	new Date(Number(ts) * 1000).toISOString();

export const stats = new Elysia().get(
	"/stats",
	async () => {
		const dbStats = await getStats();

		return {
			success: true,
			stats: {
				total: {
					...dbStats.total,
					earliest: formatTimestamp(
						dbStats.total?.earliest ? dbStats.total.earliest.toString() : "0",
					),
					latest: formatTimestamp(
						dbStats.total?.latest ? dbStats.total.latest.toString() : "0",
					),
				},
				top: await mapBatch(
					dbStats.topFids,
					async (tf) => {
						const username = await getUsernameByFid(tf.fid);
						return {
							...tf,
							earliest: formatTimestamp((tf.earliest as string).toString()),
							latest: formatTimestamp((tf.latest as string).toString()),
							username,
						};
					},
					HTTP_FAN_OUT_BATCH_SIZE,
				),
			},
		};
	},
	{
		detail: {
			tags: ["Stats"],
			summary: "Get statistics",
			responses: {
				200: {
					description: "Returns statistics",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								stats: Object({
									total: Object({
										count: t.Number(),
										earliest: t.String(),
										latest: t.String(),
									}),
									top: t.Array(
										Object({
											fid: t.Number(),
											username: t.String(),
											count: t.Number(),
											earliest: t.String(),
											latest: t.String(),
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
