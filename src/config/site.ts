export const SITE_CODE = "PTA";
export const SITE_NAME = "Pretoria";
export const APP_NAME = `${SITE_CODE} Dispatch`;

export const PTA_WAREHOUSES = [
  "Finished Goods AFi - Pretoria",
  "Raw - AFi Pretoria",
  "Dispatch Allmark - Pretoria",
  "Raws - Allmark Pretoria",
] as const;

export const DEFAULT_WAREHOUSE = PTA_WAREHOUSES[0];
export const DEFAULT_PICKUP = `${SITE_NAME} Warehouse`;

const normalizeWarehouse = (value: string) =>
  value.toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();

const PTA_WAREHOUSE_KEYS = new Set(PTA_WAREHOUSES.map(normalizeWarehouse));

export const isPtaWarehouse = (value?: string): boolean =>
  Boolean(value && PTA_WAREHOUSE_KEYS.has(normalizeWarehouse(value)));
