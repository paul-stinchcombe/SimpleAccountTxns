import { prisma } from "@/src/lib/prisma";

export type ChainContext = {
  chainId: string;
  chainName: string;
  logoUrl: string | null;
  rpcUrl: string;
  isDefault: boolean;
  simpleAccountAddress: string;
  platformFundingWalletAddress: string;
};

export async function listChainsWithPlatform(): Promise<ChainContext[]> {
  const [chains, platforms] = await Promise.all([
    prisma.blockchain.findMany({
      orderBy: [{ default: "desc" }, { name: "asc" }],
      select: {
        chainId: true,
        name: true,
        logoUrl: true,
        rpcUrl: true,
        default: true,
      },
    }),
    prisma.platform.findMany({
      select: { chainId: true, simpleAccountAddress: true, platformFundingWalletAddress: true },
    }),
  ]);

  const platformMap = new Map(
    platforms.map((item) => [
      item.chainId,
      {
        simpleAccountAddress: item.simpleAccountAddress,
        platformFundingWalletAddress: item.platformFundingWalletAddress,
      },
    ]),
  );
  return chains
    .filter((chain) => platformMap.has(chain.chainId))
    .map((chain) => ({
      chainId: chain.chainId,
      chainName: chain.name,
      logoUrl: chain.logoUrl,
      rpcUrl: chain.rpcUrl,
      isDefault: chain.default,
      simpleAccountAddress: platformMap.get(chain.chainId)?.simpleAccountAddress as string,
      platformFundingWalletAddress: platformMap.get(chain.chainId)?.platformFundingWalletAddress as string,
    }));
}

export async function getChainContext(chainId: string): Promise<ChainContext | null> {
  const [chain, platform] = await Promise.all([
    prisma.blockchain.findUnique({
      where: { chainId },
      select: {
        chainId: true,
        name: true,
        logoUrl: true,
        rpcUrl: true,
        default: true,
      },
    }),
    prisma.platform.findUnique({
      where: { chainId },
      select: {
        chainId: true,
        simpleAccountAddress: true,
        platformFundingWalletAddress: true,
      },
    }),
  ]);

  if (!chain || !platform) {
    return null;
  }

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    logoUrl: chain.logoUrl,
    rpcUrl: chain.rpcUrl,
    isDefault: chain.default,
    simpleAccountAddress: platform.simpleAccountAddress,
    platformFundingWalletAddress: platform.platformFundingWalletAddress,
  };
}
