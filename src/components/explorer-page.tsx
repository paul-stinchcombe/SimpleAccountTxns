"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ChainSelect } from "@/src/components/chain-select";
import { TransactionList } from "@/src/components/transaction-list";
import type { ChainOption, ChainsResponse } from "@/src/lib/api-types";

async function fetchChains(): Promise<ChainOption[]> {
  const response = await fetch("/api/chains");
  if (!response.ok) {
    throw new Error("Unable to load blockchain options.");
  }
  const data = (await response.json()) as ChainsResponse;
  return data.chains;
}

export function ExplorerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const chainFromUrl = searchParams.get("chainId");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const chainsQuery = useQuery({
    queryKey: ["chains"],
    queryFn: fetchChains,
  });

  useEffect(() => {
    if (!chainsQuery.data || chainsQuery.data.length === 0) {
      return;
    }

    const hasValidChainInUrl =
      Boolean(chainFromUrl) && chainsQuery.data.some((chain) => chain.chainId === chainFromUrl);
    if (hasValidChainInUrl) {
      return;
    }

    const defaultChain = chainsQuery.data.find((chain) => chain.isDefault) ?? chainsQuery.data[0];
    const params = new URLSearchParams(searchParamsString);
    params.set("chainId", defaultChain.chainId);
    const nextQueryString = params.toString();

    if (nextQueryString !== searchParamsString) {
      router.replace(`/?${nextQueryString}`);
    }
  }, [chainFromUrl, chainsQuery.data, router, searchParamsString]);

  const selectedChainId = useMemo(() => {
    if (chainFromUrl) {
      return chainFromUrl;
    }
    return chainsQuery.data?.find((chain) => chain.isDefault)?.chainId ?? chainsQuery.data?.[0]?.chainId ?? null;
  }, [chainFromUrl, chainsQuery.data]);

  const selectedChain = useMemo(
    () => chainsQuery.data?.find((chain) => chain.chainId === selectedChainId) ?? null,
    [chainsQuery.data, selectedChainId],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 md:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
          SimpleAccount Transaction Explorer
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
          Explore live ERC4337 SimpleAccount activity by blockchain. Select a chain, browse the latest transactions,
          and click any row for internal calls and token transfer details.
        </p>
      </header>

      {chainsQuery.isLoading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading chain metadata...
        </div>
      ) : null}

      {chainsQuery.isError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-red-100">
          Unable to load blockchain options from the database.
        </div>
      ) : null}

      {chainsQuery.data ? (
        <>
          <ChainSelect
            chains={chainsQuery.data}
            selectedChainId={selectedChainId}
            loading={chainsQuery.isLoading}
            onChange={(nextChainId) => {
              if (nextChainId === chainFromUrl) {
                return;
              }
              const params = new URLSearchParams(searchParamsString);
              params.set("chainId", nextChainId);
              router.replace(`/?${params.toString()}`);
            }}
          />
          <section className="mt-4 rounded-2xl border border-white/15 bg-slate-900/70 p-5 shadow-xl backdrop-blur">
            <label htmlFor="transaction-search" className="text-sm font-semibold text-white">
              Search transactions
            </label>
            <p className="mt-1 text-xs text-slate-300">
              Search by transaction hash, wallet address, or contract address.
            </p>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="transaction-search"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="0x... hash or address"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-500"
              />
            </div>
          </section>
          {selectedChain ? (
            <TransactionList
              chainId={selectedChain.chainId}
              chainName={selectedChain.chainName}
              simpleAccountAddress={selectedChain.simpleAccountAddress}
              searchQuery={deferredSearchQuery}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
