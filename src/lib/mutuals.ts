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

    for (const followingFid of following) {
        if (fid === followingFid) {
            continue;
        }
        upsertMutuals({ fids: [fid, followingFid], is_mutual: null });
    }
};

export const processUnprocessedMutuals = async () => {
    const unprocessedMutuals = await getUnprocessedMutuals();
    VERBOSE_LOGGING && console.log(`processing ${unprocessedMutuals.length} unprocessed mutuals`);

    for (let idx = 0; idx < unprocessedMutuals.length; idx++) {
        const mutuals = unprocessedMutuals[idx];
        VERBOSE_LOGGING && console.log(`${idx + 1}/${unprocessedMutuals.length}, processing ${mutuals[0]} and ${mutuals[1]}`);
        await updateMutuals(mutuals);
    }
}

export const updateMutuals = async (fids: number[]) => {
    invariant(fids.length === 2, "fids must be an array of two numbers");
    invariant(fids[0] !== fids[1], "fids must be different");

    const following = await getFollowingByFid(fids[0]);
    const follBacks = await getFollowingByFid(fids[1]);
    const is_mutual = following.includes(fids[1]) && follBacks.includes(fids[0]);

    upsertMutuals({ fids, is_mutual });

    return is_mutual;
}
