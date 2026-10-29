import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { docs } from "../../routes/docs";

const buildApp = () => new Elysia().use(docs).get("/stats", () => "OK");

describe("docs", () => {
	it("derives the spec server from the requesting origin", async () => {
		const res = await buildApp().handle(
			new Request("https://shim.artlu.xyz/docs/json"),
		);
		const spec = (await res.json()) as {
			servers?: Array<{ url: string }>;
		};
		expect(spec.servers).toEqual([{ url: "https://shim.artlu.xyz" }]);
	});

	it("prefers x-forwarded-proto over the request protocol", async () => {
		const res = await buildApp().handle(
			new Request("http://shim.artlu.xyz/docs/json", {
				headers: { "x-forwarded-proto": "https" },
			}),
		);
		const spec = (await res.json()) as {
			servers?: Array<{ url: string }>;
		};
		expect(spec.servers).toEqual([{ url: "https://shim.artlu.xyz" }]);
	});

	it("keeps the documented info and tags", async () => {
		const res = await buildApp().handle(
			new Request("https://shim.artlu.xyz/docs/json"),
		);
		const spec = (await res.json()) as {
			info: { title: string };
			tags: Array<{ name: string }>;
		};
		expect(spec.info.title).toBe("Shim API");
		expect(spec.tags.map((t) => t.name)).toContain("F 👉👈 U");
	});

	it("serves the serving origin on a real socket (Scalar curl host)", async () => {
		const app = buildApp();
		const server = Bun.serve({ fetch: app.fetch, port: 0 });
		try {
			const spec = (await (
				await fetch(`http://localhost:${server.port}/docs/json`)
			).json()) as { servers?: Array<{ url: string }> };
			expect(spec.servers).toEqual([
				{ url: `http://localhost:${server.port}` },
			]);
		} finally {
			server.stop(true);
		}
	});
});
