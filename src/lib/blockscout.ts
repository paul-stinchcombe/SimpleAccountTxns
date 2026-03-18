import { formatEther } from "viem";

type BlockscoutTransaction = {
  hash?: string;
  from?: { hash?: string } | string;
  to?: { hash?: string } | string | null;
  value?: string;
  gas_limit?: string;
  gas_price?: string;
  nonce?: string | number;
  input?: string;
  status?: string;
  block?: number;
  block_number?: number;
  block_hash?: string;
  transaction_index?: number;
  timestamp?: string;
  timeStamp?: string;
};

type BlockscoutResponse = {
  items?: BlockscoutTransaction[];
  next_page_params?: Record<string, unknown> | null;
};

type BlockscoutInternalTx = {
  from?: { hash?: string } | string | null;
  to?: { hash?: string } | string | null;
  value?: string;
  input?: string;
  type?: string;
  call_type?: string;
  trace_address?: number[];
  error?: string | null;
  success?: boolean;
};

type BlockscoutInternalTxResponse = {
  items?: BlockscoutInternalTx[];
};

export type NormalizedExplorerTx = {
  hash: string;
  chainId: string;
  from: string;
  to: string;
  value: string;
  valueFormatted: string;
  gasLimit: string;
  gasPrice: string;
  nonce: number;
  data: string;
  timestamp: bigint;
  blockNumber?: number;
  blockHash?: string;
  transactionIndex?: number;
  status?: number;
};

export type BlockscoutInternalCall = {
  depth: number;
  type: string;
  callType: string;
  from: string;
  to: string;
  valueWei: string;
  input: string;
  error?: string;
};

function normalizeAddress(value: string | { hash?: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  return value.hash?.toLowerCase() ?? null;
}

function parseTimestamp(value: string | undefined): bigint {
  if (!value) {
    return BigInt(0);
  }
  const date = new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return BigInt(0);
  }
  return BigInt(Math.floor(ms / 1000));
}

function formatWei(wei: string): string {
  try {
    return formatEther(BigInt(wei));
  } catch {
    return "0";
  }
}

export function getBlockscoutBaseUrl(chainId: string): string | null {
  const exact = process.env[`BLOCKSCOUT_API_BASE_${chainId}`];
  if (exact) {
    return exact.replace(/\/$/, "");
  }
  const normalized = process.env[`BLOCKSCOUT_API_BASE_${chainId.toLowerCase()}`];
  if (normalized) {
    return normalized.replace(/\/$/, "");
  }
  return process.env.BLOCKSCOUT_API_BASE?.replace(/\/$/, "") ?? null;
}

function parseTransaction(item: BlockscoutTransaction, chainId: string): NormalizedExplorerTx | null {
  const hash = item.hash?.toLowerCase();
  const from = normalizeAddress(item.from);
  const to = normalizeAddress(item.to);
  if (!hash || !from || !to) {
    return null;
  }

  const value = item.value ?? "0";
  const nonceRaw = typeof item.nonce === "string" ? Number(item.nonce) : (item.nonce ?? 0);

  return {
    hash,
    chainId,
    from,
    to,
    value,
    valueFormatted: formatWei(value),
    gasLimit: item.gas_limit ?? "0",
    gasPrice: item.gas_price ?? "0",
    nonce: Number.isFinite(nonceRaw) ? nonceRaw : 0,
    data: item.input ?? "0x",
    timestamp: parseTimestamp(item.timestamp ?? item.timeStamp),
    blockNumber: item.block_number ?? item.block,
    blockHash: item.block_hash,
    transactionIndex: item.transaction_index,
    status: item.status === "ok" ? 1 : item.status === "error" ? 0 : undefined,
  };
}

function toBlockNumberCursor(cursor?: string): number | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    return Number(BigInt(cursor));
  } catch {
    return undefined;
  }
}

