import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { peekActiveUserId } from "./identity";

/** On-device sale records for the P&L. One small value per card. */
export interface SaleRecord {
  price: string;
  fees: string | null;
  soldAt: string;
}

const webMemory = new Map<string, string>();

function keyFor(inventoryItemId: string): string {
  const user = peekActiveUserId().replace(/[^A-Za-z0-9._-]/g, "_");
  const item = inventoryItemId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `cardflow.sale.${user}.${item}`;
}

async function getRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") return webMemory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function loadSale(inventoryItemId: string): Promise<SaleRecord | null> {
  try {
    const raw = await getRaw(keyFor(inventoryItemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaleRecord;
    return typeof parsed?.price === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSale(inventoryItemId: string, sale: SaleRecord | null): Promise<void> {
  const key = keyFor(inventoryItemId);
  if (Platform.OS === "web") {
    if (sale) webMemory.set(key, JSON.stringify(sale));
    else webMemory.delete(key);
    return;
  }
  if (sale) await SecureStore.setItemAsync(key, JSON.stringify(sale));
  else await SecureStore.deleteItemAsync(key);
}
