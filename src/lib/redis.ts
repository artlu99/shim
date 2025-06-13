import { Redis } from "@upstash/redis";
import invariant from "tiny-invariant";

export enum Ttl {
	SHORT = 60, // 60 seconds
	FEED = 120, // 2 Minutes
	MEDIUM = 12 * 60 * 60, // 12 hours
	LONG = 7 * 24 * 60 * 60, // 7 days
}

let redisInstance: Redis | null = null;

const redis = () => {
	if (!redisInstance) {
		invariant(
			process.env.UPSTASH_REDIS_REST_URL,
			"UPSTASH_REDIS_REST_URL is not set",
		);
		invariant(
			process.env.UPSTASH_REDIS_REST_TOKEN,
			"UPSTASH_REDIS_REST_TOKEN is not set",
		);
		redisInstance = new Redis({
			url: process.env.UPSTASH_REDIS_REST_URL ?? "",
			token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
		});
	}
	return redisInstance;
};

export default redis;
