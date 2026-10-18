import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { listSales } from "./api";
import { peekActiveUserId } from "./identity";
import { pendingWrites, runQueueableWrite } from "./write-queue";

/**
 * P2-03 sale records live on the server (per user). Writes go through the P1-09
 * offline queue; pending writes overlay the server list so the P&L reflects them
 * right away. Older on-device records are uploaded once, then removed.
 */
export interface SaleRecord {
  price: string;
  fees: string | null;
  soldAt: string;
}

const webMemory = new Map<string, string>();
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
const legacyKey = (inventoryItemId: string) =>
  `cardflow.sale.${safe(peekActiveUserId())}.${safe(inventoryItemId)}`;
const migratedKey = () => `cardflow.sales.migrated.${safe(peekActiveUserId())}`;

async function getRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") return webMemory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}
async function setRaw(key: string, value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    if (value === null) webMemory.delete(key);
    else webMemory.set(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

/** One-time upload of on-device sales from before server sync. Server copy wins. */
export async function migrateLocalSales(inventoryItemIds: readonly string[]): Promise<number> {
  if ((await getRaw(migratedKey())) === "1") return 0;
  let moved = 0;
  for (const id of inventoryItemIds) {
    const raw = await getRaw(legacyKey(id));
    if (!raw) continue;
    let sale: SaleRecord | null = null;
    try {
      const parsed = JSON.parse(raw) as SaleRecord;
      sale = typeof parsed?.price === "string" ? parsed : null;
    } catch {
      sale = null;
    }
    if (sale) {
      // Throws only on a permanent refusal; offline writes are queued and replayed.
      await runQueueableWrite("save_sale", {
        inventoryItemId: id,
        body: { price: sale.price, fees: sale.fees, soldAt: sale.soldAt, onlyIfMissing: true },
      }).catch(() => undefined);
      moved += 1;
    }
    await setRaw(legacyKey(id), null);
  }
  await setRaw(migratedKey(), "1");
  return moved;
}

function overlayPending(base: Map<string, SaleRecord>): Map<string, SaleRecord> {
  const out = new Map(base);
  for (const write of pendingWrites()) {
    if (write.kind === "save_sale") {
      const p = write.payload as { inventoryItemId: string; body: { price: string; fees?: string | null; soldAt?: string; onlyIfMissing?: boolean } };
      if (p.body.onlyIfMissing && out.has(p.inventoryItemId)) continue;
      out.set(p.inventoryItemId, {
        price: p.body.price,
        fees: p.body.fees ?? null,
        soldAt: p.body.soldAt ?? new Date().toISOString(),
      });
    } else if (write.kind === "delete_sale") {
      out.delete((write.payload as { inventoryItemId: string }).inventoryItemId);
    }
  }
  return out;
}

/** Server sales plus anything still waiting to sync. `offline` when the server couldn't be reached. */
export async function loadSales(): Promise<{ sales: Map<string, SaleRecord>; offline: boolean }> {
  try {
    const { sales } = await listSales();
    const base = new Map<string, SaleRecord>(
      sales.map((sale) => [sale.inventoryItemId, { price: sale.price, fees: sale.fees, soldAt: sale.soldAt }]),
    );
    return { sales: overlayPending(base), offline: false };
  } catch {
    return { sales: overlayPending(new Map()), offline: true };
  }
}

export async function saveSale(inventoryItemId: string, sale: SaleRecord | null): Promise<void> {
  if (sale) {
    await runQueueableWrite("save_sale", {
      inventoryItemId,
      body: { price: sale.price, fees: sale.fees, soldAt: sale.soldAt },
    });
  } else {
    await runQueueableWrite("delete_sale", { inventoryItemId });
  }
}