export async function fetchBlockscoutTransactions(params: {
  baseUrl: string;
  chainId: string;
  simpleAccountAddress: string;
  limit: number;
  cursorBlock?: string;
  fromTimestampSec?: number;
  searchQuery?: string;
}): Promise<{ items: NormalizedExplorerTx[]; nextCursor?: string }> {
  const simpleAccount = params.simpleAccountAddress.toLowerCase();
  const itemsCount = Math.max(params.limit * 3, 50);
  const maxPages = Number(process.env.BLOCKSCOUT_MAX_PAGES ?? 12);
  const combined: BlockscoutTransaction[] = [];
  const seenFirstHash = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${params.baseUrl}/api/v2/addresses/${simpleAccount}/transactions`);
    url.searchParams.set("items_count", String(itemsCount));
    url.searchParams.set("page", String(page));

    const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      if (page === 1) {
        throw new Error(`Blockscout request failed with status ${response.status}`);
      }
      break;
    }
    const payload = (await response.json()) as BlockscoutResponse;
    const items = payload.items ?? [];
    if (items.length === 0) {
      break;
    }

    const firstHash = items[0]?.hash?.toLowerCase();
    if (firstHash && seenFirstHash.has(firstHash)) {
      break;
    }
    if (firstHash) {
      seenFirstHash.add(firstHash);
    }

    combined.push(...items);
    if (combined.length >= itemsCount * 2) {
      break;
    }
  }
  const cursorBlock = toBlockNumberCursor(params.cursorBlock);
  const search = params.searchQuery?.trim().toLowerCase();
  const hasSearch = Boolean(search);

  const normalized = combined
    .map((item) => parseTransaction(item, params.chainId))
    .filter((item): item is NormalizedExplorerTx => item !== null)
    .filter((item) => (cursorBlock !== undefined ? (item.blockNumber ?? 0) < cursorBlock : true))
    .filter((item) =>
      params.fromTimestampSec !== undefined ? Number(item.timestamp) >= params.fromTimestampSec : true,
    )
    .filter((item) => {
      if (!hasSearch || !search) {
        return true;
      }
      return (
        item.hash.toLowerCase().includes(search) ||
        item.from.toLowerCase().includes(search) ||
        item.to.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      const blockDelta = (b.blockNumber ?? 0) - (a.blockNumber ?? 0);
      if (blockDelta !== 0) {
        return blockDelta;
      }
      return Number(b.timestamp - a.timestamp);
    });

  const unique = new Map<string, NormalizedExplorerTx>();
  for (const tx of normalized) {
    if (!unique.has(tx.hash)) {
      unique.set(tx.hash, tx);
    }
  }
  const items = [...unique.values()].slice(0, params.limit);
  const last = items.at(-1);
  const nextCursor =
    last?.blockNumber !== undefined && last.blockNumber > 0
      ? `0x${BigInt(last.blockNumber).toString(16)}`
      : undefined;

  return { items, nextCursor };
}

function normalizeInternalCall(item: BlockscoutInternalTx): BlockscoutInternalCall | null {
  const from = normalizeAddress(item.from);
  const to = normalizeAddress(item.to);
  if (!from || !to) {
    return null;
  }

  return {
    depth: item.trace_address?.length ?? 0,
    type: item.type ?? item.call_type ?? "call",
    callType: item.call_type ?? item.type ?? "call",
    from,
    to,
    valueWei: item.value ?? "0",
    input: item.input ?? "0x",
    error: item.success === false ? (item.error ?? "Reverted") : (item.error ?? undefined),
  };
}

export async function fetchBlockscoutInternalTransactions(params: {
  baseUrl: string;
  hash: string;
}): Promise<BlockscoutInternalCall[]> {
  const txHash = params.hash.toLowerCase();
  const url = new URL(`${params.baseUrl}/api/v2/transactions/${txHash}/internal-transactions`);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Blockscout internal-transactions request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as BlockscoutInternalTxResponse | BlockscoutInternalTx[];
  const items = Array.isArray(payload) ? payload : (payload.items ?? []);
  return items.map((item) => normalizeInternalCall(item)).filter((item): item is BlockscoutInternalCall => item !== null);
}
