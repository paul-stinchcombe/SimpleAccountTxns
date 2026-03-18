import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseEther } from "viem";

import { decodeTransferLogs } from "@/src/lib/transfers";

const erc20TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

const erc721TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

const erc1155TransferSingleAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "operator", type: "address" },
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "id", type: "uint256" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "TransferSingle",
    type: "event",
  },
] as const;

describe("decodeTransferLogs", () => {
  it("decodes ERC20, ERC721, and ERC1155 transfers into normalized entries", () => {
    const txHash = "0x1234";
    const token = "0x1111111111111111111111111111111111111111";
    const from = "0x2222222222222222222222222222222222222222";
    const to = "0x3333333333333333333333333333333333333333";

    const erc20Log = {
      address: token,
      data: encodeAbiParameters([{ type: "uint256" }], [parseEther("1")]),
      topics: encodeEventTopics({
        abi: erc20TransferAbi,
        eventName: "Transfer",
        args: { from, to },
      }),
      transactionHash: txHash,
      blockNumber: BigInt(100),
      logIndex: 0,
    };

    const erc721Log = {
      address: token,
      data: "0x",
      topics: encodeEventTopics({
        abi: erc721TransferAbi,
        eventName: "Transfer",
        args: { from, to, tokenId: BigInt(99) },
      }),
      transactionHash: txHash,
      blockNumber: BigInt(100),
      logIndex: 1,
    };

    const erc1155Log = {
      address: token,
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(7), BigInt(2)]),
      topics: encodeEventTopics({
        abi: erc1155TransferSingleAbi,
        eventName: "TransferSingle",
        args: { operator: from, from, to },
      }),
      transactionHash: txHash,
      blockNumber: BigInt(100),
      logIndex: 2,
    };

    const decoded = decodeTransferLogs([erc20Log, erc721Log, erc1155Log]);

    expect(decoded).toHaveLength(3);
    expect(decoded[0]).toMatchObject({
      standard: "ERC20",
      from,
      to,
      tokenAddress: token,
      value: parseEther("1").toString(),
    });
    expect(decoded[1]).toMatchObject({
      standard: "ERC721",
      tokenId: "99",
    });
    expect(decoded[2]).toMatchObject({
      standard: "ERC1155",
      tokenId: "7",
      value: "2",
    });
  });
});
