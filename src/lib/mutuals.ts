import { sort } from "radash";
import invariant from "tiny-invariant";
import { getFollowingByFid } from "./hub-api";
import { getMutualsForFid, insertFollows } from "./postgres";

export const getMutuals = async (fid: number): Promise<number[]> => {
    const mutuals = await getMutualsForFid(fid);
    return sort(mutuals, (m) => m.fid).map((m) => m.fid);
};

export const updateMutuals = async (fids: number[]): Promise<boolean> => {
    invariant(fids.length === 2, "fids must be an array of two numbers");
    const [fid1, fid2] = fids;
    invariant(fid1 !== fid2, "fids must be different");

    const follows1 = await getFollowingByFid(fid1);
    const follows2 = await getFollowingByFid(fid2);
    const isMutual = follows1.includes(fid2) && follows2.includes(fid1);

    if (isMutual) {
        try {
            await insertFollows([
                ...follows1.map((target) => ({ fid: fid1, target })),
                ...follows2.map((target) => ({ fid: fid2, target })),
            ]);

        } catch (e) {
            console.error(`Error inserting follows for ${fid1} and ${fid2}:`, e);
        }
    }

    return isMutual;
}