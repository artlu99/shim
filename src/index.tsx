import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { Html, html } from "@elysiajs/html";
import { config as dotenvConfig } from "dotenv";
import "dotenv/config";
import { Elysia } from "elysia";
import { getAllCastsAndRepliesByUsername } from "./routes/allCasts";
import { getCastByFidAndHash } from "./routes/castByFidAndHash";
import { getCastByHash } from "./routes/castByHash";
import { getCastByWarpcastUri } from "./routes/castByWarpcastUri";
import { docs } from "./routes/docs";
import { fu } from "./routes/f-u";
import {
	getReverseChronChannelFeed,
	postReverseChronFeed,
} from "./routes/feed";
import { postRefresh, processFids } from "./routes/refresh";
import { stats } from "./routes/stats";
import { livenessFids } from "./static/artlu";

dotenvConfig();

const port = process.env.PORT || 3000;

new Elysia()
	.onStart(() => console.log(`🦊 Elysia is running on port ${port}`))
	.use(cors())
	.use(docs)
	.use(stats)
	.use(fu)
	.use(getAllCastsAndRepliesByUsername)
	.use(getCastByFidAndHash)
	.use(getCastByHash)
	.use(getCastByWarpcastUri)
	.use(getReverseChronChannelFeed)
	.use(postReverseChronFeed)
	.use(postRefresh)
	.get("/health", () => "OK")
	.use(
		cron({
			name: "refresh-fids",
			pattern: "0 0 */12 * * *", // every 12 hours
			run() {
				processFids(livenessFids);
			},
		}),
	)
	.use(
		cron({
			name: "heartbeat",
			pattern: "0 0 */2 * * *", // every 2 hours
			run() {
				const memoryUsage = process.memoryUsage();
				const rss = Math.round(memoryUsage.rss / 1024 / 1024);
				console.log(`Resident Set Size: ${rss}MB`);
			},
		}),
	)
	.get(
		"/stop",
		({
			store: {
				cron: { heartbeat },
			},
		}) => {
			heartbeat.stop();

			return "Stop heartbeat";
		},
	)
	.use(html())
	.get(
		"/",
		() => (
			<html lang="en">
				<head>
					<title>Snapper Shim | by @artlu</title>
				</head>
				<body>
					<h1>
						view <a href="/docs">API documentation</a>
					</h1>
					<div>Hello Elysia 🦊 via Render</div>
				</body>
			</html>
		),
		{ detail: { hide: true } },
	)
	.listen(port);
