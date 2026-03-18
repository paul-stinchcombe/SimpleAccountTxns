export type ChainOption = {
  chainId: string;
  chainName: string;
  logoUrl: string | null;
  rpcUrl: string;
  isDefault: boolean;
  simpleAccountAddress: string;
};

export type ChainsResponse = {
  chains: ChainOption[];
};

export type TransactionListItem = {
  hash: string;
  blockNumber: string;
  timestamp: string;
  from: string;
  to: string | null;
  status: "success" | "failed" | "unknown";
  fromLabel?: string;
  toLabel?: string;
  valueWei: string;
  valueEth: string;
};

export type AddressLabel = {
  address: string;
  label: string;
  description: string;
  kind:
    | "simpleAccount"
    | "paymentToken"
    | "platform"
    | "fundingWallet"
    | "platformWallet"
    | "assetContract"
    | "userWallet"
    | "unknown";
};

export type TransactionsResponse = {
  chainId: string;
  chainName: string;
  simpleAccountAddress: string;
  items: TransactionListItem[];
  pagination: {
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
};

export type TransactionDetailResponse = {
  chain: {
    chainId: string;
    chainName: string;
  };
  simpleAccountAddress: string;
  transaction: {
    hash: string;
    from: string;
    to: string | null;
    fromLabel?: string;
    toLabel?: string;
    nonce: number;
    valueWei: string;
    valueEth: string;
    gas: {
      limit: string;
      maxFeePerGas: string | null;
      maxPriorityFeePerGas: string | null;
      gasPrice: string;
      gasUsed: string;
    };
    status: "success" | "reverted";
    blockNumber: string;
    blockHash: string;
    transactionIndex: number;
    timestamp: string;
    methodId: string;
    input: string;
  };
  internalCalls: {
    source: "trace_transaction" | "debug_traceTransaction" | "blockscout_internal_transactions" | "none";
    unavailableReason: string | null;
    items: {
      depth: number;
      type: string;
      callType: string;
      from: string;
      to: string;
      fromLabel?: string;
      toLabel?: string;
      valueWei: string;
      input: string;
      error?: string;
    }[];
  };
  transfers: {
    standard: "ERC20" | "ERC721" | "ERC1155";
    tokenAddress: string;
    tokenAddressLabel?: string;
    tokenSymbol?: string;
    tokenDecimals?: number;
    from: string;
    fromLabel?: string;
    to: string;
    toLabel?: string;
    tokenId?: string;
    nftName?: string;
    nftOwnerLabel?: string;
    value?: string;
    valueFormatted?: string;
    valueDisplay?: string;
    transactionHash: string;
    blockNumber: string;
    logIndex: number;
  }[];
  addressLabels: Record<string, AddressLabel>;
  logsCount: number;
};
