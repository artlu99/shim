import { csv as dwr } from "../static/dwr";
import { csv as mvr } from "../static/mvr";

const crew = [
	{ fid: 15983, order: 10002 }, // jacek
	{ fid: 3, order: 10007 }, // dwr.eth
	{ fid: 2, order: 10008 }, // v
];

interface ProNftDetails {
	fid: number;
	order: number;
	timestamp: number;
}

export const getProNftDetails = (fid: number): ProNftDetails | undefined => {
	const proCrastinators = crew.find((p) => p.fid === fid);
	if (proCrastinators) {
		return { ...proCrastinators, timestamp: 0 };
	}

	const above10k = mvr
		.split("\n")
		.map((l, idx) => {
			const line = l.split(`\",\"`);
			const d: ProNftDetails = {
				fid: Number(line[0].replace(`\"`, "")),
				order: 10000 + idx,
				timestamp: Number(line[6].replace('"', "")),
			};
			return d;
		})
		.find((line) => line.fid === fid);
	if (above10k) {
		return above10k;
	}

	return dwr
		.split("\n")
		.filter((line) => line.includes(`,${fid},`))
		.map((line) => line.split(","))
		.map((line) => {
			const d: ProNftDetails = {
				fid: Number(line[1]),
				order: Number(line[0]),
				timestamp: Number(line[2]),
			};
			return d;
		})
		.find((line) => line.fid === fid);
};
