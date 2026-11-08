import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
		"utf8",
	),
) as { version?: string };

if (!pkg.version) {
	throw new Error("package.json is missing version");
}

export const SHIM_VERSION = pkg.version;

// Baked in by the image build. Absent for `bun dev` and tests unless set.
export const SHIM_GIT_SHA = process.env.SHIM_GIT_SHA?.trim() || "unknown";
