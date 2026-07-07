export const SITE_CODE = "K58";
export const SITE_NAME = "K58";
export const APP_NAME = `${SITE_CODE} Dispatch`;

export const DEFAULT_PICKUP = "K58 Warehouse";

// Warehouses that belong to the separate Pretoria (PTA) deployment — ignored here.
const PTA_WAREHOUSES = [
  "Finished Goods AFi - Pretoria",
  "Raw - AFi Pretoria",
  "Dispatch Allmark - Pretoria",
  "Raws - Allmark Pretoria",
] as const;

const normalizeWarehouse = (value: string) =>
  value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

const PTA_WAREHOUSE_KEYS = new Set(PTA_WAREHOUSES.map(normalizeWarehouse));

export const isPtaWarehouse = (value?: string): boolean =>
  Boolean(
    value &&
      (PTA_WAREHOUSE_KEYS.has(normalizeWarehouse(value)) || normalizeWarehouse(value).includes("pretoria"))
  );
