import { formatEther } from "viem";

export type RpcTransaction = {
  hash: `0x${string}` | string;
  blockNumber: bigint;
  timestamp: bigint;
  from: `0x${string}` | string;
  to: `0x${string}` | string | null;
  value: `0x${string}` | string;
};

export function mergeTransactionsLatestFirst(
  base: RpcTransaction[],
  incoming: RpcTransaction[],
): RpcTransaction[] {
  const byHash = new Map<string, RpcTransaction>();
  for (const tx of [...base, ...incoming]) {
    byHash.set(tx.hash.toLowerCase(), tx);
  }

  return [...byHash.values()].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return Number(b.blockNumber - a.blockNumber);
    }

    return Number(b.timestamp - a.timestamp);
  });
}

export function toCursorFromBlock(block: bigint): `0x${string}` | undefined {
  if (block <= BigInt(0)) {
    return undefined;
  }
  return `0x${block.toString(16)}`;
}

export type TransactionListItem = {
  hash: string;
  blockNumber: string;
  timestamp: string;
  from: string;
  to: string | null;
  valueWei: string;
  valueEth: string;
};

export function toTransactionListItem(tx: RpcTransaction): TransactionListItem {
  const valueWei = tx.value.toString().startsWith("0x")
    ? BigInt(tx.value.toString()).toString()
    : tx.value.toString();

  return {
    hash: tx.hash.toString(),
    blockNumber: tx.blockNumber.toString(),
    timestamp: tx.timestamp.toString(),
    from: tx.from.toString().toLowerCase(),
    to: tx.to ? tx.to.toString().toLowerCase() : null,
    valueWei,
    valueEth: formatEther(BigInt(valueWei)),
  };
}

export function safeLimit(value: number, fallback = 25): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < 5) {
    return 5;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

export function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
