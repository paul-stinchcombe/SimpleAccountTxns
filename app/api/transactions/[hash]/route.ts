import { NextRequest, NextResponse } from "next/server";
import { formatEther, formatUnits } from "viem";

import { getAddressLabels } from "@/src/lib/address-labels";
import { fetchBlockscoutInternalTransactions, getBlockscoutBaseUrl } from "@/src/lib/blockscout";
import { getChainContext } from "@/src/lib/platform";
import { prisma } from "@/src/lib/prisma";
import { createRpcClient, getInternalCalls } from "@/src/lib/rpc";
import { TransactionDetailQuerySchema } from "@/src/lib/schemas";
import { decodeTransferLogs } from "@/src/lib/transfers";

type Params = {
  params: Promise<{ hash: string }>;
};

function trimFormattedNumber(value: string): string {
  if (!value.includes(".")) {
    return value;
  }
  return value.replace(/\.?0+$/, "");
}

function normalizeTokenIdCandidates(tokenId: string | undefined): string[] {
  if (!tokenId) {
    return [];
  }
  const candidates = new Set<string>([tokenId]);
  if (tokenId.startsWith("0x")) {
    try {
      candidates.add(BigInt(tokenId).toString(10));
    } catch {
      // ignore conversion failures
    }
  } else if (/^\d+$/.test(tokenId)) {
    try {
      candidates.add(`0x${BigInt(tokenId).toString(16)}`);
    } catch {
      // ignore conversion failures
    }
  }
  return [...candidates];
}

function normalizeChainIdCandidates(chainId: string): string[] {
  const candidates = new Set<string>([chainId]);
  if (chainId.startsWith("0x")) {
    try {
      candidates.add(BigInt(chainId).toString(10));
    } catch {
      // ignore conversion failures
    }
  } else if (/^\d+$/.test(chainId)) {
    try {
      candidates.add(`0x${BigInt(chainId).toString(16)}`);
    } catch {
      // ignore conversion failures
    }
  }
  return [...candidates];
}

function readNftName(metadata: unknown): string | undefined {
  if (!metadata) {
    return undefined;
  }
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return readNftName(parsed);
    } catch {
      return metadata.trim() || undefined;
    }
  }
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const object = metadata as Record<string, unknown>;
  const keys = ["name", "title", "collectionName", "collection_name", "nftName"];
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  const nested = object.metadata;
  if (nested && typeof nested === "object") {
    return readNftName(nested);
  }
  return undefined;
}

function humanizeInternalCallReason(reason: string, blockscoutConfigured: boolean): string {
  const lower = reason.toLowerCase();
  const isTraceMethodUnavailable =
    lower.includes("trace_transaction") ||
    lower.includes("debug_tracetransaction") ||
    (lower.includes("method") && lower.includes("not available")) ||
    (lower.includes("method") && lower.includes("does not exist"));

  if (!isTraceMethodUnavailable) {
    return reason;
  }

  return blockscoutConfigured
    ? "This RPC endpoint does not support trace methods for this network. Blockscout fallback was attempted but no internal calls were returned."
    : "This RPC endpoint does not support trace methods for this network. Configure BLOCKSCOUT_API_BASE_<CHAIN_ID> to enable Blockscout fallback.";
}

