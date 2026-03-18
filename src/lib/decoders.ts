import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, toFunctionSelector, type Abi, type AbiFunction } from "viem";

export type ArtifactLike = {
  contractName?: string;
  abi?: unknown;
};

type DecoderEntry = {
  contractNames: Set<string>;
  functionAbi: AbiFunction;
  signature: string;
};

export type DecodedMethodArg = {
  name: string;
  type: string;
  value: string;
  nestedDecodedMethod?: DecodedMethodCall;
};

export type DecodedMethodCall = {
  selector: string;
  status: "decoded" | "empty" | "unknown" | "invalid";
  functionName?: string;
  signature?: string;
  args?: DecodedMethodArg[];
  contractNames?: string[];
  error?: string;
};

type DecoderIndex = Map<string, DecoderEntry[]>;
type DecoderByContract = Map<string, DecoderEntry[]>;

let cachedIndex: DecoderIndex | null = null;
let cachedByContract: DecoderByContract | null = null;

type DecodeMethodOptions = {
  preferredContractNames?: string[];
  recursivelyDecodeBytesArgs?: boolean;
  maxRecursionDepth?: number;
};

const KNOWN_WRAPPER_FUNCTIONS: AbiFunction[] = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest", type: "address[]" },
      { name: "value", type: "uint256[]" },
      { name: "func", type: "bytes[]" },
    ],
    outputs: [],
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSignature(functionAbi: AbiFunction): string {
  const paramTypes = (functionAbi.inputs ?? []).map((input) => input.type).join(",");
  return `${functionAbi.name}(${paramTypes})`;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toJsonSafe(nestedValue)]),
    );
  }
  return value;
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(toJsonSafe(value));
  } catch {
    return String(value);
  }
}

function formatDecodedArgs(functionAbi: AbiFunction, args: readonly unknown[]): DecodedMethodArg[] {
  const inputs = functionAbi.inputs ?? [];
  return args.map((arg, index) => ({
    name: inputs[index]?.name || `arg${index}`,
    type: inputs[index]?.type || "unknown",
    value: stringifyArg(arg),
  }));
}

function buildDecoderData(artifacts: ArtifactLike[]): {
  index: DecoderIndex;
  byContract: DecoderByContract;
} {
  const index: DecoderIndex = new Map();
  const byContract: DecoderByContract = new Map();
  for (const artifact of artifacts) {
    if (!Array.isArray(artifact.abi)) {
      continue;
    }
    const contractName = artifact.contractName ?? "UnknownContract";
    for (const item of artifact.abi) {
      if (!isObject(item) || item.type !== "function" || typeof item.name !== "string") {
        continue;
      }

      const functionAbi = item as AbiFunction;
      const signature = toSignature(functionAbi);
      const selector = toFunctionSelector(signature).toLowerCase();
      const entries = index.get(selector) ?? [];

      const existingEntry = entries.find((entry) => entry.signature === signature);
      if (existingEntry) {
        existingEntry.contractNames.add(contractName);
        index.set(selector, entries);
        continue;
      }

      entries.push({
        contractNames: new Set([contractName]),
        functionAbi,
        signature,
      });
      index.set(selector, entries);

      const contractKey = normalizeContractNameCandidate(contractName);
      const contractEntries = byContract.get(contractKey) ?? [];
      if (!contractEntries.some((entry) => entry.signature === signature)) {
        contractEntries.push({
          contractNames: new Set([contractName]),
          functionAbi,
          signature,
        });
      }
      byContract.set(contractKey, contractEntries);
    }
  }
  return { index, byContract };
}

