import { describe, expect, it } from "vitest";

import { mergeTransactionsLatestFirst, toCursorFromBlock } from "@/src/lib/transactions";

describe("mergeTransactionsLatestFirst", () => {
  it("sorts transactions newest-first and de-duplicates by hash", () => {
    const result = mergeTransactionsLatestFirst(
      [
        {
          hash: "0x2",
          blockNumber: BigInt(8),
          timestamp: BigInt(120),
          from: "0x1",
          to: "0x2",
          value: "0x0",
        },
        {
          hash: "0x1",
          blockNumber: BigInt(9),
          timestamp: BigInt(130),
          from: "0x1",
          to: "0x2",
          value: "0x0",
        },
      ],
      [
        {
          hash: "0x2",
          blockNumber: BigInt(8),
          timestamp: BigInt(120),
          from: "0x1",
          to: "0x2",
          value: "0x0",
        },
      ],
    );

    expect(result.map((tx) => tx.hash)).toEqual(["0x1", "0x2"]);
  });
});

describe("toCursorFromBlock", () => {
  it("returns undefined when block number is 0", () => {
    expect(toCursorFromBlock(BigInt(0))).toBeUndefined();
  });

  it("returns a valid hex cursor for positive blocks", () => {
    expect(toCursorFromBlock(BigInt(1024))).toBe("0x400");
  });
});