export async function GET(request: NextRequest, context: Params) {
  const { hash } = await context.params;
  const parsedQuery = TransactionDetailQuerySchema.safeParse({
    chainId: request.nextUrl.searchParams.get("chainId"),
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
    const chain = await getChainContext(parsedQuery.data.chainId);
    if (!chain) {
      return NextResponse.json({ message: "Chain was not found." }, { status: 404 });
    }

    const client = createRpcClient(chain.rpcUrl);
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: hash as `0x${string}` }),
      client.getTransactionReceipt({ hash: hash as `0x${string}` }),
    ]);

    const block = await client.getBlock({ blockHash: receipt.blockHash });
    const trace = await getInternalCalls(chain.rpcUrl, hash);
    const blockscoutBase = getBlockscoutBaseUrl(chain.chainId);
    const blockscoutConfigured = Boolean(blockscoutBase);
    const fallbackInternalCalls =
      trace.source === "none" && trace.calls.length === 0 && blockscoutBase
        ? await fetchBlockscoutInternalTransactions({ baseUrl: blockscoutBase, hash }).catch(() => [])
        : [];
    const internalCalls =
      fallbackInternalCalls.length > 0
        ? {
            calls: fallbackInternalCalls,
            source: "blockscout_internal_transactions" as const,
            unavailableReason: undefined,
          }
        : {
            ...trace,
            unavailableReason: trace.unavailableReason
              ? humanizeInternalCallReason(trace.unavailableReason, blockscoutConfigured)
              : trace.unavailableReason,
          };

    const transfers = decodeTransferLogs(
      receipt.logs.map((log) => ({
        address: log.address,
        data: log.data,
        topics: log.topics,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        logIndex: Number(log.logIndex),
      })),
    );

    const labels = await getAddressLabels({
      chainId: chain.chainId,
      simpleAccountAddress: chain.simpleAccountAddress,
      addresses: [
        tx.from,
        tx.to,
        ...internalCalls.calls.flatMap((call) => [call.from, call.to]),
        ...transfers.flatMap((transfer) => [transfer.tokenAddress, transfer.from, transfer.to]),
      ],
    });
    const transferTokenAddresses = [
      ...new Set(
        transfers
          .filter((transfer) => transfer.standard === "ERC20")
          .map((transfer) => transfer.tokenAddress.toLowerCase()),
      ),
    ];
    const tokenRows =
      transferTokenAddresses.length === 0
        ? []
        : await prisma.payment_token.findMany({
            where: {
              chainId: chain.chainId,
              OR: transferTokenAddresses.map((address) => ({
                contractAddress: { equals: address, mode: "insensitive" },
              })),
            },
            select: {
              contractAddress: true,
              symbol: true,
              decimals: true,
            },
          });
    const tokenByAddress = new Map(
      tokenRows.map((row) => [row.contractAddress.toLowerCase(), { symbol: row.symbol, decimals: row.decimals }]),
    );
    const nftTransferKeys = [
      ...new Set(
        transfers
          .filter((transfer) => (transfer.standard === "ERC721" || transfer.standard === "ERC1155") && transfer.tokenId)
          .map((transfer) => `${transfer.tokenAddress.toLowerCase()}|${transfer.tokenId}`),
      ),
    ];
    const nftTransfersByAddress = new Map<string, Set<string>>();
    for (const key of nftTransferKeys) {
      const [address, tokenId] = key.split("|");
      const set = nftTransfersByAddress.get(address) ?? new Set<string>();
      set.add(tokenId);
      nftTransfersByAddress.set(address, set);
    }
    const chainIdCandidates = normalizeChainIdCandidates(chain.chainId);
    const nftRows =
      nftTransfersByAddress.size === 0
        ? []
        : await prisma.asset.findMany({
            where: {
              chainId: { in: chainIdCandidates },
              OR: [...nftTransfersByAddress.entries()].map(([address, tokenIds]) => ({
                AND: [
                  { contractAddress: { equals: address, mode: "insensitive" } },
                  { tokenId: { in: [...tokenIds].flatMap((id) => normalizeTokenIdCandidates(id)) } },
                ],
              })),
            },
            select: {
              contractAddress: true,
              tokenId: true,
              metadata: true,
              product: {
                select: {
                  name: true,
                },
              },
              collection: {
                select: {
                  name: true,
                },
              },
              project: {
                select: {
                  name: true,
                },
              },
              user: {
                select: {
                  userName: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });
    const voucherRows =
      nftTransfersByAddress.size === 0
        ? []
        : await prisma.voucher.findMany({
            where: {
              OR: [...nftTransfersByAddress.entries()].map(([address, tokenIds]) => ({
                AND: [
                  { contractAddress: { equals: address, mode: "insensitive" } },
                  { tokenId: { in: [...tokenIds].flatMap((id) => normalizeTokenIdCandidates(id)) } },
                ],
              })),
            },
            select: {
              contractAddress: true,
              tokenId: true,
              metadata: true,
              product: {
                select: { name: true },
              },
              collection: {
                select: { name: true },
              },
              project: {
                select: { name: true },
              },
              user: {
                select: {
                  userName: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });
    const nftByKey = new Map(
      nftRows.map((row) => {
        const key = `${row.contractAddress.toLowerCase()}|${row.tokenId}`;
        const personName = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim();
        const ownerLabel = personName ? `${personName} (@${row.user.userName})` : `@${row.user.userName}`;
        const nftName =
          readNftName(row.metadata) ??
          row.product?.name ??
          row.collection?.name ??
          row.project?.name ??
          undefined;
        return [key, { nftName, ownerLabel }] as const;
      }),
    );
    for (const row of voucherRows) {
      if (!row.contractAddress) {
        continue;
      }
      const key = `${row.contractAddress.toLowerCase()}|${row.tokenId}`;
      if (nftByKey.has(key)) {
        continue;
      }
      const personName = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim();
      const ownerLabel = personName ? `${personName} (@${row.user.userName})` : `@${row.user.userName}`;
      const nftName =
        readNftName(row.metadata) ??
        row.product?.name ??
        row.collection?.name ??
        row.project?.name ??
        undefined;
      nftByKey.set(key, { nftName, ownerLabel });
    }

    const txFrom = tx.from.toLowerCase();
    const txTo = tx.to?.toLowerCase() ?? null;

    return NextResponse.json({
      chain: {
        chainId: chain.chainId,
        chainName: chain.chainName,
      },
      simpleAccountAddress: chain.simpleAccountAddress,
      transaction: {
        hash: tx.hash,
        from: txFrom,
        to: txTo,
        fromLabel: labels[txFrom]?.label,
        toLabel: txTo ? labels[txTo]?.label : undefined,
        nonce: tx.nonce,
        valueWei: tx.value.toString(),
        valueEth: formatEther(tx.value),
        gas: {
          limit: tx.gas.toString(),
          maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? null,
          gasPrice: receipt.effectiveGasPrice.toString(),
          gasUsed: receipt.gasUsed.toString(),
        },
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        transactionIndex: receipt.transactionIndex,
        timestamp: block.timestamp.toString(),
        methodId: tx.input.slice(0, 10),
        input: tx.input,
      },
      internalCalls: {
        source: internalCalls.source,
        unavailableReason: internalCalls.unavailableReason ?? null,
        items: internalCalls.calls.map((call) => ({
          ...call,
          fromLabel: labels[call.from.toLowerCase()]?.label,
          toLabel: labels[call.to.toLowerCase()]?.label,
        })),
      },
      transfers: transfers.map((transfer) => ({
        ...transfer,
        ...(function () {
          const tokenInfo = tokenByAddress.get(transfer.tokenAddress.toLowerCase());
          if (!transfer.value) {
            return {
              tokenAddressLabel: labels[transfer.tokenAddress.toLowerCase()]?.label,
              fromLabel: labels[transfer.from.toLowerCase()]?.label,
              toLabel: labels[transfer.to.toLowerCase()]?.label,
              tokenSymbol: tokenInfo?.symbol,
              tokenDecimals: tokenInfo?.decimals,
            };
          }

          const decimals =
            transfer.standard === "ERC20"
              ? (tokenInfo?.decimals ?? 18)
              : transfer.standard === "ERC1155"
                ? 0
                : undefined;
          const valueFormatted =
            decimals !== undefined ? trimFormattedNumber(formatUnits(BigInt(transfer.value), decimals)) : transfer.value;
          const tokenSymbol = transfer.standard === "ERC20" ? tokenInfo?.symbol ?? "TOKEN" : tokenInfo?.symbol;

          return {
            tokenAddressLabel: labels[transfer.tokenAddress.toLowerCase()]?.label,
            fromLabel: labels[transfer.from.toLowerCase()]?.label,
            toLabel: labels[transfer.to.toLowerCase()]?.label,
            tokenSymbol,
            tokenDecimals: decimals,
            valueFormatted,
            valueDisplay:
              transfer.standard === "ERC20"
                ? `${valueFormatted} ${tokenSymbol}`
                : transfer.standard === "ERC1155"
                  ? `${valueFormatted}`
                  : transfer.value,
            nftName:
              transfer.tokenId &&
              (transfer.standard === "ERC721" || transfer.standard === "ERC1155")
                ? normalizeTokenIdCandidates(transfer.tokenId)
                    .map((id) => nftByKey.get(`${transfer.tokenAddress.toLowerCase()}|${id}`)?.nftName)
                    .find(Boolean)
                : undefined,
            nftOwnerLabel:
              transfer.tokenId &&
              (transfer.standard === "ERC721" || transfer.standard === "ERC1155")
                ? normalizeTokenIdCandidates(transfer.tokenId)
                    .map((id) => nftByKey.get(`${transfer.tokenAddress.toLowerCase()}|${id}`)?.ownerLabel)
                    .find(Boolean)
                : undefined,
          };
        })(),
      })),
      addressLabels: labels,
      logsCount: receipt.logs.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Unable to load transaction details.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
