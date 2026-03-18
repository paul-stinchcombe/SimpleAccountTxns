import { prisma } from "@/src/lib/prisma";

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

export type AddressLabelMap = Record<string, AddressLabel>;

function normalize(address: string | null | undefined): string | null {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

function uniqueNormalizedAddresses(addresses: Array<string | null | undefined>): string[] {
  return [...new Set(addresses.map(normalize).filter((value): value is string => Boolean(value)))];
}

function toInsensitiveAddressOr(field: string, addresses: string[]) {
  return addresses.map((address) => ({
    [field]: { equals: address, mode: "insensitive" as const },
  }));
}

function metadataName(metadata: unknown): string | null {
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return metadataName(parsed);
    } catch {
      return metadata.trim() || null;
    }
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const object = metadata as Record<string, unknown>;
  const candidateKeys = ["name", "title", "collectionName", "collection_name", "nftName"];
  for (const key of candidateKeys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  const nestedKeys = ["metadata", "data", "attributes"];
  for (const key of nestedKeys) {
    const nested = object[key];
    if (nested && typeof nested === "object") {
      const nestedName = metadataName(nested);
      if (nestedName) {
        return nestedName;
      }
    }
  }
  return null;
}

type LabelPriority =
  | "simpleAccount"
  | "paymentToken"
  | "platform"
  | "fundingWallet"
  | "platformWallet"
  | "userWallet"
  | "collectionContract"
  | "voucherContract"
  | "assetContract";

const priorityRank: Record<LabelPriority, number> = {
  simpleAccount: 100,
  platform: 90,
  paymentToken: 80,
  fundingWallet: 70,
  platformWallet: 60,
  userWallet: 50,
  collectionContract: 45,
  voucherContract: 43,
  assetContract: 40,
};

function upsertLabel(
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
  entry: AddressLabel,
  priority: LabelPriority,
) {
  const normalizedAddress = entry.address.toLowerCase();
  const incomingRank = priorityRank[priority];
  const existingRank = priorityMap[normalizedAddress] ?? -1;
  if (existingRank > incomingRank) {
    return;
  }

  map[normalizedAddress] = { ...entry, address: normalizedAddress };
  priorityMap[normalizedAddress] = incomingRank;
}

async function addPaymentTokenLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.payment_token.findMany({
    where: {
      chainId,
      OR: toInsensitiveAddressOr("contractAddress", addresses),
    },
    select: {
      contractAddress: true,
      name: true,
      symbol: true,
      default: true,
    },
  });

  for (const row of rows) {
    const label = row.symbol || row.name || "Payment token";
    upsertLabel(
      map,
      priorityMap,
      {
        address: row.contractAddress,
        label,
        description: row.default
          ? `${row.name} (${row.symbol}) default payment token`
          : `${row.name} token (${row.symbol})`,
        kind: "paymentToken",
      },
      "paymentToken",
    );
  }
}

async function addPlatformLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const row = await prisma.platform.findUnique({
    where: { chainId },
    select: {
      simpleAccountAddress: true,
      contractDeployerAddress: true,
      platformFundingWalletAddress: true,
      platformAddress: true,
      kamiNFTCoreLibraryAddress: true,
      kamiPlatformLibraryAddress: true,
      kamiRoyaltyLibraryAddress: true,
      kamiRentalLibraryAddress: true,
      kamiTransferLibraryAddress: true,
    },
  });

  if (!row) {
    return;
  }

  const labels: Array<{ address: string; label: string; description: string }> = [
    {
      address: row.simpleAccountAddress,
      label: "SimpleAccount",
      description: "ERC4337 smart account contract for this chain",
    },
    {
      address: row.platformFundingWalletAddress,
      label: "Platform Funding Wallet",
      description: "Wallet used to fund platform operations",
    },
    {
      address: row.platformAddress,
      label: "Platform Address",
      description: "Core platform address on this chain",
    },
    {
      address: row.contractDeployerAddress,
      label: "Contract Deployer",
      description: "Address used to deploy KAMI contracts",
    },
    {
      address: row.kamiNFTCoreLibraryAddress,
      label: "KAMI NFT Core Library",
      description: "KAMI NFT core library contract",
    },
    {
      address: row.kamiPlatformLibraryAddress,
      label: "KAMI Platform Library",
      description: "KAMI platform library contract",
    },
    {
      address: row.kamiRoyaltyLibraryAddress,
      label: "KAMI Royalty Library",
      description: "KAMI royalty library contract",
    },
    {
      address: row.kamiRentalLibraryAddress,
      label: "KAMI Rental Library",
      description: "KAMI rental library contract",
    },
    {
      address: row.kamiTransferLibraryAddress,
      label: "KAMI Transfer Library",
      description: "KAMI transfer library contract",
    },
  ];

  for (const entry of labels) {
    const address = normalize(entry.address);
    if (!address || !addresses.includes(address)) {
      continue;
    }

    upsertLabel(
      map,
      priorityMap,
      {
        address,
        label: entry.label,
        description: entry.description,
        kind: entry.label === "SimpleAccount" ? "simpleAccount" : "platform",
      },
      entry.label === "SimpleAccount" ? "simpleAccount" : "platform",
    );
  }
}

