import { formatDistanceToNow } from "date-fns";
import { Elysia, t } from "elysia";
import { FARCASTER_EPOCH } from "../constants";

export const timestamp = new Elysia().get(
	"/timestamp/:ts",
	async ({ params: { ts } }) => {
		const unixTimestamp = FARCASTER_EPOCH + ts;
		const dateObj = new Date(unixTimestamp * 1000);
		return {
			success: true,
			distance: formatDistanceToNow(dateObj),
			unix: unixTimestamp,
			iso: dateObj.toISOString(),
			rome: dateObj.toLocaleString("it-IT", { timeZone: "Europe/Rome" }),
			paris: dateObj.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
			berlin: dateObj.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }),
			lagos: dateObj.toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
			london: dateObj.toLocaleString("en-GB", { timeZone: "Europe/London" }),
			buenos_aires: dateObj.toLocaleString("es-AR", { timeZone: "America/Buenos_Aires" }),
			new_york: dateObj.toLocaleString("en-US", { timeZone: "America/New_York" }),
			miami: dateObj.toLocaleString("en-US", { timeZone: "America/New_York" }),
			san_francisco: dateObj.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
			los_angeles: dateObj.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
			tokyo: dateObj.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
			seoul: dateObj.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
			shanghai: dateObj.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
			taipei: dateObj.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
			singapore: dateObj.toLocaleString("en-SG", { timeZone: "Asia/Singapore" }),
			jakarta: dateObj.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
			bangalore: dateObj.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
			tel_aviv: dateObj.toLocaleString("en-IL", { timeZone: "Asia/Tel_Aviv" }),
		};
	},
	{
		params: t.Object({
			ts: t.Number(),
		}),
		detail: {
			tags: ["Helpers"],
			summary: "Get time from FC timestamp.",
			// @ts-expect-error - mildly incompatible types
			responses: {
				200: {
					description: "Transforms FC timestamp into readable formats.",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								distance: t.String(),
								unix: t.Number(),
								iso: t.String(),
								rome: t.String(),
								paris: t.String(),
								berlin: t.String(),
								lagos: t.String(),
								london: t.String(),
								buenos_aires: t.String(),
								new_york: t.String(),
								miami: t.String(),
								san_francisco: t.String(),
								los_angeles: t.String(),
								tokyo: t.String(),
								seoul: t.String(),
								shanghai: t.String(),
								taipei: t.String(),
								singapore: t.String(),
								jakarta: t.String(),
								bangalore: t.String(),
								tel_aviv: t.String(),
							}),
						},
					},
				},
			},
		},
	},
);
