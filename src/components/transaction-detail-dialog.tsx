"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { TransactionDetailResponse, TransactionListItem } from "@/src/lib/api-types";
import { formatTimestamp, shortAddress } from "@/src/lib/utils";

type TransactionDetailDialogProps = {
  tx: TransactionListItem;
  chainId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

async function fetchTransactionDetails(hash: string, chainId: string): Promise<TransactionDetailResponse> {
  const response = await fetch(`/api/transactions/${hash}?chainId=${chainId}`);
  if (!response.ok) {
    throw new Error("Unable to load transaction details.");
  }
  return response.json() as Promise<TransactionDetailResponse>;
}

function AddressWithLabel({
  address,
  label,
  fallback,
  onCopy,
  copiedValue,
}: {
  address: string | null;
  label?: string;
  fallback?: string;
  onCopy: (value: string) => Promise<void>;
  copiedValue: string | null;
}) {
  if (!address) {
    return <span className="text-sm">{fallback ?? "N/A"}</span>;
  }

  return (
    <div>
      <p className="text-sm">{label ?? shortAddress(address)}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="font-mono text-xs text-slate-400">{address}</p>
        <CopyButton
          value={address}
          copied={copiedValue === address}
          onCopy={onCopy}
          label={`Copy address ${address}`}
        />
      </div>
    </div>
  );
}

function CopyButton({
  value,
  copied,
  onCopy,
  label,
}: {
  value: string;
  copied: boolean;
  onCopy: (value: string) => Promise<void>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void onCopy(value)}
      aria-label={label}
      title={copied ? "Copied" : "Copy to clipboard"}
      className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function DecodedMethodSummary({ method }: { method: TransactionDetailResponse["transaction"]["decodedMethod"] }) {
  if (method.status !== "decoded") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        {method.status === "unknown"
          ? "Unknown selector (not found in loaded artifacts)"
          : method.status === "invalid"
            ? method.error ?? "Unable to decode calldata"
            : "No calldata"}
      </p>
    );
  }

  return (
    <div className="mt-1">
      <p className="text-sm">{method.signature ?? method.functionName ?? method.selector}</p>
      {method.contractNames?.length ? (
        <p className="mt-1 text-xs text-slate-400">ABI match: {method.contractNames.join(", ")}</p>
      ) : null}
      {method.args?.length ? (
        <div className="mt-2 space-y-1">
          {method.args.slice(0, 5).map((arg) => (
            <p key={`${arg.name}-${arg.type}`} className="font-mono text-[11px] text-slate-400">
              {arg.name || "_"} ({arg.type}): {arg.value}
              {arg.nestedDecodedMethod?.signature ? ` => ${arg.nestedDecodedMethod.signature}` : ""}
            </p>
          ))}
          {method.args.length > 5 ? (
            <p className="text-[11px] text-slate-500">+ {method.args.length - 5} more argument(s)</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TransactionDetailDialog({ tx, chainId, open, onOpenChange }: TransactionDetailDialogProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["transaction-detail", chainId, tx.hash],
    queryFn: () => fetchTransactionDetails(tx.hash, chainId),
    enabled: open,
  });

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => {
        setCopiedValue((current) => (current === value ? null : current));
      }, 1200);
    } catch {
      // Ignore clipboard errors in unsupported contexts.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[96vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 text-slate-100 shadow-2xl">
          <Dialog.Title className="text-xl font-semibold">Transaction details</Dialog.Title>
          <Dialog.Description className="mt-1 flex items-center gap-2 text-sm text-slate-300">
            <span>
              Hash: <span className="font-mono text-xs">{tx.hash}</span>
            </span>
            <CopyButton
              value={tx.hash}
              copied={copiedValue === tx.hash}
              onCopy={handleCopy}
              label={`Copy transaction hash ${tx.hash}`}
            />
          </Dialog.Description>
          <Dialog.Close className="absolute right-4 top-4 rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
            <X className="h-4 w-4" />
          </Dialog.Close>

          {detailQuery.isLoading ? (
            <div className="mt-8 flex items-center gap-3 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading transaction details...
            </div>
          ) : null}

          {detailQuery.isError ? (
            <div className="mt-8 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              We could not load this transaction right now. Please try again in a moment.
            </div>
          ) : null}

          {detailQuery.data ? (
            <div className="mt-6 space-y-6">
              <section className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
                  <p className="mt-1 text-sm font-medium capitalize">{detailQuery.data.transaction.status}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Timestamp</p>
                  <p className="mt-1 text-sm">{formatTimestamp(detailQuery.data.transaction.timestamp)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">From</p>
                  <div className="mt-1">
                    <AddressWithLabel
                      address={detailQuery.data.transaction.from}
                      label={detailQuery.data.transaction.fromLabel}
                      onCopy={handleCopy}
                      copiedValue={copiedValue}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">To</p>
                  <div className="mt-1">
                    <AddressWithLabel
                      address={detailQuery.data.transaction.to}
                      label={detailQuery.data.transaction.toLabel}
                      fallback="Contract creation / none"
                      onCopy={handleCopy}
                      copiedValue={copiedValue}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Value (ETH)</p>
                  <p className="mt-1 text-sm">{detailQuery.data.transaction.valueEth}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Method</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-sm font-mono">{detailQuery.data.transaction.methodId}</p>
                    <CopyButton
                      value={detailQuery.data.transaction.methodId}
                      copied={copiedValue === detailQuery.data.transaction.methodId}
                      onCopy={handleCopy}
                      label={`Copy method id ${detailQuery.data.transaction.methodId}`}
                    />
                  </div>
                  <DecodedMethodSummary method={detailQuery.data.transaction.decodedMethod} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="text-sm font-semibold text-white">Internal transactions</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Internal transactions are contract-to-contract calls made inside the top-level transaction.
                </p>
                {detailQuery.data.internalCalls.items.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-300">
                    {detailQuery.data.internalCalls.unavailableReason ??
                      "No internal calls were found for this transaction."}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {detailQuery.data.internalCalls.items.slice(0, 50).map((call, index) => (
                      <div key={`${call.from}-${call.to}-${index}`} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                        <p className="text-xs text-slate-400">
                          Depth {call.depth} • {call.callType}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">
                          {call.decodedMethod.signature ?? call.methodId}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          {(call.fromLabel ?? shortAddress(call.from))} → {(call.toLabel ?? shortAddress(call.to))} •{" "}
                          {call.valueWei} wei
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                          <span className="font-mono">{call.from}</span>
                          <CopyButton
                            value={call.from}
                            copied={copiedValue === call.from}
                            onCopy={handleCopy}
                            label={`Copy internal call from address ${call.from}`}
                          />
                          <span className="font-mono">{call.to}</span>
                          <CopyButton
                            value={call.to}
                            copied={copiedValue === call.to}
                            onCopy={handleCopy}
                            label={`Copy internal call to address ${call.to}`}
                          />
                        </div>
                        {call.decodedMethod.args?.length ? (
                          <p className="mt-1 font-mono text-[11px] text-slate-500">
                            {call.decodedMethod.args
                              .slice(0, 2)
                              .map(
                                (arg) =>
                                  `${arg.name || "_"}=${arg.value}${
                                    arg.nestedDecodedMethod?.signature
                                      ? ` => ${arg.nestedDecodedMethod.signature}`
                                      : ""
                                  }`,
                              )
                              .join(" • ")}
                            {call.decodedMethod.args.length > 2
                              ? ` • +${call.decodedMethod.args.length - 2} more`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="text-sm font-semibold text-white">Token transfers</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Includes ERC20, ERC721, and ERC1155 transfers decoded from transaction logs.
                </p>
                {detailQuery.data.transfers.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-300">No token transfer logs found.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {detailQuery.data.transfers.map((transfer, index) => (
                      <div key={`${transfer.transactionHash}-${transfer.logIndex}-${index}`} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                        <p className="text-xs font-semibold text-indigo-300">{transfer.standard}</p>
                        <p className="mt-1 text-xs text-slate-300">
                          {(transfer.fromLabel ?? shortAddress(transfer.from))} →{" "}
                          {(transfer.toLabel ?? shortAddress(transfer.to))}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Token {transfer.tokenAddressLabel ?? shortAddress(transfer.tokenAddress)}{" "}
                          {transfer.tokenId ? `• Token ID ${transfer.tokenId}` : ""}{" "}
                          {transfer.value ? `• Amount ${transfer.valueDisplay ?? transfer.value}` : ""}
                        </p>
                        {transfer.nftName ? (
                          <p className="mt-1 text-xs text-emerald-300">
                            NFT: {transfer.nftName}
                            {transfer.nftOwnerLabel ? ` • Creator: ${transfer.nftOwnerLabel}` : ""}
                          </p>
                        ) : null}
                        <div className="mt-1 flex items-center gap-2">
                          <p className="font-mono text-[11px] text-slate-500">{transfer.tokenAddress}</p>
                          <CopyButton
                            value={transfer.tokenAddress}
                            copied={copiedValue === transfer.tokenAddress}
                            onCopy={handleCopy}
                            label={`Copy token contract address ${transfer.tokenAddress}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="text-sm font-semibold text-white">Known addresses used in this transaction</h3>
                <p className="mt-1 text-xs text-slate-400">
                  We map addresses from your platform database so users can understand what each contract or wallet is.
                </p>
                <div className="mt-3 space-y-2">
                  {Object.values(detailQuery.data.addressLabels).length === 0 ? (
                    <p className="text-sm text-slate-300">No known address labels were found for this transaction.</p>
                  ) : (
                    Object.values(detailQuery.data.addressLabels).map((entry) => (
                      <div key={entry.address} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                        <p className="text-sm text-slate-200">{entry.label}</p>
                        <p className="mt-1 text-xs text-slate-400">{entry.description}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="font-mono text-[11px] text-slate-500">{entry.address}</p>
                          <CopyButton
                            value={entry.address}
                            copied={copiedValue === entry.address}
                            onCopy={handleCopy}
                            label={`Copy known address ${entry.address}`}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
