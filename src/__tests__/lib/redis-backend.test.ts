import { afterEach, describe, expect, test } from "bun:test";
import { RedisError } from "../../lib/redis";
import { memoryRedis, redisMock } from "../helpers/redis-mock";

// Contract: cache-leg failures carry a "redis:" prefix, while hub-api's
// hubFailure prefixes hub-leg failures with "hub <uri>" — so a route-level
// catch can always tell which leg threw (the 2026-10-30 incident logged
// both as bare "Failed to parse JSON").
describe("RedisBackend error attribution", () => {
	afterEach(() => {
		redisMock.reset();
	});

	test("RedisError always carries the redis: prefix", () => {
		expect(new RedisError("connection refused").message).toBe(
			"redis: connection refused",
		);
		expect(new RedisError("redis: already prefixed").message).toBe(
			"redis: already prefixed",
		);
	});

	test("the memory mock surfaces outages as redis: errors", async () => {
		redisMock.failNextRequest();
		await expect(memoryRedis.get("any")).rejects.toThrow(/redis:/);
	});

	test("SET/GET round-trip JSON and raw strings", async () => {
		await memoryRedis.set("obj", { a: 1 }, { ex: 60 });
		expect(await memoryRedis.get("obj")).toEqual({ a: 1 });

		await memoryRedis.set("raw", "not-json", { ex: 60 });
		expect(await memoryRedis.get("raw")).toBe("not-json");

		await memoryRedis.set("bool", false, { ex: 60 });
		expect(await memoryRedis.get("bool")).toBe(false);
	});
});