async function addFundingWalletLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.fundingWallet.findMany({
    where: {
      chainId,
      isActive: true,
      OR: toInsensitiveAddressOr("walletAddress", addresses),
    },
    select: {
      walletAddress: true,
      name: true,
      type: true,
      description: true,
    },
  });

  for (const row of rows) {
    upsertLabel(
      map,
      priorityMap,
      {
        address: row.walletAddress,
        label: row.name || `${row.type} Funding Wallet`,
        description: row.description || `${row.type} funding wallet`,
        kind: "fundingWallet",
      },
      "fundingWallet",
    );
  }
}

async function addPlatformWalletLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.platformWallet.findMany({
    where: {
      isActive: true,
      OR: [{ chainId }, { chainId: null }],
      AND: [{ OR: toInsensitiveAddressOr("walletAddress", addresses) }],
    },
    select: {
      walletAddress: true,
      name: true,
      walletType: true,
    },
  });

  for (const row of rows) {
    upsertLabel(
      map,
      priorityMap,
      {
        address: row.walletAddress,
        label: row.name || `${row.walletType} Wallet`,
        description: `${row.walletType} platform wallet`,
        kind: "platformWallet",
      },
      "platformWallet",
    );
  }
}

async function addUserWalletLabels(
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.user.findMany({
    where: {
      OR: toInsensitiveAddressOr("walletAddress", addresses),
    },
    select: {
      walletAddress: true,
      userName: true,
      firstName: true,
      lastName: true,
    },
  });

  for (const row of rows) {
    const personName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    const label = personName ? `${personName} (@${row.userName})` : `@${row.userName}`;
    upsertLabel(
      map,
      priorityMap,
      {
        address: row.walletAddress,
        label,
        description: "Known KAMI user wallet",
        kind: "userWallet",
      },
      "userWallet",
    );
  }
}

