"use client";

import type { ChainOption } from "@/src/lib/api-types";

type ChainSelectProps = {
  chains: ChainOption[];
  selectedChainId: string | null;
  onChange: (chainId: string) => void;
  loading: boolean;
};

export function ChainSelect({ chains, selectedChainId, onChange, loading }: ChainSelectProps) {
  return (
    <section className="rounded-2xl border border-white/15 bg-slate-900/70 p-5 shadow-xl backdrop-blur">
      <h2 className="text-lg font-semibold text-white">Select blockchain</h2>
      <p className="mt-2 text-sm text-slate-300">
        Pick a chain to load transactions related to that chain&apos;s SimpleAccount contract.
      </p>
      <div className="mt-4">
        <label htmlFor="chain-select" className="sr-only">
          Blockchain
        </label>
        <select
          id="chain-select"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-500"
          value={selectedChainId ?? ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading || chains.length === 0}
        >
          {chains.length === 0 ? <option value="">No chains available</option> : null}
          {chains.map((chain) => (
            <option key={chain.chainId} value={chain.chainId}>
              {chain.chainName} ({chain.chainId}) {chain.isDefault ? "• default" : ""}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
