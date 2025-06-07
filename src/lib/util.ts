export const pluralize = (count: number, word: string, suffix = "s") => {
	if (count === 1) {
		return `${count} ${word}`;
	}
	return `${count} ${word}${suffix}`;
};

export const uin8ArrayToHex = (arr: Uint8Array): `0x${string}` => {
	return `0x${Buffer.from(arr).toString("hex")}`;
};

export const hexToUint8Array = (hex: `0x${string}`) => {
	return new Uint8Array(Buffer.from(hex.slice(2), "hex"));
};
