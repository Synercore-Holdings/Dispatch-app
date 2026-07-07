export const SITE_CODE = "K58";
export const SITE_NAME = "K58";
export const APP_NAME = `${SITE_CODE} Dispatch`;

export const DEFAULT_PICKUP = "K58 Warehouse";

const normalizeWarehouse = (value: string) =>
  value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

// This deployment is scoped to K58 only — every other site (Pretoria, or anything
// else) is a different process and must not be accepted on shipment upload.
export const isK58Warehouse = (value?: string): boolean =>
  Boolean(value && normalizeWarehouse(value).includes("k58"));
