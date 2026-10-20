/** MyDEX set view (Sean, Oct 19): catalog art only, owned vs total per set. */
import { z } from "zod";
import { defineRoute } from "./core";

const DexSetSummarySchema = z.looseObject({
  setId: z.string(),
  name: z.string(),
  logo: z.string().nullable(),
  owned: z.number(),
  total: z.number(),
});

const DexCardSchema = z.looseObject({
  tcgdexId: z.string(),
  localId: z.string(),
  name: z.string(),
  thumbUrl: z.string().nullable(),
  owned: z.boolean(),
});

export const dexRoutes = {
  listDexSets: defineRoute({
    method: "GET",
    path: "/v1/dex/sets",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), sets: z.array(DexSetSummarySchema) }),
  }),
  getDexSet: defineRoute({
    method: "GET",
    path: "/v1/dex/sets/:setId",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      set: DexSetSummarySchema.extend({ cards: z.array(DexCardSchema) }),
    }),
  }),
} as const;
