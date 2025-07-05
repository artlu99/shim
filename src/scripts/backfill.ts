import ProgressBar from 'progress';
import { unique } from 'radash';
import { getFollowingByFid } from "../lib/hub-api";
import { getMutualsForFid, insertFollows } from "../lib/postgres";

const fids: number[] = [5650, 37]; //5650, 37, 1689, 977233, 2, 3, 4528, 234616];
const moreFids: number[] = []; // await getFollowingByFid(234616);
const allFids = unique([...fids, ...moreFids]);

const startTime = Date.now();
const bar = new ProgressBar(
    'Processing fid [:bar] :percent | :current/:total | :rate it/s | ETA: :etas | :message',
    {
        total: allFids.length,
        width: 30,
        complete: '=',
        incomplete: ' ',
    }
);

const originalLog = console.log;
const originalError = console.error;
console.log = (..._args: unknown[]) => { };
console.error = (..._args: unknown[]) => { };

try {
    for (const fid of allFids) {
        let message = `Processing ${fid}`;

        const knwownMutuals = await getMutualsForFid(fid);
        if (knwownMutuals.length > 0) {
            message = `${fid} has ${knwownMutuals.length} known mutuals, skipping`;
        } else {
            const follows = await getFollowingByFid(fid);
            if (follows.length > 0) {
                const result = await insertFollows(follows.map((target) => ({ fid, target })));
                message = `Inserted ${result} follows for ${fid}`;
            } else {
                message = `No follows found for ${fid}`;
            }
        }

        bar.tick({ message });
    }
} finally {
    console.log = originalLog;
    console.error = originalError;
}

const elapsedMs = Date.now() - startTime;
const elapsed =
    elapsedMs < 1000
        ? `${elapsedMs}ms`
        : elapsedMs < 60000
            ? `${(elapsedMs / 1000).toFixed(1)}s`
            : `${Math.floor(elapsedMs / 60000)}m ${(Math.round(elapsedMs / 1000) % 60)}s`;

console.log(`✅ Successfully processed ${allFids.length} follows in ${elapsed}`);
