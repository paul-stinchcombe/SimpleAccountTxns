export type ChainOption = {
  chainId: string;
  chainName: string;
  logoUrl: string | null;
  rpcUrl: string;
  isDefault: boolean;
  simpleAccountAddress: string;
  platformFundingWalletAddress: string;
};

export type ChainsResponse = {
  chains: ChainOption[];
};

export type DecodedMethodCall = {
  selector: string;
  status: "decoded" | "empty" | "unknown" | "invalid";
  functionName?: string;
  signature?: string;
  args?: DecodedMethodArg[];
  contractNames?: string[];
  error?: string;
};

export type DecodedMethodArg = {
  name: string;
  type: string;
  value: string;
  nestedDecodedMethod?: DecodedMethodCall;
};

export type TransactionListItem = {
  hash: string;
  blockNumber: string;
  timestamp: string;
  from: string;
  to: string | null;
  status: "success" | "failed" | "unknown";
  summary: string;
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
  accountScope: "simpleAccount" | "fundingWallet";
  targetAddress: string;
  simpleAccountAddress: string;
  platformFundingWalletAddress: string;
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
    decodedMethod: DecodedMethodCall;
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
      methodId: string;
      decodedMethod: DecodedMethodCall;
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
