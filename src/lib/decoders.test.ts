import { encodeFunctionData, type Abi } from "viem";
import { describe, expect, it } from "vitest";

import { decodeMethodCallWithArtifacts, type ArtifactLike } from "@/src/lib/decoders";

const transferFunctionAbi = {
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
} as const;

const approveFunctionAbi = {
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
} as const;

describe("decodeMethodCallWithArtifacts", () => {
  it("decodes known calldata and returns signature + named args", () => {
    const tokenArtifact: ArtifactLike = {
      contractName: "MockToken",
      abi: [transferFunctionAbi],
    };
    const calldata = encodeFunctionData({
      abi: [transferFunctionAbi] as unknown as Abi,
      functionName: "transfer",
      args: ["0x1111111111111111111111111111111111111111", BigInt(1000000)],
    });

    const result = decodeMethodCallWithArtifacts(calldata, [tokenArtifact]);

    expect(result.status).toBe("decoded");
    expect(result.selector).toBe(calldata.slice(0, 10).toLowerCase());
    expect(result.functionName).toBe("transfer");
    expect(result.signature).toBe("transfer(address,uint256)");
    expect(result.args).toEqual([
      {
        name: "to",
        type: "address",
        value: "0x1111111111111111111111111111111111111111",
      },
      {
        name: "amount",
        type: "uint256",
        value: "1000000",
      },
    ]);
  });

  it("aggregates matching selectors across multiple artifacts", () => {
    const artifacts: ArtifactLike[] = [
      { contractName: "MockTokenA", abi: [transferFunctionAbi] },
      { contractName: "MockTokenB", abi: [transferFunctionAbi, approveFunctionAbi] },
    ];
    const calldata = encodeFunctionData({
      abi: [transferFunctionAbi] as unknown as Abi,
      functionName: "transfer",
      args: ["0x2222222222222222222222222222222222222222", BigInt(42)],
    });

    const result = decodeMethodCallWithArtifacts(calldata, artifacts);

    expect(result.status).toBe("decoded");
    expect(result.contractNames).toEqual(["MockTokenA", "MockTokenB"]);
  });

  it("returns unknown for selectors missing from artifacts", () => {
    const result = decodeMethodCallWithArtifacts("0xdeadbeef", []);

    expect(result.status).toBe("unknown");
    expect(result.selector).toBe("0xdeadbeef");
  });

  it("returns invalid for malformed calldata", () => {
    const result = decodeMethodCallWithArtifacts("hello-world", []);

    expect(result.status).toBe("invalid");
    expect(result.selector).toBe("0x");
  });

  it("returns empty when input is 0x", () => {
    const result = decodeMethodCallWithArtifacts("0x", []);

    expect(result.status).toBe("empty");
    expect(result.selector).toBe("0x");
  });
});
