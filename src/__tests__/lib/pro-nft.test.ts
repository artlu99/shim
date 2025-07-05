import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { getProNftDetails } from "../../lib/pro-nft";

// Mock the dependencies
const mockDbInstance = mock(() => ({
    selectFrom: mock(() => ({
        selectAll: mock(() => ({
            where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve(null)),
            })),
        })),
    })),
}));

const mockKysely = mock(() => mockDbInstance());
const mockNeonDialect = mock(() => ({}));

// Mock the static CSV data
const mockMvrCsv = `"fid","username","display_name","address","transaction_hash","block_number","timestamp","follower_count","sequence","following_count","verified_accounts","score","spam_label","spam_label_updated","rewards_score","rewards_cents","purchase_type"
"1077239","!1077239","richerjack","0x6fba1340acd896eddf39b84685d293627089c07b","0x0bdcc740100a6e737b303c56066ca8dd5559b8661b0389b8f193857eb5878156","30793495","1748376337","0","10001","0",,"0.11",,,"0","0","usdc"
"1091140","mugumugu","mugu","0xa088ef2ebcf65010ab6da3834a099ee6876cebca","0xbfcbe777f0fa7e4810d90963812e7e2b9e312cb60b1ea1bb10dc210cdeff4e48","30793540","1748376427","8","10002","21","x:mimirangkr","0.5",,,"0","0","usdc"
"680","woj.eth","​woj","0x58fe7e684650eebc7b1fdaea33c67961dd2e6c0e","0xce750779adaaeacae0117dec60854895871f008c953a814dfe1f2182042b8223","30793960","1748377267","241278","10003","1336","x:superwoj","0.99","2","1738450953","118892","19000","usdc"`;

const mockDwrCsv = `subscriber_number,fid,created_at_timestamp
1,549521,1748376022.02841
2,451,1748376045.92279
3,240221,1748376049.28516
4,312016,1748376064.00024
5,583095,1748376097.74266`;

