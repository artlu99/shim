import { describe, expect, it } from "bun:test";
import { pluralize, uin8ArrayToHex, hexToUint8Array } from "../../lib/util";

describe("Utility Functions", () => {
    describe("pluralize", () => {
        it("should return singular form for count of 1", () => {
            const result = pluralize(1, "cat");
            expect(result).toBe("1 cat");
        });

        it("should return plural form for count of 0", () => {
            const result = pluralize(0, "cat");
            expect(result).toBe("0 cats");
        });

        it("should return plural form for count greater than 1", () => {
            const result = pluralize(5, "cat");
            expect(result).toBe("5 cats");
        });

        it("should handle large numbers", () => {
            const result = pluralize(1000, "item");
            expect(result).toBe("1000 items");
        });

        it("should handle negative numbers", () => {
            const result = pluralize(-1, "item");
            expect(result).toBe("-1 items");
        });

        it("should handle decimal numbers", () => {
            const result = pluralize(1.5, "item");
            expect(result).toBe("1.5 items");
        });

        it("should handle empty string word", () => {
            const result = pluralize(2, "");
            expect(result).toBe("2 s");
        });

        it("should handle special characters in word", () => {
            const result = pluralize(3, "café");
            expect(result).toBe("3 cafés");
        });
    });

    describe("uin8ArrayToHex", () => {
        it("should convert Uint8Array to hex string with 0x prefix", () => {
            const arr = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0x01020304");
        });

        it("should handle empty Uint8Array", () => {
            const arr = new Uint8Array([]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0x");
        });

        it("should handle single byte", () => {
            const arr = new Uint8Array([0xFF]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0xff");
        });

        it("should handle large values", () => {
            const arr = new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0xfffefdfc");
        });

        it("should handle zero values", () => {
            const arr = new Uint8Array([0x00, 0x00, 0x00]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0x000000");
        });

        it("should handle mixed values", () => {
            const arr = new Uint8Array([0x00, 0xFF, 0x01, 0xFE]);
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0x00ff01fe");
        });

        it("should handle long arrays", () => {
            const arr = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
            const result = uin8ArrayToHex(arr);
            expect(result).toBe("0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        });
    });

    describe("hexToUint8Array", () => {
        it("should convert hex string to Uint8Array", () => {
            const hex = "0x01020304" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
        });

        it("should handle empty hex string", () => {
            const hex = "0x" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([]));
        });

        it("should handle single byte hex", () => {
            const hex = "0xff" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0xFF]));
        });

        it("should handle large values", () => {
            const hex = "0xfffefdfc" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC]));
        });

        it("should handle zero values", () => {
            const hex = "0x000000" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00]));
        });

        it("should handle mixed values", () => {
            const hex = "0x00ff01fe" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0x00, 0xFF, 0x01, 0xFE]));
        });

        it("should handle long hex strings", () => {
            const hex = "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array(Array.from({ length: 32 }, (_, i) => i)));
        });

        it("should handle uppercase hex", () => {
            const hex = "0xABCDEF" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0xAB, 0xCD, 0xEF]));
        });

        it("should handle lowercase hex", () => {
            const hex = "0xabcdef" as `0x${string}`;
            const result = hexToUint8Array(hex);
            expect(result).toEqual(new Uint8Array([0xAB, 0xCD, 0xEF]));
        });
    });

    describe("Round-trip conversion", () => {
        it("should maintain data integrity through round-trip conversion", () => {
            const original = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xFF, 0x00]);
            const hex = uin8ArrayToHex(original);
            const converted = hexToUint8Array(hex);
            expect(converted).toEqual(original);
        });

        it("should handle empty array round-trip", () => {
            const original = new Uint8Array([]);
            const hex = uin8ArrayToHex(original);
            const converted = hexToUint8Array(hex);
            expect(converted).toEqual(original);
        });

        it("should handle single byte round-trip", () => {
            const original = new Uint8Array([0xFF]);
            const hex = uin8ArrayToHex(original);
            const converted = hexToUint8Array(hex);
            expect(converted).toEqual(original);
        });

        it("should handle large array round-trip", () => {
            const original = new Uint8Array(Array.from({ length: 100 }, (_, i) => i % 256));
            const hex = uin8ArrayToHex(original);
            const converted = hexToUint8Array(hex);
            expect(converted).toEqual(original);
        });
    });
}); 