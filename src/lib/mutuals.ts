import { sift, sort } from "radash";
import { getFollowingByFid } from "./hub-api";

export const getMutualsByFids = async (fids: number[]) => {
    const follows0 = await getFollowingByFid(fids[0]);
    const follows1 = await getFollowingByFid(fids[1]);
    return sort(sift(follows0.filter((fid) => follows1.includes(fid))), (item) => item);
};