import { NextRequest, NextResponse } from "next/server";

import { fetchBlockscoutTransactions, getBlockscoutBaseUrl, type NormalizedExplorerTx } from "@/src/lib/blockscout";
import { listChainsWithPlatform } from "@/src/lib/platform";
import { prisma } from "@/src/lib/prisma";

const DEFAULT_FROM_TIMESTAMP_SEC = 1772323200; // 2026-03-01T00:00:00Z

async function upsertExplorerTransactions(items: NormalizedExplorerTx[]) {
  if (items.length === 0) {
    return;
  }

  await Promise.all(
    items.map((item) =>
      prisma.transaction.upsert({
        where: { hash: item.hash },
        create: {
          hash: item.hash,
          chainId: item.chainId,
          from: item.from,
          to: item.to,
          value: item.value,
          valueFormatted: item.valueFormatted,
          gasLimit: item.gasLimit,
          gasPrice: item.gasPrice,
          nonce: item.nonce,
          data: item.data,
          timestamp: item.timestamp,
          blockNumber: item.blockNumber,
          blockHash: item.blockHash,
          transactionIndex: item.transactionIndex,
          status: item.status,
        },
        update: {
          from: item.from,
          to: item.to,
          value: item.value,
          valueFormatted: item.valueFormatted,
          gasLimit: item.gasLimit,
          gasPrice: item.gasPrice,
          nonce: item.nonce,
          data: item.data,
          timestamp: item.timestamp,
          blockNumber: item.blockNumber,
          blockHash: item.blockHash,
          transactionIndex: item.transactionIndex,
          status: item.status,
        },
      }),
    ),
  );
}

function parseDateToUnixSec(value: string | null): number {
  if (!value) {
    return DEFAULT_FROM_TIMESTAMP_SEC;
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return DEFAULT_FROM_TIMESTAMP_SEC;
  }
  return Math.floor(ms / 1000);
}

export async function POST(request: NextRequest) {
  const expectedApiKey = process.env.BACKFILL_API_KEY;
  if (expectedApiKey) {
    const requestApiKey = request.headers.get("x-backfill-key");
    if (requestApiKey !== expectedApiKey) {
      return NextResponse.json({ message: "Unauthorized backfill request." }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as {
    chainId?: string;
    fromDate?: string;
    batchSize?: number;
    maxRounds?: number;
  };

  const fromTimestampSec = parseDateToUnixSec(body.fromDate ?? null);
  const batchSize = Math.max(50, Math.min(body.batchSize ?? 200, 500));
  const maxRounds = Math.max(1, Math.min(body.maxRounds ?? 100, 500));

  const chains = await listChainsWithPlatform();
  const targetChains = body.chainId ? chains.filter((chain) => chain.chainId === body.chainId) : chains;
  if (targetChains.length === 0) {
    return NextResponse.json({ message: "No matching chain(s) found for backfill." }, { status: 404 });
  }

  const summary: Array<{
    chainId: string;
    chainName: string;
    fetched: number;
    rounds: number;
    lastCursor?: string;
    status: "ok" | "skipped";
    reason?: string;
  }> = [];

  for (const chain of targetChains) {
    const baseUrl = getBlockscoutBaseUrl(chain.chainId);
    if (!baseUrl) {
      summary.push({
        chainId: chain.chainId,
        chainName: chain.chainName,
        fetched: 0,
        rounds: 0,
        status: "skipped",
        reason: "No Blockscout base URL configured for this chain.",
      });
      continue;
    }

    let cursor: string | undefined;
    let fetched = 0;
    let rounds = 0;

    for (let round = 0; round < maxRounds; round += 1) {
      const batch = await fetchBlockscoutTransactions({
        baseUrl,
        chainId: chain.chainId,
        simpleAccountAddress: chain.simpleAccountAddress,
        limit: batchSize,
        cursorBlock: cursor,
        fromTimestampSec,
      });

      if (batch.items.length === 0) {
        rounds = round + 1;
        break;
      }

      await upsertExplorerTransactions(batch.items);
      fetched += batch.items.length;
      rounds = round + 1;
      cursor = batch.nextCursor;

      const oldest = batch.items[batch.items.length - 1];
      if (!cursor || Number(oldest.timestamp) < fromTimestampSec) {
        break;
      }
    }

    summary.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      fetched,
      rounds,
      lastCursor: cursor,
      status: "ok",
    });
  }

  return NextResponse.json({
    message: "Backfill completed.",
    fromTimestampSec,
    summary,
  });
}
