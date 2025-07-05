import ProgressBar from 'progress';
import invariant from "tiny-invariant";
import { VERBOSE_LOGGING } from './../constants';
import { getFollowingByFid } from "./hub-api";
import { getMutualsByFid, getUnprocessedMutuals, upsertMutuals } from "./postgres";

export const getMutuals = async (fid: number) => {
    const mutuals = await getMutualsByFid(fid);
    return mutuals.map((m) => m.fid);
};

export const generateMutualsToCheck = async (fid: number) => {
    const following = await getFollowingByFid(fid);
    VERBOSE_LOGGING && console.log(`fid ${fid} is following ${following.length} fids`);

    if (following.length === 0) {
        console.log('No following found');
        return;
    }

    const startTime = Date.now();
    const bar = new ProgressBar(
        'Generating mutuals [:bar] :percent | :current/:total | :rate it/s | ETA: :etas | :message',
        {
            total: following.length,
            width: 30,
            complete: '=',
            incomplete: ' ',
        }
    );

    // Suppress console.log
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (..._args: unknown[]) => { };
    console.error = (msg: unknown, ...args: unknown[]) => {
        originalError(msg, ...args);
    };

    let processedCount = 0;
    let skippedCount = 0;

    try {
        for (const followingFid of following) {
            bar.tick({ message: `Processing ${fid} -> ${followingFid}` });

            if (fid === followingFid) {
                skippedCount++;
                continue;
            }

            await upsertMutuals({ fids: [fid, followingFid], is_mutual: null });
            processedCount++;
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

    console.log(`✅ Generated ${processedCount} mutuals to check (skipped ${skippedCount} self-follows) in ${elapsed}`);
};

export const processUnprocessedMutuals = async () => {
    const unprocessedMutuals = await getUnprocessedMutuals()

    if (unprocessedMutuals.length === 0) {
        console.log('No unprocessed mutuals found');
        return;
    }

    const startTime = Date.now();

    const bar = new ProgressBar(
        'Processing [:bar] :percent | :current/:total | :rate it/s | ETA: :etas | :message',
        {
            total: unprocessedMutuals.length,
            width: 30,
            complete: '=',
            incomplete: ' ',
        }
    );

    // Suppress console.log
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (..._args: unknown[]) => { };
    console.error = (msg: unknown, ...args: unknown[]) => {
        originalError(msg, ...args);
    };

    let successCount = 0;
    let errorCount = 0;

    try {
        for (let idx = 0; idx < unprocessedMutuals.length; idx++) {
            const mutuals = unprocessedMutuals[idx];
            bar.tick({ message: `Processing ${mutuals[0]} and ${mutuals[1]}` });

            try {
                await updateMutuals(mutuals);
                successCount++;
            } catch (error) {
                errorCount++;
                originalError(`Error processing mutuals ${mutuals[0]} and ${mutuals[1]}:`, error);
            }
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

    if (errorCount === 0) {
        console.log(`✅ Successfully processed ${successCount} mutuals in ${elapsed}`);
    } else {
        console.log(`⚠️  Processed ${successCount} mutuals, ${errorCount} errors in ${elapsed}`);
    }
};

export const updateMutuals = async (fids: number[]) => {
    invariant(fids.length === 2, "fids must be an array of two numbers");
    invariant(fids[0] !== fids[1], "fids must be different");

    const following = await getFollowingByFid(fids[0]);
    const follBacks = await getFollowingByFid(fids[1]);
    const is_mutual = following.includes(fids[1]) && follBacks.includes(fids[0]);

    upsertMutuals({ fids, is_mutual });

    return is_mutual;
}
