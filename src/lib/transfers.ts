import { getAddress, hexToBigInt } from "viem";

type RawLog = {
  address: string;
  data: `0x${string}` | string;
  topics: readonly (`0x${string}` | string | null | readonly `0x${string}`[])[];
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
};

export type DecodedTransfer = {
  standard: "ERC20" | "ERC721" | "ERC1155";
  tokenAddress: string;
  from: string;
  to: string;
  tokenId?: string;
  value?: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC1155_TRANSFER_SINGLE_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";

function normalizeAddress(value: string): string {
  return getAddress(value).toLowerCase();
}

function decodeUintWord(data: string, wordIndex: number): string | null {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  const start = wordIndex * 64;
  const word = clean.slice(start, start + 64);
  if (word.length !== 64) {
    return null;
  }
  return hexToBigInt(`0x${word}`).toString();
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 42) {
    return null;
  }
  return normalizeAddress(`0x${topic.slice(-40)}`);
}

export function decodeTransferLogs(logs: RawLog[]): DecodedTransfer[] {
  const decoded: DecodedTransfer[] = [];

  for (const log of logs) {
    const topics = log.topics.filter((topic): topic is string => typeof topic === "string");
    if (topics.length === 0) {
      continue;
    }

    const topic0 = topics[0].toLowerCase();
    if (topic0 === TRANSFER_TOPIC && topics.length >= 3) {
      const from = topicAddress(topics[1]);
      const to = topicAddress(topics[2]);
      if (!from || !to) {
        continue;
      }

      if (topics.length >= 4) {
        const tokenId = hexToBigInt(topics[3] as `0x${string}`).toString();
        decoded.push({
          standard: "ERC721",
          tokenAddress: normalizeAddress(log.address),
          from,
          to,
          tokenId,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          logIndex: log.logIndex,
        });
      } else {
        const value = decodeUintWord(log.data, 0) ?? "0";
        decoded.push({
          standard: "ERC20",
          tokenAddress: normalizeAddress(log.address),
          from,
          to,
          value,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          logIndex: log.logIndex,
        });
      }
      continue;
    }

    if (topic0 === ERC1155_TRANSFER_SINGLE_TOPIC && topics.length >= 4) {
      const from = topicAddress(topics[2]);
      const to = topicAddress(topics[3]);
      const tokenId = decodeUintWord(log.data, 0);
      const value = decodeUintWord(log.data, 1);
      if (from && to && tokenId && value) {
        decoded.push({
          standard: "ERC1155",
          tokenAddress: normalizeAddress(log.address),
          from,
          to,
          tokenId,
          value,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          logIndex: log.logIndex,
        });
      }
    }
  }

  return decoded;
}