function walkJsonFiles(baseDir: string): string[] {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(baseDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(absolutePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".dbg.json")) {
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function loadArtifactsFromPublicContracts(): ArtifactLike[] {
  const contractsDir = join(process.cwd(), "public", "contracts");
  let files: string[] = [];
  try {
    files = walkJsonFiles(contractsDir);
  } catch {
    return [];
  }

  const artifacts: ArtifactLike[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ArtifactLike;
      artifacts.push(parsed);
    } catch {
      // Skip malformed/non-artifact JSON files.
    }
  }
  return artifacts;
}

function getDecoderIndex(): DecoderIndex {
  if (cachedIndex) {
    return cachedIndex;
  }
  const built = buildDecoderData(loadArtifactsFromPublicContracts());
  cachedIndex = built.index;
  cachedByContract = built.byContract;
  return cachedIndex;
}

function getDecoderByContract(): DecoderByContract {
  if (cachedByContract) {
    return cachedByContract;
  }
  const built = buildDecoderData(loadArtifactsFromPublicContracts());
  cachedIndex = built.index;
  cachedByContract = built.byContract;
  return cachedByContract;
}

function isLikelyCalldata(input: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(input);
}

function normalizeSelector(input: string): string {
  return input.slice(0, 10).toLowerCase();
}

function normalizeContractNameCandidate(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolvePreferredEntries(
  preferredContractNames: string[] | undefined,
  indexEntries: DecoderEntry[] | undefined,
): DecoderEntry[] | undefined {
  if (!indexEntries || indexEntries.length === 0) {
    return indexEntries;
  }
  if (!preferredContractNames || preferredContractNames.length === 0) {
    return indexEntries;
  }
  const wanted = new Set(preferredContractNames.map((name) => normalizeContractNameCandidate(name)));
  const filtered = indexEntries.filter((entry) =>
    [...entry.contractNames].some((name) => wanted.has(normalizeContractNameCandidate(name))),
  );
  return filtered.length > 0 ? filtered : indexEntries;
}

function tryDecodeWithKnownWrappers(
  input: string,
  index: DecoderIndex,
  options: DecodeMethodOptions | undefined,
  recursionDepth: number,
): DecodedMethodCall | null {
  const selector = normalizeSelector(input);
  for (const functionAbi of KNOWN_WRAPPER_FUNCTIONS) {
    const signature = toSignature(functionAbi);
    const knownSelector = toFunctionSelector(signature).toLowerCase();
    if (knownSelector !== selector) {
      continue;
    }
    try {
      const decoded = decodeFunctionData({
        abi: [functionAbi] as Abi,
        data: input as `0x${string}`,
      });
      const decodedArgs = Array.isArray(decoded.args) ? decoded.args : [];
      const formattedArgs = formatDecodedArgs(functionAbi, decodedArgs);
      const inputs = functionAbi.inputs ?? [];
      const argsWithNestedDecode = formattedArgs.map((arg, argIndex) => {
        const nestedDecodedMethod = maybeDecodeNestedBytesArg(
          inputs[argIndex]?.type ?? arg.type,
          decodedArgs[argIndex],
          index,
          options,
          recursionDepth,
        );
        return nestedDecodedMethod ? { ...arg, nestedDecodedMethod } : arg;
      });

      return {
        selector,
        status: "decoded",
        functionName: functionAbi.name,
        signature,
        args: argsWithNestedDecode,
        contractNames: ["KnownWrapper"],
      };
    } catch {
      return null;
    }
  }
  return null;
}

function maybeDecodeNestedBytesArg(
  argType: string,
  argValue: unknown,
  index: DecoderIndex,
  options: DecodeMethodOptions | undefined,
  recursionDepth: number,
): DecodedMethodCall | undefined {
  if (recursionDepth <= 0) {
    return undefined;
  }
  if (!options?.recursivelyDecodeBytesArgs) {
    return undefined;
  }
  if (argType === "bytes[]") {
    if (!Array.isArray(argValue)) {
      return undefined;
    }
    for (const item of argValue) {
      if (typeof item !== "string" || !isLikelyCalldata(item) || item.length < 10) {
        continue;
      }
      const decodedArrayItem = decodeMethodCallWithIndex(item, index, options, recursionDepth - 1);
      if (decodedArrayItem.status === "decoded") {
        return decodedArrayItem;
      }
    }
    return undefined;
  }
  if (argType !== "bytes") {
    return undefined;
  }
  if (typeof argValue !== "string") {
    return undefined;
  }
  if (!isLikelyCalldata(argValue) || argValue.length < 10) {
    return undefined;
  }
  const decoded = decodeMethodCallWithIndex(argValue, index, options, recursionDepth - 1);
  return decoded.status === "decoded" ? decoded : undefined;
}

export function decodeMethodCallWithIndex(
  input: string,
  index: DecoderIndex,
  options?: DecodeMethodOptions,
  recursionDepth = options?.maxRecursionDepth ?? 1,
): DecodedMethodCall {
  if (!input || input === "0x") {
    return {
      selector: "0x",
      status: "empty",
    };
  }

  if (!isLikelyCalldata(input) || input.length < 10) {
    return {
      selector: "0x",
      status: "invalid",
      error: "Input is not valid calldata.",
    };
  }

  const selector = normalizeSelector(input);
  const entries = resolvePreferredEntries(options?.preferredContractNames, index.get(selector));
  if (!entries || entries.length === 0) {
    const wrapperDecoded = tryDecodeWithKnownWrappers(input, index, options, recursionDepth);
    if (wrapperDecoded) {
      return wrapperDecoded;
    }
    return {
      selector,
      status: "unknown",
      error: "Selector not found in loaded contract artifacts.",
    };
  }

  let lastError = "Unable to decode calldata with known ABI entries.";
  for (const entry of entries) {
    try {
      const decoded = decodeFunctionData({
        abi: [entry.functionAbi] as Abi,
        data: input as `0x${string}`,
      });
      const decodedArgs = Array.isArray(decoded.args) ? decoded.args : [];
      const formattedArgs = formatDecodedArgs(entry.functionAbi, decodedArgs);
      const inputs = entry.functionAbi.inputs ?? [];
      const argsWithNestedDecode = formattedArgs.map((arg, argIndex) => {
        const nestedDecodedMethod = maybeDecodeNestedBytesArg(
          inputs[argIndex]?.type ?? arg.type,
          decodedArgs[argIndex],
          index,
          options,
          recursionDepth,
        );
        return nestedDecodedMethod ? { ...arg, nestedDecodedMethod } : arg;
      });

      return {
        selector,
        status: "decoded",
        functionName: entry.functionAbi.name,
        signature: entry.signature,
        args: argsWithNestedDecode,
        contractNames: [...entry.contractNames].sort((a, b) => a.localeCompare(b)),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unable to decode calldata.";
    }
  }

  return {
    selector,
    status: "invalid",
    error: lastError,
  };
}

export function decodeMethodCallWithArtifacts(input: string, artifacts: ArtifactLike[]): DecodedMethodCall {
  const built = buildDecoderData(artifacts);
  return decodeMethodCallWithIndex(input, built.index, {
    recursivelyDecodeBytesArgs: true,
    maxRecursionDepth: 2,
  });
}

export function decodeMethodCall(input: string, options?: DecodeMethodOptions): DecodedMethodCall {
  const decoderIndex = getDecoderIndex();
  const decoderByContract = getDecoderByContract();
  const contractHints = options?.preferredContractNames ?? [];
  const normalizedHints = contractHints.map((name) => normalizeContractNameCandidate(name));
  const mergedEntries = new Map(decoderIndex);

  for (const hint of normalizedHints) {
    const entries = decoderByContract.get(hint);
    if (!entries) {
      continue;
    }
    // Keep selector matching from global index, but allow hint list normalization variants.
    for (const entry of entries) {
      const selector = toFunctionSelector(entry.signature).toLowerCase();
      const current = mergedEntries.get(selector) ?? [];
      if (!current.some((item) => item.signature === entry.signature)) {
        current.push(entry);
      }
      mergedEntries.set(selector, current);
    }
  }

  return decodeMethodCallWithIndex(input, mergedEntries, {
    preferredContractNames: contractHints,
    recursivelyDecodeBytesArgs: options?.recursivelyDecodeBytesArgs ?? true,
    maxRecursionDepth: options?.maxRecursionDepth ?? 2,
  });
}
