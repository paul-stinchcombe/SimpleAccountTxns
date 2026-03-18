import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { formatEther } from "viem";

import { getAddressLabels } from "@/src/lib/address-labels";
import {
  fetchBlockscoutTransactions,
  getBlockscoutBaseUrl,
  type NormalizedExplorerTx,
} from "@/src/lib/blockscout";
import { getChainContext } from "@/src/lib/platform";
import { prisma } from "@/src/lib/prisma";
import { createRpcClient, normalizeAddress, parseBlockCursor } from "@/src/lib/rpc";
import { TransactionsQuerySchema } from "@/src/lib/schemas";
import {
  envNumber,
  mergeTransactionsLatestFirst,
  safeLimit,
  toCursorFromBlock,
  toTransactionListItem,
  type RpcTransaction,
} from "@/src/lib/transactions";

const BACKFILL_START_TIMESTAMP_SEC = 1772323200; // 2026-03-01T00:00:00Z

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

export async function GET(request: NextRequest) {
  const parsedQuery = TransactionsQuerySchema.safeParse({
    chainId: request.nextUrl.searchParams.get("chainId"),
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        message: "Invalid query parameters.",
        issues: parsedQuery.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const { chainId } = parsedQuery.data;
    const searchQuery = parsedQuery.data.q?.trim();
    const normalizedSearch = searchQuery?.toLowerCase();
    const limit = safeLimit(parsedQuery.data.limit, 25);
    const windowSize = Math.max(10, envNumber("TX_SCAN_WINDOW", 30));
    const maxWindows = Math.max(1, envNumber("TX_SCAN_MAX_WINDOWS", 2));
    const chain = await getChainContext(chainId);
    if (!chain) {
      return NextResponse.json({ message: "Chain was not found." }, { status: 404 });
    }

    const simpleAccount = chain.simpleAccountAddress.toLowerCase();
    const cursorBlock = parseBlockCursor(parsedQuery.data.cursor);

    const searchFilter: Prisma.transactionWhereInput | undefined = normalizedSearch
      ? {
          OR: normalizedSearch.startsWith("0x")
            ? [
                { hash: { equals: normalizedSearch, mode: "insensitive" } },
                { hash: { contains: normalizedSearch, mode: "insensitive" } },
                { from: { equals: normalizedSearch, mode: "insensitive" } },
                { to: { equals: normalizedSearch, mode: "insensitive" } },
              ]
            : [
                { hash: { contains: normalizedSearch, mode: "insensitive" } },
                { from: { contains: normalizedSearch, mode: "insensitive" } },
                { to: { contains: normalizedSearch, mode: "insensitive" } },
              ],
        }
      : undefined;

    let dbRows = await prisma.transaction.findMany({
      where: {
        chainId,
        OR: [
          { from: { equals: simpleAccount, mode: "insensitive" } },
          { to: { equals: simpleAccount, mode: "insensitive" } },
        ],
        blockNumber:
          cursorBlock !== undefined
            ? { not: null, lt: Number(cursorBlock) }
            : { not: null },
        ...(searchFilter ?? {}),
      },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { timestamp: "desc" }],
      take: limit,
    });

    const blockscoutBase = getBlockscoutBaseUrl(chainId);
    const shouldSupplementFromBlockscout =
      Boolean(blockscoutBase) && (dbRows.length < limit || cursorBlock !== undefined);

    let blockscoutNextCursor: string | undefined;
    if (shouldSupplementFromBlockscout && blockscoutBase) {
      try {
        const supplemental = await fetchBlockscoutTransactions({
          baseUrl: blockscoutBase,
          chainId,
          simpleAccountAddress: chain.simpleAccountAddress,
          limit,
          cursorBlock: parsedQuery.data.cursor,
          fromTimestampSec: BACKFILL_START_TIMESTAMP_SEC,
          searchQuery: normalizedSearch,
        });
        await upsertExplorerTransactions(supplemental.items);
        blockscoutNextCursor = supplemental.nextCursor;

        dbRows = await prisma.transaction.findMany({
          where: {
            chainId,
            OR: [
              { from: { equals: simpleAccount, mode: "insensitive" } },
              { to: { equals: simpleAccount, mode: "insensitive" } },
            ],
            blockNumber:
              cursorBlock !== undefined
                ? { not: null, lt: Number(cursorBlock) }
                : { not: null },
            timestamp: { gte: BigInt(BACKFILL_START_TIMESTAMP_SEC) },
            ...(searchFilter ?? {}),
          },
          orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { timestamp: "desc" }],
          take: limit,
        });
      } catch {
        // Best effort: keep DB and RPC flows alive even if explorer is unavailable.
      }
    }

    if (dbRows.length > 0 || cursorBlock !== undefined) {
      const labels = await getAddressLabels({
        chainId,
        addresses: dbRows.flatMap((row) => [row.from, row.to]),
        simpleAccountAddress: chain.simpleAccountAddress,
      });

      const items = dbRows.map((row) => {
        const valueWei = row.value;
        const valueEth = (() => {
          try {
            return formatEther(BigInt(valueWei));
          } catch {
            return "0";
          }
        })();

        return {
          hash: row.hash,
          blockNumber: String(row.blockNumber ?? 0),
          timestamp: row.timestamp.toString(),
          from: row.from.toLowerCase(),
          to: row.to?.toLowerCase() ?? null,
          fromLabel: labels[row.from.toLowerCase()]?.label,
          toLabel: row.to ? labels[row.to.toLowerCase()]?.label : undefined,
          valueWei,
          valueEth,
        };
      });

      const last = dbRows.at(-1);
      const nextCursor =
        last && last.blockNumber !== null
          ? toCursorFromBlock(BigInt(last.blockNumber))
          : blockscoutNextCursor;

      return NextResponse.json({
        chainId: chain.chainId,
        chainName: chain.chainName,
        simpleAccountAddress: chain.simpleAccountAddress,
        items,
        pagination: {
          limit,
          nextCursor,
          hasMore: Boolean(nextCursor) && dbRows.length === limit,
        },
        source: shouldSupplementFromBlockscout ? "database+blockscout" : "database",
      });
    }

    const client = createRpcClient(chain.rpcUrl);
    const latestBlock = cursorBlock ?? (await client.getBlockNumber());

    let scanStart = latestBlock;
    let merged: RpcTransaction[] = [];
    const startedAt = Date.now();
    const maxScanMs = Math.max(3000, envNumber("TX_SCAN_MAX_MS", 10000));

    for (let windowIndex = 0; windowIndex < maxWindows && merged.length < limit; windowIndex += 1) {
      const scanEnd = scanStart > BigInt(windowSize - 1) ? scanStart - BigInt(windowSize - 1) : BigInt(0);

      for (let blockNumber = scanStart; blockNumber >= scanEnd; blockNumber -= BigInt(1)) {
        const block = await client.getBlock({ blockNumber, includeTransactions: true });
        const blockTimestamp = BigInt(block.timestamp);

        const blockMatches: RpcTransaction[] = [];
        for (const tx of block.transactions) {
          if (typeof tx === "string") {
            continue;
          }
          const from = normalizeAddress(tx.from);
          const to = normalizeAddress(tx.to);
          if (from !== simpleAccount && to !== simpleAccount) {
            continue;
          }
          if (normalizedSearch) {
            const matchesSearch =
              tx.hash.toLowerCase().includes(normalizedSearch) ||
              tx.from.toLowerCase().includes(normalizedSearch) ||
              (tx.to?.toLowerCase().includes(normalizedSearch) ?? false);
            if (!matchesSearch) {
              continue;
            }
          }

          blockMatches.push({
            hash: tx.hash,
            blockNumber,
            timestamp: blockTimestamp,
            from: tx.from,
            to: tx.to,
            value: tx.value.toString(),
          });
        }

        merged = mergeTransactionsLatestFirst(merged, blockMatches);

        if (blockNumber === BigInt(0) || merged.length >= limit || Date.now() - startedAt > maxScanMs) {
          break;
        }
      }

      if (scanEnd === BigInt(0) || merged.length >= limit || Date.now() - startedAt > maxScanMs) {
        scanStart = scanEnd;
        break;
      }
      scanStart = scanEnd - BigInt(1);
    }

    const items = merged.slice(0, limit).map(toTransactionListItem);
    const labels = await getAddressLabels({
      chainId,
      addresses: items.flatMap((item) => [item.from, item.to]),
      simpleAccountAddress: chain.simpleAccountAddress,
    });
    const itemsWithLabels = items.map((item) => ({
      ...item,
      fromLabel: labels[item.from.toLowerCase()]?.label,
      toLabel: item.to ? labels[item.to.toLowerCase()]?.label : undefined,
    }));
    const nextCursor = toCursorFromBlock(scanStart);

    return NextResponse.json({
      chainId: chain.chainId,
      chainName: chain.chainName,
      simpleAccountAddress: chain.simpleAccountAddress,
      items: itemsWithLabels,
      pagination: {
        limit,
        nextCursor,
        hasMore: Boolean(nextCursor),
      },
      source: "rpc",
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Unable to load transactions from the selected chain.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
