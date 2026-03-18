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

let cachedIndex: DecoderIndex | null = null;

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

function buildDecoderIndex(artifacts: ArtifactLike[]): DecoderIndex {
  const index: DecoderIndex = new Map();
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
    }
  }
  return index;
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
  cachedIndex = buildDecoderIndex(loadArtifactsFromPublicContracts());
  return cachedIndex;
}

function isLikelyCalldata(input: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(input);
}

function normalizeSelector(input: string): string {
  return input.slice(0, 10).toLowerCase();
}

export function decodeMethodCallWithIndex(input: string, index: DecoderIndex): DecodedMethodCall {
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
  const entries = index.get(selector);
  if (!entries || entries.length === 0) {
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

      return {
        selector,
        status: "decoded",
        functionName: entry.functionAbi.name,
        signature: entry.signature,
        args: formatDecodedArgs(entry.functionAbi, decodedArgs),
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
  return decodeMethodCallWithIndex(input, buildDecoderIndex(artifacts));
}

export function decodeMethodCall(input: string): DecodedMethodCall {
  return decodeMethodCallWithIndex(input, getDecoderIndex());
}
