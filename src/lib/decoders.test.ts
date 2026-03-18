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

const executeFunctionAbi = {
  type: "function",
  name: "execute",
  stateMutability: "nonpayable",
  inputs: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  outputs: [],
} as const;

const executeBatchFunctionAbi = {
  type: "function",
  name: "executeBatch",
  stateMutability: "nonpayable",
  inputs: [
    { name: "dest", type: "address[]" },
    { name: "value", type: "uint256[]" },
    { name: "func", type: "bytes[]" },
  ],
  outputs: [],
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

  it("decodes known execute wrapper calls and nested calldata", () => {
    const tokenArtifact: ArtifactLike = {
      contractName: "MockToken",
      abi: [transferFunctionAbi],
    };
    const nestedTransferCalldata = encodeFunctionData({
      abi: [transferFunctionAbi] as unknown as Abi,
      functionName: "transfer",
      args: ["0x3333333333333333333333333333333333333333", BigInt(7)],
    });
    const executeCalldata = encodeFunctionData({
      abi: [executeFunctionAbi] as unknown as Abi,
      functionName: "execute",
      args: [
        "0x4444444444444444444444444444444444444444",
        BigInt(0),
        nestedTransferCalldata,
      ],
    });

    const result = decodeMethodCallWithArtifacts(executeCalldata, [tokenArtifact]);

    expect(result.status).toBe("decoded");
    expect(result.signature).toBe("execute(address,uint256,bytes)");
    expect(result.contractNames).toEqual(["KnownWrapper"]);
    const nested = result.args?.[2]?.nestedDecodedMethod;
    expect(nested?.status).toBe("decoded");
    expect(nested?.signature).toBe("transfer(address,uint256)");
  });

  it("decodes known executeBatch wrapper and nested bytes[] calldata", () => {
    const tokenArtifact: ArtifactLike = {
      contractName: "MockToken",
      abi: [approveFunctionAbi],
    };
    const nestedApproveCalldata = encodeFunctionData({
      abi: [approveFunctionAbi] as unknown as Abi,
      functionName: "approve",
      args: ["0x5555555555555555555555555555555555555555", BigInt(9)],
    });
    const executeBatchCalldata = encodeFunctionData({
      abi: [executeBatchFunctionAbi] as unknown as Abi,
      functionName: "executeBatch",
      args: [
        ["0x6666666666666666666666666666666666666666"],
        [BigInt(0)],
        [nestedApproveCalldata],
      ],
    });

    const result = decodeMethodCallWithArtifacts(executeBatchCalldata, [tokenArtifact]);

    expect(result.status).toBe("decoded");
    expect(result.signature).toBe("executeBatch(address[],uint256[],bytes[])");
    const nested = result.args?.[2]?.nestedDecodedMethod;
    expect(nested?.status).toBe("decoded");
    expect(nested?.signature).toBe("approve(address,uint256)");
  });
});
