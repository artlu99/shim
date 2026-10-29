import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

// sh: no `servers` entry — OpenAPI defaults to the serving origin, so /docs
// always targets whichever host renders it (dev / Render / potato). Upstream
// hardcoded https://shim.artlu.xyz here in production.

export const docs = new Elysia().use(
	swagger({
		path: "/docs",
		documentation: {
			info: {
				title: "Shim API",
				version: "0.0.1",
				description:
					"Shim API for the Farcaster Snapchain (née Hubble Protocol)",
				contact: {
					name: "artlu",
					url: "https://github.com/artlu99",
				},
				license: {
					name: "MIT",
					url: "https://opensource.org/licenses/MIT",
				},
			},
			tags: [
				{ name: "Status", description: "Status endpoints" },
				{ name: "Feed", description: "Feed endpoints" },
				{ name: "Cast", description: "Cast endpoints" },
				{ name: "F 👉👈 U", description: "Fid to Username endpoints" },
				{
					name: "Social Contract",
					description: "Social contract signature endpoints",
				},
			],
		},
	}),
);
