import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { formatEther } from "viem";

import { getAddressLabels } from "@/src/lib/address-labels";
import { decodeMethodCall, type DecodedMethodCall } from "@/src/lib/decoders";
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

type StatusFilter = "all" | "success" | "failed";
type AccountScope = "simpleAccount" | "fundingWallet";

function toListStatus(status: number | null | undefined): "success" | "failed" | "unknown" {
  if (status === 1) {
    return "success";
  }
  if (status === 0) {
    return "failed";
  }
  return "unknown";
}

function contractHintsFromLabel(label: string | undefined): string[] {
  if (!label) {
    return [];
  }
  const lowered = label.toLowerCase();
  const hints: string[] = [];
  if (lowered.includes("simpleaccount") || lowered.includes("simple account")) {
    hints.push("SimpleAccount");
  }
  if (lowered.includes("entrypoint") || lowered.includes("entry point")) {
    hints.push("EntryPoint");
  }
  if (lowered.includes("factory")) {
    hints.push("SimpleAccountFactory");
  }
  if (lowered.includes("kami transfer")) {
    hints.push("KamiTransfer");
  }
  if (lowered.includes("kami royalty")) {
    hints.push("KamiRoyalty");
  }
  if (lowered.includes("kami rental")) {
    hints.push("KamiRental");
  }
  if (lowered.includes("kami platform")) {
    hints.push("KamiPlatform");
  }
  if (lowered.includes("kami nft core")) {
    hints.push("KamiNFTCore");
  }
  return hints;
}

function nestedDecodedMethodName(decoded: DecodedMethodCall): string | undefined {
  if (!decoded.args) {
    return undefined;
  }
  for (const arg of decoded.args) {
    const nested = arg.nestedDecodedMethod;
    if (nested?.status === "decoded" && nested.functionName) {
      return nested.functionName;
    }
  }
  return undefined;
}

function methodIntent(decoded: DecodedMethodCall): string | null {
  if (decoded.status !== "decoded") {
    return null;
  }
  const functionName = nestedDecodedMethodName(decoded) ?? decoded.functionName ?? "";
  const candidate = functionName.toLowerCase();
  if (!candidate) {
    return null;
  }

  const exactMap: Record<string, string> = {
    deploy721c: "Deploy ERC721 collection",
    deploy721ac: "Deploy ERC721A collection",
    deploy1155c: "Deploy ERC1155 collection",
    mint721c: "Mint ERC721 NFT",
    mint721ac: "Mint ERC721A NFT",
    mint1155c: "Mint ERC1155 NFT",
    burn721c: "Burn ERC721 NFT",
    burn721ac: "Burn ERC721A NFT",
    burn1155c: "Burn ERC1155 NFT",
    transfer: "Transfer assets",
    sell: "List/Sell asset",
    rent: "Start rental",
    endrental: "End rental",
    extendrental: "Extend rental",
    setprice: "Update listing price",
    settokenuri: "Update token metadata",
    setroyaltyreceivers: "Update royalty receivers",
    charges: "Charge payment",
    refund: "Refund payment",
    prefundescrow: "Prefund escrow",
    createaccount: "Create smart account",
    handleops: "Process account operations",
    validateuserop: "Validate user operation",
    getsenderaddress: "Resolve account address",
    execute: "Execute contract call",
    executebatch: "Execute batch contract calls",
    approvetransfer: "Approve transfer",
  };

  if (exactMap[candidate]) {
    return exactMap[candidate];
  }

  if (candidate.includes("mint")) return "Mint NFT";
  if (candidate.includes("refund")) return "Refund payment";
  if (candidate.includes("burn")) return "Burn NFT";
  if (candidate.includes("approve")) return "Approve token spend";
  if (candidate.includes("createaccount")) return "Create smart account";
  if (candidate.includes("handleops")) return "Process account operations";
  if (candidate.includes("extendrent")) return "Extend rental";
  if (candidate.includes("endrent")) return "End rental";
  if (candidate.includes("rent")) return "Rental action";
  if (candidate.includes("sell") || candidate.includes("list")) return "Sell/List asset";
  if (candidate.includes("setprice")) return "Update listing price";
  if (candidate.includes("settokenuri")) return "Update token metadata";
  if (candidate.includes("royalty")) return "Update royalties";
  if (candidate.includes("charge")) return "Charge payment";
  if (candidate.includes("escrow")) return "Escrow funding action";
  if (candidate.includes("transfer")) return "Transfer assets";
  if (candidate.includes("executebatch")) return "Execute batch contract calls";
  if (candidate.includes("execute")) return "Execute contract call";

  return `Contract call: ${functionName}`;
}