describe("Pro NFT Functions", () => {
    beforeAll(() => {
        // Mock the modules
        mock.module("kysely", () => ({
            Kysely: mockKysely,
        }));

        mock.module("kysely-neon", () => ({
            NeonDialect: mockNeonDialect,
        }));

        mock.module("tiny-invariant", () => ({
            default: mock((condition: boolean, message: string) => {
                if (!condition) {
                    throw new Error(message);
                }
            }),
        }));

        mock.module("../../static/mvr", () => ({
            csv: mockMvrCsv,
        }));

        mock.module("../../static/dwr", () => ({
            csv: mockDwrCsv,
        }));
    });

    beforeEach(() => {
        // Reset all mocks
        mockDbInstance.mockClear();
        mockKysely.mockClear();
        mockNeonDialect.mockClear();
    });

    afterAll(() => {
        // Restore all mocks
        mock.restore();
    });

    describe("getProNftDetails", () => {
        it("should return MVR data for fid in above 10k list", async () => {
            const fid = 1077239;
            const result = await getProNftDetails(fid);

            expect(result).toEqual({
                fid: 1077239,
                order: 10001, // 10000 + 0 (first entry)
                timestamp: 1748376337,
            });
        });

        it("should return MVR data for another fid in above 10k list", async () => {
            const fid = 680;
            const result = await getProNftDetails(fid);

            expect(result).toEqual({
                fid: 680,
                order: 10003, // 10000 + 2 (third entry)
                timestamp: 1748377267,
            });
        });

        it("should return DWR data for fid in snapshot CSV", async () => {
            const fid = 549521;
            const result = await getProNftDetails(fid);

            expect(result).toEqual({
                fid: 549521,
                order: 1, // subscriber_number
                timestamp: 1748376022.02841,
            });
        });

        it("should return DWR data for another fid in snapshot CSV", async () => {
            const fid = 451;
            const result = await getProNftDetails(fid);

            expect(result).toEqual({
                fid: 451,
                order: 2, // subscriber_number
                timestamp: 1748376045.92279,
            });
        });

        it("should prioritize MVR data over DWR data", async () => {
            // Add a fid that exists in both MVR and DWR to test priority
            const extendedMvrCsv = `${mockMvrCsv}
"451","test","test","0x123","0x456","123","1748376000","0","10004","0",,"0.5",,,"0","0","usdc"`;

            // Temporarily mock the MVR module with extended data
            mock.module("../../static/mvr", () => ({
                csv: extendedMvrCsv,
            }));

            const fid = 451;
            const result = await getProNftDetails(fid);

            // Should return MVR data (order 10004) not DWR data (order 2)
            expect(result).toEqual({
                fid: 451,
                order: 10004,
                timestamp: 1748376000,
            });
        });

        it("should handle CSV parsing with extra whitespace", async () => {
            const whitespaceMvrCsv = `"fid","username","display_name","address","transaction_hash","block_number","timestamp","follower_count","sequence","following_count","verified_accounts","score","spam_label","spam_label_updated","rewards_score","rewards_cents","purchase_type"
" 1077239 ","!1077239","richerjack","0x6fba1340acd896eddf39b84685d293627089c07b","0x0bdcc740100a6e737b303c56066ca8dd5559b8661b0389b8f193857eb5878156","30793495"," 1748376337 ","0","10001","0",,"0.11",,,"0","0","usdc"`;

            mock.module("../../static/mvr", () => ({
                csv: whitespaceMvrCsv,
            }));

            const fid = 1077239;
            const result = await getProNftDetails(fid);

            expect(result).toEqual({
                fid: 1077239,
                order: 10001,
                timestamp: 1748376337,
            });
        });

        it("should handle CSV parsing with missing fields", async () => {
            const incompleteMvrCsv = `"fid","username","display_name","address","transaction_hash","block_number","timestamp","follower_count","sequence","following_count","verified_accounts","score","spam_label","spam_label_updated","rewards_score","rewards_cents","purchase_type"
"1077239","!1077239","richerjack","0x6fba1340acd896eddf39b84685d293627089c07b","0x0bdcc740100a6e737b303c56066ca8dd5559b8661b0389b8f193857eb5878156","30793495","1748376337","0","10001"`;

            mock.module("../../static/mvr", () => ({
                csv: incompleteMvrCsv,
            }));

            const fid = 1077239;
            const result = await getProNftDetails(fid);

            // Should handle missing fields gracefully
            expect(result).toEqual({
                fid: 1077239,
                order: 10001,
                timestamp: 1748376337,
            });
        });

        it("should return undefined for fid not in any CSV data", async () => {
            const fid = 999999;
            const result = await getProNftDetails(fid);

            expect(result).toBeUndefined();
        });

        it("should handle edge case with zero fid", async () => {
            const zeroFid = 0;
            const result = await getProNftDetails(zeroFid);

            expect(result).toBeUndefined();
        });

        it("should handle edge case with negative fid", async () => {
            const negativeFid = -1;
            const result = await getProNftDetails(negativeFid);

            expect(result).toBeUndefined();
        });

        it("should handle edge case with very large fid numbers", async () => {
            const largeFid = 999999999;
            const result = await getProNftDetails(largeFid);

            expect(result).toBeUndefined();
        });

        it("should handle malformed CSV data gracefully", async () => {
            const malformedMvrCsv = `"fid","username","display_name","address","transaction_hash","block_number","timestamp","follower_count","sequence","following_count","verified_accounts","score","spam_label","spam_label_updated","rewards_score","rewards_cents","purchase_type"
"invalid","!1077239","richerjack","0x6fba1340acd896eddf39b84685d293627089c07b","0x0bdcc740100a6e737b303c56066ca8dd5559b8661b0389b8f193857eb5878156","30793495","1748376337","0","10001","0",,"0.11",,,"0","0","usdc"`;

            mock.module("../../static/mvr", () => ({
                csv: malformedMvrCsv,
            }));

            const fid = 1077239;
            const result = await getProNftDetails(fid);

            // Should return undefined because the fid is "invalid" (not a number)
            expect(result).toBeUndefined();
        });

        it("should handle empty CSV data", async () => {
            mock.module("../../static/mvr", () => ({
                csv: "",
            }));

            mock.module("../../static/dwr", () => ({
                csv: "",
            }));

            const fid = 1077239;
            const result = await getProNftDetails(fid);

            expect(result).toBeUndefined();
        });

        it("should handle CSV data with only headers", async () => {
            const headerOnlyMvrCsv = '"fid","username","display_name","address","transaction_hash","block_number","timestamp","follower_count","sequence","following_count","verified_accounts","score","spam_label","spam_label_updated","rewards_score","rewards_cents","purchase_type"';
            const headerOnlyDwrCsv = "subscriber_number,fid,created_at_timestamp";

            mock.module("../../static/mvr", () => ({
                csv: headerOnlyMvrCsv,
            }));

            mock.module("../../static/dwr", () => ({
                csv: headerOnlyDwrCsv,
            }));

            const fid = 1077239;
            const result = await getProNftDetails(fid);

            expect(result).toBeUndefined();
        });
    });
});
