"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TransactionDetailDialog } from "@/src/components/transaction-detail-dialog";
import type { TransactionListItem, TransactionsResponse } from "@/src/lib/api-types";
import { formatTimestamp, shortAddress } from "@/src/lib/utils";

type TransactionListProps = {
  chainId: string;
  chainName: string;
  simpleAccountAddress: string;
  searchQuery: string;
};

async function fetchTransactions(
  chainId: string,
  searchQuery: string,
  cursor?: string,
): Promise<TransactionsResponse> {
  const params = new URLSearchParams({ chainId, limit: "25" });
  const q = searchQuery.trim();
  if (q) {
    params.set("q", q);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await fetch(`/api/transactions?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Unable to load transactions.");
  }
  return response.json() as Promise<TransactionsResponse>;
}

export function TransactionList({
  chainId,
  chainName,
  simpleAccountAddress,
  searchQuery,
}: TransactionListProps) {
  const [selectedTx, setSelectedTx] = useState<TransactionListItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["transactions", chainId, searchQuery],
    queryFn: ({ pageParam }) => fetchTransactions(chainId, searchQuery, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });

  const items = useMemo(
    () =>
      query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [query]);

  if (query.isLoading) {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading transactions...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-100">
        <p className="text-sm">We could not load transactions for this chain right now.</p>
      </div>
    );
  }

  return (
    <section className="mt-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-lg font-semibold text-white">SimpleAccount transactions</h2>
        <p className="mt-2 text-sm text-slate-300">
          Viewing <span className="font-medium text-indigo-200">{chainName}</span> • SimpleAccount{" "}
          <span className="font-mono text-xs text-slate-200">{simpleAccountAddress}</span>
        </p>
        {searchQuery.trim() ? (
          <p className="mt-2 text-xs text-slate-400">
            Filter: <span className="font-mono text-slate-300">{searchQuery.trim()}</span>
          </p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
          {searchQuery.trim()
            ? "No matching transactions found for this search query."
            : "No transactions found yet. This account may be new on this chain."}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((tx) => (
            <button
              key={tx.hash}
              type="button"
              onClick={() => setSelectedTx(tx)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-left transition hover:border-indigo-500 hover:bg-slate-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-indigo-500/20 px-2 py-1 text-xs text-indigo-200">Tx</span>
                <span className="font-mono text-xs text-slate-300">{tx.hash}</span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-4">
                <p>
                  <span className="text-slate-400">From:</span> {tx.fromLabel ?? shortAddress(tx.from)}
                </p>
                <p>
                  <span className="text-slate-400">To:</span> {tx.toLabel ?? shortAddress(tx.to)}
                </p>
                <p>
                  <span className="text-slate-400">Value:</span> {tx.valueEth} ETH
                </p>
                <p>
                  <span className="text-slate-400">Time:</span> {formatTimestamp(tx.timestamp)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-8" />
      {query.isFetchingNextPage ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading more transactions...
        </div>
      ) : null}
      {!query.hasNextPage && items.length > 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">You&apos;ve reached the earliest loaded results.</p>
      ) : null}

      {selectedTx ? (
        <TransactionDetailDialog
          tx={selectedTx}
          chainId={chainId}
          open={Boolean(selectedTx)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedTx(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}