async function addCollectionContractLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.collection.findMany({
    where: {
      chainId,
      OR: toInsensitiveAddressOr("contractAddress", addresses),
    },
    select: {
      contractAddress: true,
      name: true,
      symbol: true,
      owner: {
        select: {
          userName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  for (const row of rows) {
    if (!row.contractAddress) {
      continue;
    }
    const personName = [row.owner.firstName, row.owner.lastName].filter(Boolean).join(" ").trim();
    const ownerLabel = personName ? `${personName} (@${row.owner.userName})` : `@${row.owner.userName}`;
    upsertLabel(
      map,
      priorityMap,
      {
        address: row.contractAddress,
        label: row.name,
        description: `${row.symbol} collection by ${ownerLabel}`,
        kind: "assetContract",
      },
      "collectionContract",
    );
  }
}

async function addVoucherContractLabels(
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.voucher.findMany({
    where: {
      OR: toInsensitiveAddressOr("contractAddress", addresses),
    },
    select: {
      contractAddress: true,
      metadata: true,
      product: {
        select: { name: true },
      },
      project: {
        select: { name: true },
      },
      collection: {
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
    take: 300,
  });

  const byAddress = new Map<string, { names: Set<string>; creators: Set<string> }>();
  for (const row of rows) {
    if (!row.contractAddress) {
      continue;
    }
    const address = row.contractAddress.toLowerCase();
    const aggregate = byAddress.get(address) ?? { names: new Set<string>(), creators: new Set<string>() };
    const name =
      metadataName(row.metadata) ??
      row.product?.name ??
      row.collection?.name ??
      row.project?.name ??
      null;
    if (name) {
      aggregate.names.add(name);
    }
    const personName = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim();
    aggregate.creators.add(personName ? `${personName} (@${row.user.userName})` : `@${row.user.userName}`);
    byAddress.set(address, aggregate);
  }

  for (const [address, aggregate] of byAddress.entries()) {
    const firstName = [...aggregate.names][0];
    const firstCreator = [...aggregate.creators][0];
    upsertLabel(
      map,
      priorityMap,
      {
        address,
        label: firstName ?? (firstCreator ? `${firstCreator}'s NFT Contract` : "NFT Contract"),
        description: firstCreator
          ? `Voucher/NFT contract for ${firstCreator}`
          : "Voucher/NFT contract",
        kind: "assetContract",
      },
      "voucherContract",
    );
  }
}

async function addAssetContractLabels(
  chainId: string,
  addresses: string[],
  map: AddressLabelMap,
  priorityMap: Record<string, number>,
) {
  if (addresses.length === 0) {
    return;
  }

  const rows = await prisma.asset.findMany({
    where: {
      chainId,
      OR: toInsensitiveAddressOr("contractAddress", addresses),
    },
    select: {
      contractAddress: true,
      metadata: true,
      tokenId: true,
      collection: {
        select: {
          name: true,
        },
      },
      product: {
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
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });

  const byContract = new Map<
    string,
    { names: Set<string>; creators: Set<string>; tokenCount: number }
  >();

  for (const row of rows) {
    const address = row.contractAddress.toLowerCase();
    const aggregate = byContract.get(address) ?? {
      names: new Set<string>(),
      creators: new Set<string>(),
      tokenCount: 0,
    };

    const name = metadataName(row.metadata);
    if (name) {
      aggregate.names.add(name);
    }
    if (row.collection?.name) {
      aggregate.names.add(row.collection.name);
    }
    if (row.product?.name) {
      aggregate.names.add(row.product.name);
    }
    if (row.project?.name) {
      aggregate.names.add(row.project.name);
    }

    const personName = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim();
    if (personName) {
      aggregate.creators.add(`${personName} (@${row.user.userName})`);
    } else {
      aggregate.creators.add(`@${row.user.userName}`);
    }

    aggregate.tokenCount += 1;
    byContract.set(address, aggregate);
  }

  for (const [address, aggregate] of byContract.entries()) {
    const firstName = [...aggregate.names][0];
    const firstCreator = [...aggregate.creators][0];
    const label = firstName ?? (firstCreator ? `${firstCreator}'s NFT Contract` : "NFT Contract");

    const descriptionParts: string[] = [];
    if (aggregate.names.size > 0) {
      descriptionParts.push(`Example NFT: "${[...aggregate.names][0]}"`);
    }
    if (aggregate.creators.size > 0) {
      descriptionParts.push(`Creator: ${[...aggregate.creators][0]}`);
    }
    descriptionParts.push(`Observed ${aggregate.tokenCount} matching asset record(s)`);

    upsertLabel(
      map,
      priorityMap,
      {
        address,
        label,
        description: descriptionParts.join(" • "),
        kind: "assetContract",
      },
      "assetContract",
    );
  }
}

export async function getAddressLabels(params: {
  chainId: string;
  addresses: Array<string | null | undefined>;
  simpleAccountAddress?: string;
}): Promise<AddressLabelMap> {
  const map: AddressLabelMap = {};
  const priorityMap: Record<string, number> = {};
  const addresses = uniqueNormalizedAddresses(params.addresses);
  if (addresses.length === 0) {
    return map;
  }

  const simpleAccount = normalize(params.simpleAccountAddress);
  if (simpleAccount) {
    upsertLabel(
      map,
      priorityMap,
      {
        address: simpleAccount,
        label: "SimpleAccount",
        description: "ERC4337 smart account contract",
        kind: "simpleAccount",
      },
      "simpleAccount",
    );
  }

  try {
    await Promise.all([
      addPaymentTokenLabels(params.chainId, addresses, map, priorityMap),
      addPlatformLabels(params.chainId, addresses, map, priorityMap),
      addFundingWalletLabels(params.chainId, addresses, map, priorityMap),
      addPlatformWalletLabels(params.chainId, addresses, map, priorityMap),
      addUserWalletLabels(addresses, map, priorityMap),
      addCollectionContractLabels(params.chainId, addresses, map, priorityMap),
      addVoucherContractLabels(addresses, map, priorityMap),
      addAssetContractLabels(params.chainId, addresses, map, priorityMap),
    ]);
  } catch {
    // Never fail transaction views if labeling fails.
  }

  return map;
}
