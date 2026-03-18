import { createPublicClient, formatEther, hexToBigInt, http, type Address } from "viem";

export function createRpcClient(rpcUrl: string) {
  return createPublicClient({
    transport: http(rpcUrl),
  });
}

export function parseBlockCursor(cursor?: string): bigint | undefined {
  if (!cursor) {
    return undefined;
  }
  return hexToBigInt(cursor as `0x${string}`);
}

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

export function toAddress(address: string): Address {
  return address as Address;
}

export function formatWeiToEth(value: bigint): string {
  return formatEther(value);
}

type TraceTransactionItem = {
  action?: {
    callType?: string;
    from?: string;
    to?: string;
    value?: string;
    input?: string;
  };
  error?: string;
  traceAddress?: number[];
  type?: string;
};

type DebugTraceCall = {
  type?: string;
  from?: string;
  to?: string;
  value?: string;
  input?: string;
  output?: string;
  error?: string;
  calls?: DebugTraceCall[];
};

export type InternalCall = {
  depth: number;
  type: string;
  callType: string;
  from: string;
  to: string;
  valueWei: string;
  input: string;
  error?: string;
};

function mapTraceTransactionItem(item: TraceTransactionItem): InternalCall | null {
  if (!item.action?.from || !item.action?.to) {
    return null;
  }
  return {
    depth: item.traceAddress?.length ?? 0,
    type: item.type ?? "call",
    callType: item.action.callType ?? "call",
    from: item.action.from.toLowerCase(),
    to: item.action.to.toLowerCase(),
    valueWei: item.action.value ?? "0x0",
    input: item.action.input ?? "0x",
    error: item.error,
  };
}

function flattenDebugTrace(call: DebugTraceCall, depth = 0): InternalCall[] {
  if (!call.from || !call.to) {
    const nested = call.calls ?? [];
    return nested.flatMap((child) => flattenDebugTrace(child, depth + 1));
  }

  const current: InternalCall = {
    depth,
    type: call.type ?? "call",
    callType: call.type?.toLowerCase() ?? "call",
    from: call.from.toLowerCase(),
    to: call.to.toLowerCase(),
    valueWei: call.value ?? "0x0",
    input: call.input ?? "0x",
    error: call.error,
  };

  const nested = call.calls ?? [];
  return [current, ...nested.flatMap((child) => flattenDebugTrace(child, depth + 1))];
}

async function rpcRequest<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}.`);
  }
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? "Unknown RPC error.");
  }
  return payload.result as T;
}

export async function getInternalCalls(rpcUrl: string, hash: string): Promise<{
  calls: InternalCall[];
  source: "trace_transaction" | "debug_traceTransaction" | "none";
  unavailableReason?: string;
}> {
  try {
    const trace = await rpcRequest<TraceTransactionItem[]>(rpcUrl, "trace_transaction", [hash]);

    if (Array.isArray(trace)) {
      const calls = trace.map((item) => mapTraceTransactionItem(item)).filter((item): item is InternalCall => item !== null);

      return { calls, source: "trace_transaction" };
    }
  } catch {
    // Fallback to debug_traceTransaction.
  }

  try {
    const debugTrace = await rpcRequest<DebugTraceCall>(rpcUrl, "debug_traceTransaction", [
      hash,
      { tracer: "callTracer" },
    ]);

    if (debugTrace && typeof debugTrace === "object") {
      const calls = flattenDebugTrace(debugTrace as DebugTraceCall);
      return { calls, source: "debug_traceTransaction" };
    }
  } catch (error) {
    return {
      calls: [],
      source: "none",
      unavailableReason:
        error instanceof Error
          ? error.message
          : "Trace methods are unavailable on this RPC endpoint.",
    };
  }

  return {
    calls: [],
    source: "none",
    unavailableReason: "Trace methods are unavailable on this RPC endpoint.",
  };
}
