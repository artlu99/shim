import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

const IS_DEBUGGING = process.env.NODE_ENV !== "production";
const url = IS_DEBUGGING
	? "http://localhost:3000"
	: "https://elysia-shim.onrender.com";

export const docs = new Elysia()
.use(
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
            servers: [{ url }],
            tags: [
                { name: "Status", description: "Status endpoints" },
                { name: "Feed", description: "Feed endpoints" },
                { name: "Cast", description: "Cast endpoints" },
                { name: "F 👉👈 U", description: "Fid to Username endpoints" },
            ],
        },
    }),
)