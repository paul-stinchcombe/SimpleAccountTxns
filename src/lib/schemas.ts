import { z } from "zod";

export const ChainQuerySchema = z.object({
  chainId: z.string().trim().min(1, "chainId is required"),
});

export const TransactionsQuerySchema = z.object({
  chainId: z.string().trim().min(1, "chainId is required"),
  cursor: z.string().trim().regex(/^0x[0-9a-fA-F]+$/, "cursor must be a hex block number").optional(),
  q: z.string().trim().max(256).optional(),
  accountScope: z.enum(["simpleAccount", "fundingWallet"]).default("simpleAccount"),
  status: z.enum(["all", "success", "failed"]).default("all"),
  limit: z.coerce.number().int().min(5).max(100).default(25),
});

export const TransactionDetailQuerySchema = z.object({
  chainId: z.string().trim().min(1, "chainId is required"),
});

export type TransactionsQuery = z.infer<typeof TransactionsQuerySchema>;