function summarizeTransaction(params: {
  from: string;
  valueEth: string;
  decodedMethod: DecodedMethodCall;
  accountScope: AccountScope;
  targetAddress: string;
  toLabel?: string;
}): string {
  const isOutgoing = params.from.toLowerCase() === params.targetAddress.toLowerCase();
  const direction = isOutgoing ? "Outgoing" : "Incoming";
  const intent = methodIntent(params.decodedMethod);
  if (intent) {
    return `${direction}: ${intent}`;
  }

  if (params.valueEth !== "0") {
    return isOutgoing ? `Send ${params.valueEth} ETH` : `Receive ${params.valueEth} ETH`;
  }

  if (params.toLabel) {
    return isOutgoing ? `Call ${params.toLabel}` : `Interaction from ${params.toLabel}`;
  }

  return params.accountScope === "fundingWallet" ? "Funding wallet activity" : "Account activity";
}

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
    accountScope: request.nextUrl.searchParams.get("accountScope") ?? undefined,
    status: request.nextUrl.searchParams.get("status") ?? undefined,
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
    const accountScope = parsedQuery.data.accountScope as AccountScope;
    const statusFilter = parsedQuery.data.status as StatusFilter;
    const limit = safeLimit(parsedQuery.data.limit, 25);
    const windowSize = Math.max(10, envNumber("TX_SCAN_WINDOW", 30));
    const maxWindows = Math.max(1, envNumber("TX_SCAN_MAX_WINDOWS", 2));
    const chain = await getChainContext(chainId);
    if (!chain) {
      return NextResponse.json({ message: "Chain was not found." }, { status: 404 });
    }

    const targetAddress =
      accountScope === "fundingWallet"
        ? chain.platformFundingWalletAddress.toLowerCase()
        : chain.simpleAccountAddress.toLowerCase();
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
    const statusWhere: Prisma.transactionWhereInput | undefined =
      statusFilter === "success"
        ? { status: 1 }
        : statusFilter === "failed"
          ? { status: 0 }
          : undefined;

    let dbRows = await prisma.transaction.findMany({
      where: {
        chainId,
        OR: [
          { from: { equals: targetAddress, mode: "insensitive" } },
          { to: { equals: targetAddress, mode: "insensitive" } },
        ],
        blockNumber:
          cursorBlock !== undefined
            ? { not: null, lt: Number(cursorBlock) }
            : { not: null },
        ...(searchFilter ?? {}),
        ...(statusWhere ?? {}),
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
          simpleAccountAddress: targetAddress,
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
              { from: { equals: targetAddress, mode: "insensitive" } },
              { to: { equals: targetAddress, mode: "insensitive" } },
            ],
            blockNumber:
              cursorBlock !== undefined
                ? { not: null, lt: Number(cursorBlock) }
                : { not: null },
            timestamp: { gte: BigInt(BACKFILL_START_TIMESTAMP_SEC) },
            ...(searchFilter ?? {}),
            ...(statusWhere ?? {}),
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
          status: toListStatus(row.status),
          fromLabel: labels[row.from.toLowerCase()]?.label,
          toLabel: row.to ? labels[row.to.toLowerCase()]?.label : undefined,
          summary: (() => {
            const toLabel = row.to ? labels[row.to.toLowerCase()]?.label : undefined;
            const decodedMethod = decodeMethodCall(row.data ?? "0x", {
              preferredContractNames: contractHintsFromLabel(toLabel),
              recursivelyDecodeBytesArgs: true,
              maxRecursionDepth: 2,
            });
            return summarizeTransaction({
              from: row.from,
              valueEth,
              decodedMethod,
              accountScope,
              targetAddress,
              toLabel,
            });
          })(),
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
        accountScope,
        targetAddress,
        simpleAccountAddress: chain.simpleAccountAddress,
        platformFundingWalletAddress: chain.platformFundingWalletAddress,
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
          if (from !== targetAddress && to !== targetAddress) {
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

          let txStatus: "success" | "failed" | "unknown" = "unknown";
          if (statusFilter !== "all") {
            try {
              const receipt = await client.getTransactionReceipt({ hash: tx.hash });
              txStatus = receipt.status === "success" ? "success" : "failed";
            } catch {
              continue;
            }
            if (txStatus !== statusFilter) {
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
            input: tx.input,
            status: txStatus,
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

    const mergedPage = merged.slice(0, limit);
    const items = mergedPage.map(toTransactionListItem);
    const mergedByHash = new Map(mergedPage.map((tx) => [tx.hash.toLowerCase(), tx]));
    const labels = await getAddressLabels({
      chainId,
      addresses: items.flatMap((item) => [item.from, item.to]),
      simpleAccountAddress: chain.simpleAccountAddress,
    });
    const itemsWithLabels = items.map((item) => ({
      ...item,
      fromLabel: labels[item.from.toLowerCase()]?.label,
      toLabel: item.to ? labels[item.to.toLowerCase()]?.label : undefined,
      summary: (() => {
        const sourceTx = mergedByHash.get(item.hash.toLowerCase());
        const toLabel = item.to ? labels[item.to.toLowerCase()]?.label : undefined;
        const decodedMethod = decodeMethodCall(sourceTx?.input?.toString() ?? "0x", {
          preferredContractNames: contractHintsFromLabel(toLabel),
          recursivelyDecodeBytesArgs: true,
          maxRecursionDepth: 2,
        });
        return summarizeTransaction({
          from: item.from,
          valueEth: item.valueEth,
          decodedMethod,
          accountScope,
          targetAddress,
          toLabel,
        });
      })(),
    }));
    const nextCursor = toCursorFromBlock(scanStart);

    return NextResponse.json({
      chainId: chain.chainId,
      chainName: chain.chainName,
      accountScope,
      targetAddress,
      simpleAccountAddress: chain.simpleAccountAddress,
      platformFundingWalletAddress: chain.platformFundingWalletAddress,
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
