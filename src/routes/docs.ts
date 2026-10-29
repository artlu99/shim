import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

// Scalar does NOT fall back to the serving origin when the spec omits
// `servers` (unlike Swagger UI): it renders host-less curl snippets like
// `curl /stats`, which request a nothing host. The swagger plugin spreads
// `documentation` into the spec on every /docs/json request, so an onRequest
// hook can point this shared object at whichever origin renders the docs
// (dev / Render / potato). x-forwarded-proto wins over request.url because
// TLS terminates upstream in production.
const documentation: NonNullable<
	NonNullable<Parameters<typeof swagger>[0]>["documentation"]
> = {
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
};

export const docs = new Elysia()
	.onRequest(({ request }) => {
		const url = new URL(request.url);
		const proto =
			request.headers
				.get("x-forwarded-proto")
				?.split(",")[0]
				.trim() || url.protocol.replace(":", "");
		documentation.servers = [{ url: `${proto}://${url.host}` }];
	})
	.use(
		swagger({
			path: "/docs",
			documentation,
		}),
	);
