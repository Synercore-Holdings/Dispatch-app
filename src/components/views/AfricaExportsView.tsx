import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe2,
  GripVertical,
  History,
  Package,
  Plane,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Ship,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";

import { useAuth } from "../../context/AuthContext";
import { useNotification } from "../../context/NotificationContext";
import { africaExportCountryRulesAPI, africaExportTransportersAPI, africaExportsAPI } from "../../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";

type ExportTab = "onboarding" | "overview" | "documents" | "permits" | "incoterms" | "history";
type ExportStatus = "pending" | "assigned" | "in-transit" | "delivered" | "cancelled";
type DocumentStatus = Record<string, boolean>;
type DocumentDetails = Record<string, { reference: string; expiry: string; notes: string }>;

interface ProductLine {
  id: string;
  product: string;
  hsCode: string;
  quantity: number;
  pallets: number;
  batch: string;
  notes: string;
}

interface CountryRule {
  id?: string;
  country: string;
  title: string;
  points: string[];
  requiredDocumentIds: string[];
  history?: CountryRuleHistoryEntry[];
  updatedBy?: string;
}

interface CustomerRule {
  title: string;
  matches: (customer: string) => boolean;
  points: string[];
  requiredDocumentIds: string[];
}

interface CountryRuleHistoryEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
  user: string;
}

interface ShipmentHistoryEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
}

interface ExportShipment {
  id?: string;
  ref: string;
  customer: string;
  destinationCountry: string;
  hsCode: string;
  productType: string;
  incoterm: string;
  transportMode: string;
  preferenceScheme: string;
  destinationAgent: string;
  etd: string;
  eta: string;
  customsBufferDays?: number;
  queuePosition?: number;
  quantity: number;
  pallets: number;
  status: ExportStatus;
  assignedTransporterId?: string;
  lastCheckedAt: string;
  notes: string;
  documents: DocumentStatus;
  documentDetails?: DocumentDetails;
  productLines?: ProductLine[];
  history?: ShipmentHistoryEntry[];
  archived?: boolean;
  dispatchApprovedAt?: string;
  dispatchApprovedBy?: string;
}

interface ExportTransporter {
  id: string;
  name: string;
  route: string;
  contact: string;
  capacity: number;
  status: "available" | "busy" | "offline";
}

interface ChecklistItem {
  id: string;
  label: string;
  purpose: string;
  required?: boolean;
  conditional?: string;
}

interface ChecklistGroup {
  title: string;
  description: string;
  items: ChecklistItem[];
}

const SHIPMENTS_KEY = "dispatch_africa_export_shipments_v2";
const TRANSPORTERS_KEY = "dispatch_africa_export_transporters_v1";
const COUNTRY_RULES_KEY = "dispatch_africa_export_country_rules_v1";

const AFRICA_COUNTRIES = [
  "Algeria",
  "Angola",
  "Benin",
  "Botswana",
  "Burkina Faso",
  "Burundi",
  "Cabo Verde",
  "Cameroon",
  "Central African Republic",
  "Chad",
  "Comoros",
  "Democratic Republic of the Congo",
  "Republic of the Congo",
  "Cote d'Ivoire",
  "Djibouti",
  "Egypt",
  "Equatorial Guinea",
  "Eritrea",
  "Eswatini",
  "Ethiopia",
  "Gabon",
  "Gambia",
  "Ghana",
  "Guinea",
  "Guinea-Bissau",
  "Kenya",
  "Lesotho",
  "Liberia",
  "Libya",
  "Madagascar",
  "Malawi",
  "Mali",
  "Mauritania",
  "Mauritius",
  "Morocco",
  "Mozambique",
  "Namibia",
  "Niger",
  "Nigeria",
  "Rwanda",
  "Sao Tome and Principe",
  "Senegal",
  "Seychelles",
  "Sierra Leone",
  "Somalia",
  "South Sudan",
  "Sudan",
  "Tanzania",
  "Togo",
  "Tunisia",
  "Uganda",
  "Zambia",
  "Zimbabwe",
];

type LeadTimeMode = "air" | "road" | "sea";

interface ExportLeadTimeGuide {
  air: string;
  road: string;
  sea: string;
}

const EXPORT_LEAD_TIME_GUIDE: Record<string, ExportLeadTimeGuide> = {
  Algeria: { air: "4-8 days", road: "Not practical", sea: "30-50 days" },
  Angola: { air: "3-6 days", road: "10-18 days", sea: "20-35 days" },
  Benin: { air: "4-8 days", road: "Not practical", sea: "30-45 days" },
  Botswana: { air: "1-3 days", road: "2-5 days", sea: "Not practical" },
  "Burkina Faso": { air: "5-10 days", road: "Not practical", sea: "35-55 days via Ghana/Togo/Benin + inland" },
  Burundi: { air: "4-7 days", road: "16-26 days", sea: "28-45 days via Dar/Mombasa + road" },
  "Cabo Verde": { air: "5-10 days", road: "Not possible", sea: "40-60 days" },
  Cameroon: { air: "4-8 days", road: "Not practical / difficult", sea: "30-50 days via Douala" },
  "Central African Republic": { air: "5-10 days", road: "Not practical", sea: "40-65 days via Douala + inland" },
  Chad: { air: "5-10 days", road: "Not practical", sea: "35-60 days via Douala + inland" },
  Comoros: { air: "5-10 days", road: "Not possible", sea: "30-50 days" },
  "Cote d'Ivoire": { air: "4-8 days", road: "Not practical", sea: "28-45 days" },
  "Democratic Republic of the Congo": { air: "4-8 days", road: "12-25 days", sea: "25-45 days via Matadi/Durban/Dar + inland" },
  Djibouti: { air: "4-7 days", road: "Not practical", sea: "25-40 days" },
  Egypt: { air: "3-6 days", road: "Not practical", sea: "25-40 days" },
  "Equatorial Guinea": { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Eritrea: { air: "5-8 days", road: "Not practical", sea: "30-50 days" },
  Eswatini: { air: "1-2 days", road: "1-3 days", sea: "Not practical" },
  Ethiopia: { air: "4-7 days", road: "Not practical", sea: "28-45 days via Djibouti + inland" },
  Gabon: { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Gambia: { air: "5-9 days", road: "Not practical", sea: "35-50 days" },
  Ghana: { air: "4-8 days", road: "Not practical", sea: "28-45 days" },
  Guinea: { air: "5-9 days", road: "Not practical", sea: "35-50 days" },
  "Guinea-Bissau": { air: "5-10 days", road: "Not practical", sea: "35-55 days" },
  Kenya: { air: "3-6 days", road: "12-20 days", sea: "18-35 days via Mombasa" },
  Lesotho: { air: "1-2 days", road: "1-3 days", sea: "Not practical" },
  Liberia: { air: "5-9 days", road: "Not practical", sea: "35-50 days" },
  Libya: { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Madagascar: { air: "4-8 days", road: "Not possible", sea: "25-40 days" },
  Malawi: { air: "2-5 days", road: "6-10 days", sea: "18-30 days via Beira/Durban + road" },
  Mali: { air: "5-10 days", road: "Not practical", sea: "35-60 days via Dakar/Abidjan + inland" },
  Mauritania: { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Mauritius: { air: "3-6 days", road: "Not possible", sea: "18-30 days" },
  Morocco: { air: "4-8 days", road: "Not practical", sea: "30-50 days" },
  Mozambique: { air: "1-4 days", road: "3-7 days", sea: "10-21 days coastal / port dependent" },
  Namibia: { air: "1-4 days", road: "4-8 days", sea: "12-24 days" },
  Niger: { air: "5-10 days", road: "Not practical", sea: "35-60 days via Cotonou/Lome + inland" },
  Nigeria: { air: "4-8 days", road: "Not practical", sea: "30-50 days" },
  "Republic of the Congo": { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Rwanda: { air: "3-6 days", road: "14-24 days", sea: "25-40 days via Mombasa/Dar + road" },
  "Sao Tome and Principe": { air: "5-10 days", road: "Not possible", sea: "40-60 days" },
  Senegal: { air: "4-8 days", road: "Not practical", sea: "30-45 days" },
  Seychelles: { air: "4-8 days", road: "Not possible", sea: "25-40 days" },
  "Sierra Leone": { air: "5-9 days", road: "Not practical", sea: "35-50 days" },
  Somalia: { air: "5-10 days", road: "Not practical", sea: "30-55 days" },
  "South Sudan": { air: "5-10 days", road: "20-35 days, difficult", sea: "35-55 days via Mombasa/Djibouti + inland" },
  Sudan: { air: "5-9 days", road: "Not practical", sea: "35-55 days" },
  Tanzania: { air: "3-6 days", road: "10-18 days", sea: "18-32 days" },
  Togo: { air: "4-8 days", road: "Not practical", sea: "30-45 days" },
  Tunisia: { air: "4-7 days", road: "Not practical", sea: "30-45 days" },
  Uganda: { air: "3-6 days", road: "14-24 days", sea: "25-40 days via Mombasa/Dar + road" },
  Zambia: { air: "2-5 days", road: "5-9 days", sea: "18-30 days via Durban/Beira/Dar + road" },
  Zimbabwe: { air: "1-4 days", road: "3-6 days", sea: "14-25 days via Durban/Beira + road" },
};

const EXPORT_LEAD_TIME_ALIASES: Record<string, string> = {
  "Cape Verde": "Cabo Verde",
  "Cote dIvoire": "Cote d'Ivoire",
  "DR Congo": "Democratic Republic of the Congo",
  "DRC": "Democratic Republic of the Congo",
  "Sao Tome & Principe": "Sao Tome and Principe",
};

const EXPORT_LEAD_TIME_SERVICES: {
  id: LeadTimeMode;
  label: string;
  transportMode: string;
  icon: React.FC<any>;
}[] = [
  { id: "air", label: "Export Airfreight", transportMode: "Air", icon: Plane },
  { id: "road", label: "Export Road", transportMode: "Road", icon: Truck },
  { id: "sea", label: "Export Seafreight", transportMode: "Sea", icon: Ship },
];

const EXPORT_STATUSES: ExportStatus[] = ["pending", "assigned", "in-transit", "delivered", "cancelled"];
const CLOSED_EXPORT_STATUSES: ExportStatus[] = ["delivered", "cancelled"];
const PRE_DISPATCH_EXPORT_STATUSES: ExportStatus[] = ["pending", "assigned"];

const asText = (value: unknown, fallback = "") => (value === undefined || value === null ? fallback : String(value));

const asOptionalText = (value: unknown) => {
  const text = asText(value);
  return text || undefined;
};

const normalizeLeadTimeCountry = (country: unknown) => {
  const trimmed = asText(country).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u2019/g, "'");
  return EXPORT_LEAD_TIME_GUIDE[trimmed] ? trimmed : EXPORT_LEAD_TIME_ALIASES[trimmed] || trimmed;
};

const getLeadTimeGuide = (country: unknown) => EXPORT_LEAD_TIME_GUIDE[normalizeLeadTimeCountry(country)];

const isLeadTimePractical = (leadTime: string) => !/not practical|not possible/i.test(leadTime);

const getLeadTimeModeForTransportMode = (transportMode: unknown): LeadTimeMode | "" =>
  asText(transportMode) === "Air" || asText(transportMode) === "Courier" ? "air" :
  asText(transportMode) === "Sea" ? "sea" :
  asText(transportMode) === "Road" ? "road" :
  "";

const getLeadTimeMaxDays = (leadTime: string) => {
  if (!isLeadTimePractical(leadTime)) return null;
  const matches = leadTime.match(/\d+/g);
  if (!matches?.length) return null;
  return Math.max(...matches.map((value) => Number(value)));
};

const toDateInputValue = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

const todayDateInput = () => toDateInputValue(new Date());

const calculateEtdFromEta = (eta: string, leadTime: string, bufferDays: number) => {
  const maxLeadDays = getLeadTimeMaxDays(leadTime);
  if (!eta || maxLeadDays === null) return "";
  const etaDate = new Date(eta);
  if (Number.isNaN(etaDate.getTime())) return "";
  etaDate.setDate(etaDate.getDate() - maxLeadDays - Math.max(0, Math.round(bufferDays || 0)));
  return toDateInputValue(etaDate);
};

const calculateEtaFromEtd = (etd: string, leadTime: string, bufferDays: number) => {
  const maxLeadDays = getLeadTimeMaxDays(leadTime);
  if (!etd || maxLeadDays === null) return "";
  const etdDate = new Date(etd);
  if (Number.isNaN(etdDate.getTime())) return "";
  etdDate.setDate(etdDate.getDate() + maxLeadDays + Math.max(0, Math.round(bufferDays || 0)));
  return toDateInputValue(etdDate);
};

const CORE_DOCUMENTS: ChecklistItem[] = [
  { id: "proforma-invoice", label: "Proforma Invoice", purpose: "Pre-shipment quote document used by the buyer or destination agent to apply for import permits, approvals, or foreign payment where required.", conditional: "Prepare before shipment when the importer, bank, or destination authority needs it." },
  { id: "commercial-invoice", label: "Commercial Invoice", purpose: "Customs valuation, buyer and seller details, Incoterm, currency, HS code, product description, and country of origin.", required: true },
  { id: "packing-list", label: "Packing List", purpose: "Carton or pallet count, gross and net weight, dimensions, and batch numbers where applicable.", required: true },
  { id: "sad-500", label: "SAD 500 / Export Customs Declaration", purpose: "South African customs export declaration lodged with SARS.", required: true },
  { id: "transport-document", label: "Transport Document / Consignment Note", purpose: "Road consignment note, CMR, air waybill, or bill of lading depending on transport mode.", required: true },
  { id: "road-manifest", label: "Road Manifest / Cargo Manifest", purpose: "Transporter or clearing-agent manifest used with cross-border road clearance and destination import support.", conditional: "Required for South Africa to Zambia road exports and other road movements where the border agent requests a cargo or road manifest." },
  { id: "electronic-manifest", label: "Electronic Manifest", purpose: "Electronic cargo manifest aligned to the commercial invoice, packing list, shipment quantities, and transport details.", conditional: "Required before loading for Dairibord Zimbabwe shipments." },
  { id: "hs-code", label: "HS Code / Tariff Classification", purpose: "Required for SA export declaration and destination import clearance.", required: true },
  { id: "exporter-code", label: "Exporter Customs Code / SARS Registration", purpose: "Confirms the exporter is registered with SARS Customs where required.", required: true },
  { id: "proof-export", label: "Proof of Export Pack", purpose: "VAT zero-rating and customs audit support: SAD 500, transport document, border stamps, POD, exit note, and related evidence.", required: true },
];

const ORIGIN_DOCUMENTS: ChecklistItem[] = [
  { id: "general-coo", label: "Certificate of Origin - General COO", purpose: "Proof of origin when requested by the buyer or destination customs.", conditional: "Use when destination or customer asks for origin proof without preference." },
  { id: "sadc-coo", label: "SADC Certificate of Origin", purpose: "Supports preferential or reduced duty claims in SADC countries.", conditional: "Needed when the importer wants to claim SADC preference and the product qualifies. SARS has confirmed SADC COO does not need to be stamped at a SARS office until further notice." },
  { id: "afcfta-coo", label: "AfCFTA Certificate of Origin", purpose: "Supports AfCFTA preferential duty claims where the country and goods qualify.", conditional: "Use only for participating AfCFTA preference movements." },
  { id: "producer-declaration", label: "Producer / Manufacturer Declaration", purpose: "Supports origin qualification, especially when exporter is not the manufacturer." },
  { id: "local-content", label: "Costing / Local Content Support", purpose: "Evidence that the product qualifies under SADC or AfCFTA rules of origin." },
];

const FOOD_DOCUMENTS: ChecklistItem[] = [
  { id: "coa", label: "Certificate of Analysis / COA", purpose: "Batch-specific quality results.", required: true },
  { id: "tds", label: "Technical Data Sheet / TDS", purpose: "Composition, application, dosage, and physical or chemical specifications.", required: true },
  { id: "sds", label: "Safety Data Sheet / SDS/MSDS", purpose: "Warehouse, transport, chemical, flavouring, or dangerous goods acceptance.", required: true },
  { id: "allergen", label: "Allergen Statement", purpose: "Commonly required by African importers and food authorities.", required: true },
  { id: "non-gmo", label: "Non-GMO / GMO Declaration", purpose: "Often requested for food products and ingredients.", required: true },
  { id: "food-grade", label: "Food Grade Declaration", purpose: "Confirms the product is suitable for food use.", required: true },
  { id: "shelf-life", label: "Shelf-life / Storage Declaration", purpose: "Production date, expiry date, best-before date, and storage conditions.", required: true },
  { id: "batch-traceability", label: "Batch / Lot Traceability", purpose: "Links invoice quantity to production batch.", required: true },
  { id: "health-free-sale", label: "Health Certificate / Free Sale Certificate", purpose: "Destination food authority support.", conditional: "Depends on product and destination country." },
  { id: "halal", label: "Halal Certificate", purpose: "Required for halal-sensitive customers or countries.", conditional: "Use where buyer or country requires halal compliance." },
  { id: "phyto", label: "Phytosanitary Certificate", purpose: "Plant-based, agricultural, botanical, or regulated plant products.", conditional: "Required for regulated plant products." },
  { id: "vet", label: "Veterinary / DAFF-type Certificate", purpose: "Animal-origin products, dairy, gelatine, collagen, animal enzymes, or meat-related products.", conditional: "Required for animal-origin or regulated animal products." },
];

const PERMIT_DOCUMENTS: ChecklistItem[] = [
  { id: "speedlink-loading-authority", label: "Speedlink Cargo Loading Authority", purpose: "Proof that the Zimbabwe clearing agent has pre-checked duties, third-party charges, controls, compliance documents, and preferential trade requirements.", conditional: "Mandatory before any Dairibord Zimbabwe cargo is loaded or dispatched." },
  { id: "loading-authority-prealert", label: "Loading Authority Attached to Pre-alert", purpose: "Confirms the Speedlink Cargo Loading Authority was included in the pre-alert sent to the transporter, clearing agent, and relevant internal parties.", conditional: "Mandatory for Dairibord Zimbabwe shipments before loading." },
  { id: "applicable-control-compliance", label: "Applicable Control / Compliance Documents", purpose: "Product-specific control and compliance documents checked against the Loading Authority and shipment pack.", conditional: "Required where identified by Speedlink Cargo, ZIMRA, or another Zimbabwe authority." },
  { id: "ema-si-268-2018", label: "EMA SI 268 of 2018", purpose: "Zimbabwe environmental control/compliance document currently reflected on the Loading Authority for Yogurt Stabiliser under tariff code 3824.9990.", conditional: "Required for Yogurt Stabiliser supplied to Dairibord Zimbabwe unless Speedlink Cargo confirms otherwise in writing." },
  { id: "additional-zimbabwe-compliance", label: "Additional Zimbabwe Compliance Documents", purpose: "Any further compliance documents requested by Speedlink Cargo, ZIMRA, or the relevant Zimbabwe authority.", conditional: "Add and confirm when requested for the shipment." },
  { id: "itac-permit", label: "ITAC Export Permit", purpose: "Required only for controlled or restricted goods leaving South Africa.", conditional: "Check before dispatch for controlled goods." },
  { id: "import-permit", label: "Destination Import Permit", purpose: "Often needed for food, chemicals, dairy, animal-origin, plant, medicine, or controlled products.", conditional: "Must usually be issued before shipment." },
  { id: "coc-pvoc", label: "COC / PVOC / Pre-shipment Inspection", purpose: "Conformity assessment for countries such as Kenya, Tanzania, Uganda, Cameroon, and others depending on product.", conditional: "Confirm with destination agent before loading." },
  { id: "sgs-cameroon", label: "Cameroon SGS Confirmation", purpose: "SGS inspection, COC route, or exemption confirmation for Cameroon shipments.", conditional: "Required when Cameroon agent confirms SGS route." },
  { id: "cargox-registration", label: "CargoX Registration / Verification", purpose: "Exporter CargoX registration and verification needed before Egypt NAFEZA ACI can be completed.", conditional: "Required for Egypt ACI/NAFEZA shipments." },
  { id: "acid-number", label: "Egypt ACID Number", purpose: "ACID issued through NAFEZA by Egyptian importer or authorised agent and received by exporter in CargoX.", conditional: "Required before Egypt ACI documents are sent." },
  { id: "aci-envelope", label: "CargoX ACI Document Envelope", purpose: "Commercial invoice, packing list, transport document, and certificates uploaded through CargoX for Egypt ACI.", conditional: "Required for Egypt once ACID is approved." },
  { id: "product-registration", label: "Product Registration", purpose: "Some countries require food additives, enzymes, chemicals, fertilisers, or health-related products to be registered before import." },
  { id: "dg-declaration", label: "Dangerous Goods Declaration", purpose: "Required if product is classified as dangerous goods for air, sea, or road transport." },
  { id: "temperature-control", label: "Temperature Control Declaration", purpose: "Chilled, frozen, culture, or temperature-sensitive products." },
];

const DESTINATION_DOCUMENTS: ChecklistItem[] = [
  { id: "importer-tax", label: "Importer Tax / Customs Registration Number", purpose: "Required for import entry in the destination country.", required: true },
  { id: "zambia-tpin", label: "Zambia TPIN / Importer Registration", purpose: "Confirms the Zambian importer can clear the shipment with ZRA.", conditional: "Required for Zambia import clearance." },
  { id: "agent-appointment", label: "Clearing Agent Appointment", purpose: "Importer appoints destination clearing agent.", required: true },
  { id: "hs-confirmation", label: "Destination HS Code Confirmation", purpose: "Avoids customs disputes by aligning exporter, forwarder, and destination clearing agent.", required: true },
  { id: "duties-vat", label: "Duties and VAT Calculation", purpose: "Based on HS code, customs value, origin, and applicable trade agreement." },
  { id: "zambia-final-clearance", label: "Zambia Final Clearance Confirmation", purpose: "Buyer, importer, or Zambian clearing agent confirms who handles final import clearance, duties, VAT, and taxes.", conditional: "Confirm before dispatch for DAP Zambia shipments where transport excludes final clearance." },
  { id: "zcsa-standards", label: "ZCSA / Compulsory Standards Check", purpose: "Zambian agent confirms whether the product is covered by compulsory standards, import quality monitoring, or inspection.", conditional: "Confirm before dispatch for Zambia." },
  { id: "zambia-labelling", label: "Zambia Food Labelling Check", purpose: "Importer confirms English labels, ingredients, expiry or expiration date, and any product-specific labelling controls.", conditional: "Confirm before dispatch for imported food products." },
  { id: "border-inspection", label: "Border / Port Health / Standards Inspection", purpose: "Food, chemical, cosmetic, animal, and plant products may be inspected." },
  { id: "original-docs", label: "Original Documents Confirmed", purpose: "Some countries still require original COO, SADC, health certificate, or stamped documents." },
];

const CHECKLIST_GROUPS: ChecklistGroup[] = [
  { title: "Core Export Documents", description: "Almost always required for South Africa exports into Africa.", items: CORE_DOCUMENTS },
  { title: "Origin / Duty Preference", description: "SADC is not automatic. Use preferential documents only when the importer claims preference and the product qualifies.", items: ORIGIN_DOCUMENTS },
  { title: "Food Ingredient Documents", description: "Recommended pack for food ingredients, flavourings, enzymes, dairy blends, premixes, and stabilisers.", items: FOOD_DOCUMENTS },
  { title: "Permits and Approvals", description: "Product and country controls that must be checked before dispatch.", items: PERMIT_DOCUMENTS },
  { title: "Destination Customs", description: "Items normally confirmed by the consignee or destination clearing agent.", items: DESTINATION_DOCUMENTS },
];

const INCOTERM_GUIDANCE = [
  { term: "EXW", responsibility: "Buyer handles collection and export flow, but seller still needs strong proof of export if VAT is zero-rated." },
  { term: "FOB / FCA", responsibility: "Seller normally handles export customs clearance up to the handover point." },
  { term: "CFR / CIF", responsibility: "Seller handles export customs and international freight. Buyer handles destination clearance, duties, and VAT." },
  { term: "DAP", responsibility: "Seller delivers to named destination. Buyer usually pays import duties and VAT unless agreed otherwise." },
  { term: "DDP", responsibility: "Seller carries maximum responsibility including destination duties and taxes. Use carefully for Africa exports." },
];

const PRE_DISPATCH_CHECKS = [
  "Correct HS code agreed between exporter, forwarder, and destination clearing agent.",
  "Destination country confirms whether an import permit is required.",
  "SADC or AfCFTA COO need is confirmed for duty preference.",
  "SARS has confirmed SADC COO does not need to be stamped at a SARS office until further notice.",
  "COC, PVOC, SGS, Bureau Veritas, or Intertek inspection requirement is confirmed.",
  "Health, phytosanitary, veterinary, or food safety certificate need is confirmed.",
  "Invoice and packing list match exactly: description, quantity, weights, batch numbers, and Incoterm.",
  "Destination charges payer is clear under the agreed Incoterm.",
  "Full proof of export pack is retained for SARS and VAT audit.",
];

const ONBOARDING_REQUIREMENTS = [
  "Required product description for the destination market.",
  "Customer product code, if applicable.",
  "Final consignee and destination country.",
  "Packaging size and format.",
  "Label wording and language requirements.",
  "Ingredient declaration requirements.",
  "Batch number, manufacturing date, expiry date, and shelf-life format.",
  "Net weight / quantity declaration requirements.",
  "Country of origin wording.",
  "Manufacturer / supplier details required on the label.",
  "Any special carton, pallet, or product marking requirements.",
  "Whether the destination requires SGS, COC, PVOC, KEBS, or any other pre-export inspection/certification.",
  "Whether an import permit, product registration, or destination authority approval is required.",
  "Whether the client has a previously approved label or document pack for the same destination.",
  "Whether the label must be approved by the client, SGS, or the destination authority before shipment.",
];

const ONBOARDING_RESPONSIBILITIES = [
  {
    owner: "Sales / Customer Owner",
    responsibility: "Obtain and confirm the customer-specific and destination-specific requirements from the client.",
  },
  {
    owner: "QA / Regulatory",
    responsibility: "Confirm the product specification, ingredient declaration, allergen information, label compliance, shelf-life, COA, testing, and regulatory requirements.",
  },
  {
    owner: "Production / Site",
    responsibility: "Implement the approved label and product procedure only once the requirements have been reviewed and signed off.",
  },
  {
    owner: "Exports / Logistics",
    responsibility: "Confirm SGS, export, customs, certificate of origin, import permit, and destination documentation requirements.",
  },
];

const UNIVERSAL_EXPORT_RULES = [
  "SARS CONFIRMED SADC COO DOES NOT NEED TO BE STAMPED AT SARS OFFICE UNTIL FURTHER NOTICE",
  ...PRE_DISPATCH_CHECKS.filter((rule) => !rule.toLowerCase().includes("sadc coo does not need")),
];

const AGENT_QUESTION =
  "Please confirm, based on the HS code and product description, whether any import permit, standards approval, COC/PVOC, health certificate, phytosanitary/veterinary certificate, or original certificate of origin is required before shipment.";

const normalizeCustomerName = (customer: string) => customer.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DAIRIBORD_ZIMBABWE_RULE: CustomerRule = {
  title: "Dairibord Zimbabwe - Speedlink Loading Authority",
  matches: (customer) => normalizeCustomerName(customer).includes("dairibord zimbabwe"),
  points: [
    "No Dairibord Zimbabwe shipment may be loaded or dispatched until Logistics has obtained the Speedlink Cargo Loading Authority and checked it against the shipment documents.",
    "Obtain the Loading Authority within 3-4 working days from receipt of the order, provided all required documents and product information are available.",
    "Before loading, align the Commercial / Supplier Invoice, Packing List, Electronic Manifest, correct preferential trade agreement certificate, applicable control documents, and any additional documents requested by Speedlink Cargo, ZIMRA, or the relevant Zimbabwe authority.",
    "Attach the Loading Authority to the pre-alert sent to the transporter, clearing agent, and relevant internal parties.",
    "If the authority is delayed, Logistics must update Sales, QA, and Dispatch with the outstanding information, who it is pending from, and the next expected follow-up date.",
    "Logistics owns the authority; QA owns supporting product, ingredient, label, COA, batch, and compliance information; Sales owns customer-specific requirements. Final approval remains cross-functional where documentation or compliance is affected.",
  ],
  requiredDocumentIds: [
    "commercial-invoice",
    "packing-list",
    "electronic-manifest",
    "sadc-coo",
    "speedlink-loading-authority",
    "loading-authority-prealert",
    "applicable-control-compliance",
  ],
};

const getCustomerRule = (customer: string) =>
  DAIRIBORD_ZIMBABWE_RULE.matches(customer) ? DAIRIBORD_ZIMBABWE_RULE : undefined;

const isYogurtStabiliserShipment = (shipment: ExportShipment) =>
  [shipment.productType, ...(shipment.productLines || []).map((line) => line.product)]
    .some((product) => /yog(h)?urt\s+stabili[sz]er/i.test(product));

const DEFAULT_COUNTRY_RULES: Record<string, CountryRule> = {
  Botswana: {
    country: "Botswana",
    title: "Botswana SACU / BOBS Import Requirements",
    points: [
      "Botswana and South Africa are both SACU members, so exports from South Africa to Botswana are usually simpler than exports to non-SACU countries.",
      "For most normal goods, a SADC Certificate of Origin is not needed for Botswana duty preference. A normal Certificate of Origin may still be requested by the Botswana importer or clearing agent for records or product-specific controls.",
      "Main South Africa-side documents are Commercial Invoice, Packing List, road consignment note or waybill, SAD 500 export declaration, exporter customs code, and proof of export pack.",
      "The Botswana importer or clearing agent handles the Botswana customs declaration with BURS Customs and Excise, including any import licence, invoice, Certificate of Origin, consignment note, manifest, and packing list where applicable.",
      "Restricted goods may require an import permit from the relevant Botswana regulatory authority before dispatch.",
      "Botswana uses BOBS, the Botswana Bureau of Standards. Regulated products under compulsory standards may require a Product Certificate or Certificate of Conformity from a designated inspection agency.",
      "Before dispatch, ask the Botswana clearing agent whether the HS code or product falls under BOBS compulsory standards and whether a Certificate of Conformity is required before dispatch from South Africa.",
      "For food ingredients or food products, prepare COA, TDS, SDS/MSDS, food grade declaration, allergen statement, non-GMO/GMO declaration, shelf-life statement, batch traceability, and any halal, health/free sale, phyto, or vet certificate if the agent confirms they are required.",
      "Confirm whether original documents are needed or whether scanned copies are acceptable before loading.",
      "Suggested agent question: Please confirm whether this shipment requires a Botswana import permit, BOBS Certificate of Conformity or compulsory standards approval, Certificate of Origin, health/phyto/vet/free sale certificate, or any special labelling, testing, or standards requirement before dispatch.",
    ],
    requiredDocumentIds: [
      "commercial-invoice",
      "packing-list",
      "sad-500",
      "transport-document",
      "exporter-code",
      "proof-export",
      "general-coo",
      "import-permit",
      "coc-pvoc",
      "coa",
      "tds",
      "sds",
      "food-grade",
      "allergen",
      "non-gmo",
      "shelf-life",
      "batch-traceability",
      "health-free-sale",
      "phyto",
      "vet",
    ],
  },
  Egypt: {
    country: "Egypt",
    title: "Egypt NAFEZA / CargoX / ACID Requirements",
    points: [
      "Egyptian importer or authorised clearing agent must register the shipment on NAFEZA using the exporter's CargoX details and request the ACID number.",
      "Exporter must already be registered and verified on CargoX before the importer can complete the NAFEZA ACI request.",
      "Once NAFEZA approves the ACI request, the supplier/exporter receives the ACID notification by email and inside CargoX.",
      "ACID details should appear in the CargoX inbox/envelope and must be checked before sending documents.",
      "Supplier uploads the ACI document envelope via CargoX, usually including commercial invoice, packing list, bill of lading or airway bill when available, and any product-specific certificates.",
      "Important: the supplier cannot generate the ACID number unless they are the Egyptian importer or authorised NAFEZA agent.",
    ],
    requiredDocumentIds: ["cargox-registration", "acid-number", "aci-envelope", "commercial-invoice", "packing-list", "transport-document"],
  },
  Cameroon: {
    country: "Cameroon",
    title: "Cameroon SGS / Conformity Requirements",
    points: [
      "Confirm whether the shipment requires SGS pre-shipment conformity assessment before dispatch.",
      "Destination importer or clearing agent must confirm whether a Certificate of Conformity, inspection booking, product testing, or document review is required for the HS code and product type.",
      "Do not dispatch until SGS or the destination agent confirms the required route, certificate status, and whether originals are needed.",
      "Keep SGS confirmation or certificate with the export pack and align it to invoice, packing list, HS code, batch, and product description.",
    ],
    requiredDocumentIds: ["sgs-cameroon", "coc-pvoc"],
  },
  Uganda: {
    country: "Uganda",
    title: "Uganda UNBS PVoC / Import Customs Requirements",
    points: [
      "The Ugandan importer or clearing agent must clear the goods through Uganda customs and confirm whether UNBS PVoC applies before dispatch.",
      "Uganda customs normally requires an Import Declaration Form, Certificate of Origin, Bill of Lading or Air Waybill, PVoC Certificate where applicable, Commercial Invoice, and Packing List through the Electronic Single Window.",
      "Do not dispatch until the Uganda clearing agent confirms whether the HS code or product is regulated under UNBS PVoC and whether a Certificate of Conformity is required before shipment.",
      "PVoC is arranged in the country of export before the goods leave South Africa. For regulated goods, the Certificate of Conformity is used for Uganda customs clearance on arrival.",
      "Uganda is not part of SADC, so do not use a SADC COO for duty preference. Use a normal Certificate of Origin, or confirm AfCFTA eligibility with the clearing agent.",
      "Confirm whether Uganda needs an import permit, health certificate, phytosanitary certificate, veterinary certificate, free sale certificate, special labelling, testing, or standards approval before dispatch.",
      "Importer-side items such as Uganda Import Declaration, Uganda TIN/importer registration, duties, VAT, and levies are handled by the Ugandan importer or clearing agent unless the shipment is DDP.",
      "Suggested agent question: Please confirm whether this shipment requires UNBS PVoC / Certificate of Conformity, Uganda import permit, health/phyto/vet/free sale certificate, COO or AfCFTA COO, or any special labelling/testing/standards approval before export from South Africa.",
    ],
    requiredDocumentIds: [
      "commercial-invoice",
      "packing-list",
      "sad-500",
      "transport-document",
      "exporter-code",
      "proof-export",
      "general-coo",
      "afcfta-coo",
      "coc-pvoc",
      "import-permit",
      "coa",
      "tds",
      "sds",
      "food-grade",
      "allergen",
      "non-gmo",
      "shelf-life",
      "batch-traceability",
      "health-free-sale",
      "phyto",
      "vet",
    ],
  },
  Zambia: {
    country: "Zambia",
    title: "Zambia Road Export / ZRA Import Requirements",
    points: [
      "For South Africa to Zambia road exports, prepare the core export pack before loading: Commercial Invoice, Packing List, SAD 500 export customs declaration, road consignment note or transport document, and road or cargo manifest.",
      "Commercial Invoice must show buyer or consignee, seller, product description, HS code, quantity, value, currency, Incoterm, country of origin, and payment terms.",
      "Packing List must align to the invoice and show pallets, cartons or bags, gross and net weight, batch numbers, and best-before or expiry dates.",
      "Use a SADC Certificate of Origin when the importer will claim SADC preferential duty and the products qualify. In this Zambia road flow, SADC has been confirmed as required.",
      "Do not dispatch until Matvin, the buyer, or the Zambia clearing agent confirms Zambian import customs clearance, permits, duties, VAT, taxes, and any food or health clearance needed before the truck leaves PTA.",
      "Under DAP Lusaka, the buyer normally handles Zambia import charges and final clearance unless a different written agreement is in place.",
      "For food ingredients, send COA per batch, Product Specification or TDS, Food Grade Declaration, Allergen Statement, GMO or Non-GMO Declaration, Manufacturer or Ingredient Declaration, and batch or best-before details.",
      "For Calcium Propionate Granular, include SDS, COA, Food Grade Declaration, and HS confirmation. SDS is useful because it is a chemical or food additive even when not classified as dangerous goods.",
      "For ifaBake Z Full Fat Enzyme Active Soya Flour, confirm SADC origin support, soya or GMO status, Allergen Statement, and Food Grade Declaration.",
      "For ifaBake Bun & Roll 3.5% Wheat Gluten, confirm Allergen Statement, wheat or gluten declaration, and HS confirmation.",
      "Zambia importer must confirm TPIN/importer registration, ZCSA or compulsory standards inspection need, and English food label requirements including ingredients and expiry or expiration date.",
      "Recommended Matvin/clearing pack: Commercial Invoice, Packing List, stamped or issued SADC Certificate of Origin, COAs, TDS, SDS for Calcium Propionate, Allergen Statements, GMO/Non-GMO Declaration, Food Grade Declaration, batch and best-before details, transport instruction or collection note, and export customs details for SAD 500 processing.",
      "For ASO0024913 / Kafue Wholesalers & Distributors in Lusaka, do not release until Zambia clearing confirms the Calcium Propionate, ifaBake Z, and ifaBake Bun & Roll 3.5% controls above.",
    ],
    requiredDocumentIds: [
      "commercial-invoice",
      "packing-list",
      "sad-500",
      "transport-document",
      "road-manifest",
      "hs-code",
      "exporter-code",
      "proof-export",
      "sadc-coo",
      "producer-declaration",
      "local-content",
      "coa",
      "tds",
      "sds",
      "food-grade",
      "allergen",
      "non-gmo",
      "shelf-life",
      "batch-traceability",
      "import-permit",
      "health-free-sale",
      "importer-tax",
      "zambia-tpin",
      "agent-appointment",
      "hs-confirmation",
      "duties-vat",
      "zambia-final-clearance",
      "zcsa-standards",
      "zambia-labelling",
      "border-inspection",
      "original-docs",
    ],
  },
};

const DEFAULT_SHIPMENT: ExportShipment = {
  ref: "",
  customer: "",
  destinationCountry: "",
  hsCode: "",
  productType: "",
  incoterm: "FCA",
  transportMode: "Road",
  preferenceScheme: "To confirm",
  destinationAgent: "",
  etd: "",
  eta: "",
  customsBufferDays: 2,
  queuePosition: 0,
  quantity: 0,
  pallets: 0,
  status: "pending",
  lastCheckedAt: "",
  notes: "",
  documents: {},
  documentDetails: {},
  productLines: [],
  history: [],
  archived: false,
};

const normalizeShipment = (shipment: Partial<ExportShipment> = {}): ExportShipment => {
  const status = asText(shipment.status, "pending") as ExportStatus;
  const validStatus: ExportStatus = EXPORT_STATUSES.includes(status) ? status : "pending";
  const documents = shipment.documents && typeof shipment.documents === "object" && !Array.isArray(shipment.documents)
    ? shipment.documents as DocumentStatus
    : {};
  const documentDetails = shipment.documentDetails && typeof shipment.documentDetails === "object" && !Array.isArray(shipment.documentDetails)
    ? shipment.documentDetails as DocumentDetails
    : {};
  const productLines = Array.isArray(shipment.productLines)
    ? shipment.productLines.map((line) => {
      const item = line && typeof line === "object" ? line as Partial<ProductLine> : {};
      return {
        id: asText(item.id, `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        product: asText(item.product),
        hsCode: asText(item.hsCode),
        quantity: parseNumber(item.quantity),
        pallets: parseNumber(item.pallets),
        batch: asText(item.batch),
        notes: asText(item.notes),
      };
    })
    : [];

  return {
    ...DEFAULT_SHIPMENT,
    ...shipment,
    id: asOptionalText(shipment.id),
    ref: asText(shipment.ref),
    customer: asText(shipment.customer),
    destinationCountry: asText(shipment.destinationCountry),
    hsCode: asText(shipment.hsCode),
    productType: asText(shipment.productType),
    incoterm: asText(shipment.incoterm, "FCA") || "FCA",
    transportMode: asText(shipment.transportMode, "Road") || "Road",
    preferenceScheme: asText(shipment.preferenceScheme, "To confirm") || "To confirm",
    destinationAgent: asText(shipment.destinationAgent),
    etd: asText(shipment.etd),
    eta: asText(shipment.eta),
    customsBufferDays: parseNumber(shipment.customsBufferDays) || 2,
    queuePosition: parseNumber(shipment.queuePosition),
    quantity: parseNumber(shipment.quantity),
    pallets: parseNumber(shipment.pallets),
    status: validStatus,
    assignedTransporterId: asOptionalText(shipment.assignedTransporterId),
    lastCheckedAt: asText(shipment.lastCheckedAt),
    notes: asText(shipment.notes),
    documents,
    documentDetails,
    productLines,
    history: Array.isArray(shipment.history) ? shipment.history : [],
    archived: Boolean(shipment.archived),
    dispatchApprovedAt: asOptionalText(shipment.dispatchApprovedAt),
    dispatchApprovedBy: asOptionalText(shipment.dispatchApprovedBy),
  };
};

const DEFAULT_TRANSPORTERS: ExportTransporter[] = [
  { id: "export-road-crossborder", name: "Cross-border Road Carrier", route: "SADC Road", contact: "", capacity: 26, status: "available" },
  { id: "export-airfreight-agent", name: "Export Airfreight Agent", route: "Africa Air", contact: "", capacity: 8, status: "available" },
];

const parseNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const splitHsCodes = (value: string) => String(value || "")
  .split(/[;,\n]+/)
  .map((code) => code.trim())
  .filter(Boolean);

const joinHsCodes = (codes: string[]) => codes.map((code) => code.trim()).filter(Boolean).join("; ");

const normalizeDate = (value: unknown) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
};

const normalizeHeader = (value: unknown) => String(value ?? "").trim().toLowerCase();

const findValue = (headers: string[], row: unknown[], aliases: string[]) => {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index >= 0 ? row[index] : undefined;
};

const loadList = <T,>(key: string, fallback: T[]): T[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T[] : fallback;
  } catch (error) {
    console.warn(`Failed to load ${key}`, error);
    return fallback;
  }
};

const saveList = <T,>(key: string, value: T[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key}`, error);
  }
};

const loadCountryRules = (): Record<string, CountryRule> => {
  try {
    const raw = localStorage.getItem(COUNTRY_RULES_KEY);
    const customRules = raw ? JSON.parse(raw) as Record<string, CountryRule> : {};
    return { ...DEFAULT_COUNTRY_RULES, ...customRules };
  } catch (error) {
    console.warn("Failed to load Africa export country rules", error);
    return DEFAULT_COUNTRY_RULES;
  }
};

const saveCountryRules = (rules: Record<string, CountryRule>) => {
  try {
    localStorage.setItem(COUNTRY_RULES_KEY, JSON.stringify(rules));
  } catch (error) {
    console.warn("Failed to save Africa export country rules", error);
  }
};

const countryRulesToList = (rules: Record<string, CountryRule>) => Object.values(rules).map((rule) => ({
  ...rule,
  country: rule.country || "",
  points: rule.points || [],
  requiredDocumentIds: rule.requiredDocumentIds || [],
}));

const isLiveExportShipment = (shipment: ExportShipment) => !shipment.archived && shipment.status !== "cancelled";

const getFirstLiveShipmentRef = (shipments: ExportShipment[]) => shipments.find(isLiveExportShipment)?.ref || "";

const hasLiveSelectedShipment = (shipments: ExportShipment[], ref: string) =>
  shipments.some((shipment) => shipment.ref === ref && isLiveExportShipment(shipment));

const rulesListToRecord = (rules: CountryRule[]) => rules.reduce<Record<string, CountryRule>>((acc, rule) => {
  if (!rule.country) return acc;
  acc[rule.country] = {
    ...rule,
    points: rule.points || [],
    requiredDocumentIds: rule.requiredDocumentIds || [],
  };
  return acc;
}, {});

const isSyncableShipment = (shipment: ExportShipment) => Boolean(shipment.ref?.trim() && shipment.customer?.trim());

const getSyncableShipments = (shipments: ExportShipment[]) => shipments.filter(isSyncableShipment);

const appendHistory = (
  history: ShipmentHistoryEntry[] | undefined,
  action: string,
  detail: string,
): ShipmentHistoryEntry[] => [
  {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    action,
    detail,
  },
  ...(history || []),
].slice(0, 80);

const appendRuleHistory = (
  history: CountryRuleHistoryEntry[] | undefined,
  action: string,
  detail: string,
  user: string,
): CountryRuleHistoryEntry[] => [
  {
    id: `rule-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    action,
    detail,
    user,
  },
  ...(history || []),
].slice(0, 80);

const getDaysUntil = (dateValue: string) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

const formatExportDate = (dateValue: string) => {
  if (!dateValue) return "No ETD / ETA";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
};

const getShipmentDateMeta = (shipment: ExportShipment) => {
  if (shipment.status === "delivered") {
    return {
      label: "Delivered",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (shipment.status === "cancelled") {
    return {
      label: "Cancelled",
      tone: "border-gray-200 bg-gray-100 text-gray-700",
    };
  }
  const etaDaysUntil = getDaysUntil(shipment.eta);
  if (etaDaysUntil !== null) {
    if (etaDaysUntil < 0) {
      return {
        label: `ETA missed ${Math.abs(etaDaysUntil)}d`,
        tone: "border-red-200 bg-red-50 text-red-700",
      };
    }
    if (etaDaysUntil === 0) {
      return {
        label: "ETA today",
        tone: "border-orange-200 bg-orange-50 text-orange-700",
      };
    }
    if (etaDaysUntil <= 7) {
      return {
        label: `ETA ${etaDaysUntil}d out`,
        tone: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }
    return {
      label: `ETA ${etaDaysUntil}d out`,
      tone: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }
  const daysUntil = getDaysUntil(shipment.etd);
  if (daysUntil === null) {
    return {
      label: "No date",
      tone: "border-gray-200 bg-gray-50 text-gray-600",
    };
  }
  if (daysUntil < 0) {
    return {
      label: `ETD missed ${Math.abs(daysUntil)}d`,
      tone: "border-red-200 bg-red-50 text-red-700",
    };
  }
  if (daysUntil === 0) {
    return {
      label: "ETD today",
      tone: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }
  if (daysUntil <= 7) {
    return {
      label: `ETD ${daysUntil} day${daysUntil === 1 ? "" : "s"} out`,
      tone: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  return {
    label: `ETD ${daysUntil} days out`,
    tone: "border-blue-200 bg-blue-50 text-blue-700",
  };
};

const isEtaThisWeek = (dateValue: string) => {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
};

const matchesEtaFilter = (shipment: ExportShipment, filter: ExportEtaFilter) => {
  if (filter === "all") return true;
  const planningDate = shipment.etd || shipment.eta;
  if (filter === "no-date") return !planningDate;
  const daysUntil = getDaysUntil(planningDate);
  if (filter === "this-week") return isEtaThisWeek(planningDate);
  if (filter === "next-30") return daysUntil !== null && daysUntil >= 0 && daysUntil <= 30;
  if (filter === "overdue") return daysUntil !== null && daysUntil < 0 && !CLOSED_EXPORT_STATUSES.includes(shipment.status);
  return true;
};

const mergeUniqueTextList = (...values: string[]) => {
  const seen = new Set<string>();
  return values
    .flatMap((value) => String(value || "").split(/\s*[;\n]\s*/))
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("; ");
};

const createProductLine = (shipment: Pick<ExportShipment, "productType" | "hsCode" | "quantity" | "pallets" | "notes">): ProductLine | null => {
  if (!shipment.productType && !shipment.hsCode && !shipment.quantity && !shipment.pallets && !shipment.notes) return null;
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product: shipment.productType || "",
    hsCode: shipment.hsCode || "",
    quantity: shipment.quantity || 0,
    pallets: shipment.pallets || 0,
    batch: "",
    notes: shipment.notes || "",
  };
};

const mergeProductLines = (...lineGroups: (ProductLine[] | undefined)[]) => {
  const byKey = new Map<string, ProductLine>();
  lineGroups.flatMap((lines) => lines || []).forEach((line) => {
    const key = [line.product, line.hsCode, line.batch, line.notes].map((value) => String(value || "").trim().toLowerCase()).join("|");
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        quantity: (existing.quantity || 0) + (line.quantity || 0),
        pallets: Math.max(existing.pallets || 0, line.pallets || 0),
      });
      return;
    }
    byKey.set(key, { ...line, id: line.id || `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  });
  return Array.from(byKey.values());
};

const summarizeProductLines = (lines: ProductLine[]) => ({
  productType: mergeUniqueTextList(...lines.map((line) => line.product)),
  hsCode: joinHsCodes(lines.flatMap((line) => splitHsCodes(line.hsCode))),
  quantity: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
  pallets: lines.reduce((max, line) => Math.max(max, line.pallets || 0), 0),
});

const getImportShipmentNote = (headers: string[], row: unknown[]) => {
  const shipmentNote = String(findValue(headers, row, ["shipment notes", "export notes", "special instructions", "dispatch notes"]) ?? "").trim();
  return shipmentNote;
};

const mergeShipmentLines = (shipments: ExportShipment[]) => {
  const byRef = new Map<string, ExportShipment>();
  const lineCounts = new Map<string, number>();

  shipments.forEach((shipment) => {
    const refKey = shipment.ref.trim().toLowerCase();
    const existing = byRef.get(refKey);
    if (!existing) {
      byRef.set(refKey, shipment);
      lineCounts.set(refKey, 1);
      return;
    }

    lineCounts.set(refKey, (lineCounts.get(refKey) || 1) + 1);
    byRef.set(refKey, {
      ...existing,
      customer: existing.customer || shipment.customer,
      destinationCountry: existing.destinationCountry || shipment.destinationCountry,
      hsCode: joinHsCodes([...splitHsCodes(existing.hsCode), ...splitHsCodes(shipment.hsCode)]),
      productType: mergeUniqueTextList(existing.productType, shipment.productType),
      incoterm: existing.incoterm || shipment.incoterm,
      transportMode: existing.transportMode || shipment.transportMode,
      eta: existing.eta || shipment.eta,
      etd: existing.etd || shipment.etd,
      customsBufferDays: existing.customsBufferDays ?? shipment.customsBufferDays,
      quantity: (existing.quantity || 0) + (shipment.quantity || 0),
      pallets: Math.max(existing.pallets || 0, shipment.pallets || 0),
      notes: existing.notes || shipment.notes,
      productLines: mergeProductLines(existing.productLines, shipment.productLines),
    });
  });

  return Array.from(byRef.entries()).map(([refKey, shipment]) => {
    const count = lineCounts.get(refKey) || 1;
    return count > 1 ? {
      ...shipment,
      history: appendHistory(shipment.history, "Product lines merged", `${count} spreadsheet rows imported under ${shipment.ref}`),
    } : shipment;
  });
};

const parseShipmentRows = async (file: File): Promise<ExportShipment[]> => {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  const workbook = isExcel
    ? await XLSX.read(await file.arrayBuffer(), { type: "array" })
    : await XLSX.read(await file.text(), { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][];
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const parsedRows = rows.slice(1).map((row): ExportShipment | null => {
    const ref = String(findValue(headers, row, ["ref", "reference", "document no", "export ref", "shipment ref", "order no"]) ?? "").trim();
    const customer = String(findValue(headers, row, ["customer", "customer name", "client", "consignee", "buyer"]) ?? "").trim();
    if (!ref || !customer) return null;

    const shipment = {
      ...DEFAULT_SHIPMENT,
      ref,
      customer,
      destinationCountry: String(findValue(headers, row, ["destination country", "country", "destination"]) ?? "").trim(),
      hsCode: String(findValue(headers, row, ["hs code", "tariff", "tariff code"]) ?? "").trim(),
      productType: String(findValue(headers, row, ["product type", "inventory description", "description", "product"]) ?? "").trim(),
      incoterm: String(findValue(headers, row, ["incoterm", "inco term"]) ?? "FCA").trim() || "FCA",
      transportMode: String(findValue(headers, row, ["transport mode", "mode"]) ?? "Road").trim() || "Road",
      etd: normalizeDate(findValue(headers, row, ["etd", "departure date", "planned dispatch date"])),
      eta: normalizeDate(findValue(headers, row, ["eta", "delivery date", "dispatch date", "shipment date"])),
      customsBufferDays: parseNumber(findValue(headers, row, ["customs buffer days", "buffer days", "border buffer days"])) || 2,
      quantity: parseNumber(findValue(headers, row, ["qty", "quantity", "order qty", "invoice qty", "dispatch qty"])),
      pallets: parseNumber(findValue(headers, row, ["pallets", "pallet qty", "pallet quantity"])),
      notes: getImportShipmentNote(headers, row),
      status: "pending" as ExportStatus,
      documents: {},
      documentDetails: {},
      history: appendHistory([], "Imported", `Imported from ${file.name}`),
      archived: false,
    };
    const importedLeadTimeGuide = getLeadTimeGuide(shipment.destinationCountry);
    const importedMode = getLeadTimeModeForTransportMode(shipment.transportMode);
    const importedLeadTime = importedMode && importedLeadTimeGuide ? importedLeadTimeGuide[importedMode] : "";
    if (!shipment.etd && importedLeadTime) {
      shipment.etd = calculateEtdFromEta(shipment.eta, importedLeadTime, shipment.customsBufferDays || 2);
    }
    const lineNote = String(findValue(headers, row, ["line notes", "product notes", "notes", "remarks", "comment"]) ?? "").trim();
    const productLine = createProductLine({ ...shipment, notes: lineNote });
    return {
      ...shipment,
      productLines: productLine ? [productLine] : [],
    };
  }).filter((shipment): shipment is ExportShipment => Boolean(shipment && shipment.ref && shipment.customer))
    .map((shipment, index) => ({ ...shipment, ref: shipment.ref || `AFX-${Date.now()}-${index}` }));

  return mergeShipmentLines(parsedRows);
};

type ExportQueueFilter = "all" | "open" | "assigned" | "in-transit" | "delivered" | "cancelled" | "this-week" | "ready" | "missing-docs" | "risks" | "approved" | "pending-approval" | "archived";
type ExportEtaFilter = "all" | "this-week" | "next-30" | "overdue" | "no-date";

interface AfricaExportsViewProps {
  initialRef?: string;
  initialFilter?: string;
}

const SortableAfricaQueueItem: React.FC<{ id: string; children: (handle: ReactNode, isDragging: boolean) => ReactNode }> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  const handle = (
    <span
      {...attributes}
      {...listeners}
      className="inline-flex h-8 w-8 flex-shrink-0 cursor-grab items-center justify-center rounded border border-gray-200 bg-white text-gray-400 active:cursor-grabbing"
      title="Drag to reorder"
      onClick={(event) => event.stopPropagation()}
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );

  return (
    <div ref={setNodeRef} style={style}>
      {children(handle, isDragging)}
    </div>
  );
};

export const AfricaExportsView: React.FC<AfricaExportsViewProps> = ({ initialRef, initialFilter }) => {
  const { showSuccess, showError, showWarning, confirm } = useNotification();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [shipments, setShipments] = useState<ExportShipment[]>([]);
  const [transporters, setTransporters] = useState<ExportTransporter[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [activeTab, setActiveTab] = useState<ExportTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState<ExportQueueFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ExportStatus | "all">("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [transporterFilter, setTransporterFilter] = useState("all");
  const [etaFilter, setEtaFilter] = useState<ExportEtaFilter>("all");
  const [showImport, setShowImport] = useState(false);
  const [showAddTransporter, setShowAddTransporter] = useState(false);
  const [importPreview, setImportPreview] = useState<ExportShipment[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteSyncError, setRemoteSyncError] = useState("");
  const [hsCodeRows, setHsCodeRows] = useState<string[]>([""]);
  const [countryRules, setCountryRules] = useState<Record<string, CountryRule>>(() => loadCountryRules());
  const [countryRuleDraft, setCountryRuleDraft] = useState({ country: "Egypt", title: "", points: "", requiredDocumentIds: DEFAULT_COUNTRY_RULES.Egypt.requiredDocumentIds });
  const [newTransporter, setNewTransporter] = useState<Omit<ExportTransporter, "id">>({
    name: "",
    route: "",
    contact: "",
    capacity: 0,
    status: "available",
  });

  useEffect(() => {
    const loadedShipments = loadList<ExportShipment>(SHIPMENTS_KEY, []).map((item) => normalizeShipment(item));
    const loadedTransporters = loadList<ExportTransporter>(TRANSPORTERS_KEY, DEFAULT_TRANSPORTERS);
    setShipments(loadedShipments);
    setTransporters(loadedTransporters);
    setSelectedRef(getFirstLiveShipmentRef(loadedShipments));

    let cancelled = false;
    const loadRemoteData = async () => {
      try {
        const [rawRemoteShipments, remoteTransporters, remoteCountryRules] = await Promise.all([
          africaExportsAPI.getAll(),
          africaExportTransportersAPI.getAll(),
          africaExportCountryRulesAPI.getAll(),
        ]);
        if (cancelled) return;
        const remoteShipments = rawRemoteShipments.map((item) => normalizeShipment(item));

        const nextTransporters = remoteTransporters.length > 0
          ? remoteTransporters
          : loadedTransporters.length > 0
            ? await africaExportTransportersAPI.bulkUpsert(loadedTransporters)
            : await africaExportTransportersAPI.bulkUpsert(DEFAULT_TRANSPORTERS);

        const localSyncableShipments = getSyncableShipments(loadedShipments);
        const syncedLocalShipments = remoteShipments.length > 0
          ? []
          : localSyncableShipments.length > 0
            ? (await africaExportsAPI.bulkUpsert(localSyncableShipments)).map((item) => normalizeShipment(item))
            : [];
        const localDraftShipments = loadedShipments.filter((item) => !isSyncableShipment(item));
        const nextShipments = remoteShipments.length > 0
          ? [...remoteShipments, ...localDraftShipments]
          : [...syncedLocalShipments, ...localDraftShipments];

        const seededRules = remoteCountryRules.length > 0
          ? remoteCountryRules
          : await africaExportCountryRulesAPI.bulkUpsert(countryRulesToList(DEFAULT_COUNTRY_RULES));
        const seededRuleCountries = new Set(seededRules.map((rule) => rule.country));
        const missingDefaultRules = countryRulesToList(DEFAULT_COUNTRY_RULES).filter((rule) => !seededRuleCountries.has(rule.country));
        const backfilledDefaultRules = missingDefaultRules.length > 0
          ? await africaExportCountryRulesAPI.bulkUpsert(missingDefaultRules)
          : [];
        const nextCountryRules = { ...DEFAULT_COUNTRY_RULES, ...rulesListToRecord([...seededRules, ...backfilledDefaultRules]) };

        if (cancelled) return;
        setTransporters(nextTransporters);
        setShipments(nextShipments.length > 0 ? nextShipments : loadedShipments);
        setCountryRules(nextCountryRules);
        setSelectedRef((current) => {
          if (hasLiveSelectedShipment(nextShipments, current)) return current;
          return getFirstLiveShipmentRef(nextShipments);
        });
        saveList(TRANSPORTERS_KEY, nextTransporters);
        saveList(SHIPMENTS_KEY, nextShipments);
        saveCountryRules(nextCountryRules);
        setRemoteSyncError("");
      } catch (error) {
        console.warn("Africa export database sync unavailable, using local cache", error);
        if (!cancelled) setRemoteSyncError("Database sync unavailable. Using this browser's saved Africa export data.");
      } finally {
        if (!cancelled) setRemoteReady(true);
      }
    };

    void loadRemoteData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialRef) {
      setSelectedRef(initialRef);
    }
  }, [initialRef]);

  useEffect(() => {
    const allowedFilters: ExportQueueFilter[] = ["all", "risks", "approved", "pending-approval", "archived", "cancelled"];
    const allowedTabs: ExportTab[] = ["onboarding", "overview", "documents", "permits", "incoterms", "history"];
    if (initialFilter && allowedTabs.includes(initialFilter as ExportTab)) {
      setActiveTab(initialFilter as ExportTab);
      return;
    }
    if (initialFilter && allowedFilters.includes(initialFilter as ExportQueueFilter)) {
      setQueueFilter(initialFilter as ExportQueueFilter);
    }
  }, [initialFilter]);

  useEffect(() => {
    saveList(SHIPMENTS_KEY, shipments);
  }, [shipments]);

  useEffect(() => {
    saveList(TRANSPORTERS_KEY, transporters);
  }, [transporters]);

  useEffect(() => {
    saveCountryRules(countryRules);
  }, [countryRules]);

  useEffect(() => {
    if (!remoteReady) return;
    const timeout = window.setTimeout(async () => {
      try {
        const syncableShipments = getSyncableShipments(shipments);
        if (syncableShipments.length > 0) {
          const saved = (await africaExportsAPI.bulkUpsert(syncableShipments)).map((item) => normalizeShipment(item));
          setShipments((current) => {
            if (current.filter(isSyncableShipment).every((item) => item.id)) return current;
            const byRef = new Map(saved.map((item) => [item.ref, item]));
            let changed = false;
            const next = current.map((item) => {
              if (item.id || !isSyncableShipment(item)) return item;
              const savedItem = byRef.get(item.ref);
              if (!savedItem) return item;
              changed = true;
              return savedItem;
            });
            return changed ? next : current;
          });
        }
        const draftCount = shipments.length - syncableShipments.length;
        setRemoteSyncError(draftCount > 0
          ? `${draftCount} Africa export draft${draftCount === 1 ? "" : "s"} saved locally until reference and consignee are captured.`
          : "");
      } catch (error) {
        console.warn("Failed to sync Africa export shipments", error);
        setRemoteSyncError("Database sync failed. Changes are saved in this browser and will retry while this page is open.");
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [shipments, remoteReady]);

  useEffect(() => {
    if (!remoteReady) return;
    const timeout = window.setTimeout(async () => {
      try {
        if (transporters.length > 0) {
          await africaExportTransportersAPI.bulkUpsert(transporters);
        }
      } catch (error) {
        console.warn("Failed to sync Africa export transporters", error);
        setRemoteSyncError("Database sync failed. Changes are saved in this browser and will retry while this page is open.");
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [transporters, remoteReady]);

  const shipment = useMemo(
    () => shipments.find((item) => item.ref === selectedRef) || DEFAULT_SHIPMENT,
    [shipments, selectedRef],
  );

  useEffect(() => {
    const codes = splitHsCodes(shipment.hsCode);
    setHsCodeRows(codes.length > 0 ? codes : [""]);
  }, [shipment.ref, shipment.hsCode]);

  useEffect(() => {
    if (!shipment.destinationCountry) return;
    const rule = countryRules[shipment.destinationCountry];
    setCountryRuleDraft({
      country: shipment.destinationCountry,
      title: rule?.title || "",
      points: rule?.points.join("\n") || "",
      requiredDocumentIds: rule?.requiredDocumentIds || [],
    });
  }, [countryRules, shipment.destinationCountry]);

  const trackedShipments = useMemo(
    () => [...shipments].sort((a, b) => {
      const aPosition = a.queuePosition || Number.MAX_SAFE_INTEGER;
      const bPosition = b.queuePosition || Number.MAX_SAFE_INTEGER;
      if (aPosition !== bPosition) return aPosition - bPosition;
      return (a.etd || a.eta || "9999").localeCompare(b.etd || b.eta || "9999");
    }),
    [shipments],
  );
  const activeShipments = useMemo(() => trackedShipments.filter((item) => !item.archived && item.status !== "cancelled"), [trackedShipments]);
  const archivedShipments = useMemo(() => trackedShipments.filter((item) => item.archived), [trackedShipments]);
  const cancelledShipments = useMemo(() => trackedShipments.filter((item) => item.status === "cancelled"), [trackedShipments]);

  const allChecklistItems = useMemo(
    () => CHECKLIST_GROUPS.flatMap((group) => group.items),
    [],
  );
  const baseRequiredIds = useMemo(() => new Set(allChecklistItems.filter((item) => item.required).map((item) => item.id)), [allChecklistItems]);

  const getRequiredItemsForShipment = useCallback((item: ExportShipment) => {
    const countryRequiredIds = countryRules[item.destinationCountry]?.requiredDocumentIds;
    const ids = new Set(countryRequiredIds || baseRequiredIds);
    const customerRule = getCustomerRule(item.customer);
    customerRule?.requiredDocumentIds.forEach((id) => ids.add(id));
    if (customerRule && isYogurtStabiliserShipment(item)) ids.add("ema-si-268-2018");
    return allChecklistItems.filter((doc) => ids.has(doc.id));
  }, [allChecklistItems, baseRequiredIds, countryRules]);

  const getMissingRequiredDocs = useCallback(
    (item: ExportShipment) => getRequiredItemsForShipment(item).filter((doc) => !item.documents?.[doc.id]),
    [getRequiredItemsForShipment],
  );

  const getReadiness = (item: ExportShipment) => {
    if (item.archived) return { label: "Archived", detail: "Hidden from live export work", tone: "border-gray-200 bg-gray-100 text-gray-700" };
    if (item.status === "cancelled") return { label: "Cancelled", detail: "Removed from live export queue", tone: "border-gray-200 bg-gray-100 text-gray-700" };
    if (item.status === "delivered") return { label: "Delivered", detail: "Shipment has been completed", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    if (item.status === "in-transit") return { label: "In Transit", detail: "Shipment has departed and is in transit", tone: "border-blue-200 bg-blue-50 text-blue-700" };
    if (item.dispatchApprovedAt) return { label: "Approved", detail: `Dispatch approved ${item.dispatchApprovedAt}`, tone: "border-emerald-300 bg-emerald-100 text-emerald-800" };
    if (!item.ref || !item.customer) return { label: "Draft", detail: "Reference and client are still needed", tone: "border-gray-200 bg-gray-50 text-gray-600" };

    const missingRequired = getMissingRequiredDocs(item);
    if (missingRequired.length > 0) {
      return {
        label: "At Risk",
        detail: `${missingRequired.length} required document${missingRequired.length === 1 ? "" : "s"} missing`,
        tone: "border-red-200 bg-red-50 text-red-700",
      };
    }

    if (!item.lastCheckedAt) {
      return { label: "Needs Agent Check", detail: "Destination agent check not marked", tone: "border-amber-200 bg-amber-50 text-amber-700" };
    }

    if (!item.assignedTransporterId) {
      return { label: "Needs Transporter", detail: "Documents are clear, assign export transporter", tone: "border-amber-200 bg-amber-50 text-amber-700" };
    }

    return { label: "Ready", detail: "Required pack, agent check, and transporter are in place", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  };

  const riskyShipments = useMemo(() => {
    return activeShipments.filter((item) => {
      if (CLOSED_EXPORT_STATUSES.includes(item.status)) return false;
      return getMissingRequiredDocs(item).length > 0;
    });
  }, [activeShipments, getMissingRequiredDocs]);
  const missingDocsShipments = useMemo(() => {
    return activeShipments.filter((item) => !CLOSED_EXPORT_STATUSES.includes(item.status) && getMissingRequiredDocs(item).length > 0);
  }, [activeShipments, getMissingRequiredDocs]);
  const readyShipments = useMemo(() => {
    return activeShipments.filter((item) =>
      PRE_DISPATCH_EXPORT_STATUSES.includes(item.status) &&
      getMissingRequiredDocs(item).length === 0 &&
      Boolean(item.lastCheckedAt) &&
      Boolean(item.assignedTransporterId),
    );
  }, [activeShipments, getMissingRequiredDocs]);
  const approvedShipments = useMemo(() => activeShipments.filter((item) => Boolean(item.dispatchApprovedAt)), [activeShipments]);
  const pendingApprovalShipments = useMemo(() => activeShipments.filter((item) => !CLOSED_EXPORT_STATUSES.includes(item.status) && !item.dispatchApprovedAt), [activeShipments]);
  const exportCountries = useMemo(() => Array.from(new Set(trackedShipments.map((item) => item.destinationCountry).filter(Boolean))).sort(), [trackedShipments]);

  const tabCounts = useMemo(() => ({
    all: activeShipments.length,
    open: activeShipments.filter((item) => item.status === "pending").length,
    assigned: activeShipments.filter((item) => item.status === "assigned").length,
    inTransit: activeShipments.filter((item) => item.status === "in-transit").length,
    delivered: activeShipments.filter((item) => item.status === "delivered").length,
    cancelled: cancelledShipments.length,
    thisWeek: activeShipments.filter((item) => isEtaThisWeek(item.etd || item.eta)).length,
    ready: readyShipments.length,
    missingDocs: missingDocsShipments.length,
  }), [activeShipments, cancelledShipments.length, missingDocsShipments.length, readyShipments.length]);

  const filteredShipments = useMemo(() => {
    const baseShipments =
      queueFilter === "open" ? activeShipments.filter((item) => item.status === "pending") :
      queueFilter === "assigned" ? activeShipments.filter((item) => item.status === "assigned") :
      queueFilter === "in-transit" ? activeShipments.filter((item) => item.status === "in-transit") :
      queueFilter === "delivered" ? activeShipments.filter((item) => item.status === "delivered") :
      queueFilter === "cancelled" ? cancelledShipments :
      queueFilter === "this-week" ? activeShipments.filter((item) => isEtaThisWeek(item.etd || item.eta)) :
      queueFilter === "ready" ? readyShipments :
      queueFilter === "missing-docs" ? missingDocsShipments :
      queueFilter === "risks" ? riskyShipments :
      queueFilter === "approved" ? approvedShipments :
      queueFilter === "pending-approval" ? pendingApprovalShipments :
      queueFilter === "archived" ? archivedShipments :
      activeShipments;
    const query = searchQuery.toLowerCase();
    return baseShipments.filter((item) =>
      (statusFilter === "all" || item.status === statusFilter) &&
      (countryFilter === "all" || item.destinationCountry === countryFilter) &&
      (transporterFilter === "all" || item.assignedTransporterId === transporterFilter) &&
      matchesEtaFilter(item, etaFilter) &&
      (!query.trim() || [item.ref, item.customer, item.destinationCountry, item.hsCode, item.productType, item.status]
        .join(" ")
        .toLowerCase()
        .includes(query)),
    );
  }, [activeShipments, approvedShipments, archivedShipments, cancelledShipments, countryFilter, etaFilter, missingDocsShipments, pendingApprovalShipments, queueFilter, readyShipments, riskyShipments, searchQuery, statusFilter, transporterFilter]);

  const handleQueueDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const visibleRefs = filteredShipments.map((item) => item.ref);
    const oldIndex = visibleRefs.indexOf(String(active.id));
    const newIndex = visibleRefs.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedRefs = [...visibleRefs];
    const [movedRef] = reorderedRefs.splice(oldIndex, 1);
    reorderedRefs.splice(newIndex, 0, movedRef);
    const positionByRef = new Map(reorderedRefs.map((ref, index) => [ref, (index + 1) * 1000]));

    setShipments((current) => current.map((item) => (
      positionByRef.has(item.ref)
        ? {
          ...item,
          queuePosition: positionByRef.get(item.ref),
          history: item.ref === movedRef ? appendHistory(item.history, "Queue reordered", `Moved to position ${newIndex + 1}`) : item.history,
        }
        : item
    )));
    showSuccess(`${movedRef} moved to queue position ${newIndex + 1}.`);
  };

  const requiredItems = getRequiredItemsForShipment(shipment);
  const requiredDone = requiredItems.filter((item) => shipment.documents?.[item.id]).length;
  const requiredCompletionPercent = requiredItems.length ? Math.round((requiredDone / requiredItems.length) * 100) : 0;
  const complianceAlerts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return activeShipments.flatMap((item) => {
      if (CLOSED_EXPORT_STATUSES.includes(item.status)) return [];

      const missingRequired = getMissingRequiredDocs(item);
      const alerts: {
        ref: string;
        title: string;
        detail: string;
        tone: string;
        tab: ExportTab;
        priority: number;
      }[] = [];

      if (!item.lastCheckedAt) {
        alerts.push({
          ref: item.ref,
          title: "Destination agent check not done",
          detail: `${item.customer} - ${item.destinationCountry || "country to confirm"}`,
          tone: "border-amber-200 bg-amber-50 text-amber-800",
          tab: "permits",
          priority: 1,
        });
      }

      if (missingRequired.length > 0) {
        alerts.push({
          ref: item.ref,
          title: `${missingRequired.length} required document${missingRequired.length === 1 ? "" : "s"} outstanding`,
          detail: missingRequired.slice(0, 3).map((doc) => doc.label).join(", "),
          tone: "border-red-200 bg-red-50 text-red-800",
          tab: "documents",
          priority: 0,
        });
      }

      const planningDate = item.etd || item.eta;
      if (planningDate) {
        const dispatchDate = new Date(planningDate);
        dispatchDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((dispatchDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        if (daysUntil >= 0 && daysUntil <= 7 && (missingRequired.length > 0 || !item.lastCheckedAt)) {
          alerts.push({
            ref: item.ref,
            title: daysUntil === 0 ? "ETD is today" : `ETD in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
            detail: `${item.ref} still has export checks outstanding`,
            tone: "border-orange-200 bg-orange-50 text-orange-800",
            tab: missingRequired.length > 0 ? "documents" : "permits",
            priority: 2,
          });
        }
      }

      Object.entries(item.documentDetails || {}).forEach(([documentId, detail]) => {
        const daysUntil = getDaysUntil(detail.expiry);
        if (daysUntil === null || daysUntil > 30) return;
        const document = allChecklistItems.find((doc) => doc.id === documentId);
        alerts.push({
          ref: item.ref,
          title: daysUntil < 0 ? "Document expired" : daysUntil === 0 ? "Document expires today" : `Document expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
          detail: document?.label || documentId,
          tone: daysUntil < 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800",
          tab: "documents",
          priority: daysUntil < 0 ? -1 : 1,
        });
      });

      return alerts;
    }).sort((a, b) => a.priority - b.priority).slice(0, 8);
  }, [activeShipments, allChecklistItems, getMissingRequiredDocs]);
  const assignedTransporter = transporters.find((item) => item.id === shipment.assignedTransporterId);
  const countryOptions = useMemo(() => {
    const countries = Array.from(new Set([...AFRICA_COUNTRIES, ...Object.keys(countryRules)]));
    if (!shipment.destinationCountry || countries.includes(shipment.destinationCountry)) return countries;
    return [shipment.destinationCountry, ...countries];
  }, [countryRules, shipment.destinationCountry]);
  const destinationRequirement = countryRules[shipment.destinationCountry];
  const customerRequirement = getCustomerRule(shipment.customer);
  const leadTimeGuide = getLeadTimeGuide(shipment.destinationCountry);
  const selectedLeadTimeMode = getLeadTimeModeForTransportMode(shipment.transportMode);
  const customsBufferDays = shipment.customsBufferDays ?? 2;
  const selectedLeadTime = selectedLeadTimeMode && leadTimeGuide ? leadTimeGuide[selectedLeadTimeMode] : "";
  const calculatedEtd = selectedLeadTime ? calculateEtdFromEta(shipment.eta, selectedLeadTime, customsBufferDays) : "";
  const effectiveEtd = shipment.etd || calculatedEtd;
  const etaDaysUntil = getDaysUntil(shipment.eta);
  const etdDaysUntil = getDaysUntil(effectiveEtd);
  const showEtaRiskWarning = !CLOSED_EXPORT_STATUSES.includes(shipment.status) && etaDaysUntil !== null && etaDaysUntil < 0;
  const etdMissedDays = showEtaRiskWarning && etdDaysUntil !== null && etdDaysUntil < 0 ? Math.abs(etdDaysUntil) : 0;
  const etaFromToday = selectedLeadTime ? calculateEtaFromEtd(todayDateInput(), selectedLeadTime, customsBufferDays) : "";
  const readiness = getReadiness(shipment);
  const missingRequiredDocs = getMissingRequiredDocs(shipment);
  const isDispatchApproved = Boolean(shipment.dispatchApprovedAt);
  const canApproveDispatch = Boolean(
    shipment.ref &&
    !shipment.archived &&
    PRE_DISPATCH_EXPORT_STATUSES.includes(shipment.status) &&
    missingRequiredDocs.length === 0 &&
    shipment.lastCheckedAt &&
    shipment.assignedTransporterId,
  );

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return CHECKLIST_GROUPS;
    const query = searchQuery.toLowerCase();
    return CHECKLIST_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.label, item.purpose, item.conditional || "", group.title].join(" ").toLowerCase().includes(query),
      ),
    })).filter((group) => group.items.length > 0);
  }, [searchQuery]);

  const statusTone = requiredCompletionPercent >= 85
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : requiredCompletionPercent >= 45
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";

  const resetQueueControls = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCountryFilter("all");
    setTransporterFilter("all");
    setEtaFilter("all");
  };

  const queueEmptyTitle =
    queueFilter === "open" ? "No open exports" :
    queueFilter === "assigned" ? "No assigned exports" :
    queueFilter === "in-transit" ? "No exports in transit" :
    queueFilter === "delivered" ? "No delivered exports" :
    queueFilter === "cancelled" ? "No cancelled exports" :
    queueFilter === "this-week" ? "No exports this week" :
    queueFilter === "ready" ? "No shipments are ready to dispatch" :
    queueFilter === "missing-docs" ? "No shipments are missing required documents" :
    queueFilter === "risks" ? "No export risks found" :
    queueFilter === "approved" ? "No approved exports" :
    queueFilter === "pending-approval" ? "No exports pending approval" :
    queueFilter === "archived" ? "No archived exports" :
    "No Africa exports yet";

  const queueEmptyDetail =
    queueFilter === "open" ? "Pending Africa export shipments will appear here." :
    queueFilter === "assigned" ? "Assigned Africa export shipments will appear here." :
    queueFilter === "in-transit" ? "In-transit Africa export shipments will appear here." :
    queueFilter === "delivered" ? "Delivered Africa export shipments will appear here." :
    queueFilter === "cancelled" ? "Cancelled Africa export shipments will appear here." :
    queueFilter === "this-week" ? "Shipments with an ETD or ETA in the current week will appear here." :
    queueFilter === "ready" ? "Shipments with required docs, transporter, and agent check will appear here." :
    queueFilter === "missing-docs" ? "Shipments with outstanding required documents will appear here." :
    queueFilter === "risks" ? "Required documents and agent checks are clear for this filter." :
    queueFilter === "approved" ? "Approved dispatches will appear here." :
    queueFilter === "pending-approval" ? "Shipments still needing approval will appear here." :
    queueFilter === "archived" ? "Archived shipments will appear here." :
    "Import or create an export shipment to start.";

  const updateShipment = (updates: Partial<ExportShipment>, historyEntry?: { action: string; detail: string }) => {
    const ref = updates.ref || shipment.ref || selectedRef || `AFX-${Date.now()}`;
    const nextShipment = {
      ...shipment,
      documentDetails: shipment.documentDetails || {},
      history: shipment.history || [],
      ...updates,
      ref,
    };
    if (historyEntry) {
      nextShipment.history = appendHistory(nextShipment.history, historyEntry.action, historyEntry.detail);
    }
    setSelectedRef(ref);
    setShipments((prev) => {
      const exists = prev.some((item) => item.ref === shipment.ref || item.ref === selectedRef || item.ref === ref);
      if (!exists) return [nextShipment, ...prev];
      return prev.map((item) => (item.ref === shipment.ref || item.ref === selectedRef ? nextShipment : item));
    });
  };

  const updateHsCode = (index: number, value: string) => {
    const nextCodes = [...hsCodeRows];
    nextCodes[index] = value;
    setHsCodeRows(nextCodes);
    updateShipment({ hsCode: joinHsCodes(nextCodes) });
  };
  const addHsCode = () => {
    setHsCodeRows((current) => [...current, ""]);
  };
  const removeHsCode = (index: number) => {
    const nextCodes = hsCodeRows.filter((_, itemIndex) => itemIndex !== index);
    const normalizedCodes = nextCodes.length > 0 ? nextCodes : [""];
    setHsCodeRows(normalizedCodes);
    updateShipment({ hsCode: joinHsCodes(normalizedCodes) });
  };

  const openTariffLookup = () => {
    window.open("https://www.freightnews.co.za/customs", "_blank", "noopener,noreferrer");
  };

  const createBlankShipment = () => {
    const ref = `AFX-${Date.now()}`;
    const nextShipment = {
      ...DEFAULT_SHIPMENT,
      ref,
      history: appendHistory([], "Created", "Blank Africa export shipment created"),
    };
    setShipments((prev) => [nextShipment, ...prev]);
    setSelectedRef(ref);
    setActiveTab("overview");
  };

  const toggleDocument = (id: string) => {
    if (!shipment.ref) return;
    const item = CHECKLIST_GROUPS.flatMap((group) => group.items).find((doc) => doc.id === id);
    const nextChecked = !shipment.documents?.[id];
    updateShipment({
      documents: {
        ...shipment.documents,
        [id]: nextChecked,
      },
    }, {
      action: nextChecked ? "Document marked complete" : "Document reopened",
      detail: item?.label || id,
    });
  };

  const markRequiredDocuments = (checked: boolean) => {
    if (!shipment.ref) {
      showWarning("Create or select an Africa export shipment first.");
      return;
    }

    if (requiredItems.length === 0) {
      showWarning("No required documents are defined for this shipment.");
      return;
    }

    const documents = {
      ...shipment.documents,
      ...Object.fromEntries(requiredItems.map((item) => [item.id, checked])),
    };
    updateShipment({ documents }, {
      action: checked ? "Required documents completed" : "Required documents reopened",
      detail: `${requiredItems.length} required document${requiredItems.length === 1 ? "" : "s"} ${checked ? "marked complete" : "reopened"}`,
    });
    showSuccess(`${requiredItems.length} required document${requiredItems.length === 1 ? "" : "s"} ${checked ? "marked complete" : "reopened"}.`);
  };

  const updateDocumentDetail = (id: string, field: "reference" | "expiry" | "notes", value: string) => {
    const item = CHECKLIST_GROUPS.flatMap((group) => group.items).find((doc) => doc.id === id);
    updateShipment({
      documentDetails: {
        ...(shipment.documentDetails || {}),
        [id]: {
          reference: shipment.documentDetails?.[id]?.reference || "",
          expiry: shipment.documentDetails?.[id]?.expiry || "",
          notes: shipment.documentDetails?.[id]?.notes || "",
          [field]: value,
        },
      },
    }, {
      action: "Document detail updated",
      detail: `${item?.label || id}: ${field} updated`,
    });
  };

  const addProductLine = () => {
    const nextLines = [
      ...(shipment.productLines || []),
      { id: `line-${Date.now()}`, product: "", hsCode: "", quantity: 0, pallets: 0, batch: "", notes: "" },
    ];
    updateShipment({ productLines: nextLines }, { action: "Product line added", detail: "Blank export product line added" });
  };

  const updateProductLine = (id: string, field: keyof ProductLine, value: string) => {
    const nextLines = (shipment.productLines || []).map((line) => line.id === id ? {
      ...line,
      [field]: field === "quantity" || field === "pallets" ? parseNumber(value) : value,
    } : line);
    updateShipment({
      productLines: nextLines,
      ...summarizeProductLines(nextLines),
    }, { action: "Product line updated", detail: `${field} updated` });
  };

  const removeProductLine = (id: string) => {
    const nextLines = (shipment.productLines || []).filter((line) => line.id !== id);
    updateShipment({
      productLines: nextLines,
      ...summarizeProductLines(nextLines),
    }, { action: "Product line removed", detail: "Export product line removed" });
  };

  const markPreDispatchConfirmed = () => {
    updateShipment(
      { lastCheckedAt: new Date().toISOString().slice(0, 10) },
      { action: "Agent check marked", detail: "Destination agent pre-dispatch question confirmed" },
    );
  };

  const updateEtaTarget = (eta: string) => {
    const nextEtd = selectedLeadTime ? calculateEtdFromEta(eta, selectedLeadTime, customsBufferDays) : shipment.etd;
    updateShipment({ eta, etd: nextEtd });
  };

  const updateCustomsBuffer = (value: string) => {
    const nextBuffer = parseNumber(value);
    const nextEtd = selectedLeadTime ? calculateEtdFromEta(shipment.eta, selectedLeadTime, nextBuffer) : shipment.etd;
    updateShipment(
      { customsBufferDays: nextBuffer, etd: nextEtd },
      { action: "Lead time buffer updated", detail: `${nextBuffer} working day${nextBuffer === 1 ? "" : "s"} buffer applied` },
    );
  };

  const updateShipmentStatus = (status: ExportStatus) => {
    const wasCancelled = shipment.status === "cancelled";
    updateShipment(
      { status },
      { action: "Status changed", detail: `Shipment status set to ${status}` },
    );

    if (status === "cancelled") {
      const nextLive = activeShipments.find((item) => item.ref !== shipment.ref);
      setQueueFilter("all");
      setSelectedRef(nextLive?.ref || "");
      showSuccess(`${shipment.ref} cancelled and moved out of the live queue.`);
      return;
    }

    if (wasCancelled) {
      setQueueFilter("all");
      setSelectedRef(shipment.ref);
      showSuccess(`${shipment.ref} returned to the live queue.`);
    }
  };

  const applyCalculatedEtd = () => {
    if (!calculatedEtd) {
      showWarning("Select destination, service, and ETA before calculating ETD.");
      return;
    }
    updateShipment(
      { etd: calculatedEtd },
      { action: "ETD calculated", detail: `ETD set to ${calculatedEtd} from ETA ${shipment.eta}, ${selectedLeadTime || "selected service"}, and ${customsBufferDays} buffer day${customsBufferDays === 1 ? "" : "s"}` },
    );
    showSuccess(`ETD set to ${calculatedEtd}.`);
  };

  const setEtdToday = () => {
    const today = todayDateInput();
    updateShipment(
      { etd: today },
      { action: "ETD replanned", detail: `ETD moved to today (${today}) after missed calculated dispatch date` },
    );
    showSuccess(`ETD moved to ${today}.`);
  };

  const replanEtaFromToday = () => {
    const today = todayDateInput();
    const nextEta = selectedLeadTime ? calculateEtaFromEtd(today, selectedLeadTime, customsBufferDays) : "";
    if (!nextEta) {
      showWarning("Select destination, service, and buffer before replanning ETA.");
      return;
    }
    updateShipment(
      { etd: today, eta: nextEta },
      { action: "ETA replanned", detail: `ETD ${today}, ETA ${nextEta} based on ${selectedLeadTime} and ${customsBufferDays} buffer day${customsBufferDays === 1 ? "" : "s"}` },
    );
    showSuccess(`ETA replanned to ${nextEta}.`);
  };

  const saveShipmentSetup = async () => {
    if (!shipment.ref.trim() || !shipment.customer.trim()) {
      showWarning("Reference and Africa client / consignee are required before saving setup.");
      return;
    }

    const nextShipment = {
      ...shipment,
      history: appendHistory(shipment.history, "Shipment setup saved", "Shipment setup details confirmed"),
    };

    setShipments((prev) => prev.map((item) => (item.ref === shipment.ref ? nextShipment : item)));
    try {
      const [saved] = await africaExportsAPI.bulkUpsert([nextShipment]);
      if (saved) {
        const normalizedSaved = normalizeShipment(saved);
        setShipments((prev) => prev.map((item) => (item.ref === shipment.ref ? normalizedSaved : item)));
      }
      setRemoteSyncError("");
      showSuccess(`${shipment.ref} setup saved.`);
    } catch (error) {
      console.warn("Failed to sync Africa export shipment setup", error);
      setRemoteSyncError("Database sync failed. Shipment setup is saved in this browser and will retry while this page is open.");
      showWarning(`${shipment.ref} setup saved in this browser. Database sync will retry.`);
    }
  };

  const assignShipment = async (transporter: ExportTransporter) => {
    if (!shipment.ref) {
      showWarning("Create or import an Africa export shipment first.");
      return;
    }

    if (transporter.capacity && shipment.pallets > transporter.capacity) {
      const proceed = await confirm({
        title: "Capacity Warning",
        message: `${transporter.name} capacity is ${transporter.capacity} pallets and this shipment has ${shipment.pallets}. Assign anyway?`,
        type: "warning",
        confirmText: "Assign Anyway",
      });
      if (!proceed) return;
    }

    updateShipment(
      { assignedTransporterId: transporter.id, status: "assigned" },
      { action: "Transporter assigned", detail: transporter.name },
    );
    showSuccess(`${shipment.ref} assigned to ${transporter.name}`);
  };

  const clearAssignment = () => {
    updateShipment(
      { assignedTransporterId: undefined, status: "pending" },
      { action: "Transporter cleared", detail: assignedTransporter?.name || "Shipment moved back to unassigned" },
    );
    showSuccess(`${shipment.ref} moved back to unassigned`);
  };

  const archiveShipment = async () => {
    if (!shipment.ref) return;
    const proceed = await confirm({
      title: "Archive Export Shipment",
      message: `Archive ${shipment.ref}? It will move out of the live Africa export queue but can be restored.`,
      type: "warning",
      confirmText: "Archive",
    });
    if (!proceed) return;
    updateShipment({ archived: true }, { action: "Archived", detail: "Moved out of live Africa export queue" });
    const nextLive = activeShipments.find((item) => item.ref !== shipment.ref);
    setSelectedRef(nextLive?.ref || shipment.ref);
    showSuccess(`${shipment.ref} archived.`);
  };

  const restoreShipment = () => {
    if (!shipment.ref) return;
    updateShipment({ archived: false }, { action: "Restored", detail: "Returned to live Africa export queue" });
    setQueueFilter("all");
    showSuccess(`${shipment.ref} restored to the live queue.`);
  };

  const deleteShipment = async () => {
    if (!shipment.ref) return;
    const proceed = await confirm({
      title: "Delete Export Shipment",
      message: `Permanently delete ${shipment.ref}? This cannot be restored.`,
      type: "danger",
      confirmText: "Delete",
    });
    if (!proceed) return;

    try {
      if (shipment.id) await africaExportsAPI.delete(shipment.id);
      setShipments((prev) => prev.filter((item) => item.ref !== shipment.ref));
      const nextShipment = filteredShipments.find((item) => item.ref !== shipment.ref) || activeShipments.find((item) => item.ref !== shipment.ref);
      setSelectedRef(nextShipment?.ref || "");
      showSuccess(`${shipment.ref} deleted.`);
    } catch (error) {
      console.error("Failed to delete Africa export shipment", error);
      showError("Could not delete the Africa export shipment.");
    }
  };

  const approveDispatch = () => {
    if (!shipment.ref) return;
    if (!canApproveDispatch) {
      showWarning("Complete required documents, agent check, and transporter assignment before approving dispatch.");
      return;
    }

    const approvedAt = new Date().toISOString().slice(0, 10);
    const approvedBy = user?.username || user?.email || "Unknown user";
    updateShipment(
      { dispatchApprovedAt: approvedAt, dispatchApprovedBy: approvedBy },
      { action: "Dispatch approved", detail: `Shipment passed Africa export dispatch gate by ${approvedBy}` },
    );
    showSuccess(`${shipment.ref} approved for dispatch.`);
  };

  const clearDispatchApproval = () => {
    if (!shipment.ref) return;
    updateShipment(
      { dispatchApprovedAt: undefined, dispatchApprovedBy: undefined },
      { action: "Dispatch approval cleared", detail: "Shipment requires approval again before dispatch" },
    );
    showSuccess(`${shipment.ref} dispatch approval cleared.`);
  };

  const downloadExportPack = async () => {
    if (!shipment.ref) {
      showWarning("Select an Africa export shipment first.");
      return;
    }

    const rows = allChecklistItems.map((item) => {
      const detail = shipment.documentDetails?.[item.id] || { reference: "", expiry: "", notes: "" };
      const required = requiredItems.some((doc) => doc.id === item.id);
      return {
        Document: item.label,
        Required: required ? "Yes" : "No",
        Complete: shipment.documents?.[item.id] ? "Yes" : "No",
        Reference: detail.reference,
        Expiry: detail.expiry,
        Notes: detail.notes,
        Purpose: item.purpose,
      };
    });
    const summary = [
      ["Reference", shipment.ref],
      ["Africa Client", shipment.customer],
      ["Destination Country", shipment.destinationCountry],
      ["HS Code", shipment.hsCode],
      ["Product Type", shipment.productType],
      ["Incoterm", shipment.incoterm],
      ["Transport Mode", shipment.transportMode],
      ["ETD", shipment.etd || calculatedEtd || ""],
      ["ETA", shipment.eta],
      ["Customs / Docs Buffer Days", customsBufferDays],
      ["Quantity", shipment.quantity],
      ["Pallets", shipment.pallets],
      ["Readiness", readiness.label],
      ["Dispatch Approved", shipment.dispatchApprovedAt || "No"],
      ["Agent Check", shipment.lastCheckedAt || "Not done"],
      ["Destination Agent", shipment.destinationAgent],
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Shipment Summary");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((shipment.productLines || []).map((line) => ({
      Product: line.product,
      "HS Code": line.hsCode,
      Qty: line.quantity,
      Pallets: line.pallets,
      Batch: line.batch,
      Notes: line.notes,
    }))), "Product Lines");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Document Pack");
    await XLSX.writeFile(workbook, `${shipment.ref}_africa_export_pack.xlsx`);
    showSuccess("Africa export pack downloaded.");
  };

  const downloadReadyDispatchExport = async () => {
    if (readyShipments.length === 0) {
      showWarning("No Africa export shipments are ready to dispatch.");
      return;
    }
    const rows = readyShipments.map((item) => {
      const required = getRequiredItemsForShipment(item);
      const completed = required.filter((doc) => item.documents?.[doc.id]).length;
      const transporter = transporters.find((carrier) => carrier.id === item.assignedTransporterId);
      return {
        Reference: item.ref,
        Customer: item.customer,
        Country: item.destinationCountry,
        "HS Codes": item.hsCode,
        Products: item.productType,
        Qty: item.quantity,
        Pallets: item.pallets,
        Transporter: transporter?.name || "Unassigned",
        "Agent Check": item.lastCheckedAt,
        "Required Docs": `${completed}/${required.length}`,
        "Dispatch Approved": item.dispatchApprovedAt || "No",
        ETD: item.etd,
        ETA: item.eta,
        "Customs / Docs Buffer Days": item.customsBufferDays ?? 2,
      };
    });
    const lineRows = readyShipments.flatMap((item) => (item.productLines || []).map((line) => ({
      Reference: item.ref,
      Product: line.product,
      "HS Code": line.hsCode,
      Qty: line.quantity,
      Pallets: line.pallets,
      Batch: line.batch,
      Notes: line.notes,
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Ready Shipments");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lineRows), "Product Lines");
    await XLSX.writeFile(workbook, "africa_ready_to_dispatch.xlsx");
  };

  const saveCountryRule = async () => {
    const country = countryRuleDraft.country.trim();
    const title = countryRuleDraft.title.trim() || `${country} Export Requirements`;
    const points = countryRuleDraft.points
      .split("\n")
      .map((point) => point.trim())
      .filter(Boolean);

    if (!country) {
      showWarning("Choose an Africa country for the rule.");
      return;
    }
    if (points.length === 0) {
      showWarning("Add at least one destination requirement line.");
      return;
    }

    const existingRule = countryRules[country];
    const changedDocs = countryRuleDraft.requiredDocumentIds.length;
    const changedBy = user?.username || user?.email || "Unknown user";
    const nextRule = {
      ...existingRule,
      country,
      title,
      points,
      requiredDocumentIds: countryRuleDraft.requiredDocumentIds,
      updatedBy: changedBy,
      history: appendRuleHistory(
        existingRule?.history,
        existingRule ? "Country rule updated" : "Country rule created",
        `${points.length} guidance line${points.length === 1 ? "" : "s"} and ${changedDocs} required document${changedDocs === 1 ? "" : "s"} saved`,
        changedBy,
      ),
    };
    setCountryRules((prev) => ({
      ...prev,
      [country]: nextRule,
    }));

    try {
      const saved = await africaExportCountryRulesAPI.upsert(nextRule);
      setCountryRules((prev) => ({ ...prev, [saved.country]: saved }));
      showSuccess(`${country} destination rules saved.`);
    } catch (error) {
      console.error("Failed to save Africa export country rule", error);
      showWarning(`${country} rule saved in this browser. Database sync will retry when available.`);
    }
  };

  const addTransporter = () => {
    if (!newTransporter.name.trim()) {
      showWarning("Transporter name is required.");
      return;
    }

    const transporter: ExportTransporter = {
      ...newTransporter,
      id: `export-transporter-${Date.now()}`,
      capacity: Number(newTransporter.capacity) || 0,
    };
    setTransporters((prev) => [transporter, ...prev]);
    setNewTransporter({ name: "", route: "", contact: "", capacity: 0, status: "available" });
    setShowAddTransporter(false);
    showSuccess("Africa export transporter added.");
  };

  const handleFileSelect = async (file?: File) => {
    if (!file) return;
    setIsImporting(true);
    try {
      const parsed = await parseShipmentRows(file);
      if (parsed.length === 0) {
        showError("No valid Africa export rows found. Check the reference and customer columns.");
        return;
      }
      setImportPreview(parsed);
      showSuccess(`Parsed ${parsed.length} Africa export shipment${parsed.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Failed to import Africa export shipments", error);
      showError("Could not read the import file.");
    } finally {
      setIsImporting(false);
    }
  };

  const commitImport = () => {
    if (importPreview.length === 0) return;
    let addedCount = 0;
    let mergedCount = 0;
    const byRef = new Map(shipments.map((item) => [item.ref.trim().toLowerCase(), item]));
    importPreview.forEach((item) => {
      const refKey = item.ref.trim().toLowerCase();
      const existing = byRef.get(refKey);
      if (existing) {
        const merged = mergeShipmentLines([existing, item])[0];
        byRef.set(refKey, {
          ...merged,
          id: existing.id,
          ref: existing.ref,
          documents: existing.documents,
          documentDetails: existing.documentDetails,
          history: appendHistory(merged.history, "Import merged", "Additional product/HS lines merged from Africa export import"),
        });
        mergedCount += 1;
        return;
      }
      byRef.set(refKey, {
        ...item,
        history: appendHistory(item.history, "Imported", "Africa export order imported from file"),
      });
      addedCount += 1;
    });

    setShipments(Array.from(byRef.values()));
    if (importPreview[0]?.ref) setSelectedRef(importPreview[0].ref);
    setImportPreview([]);
    setShowImport(false);
    showSuccess(`Added ${addedCount} Africa export shipment${addedCount === 1 ? "" : "s"} and merged ${mergedCount} existing ASO${mergedCount === 1 ? "" : "s"}.`);
  };

  const downloadTemplate = async () => {
    const data = [
      ["Reference", "Customer", "Destination Country", "HS Code", "Product Type", "Incoterm", "Transport Mode", "ETD", "ETA", "Customs Buffer Days", "Qty", "Pallets", "Notes"],
      ["AFX-0001", "Africa Client", "Botswana", "2106.90", "Food ingredient blend", "FCA", "Road", "2026-06-10", "2026-06-15", "2", "1250", "4", "Confirm import permit before dispatch"],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AfricaExports");
    await XLSX.writeFile(workbook, "africa_exports_template.xlsx");
  };

  const tabs: { id: ExportTab; label: string; icon: React.FC<any> }[] = [
    { id: "onboarding", label: "Onboarding", icon: ClipboardCheck },
    { id: "overview", label: "Shipment Setup", icon: Globe2 },
    { id: "documents", label: "Document Pack", icon: FileCheck2 },
    { id: "permits", label: "Destination Checks", icon: ShieldCheck },
    { id: "incoterms", label: "Incoterms", icon: Truck },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Africa Export Shipments</h1>
          <p className="text-sm text-gray-500">
            Independent export workspace for Africa clients, export documents, and cross-border transporters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button variant="outline" className="gap-2" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4" />
            Import Africa Orders
          </Button>
          <Button variant="outline" className="gap-2" onClick={downloadReadyDispatchExport} disabled={readyShipments.length === 0}>
            <Download className="h-4 w-4" />
            Ready Export
          </Button>
          <Button variant="outline" className="gap-2" onClick={createBlankShipment}>
            <Plus className="h-4 w-4" />
            New Export
          </Button>
        </div>
      </div>

      <div
        className="group relative overflow-hidden rounded-xl bg-gray-900 pb-3 pt-8 text-sm font-bold uppercase tracking-wide text-white shadow-sm ring-1 ring-gray-800"
        aria-label="Universal Africa export rules"
        tabIndex={0}
      >
        <div className="absolute left-0 top-0 z-10 flex h-6 items-center rounded-br-lg border-b border-r border-gray-700 bg-gray-800 px-4 text-xs text-emerald-300">
          Universal Export rules
        </div>
        <div className="flex min-w-max animate-africa-export-rules gap-8 whitespace-nowrap px-5 group-hover:[animation-play-state:paused] group-focus:[animation-play-state:paused]">
          {[...UNIVERSAL_EXPORT_RULES, ...UNIVERSAL_EXPORT_RULES].map((rule, index) => (
            <span key={`${rule}-${index}`} className="inline-flex items-center gap-8">
              <span>{rule}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
          ))}
        </div>
      </div>

      {remoteSyncError && (
        <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {remoteSyncError}
        </div>
      )}

      {customerRequirement && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-4 text-red-900 shadow-sm" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
            <div>
              <p className="font-bold">Loading blocked until Speedlink authority is received</p>
              <p className="mt-1 text-sm">
                {shipment.customer}: obtain and verify the Speedlink Cargo Loading Authority before loading or dispatch. The authority and pre-alert attachment are mandatory dispatch documents.
              </p>
              {isYogurtStabiliserShipment(shipment) && (
                <p className="mt-2 text-sm font-semibold">
                  Yogurt Stabiliser: confirm tariff code 3824.9990, SADC preference, and EMA SI 268 of 2018 against the authority.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="overflow-hidden border-l-4 border-l-emerald-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Africa Exports</p>
                <p className="text-2xl font-bold text-gray-900">{activeShipments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-emerald-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Required Docs</p>
                <p className="text-2xl font-bold text-gray-900">{requiredDone}/{requiredItems.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-blue-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Truck className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Export Transporters</p>
                <p className="text-2xl font-bold text-gray-900">{transporters.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-amber-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last Agent Check</p>
                <p className="text-base font-bold text-gray-900">{shipment.lastCheckedAt || "Not done"}</p>
                <p className="text-xs font-semibold text-gray-500">{readiness.detail}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9">
            {[
              { id: "all" as ExportQueueFilter, label: "All Exports", count: tabCounts.all, dot: "bg-gray-400" },
              { id: "open" as ExportQueueFilter, label: "Open", count: tabCounts.open, dot: "bg-yellow-500" },
              { id: "assigned" as ExportQueueFilter, label: "Assigned", count: tabCounts.assigned, dot: "bg-blue-500" },
              { id: "in-transit" as ExportQueueFilter, label: "In Transit", count: tabCounts.inTransit, dot: "bg-indigo-500" },
              { id: "delivered" as ExportQueueFilter, label: "Delivered", count: tabCounts.delivered, dot: "bg-emerald-500" },
              { id: "cancelled" as ExportQueueFilter, label: "Cancelled", count: tabCounts.cancelled, dot: "bg-gray-500" },
              { id: "ready" as ExportQueueFilter, label: "Ready", count: tabCounts.ready, dot: "bg-green-500" },
              { id: "missing-docs" as ExportQueueFilter, label: "Missing Docs", count: tabCounts.missingDocs, dot: "bg-red-500" },
              { id: "this-week" as ExportQueueFilter, label: "This Week", count: tabCounts.thisWeek, dot: "bg-purple-500" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setQueueFilter(tab.id)}
                className={`flex h-10 items-center justify-center gap-2 rounded-card border px-3 text-sm font-semibold transition ${
                  queueFilter === tab.id ? "border-resilinc-primary bg-resilinc-primary text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${queueFilter === tab.id ? "bg-white" : tab.dot}`} />
                <span className="truncate">{tab.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${queueFilter === tab.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 w-full rounded-card border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Search export ASO, customer, HS code..."
              />
            </div>
            <select
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value)}
              className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Countries</option>
              {exportCountries.map((country) => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ExportStatus | "all")}
              className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="assigned">Assigned</option>
              <option value="in-transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={transporterFilter}
              onChange={(event) => setTransporterFilter(event.target.value)}
              className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Transporters</option>
              {transporters.map((transporter) => (
                <option key={transporter.id} value={transporter.id}>{transporter.name}</option>
              ))}
            </select>
            <select
              value={etaFilter}
              onChange={(event) => setEtaFilter(event.target.value as ExportEtaFilter)}
              className="h-10 rounded-card border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Dates</option>
              <option value="this-week">ETD / ETA This Week</option>
              <option value="next-30">Next 30 Days</option>
              <option value="overdue">Overdue</option>
              <option value="no-date">No ETD / ETA</option>
            </select>
            <Button variant="outline" size="icon" className="h-10 w-10 border-emerald-200 text-emerald-700" onClick={resetQueueControls} title="Clear filters" aria-label="Clear Africa export filters">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {shipment.ref && (
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-bold text-gray-900">{shipment.ref}</span>
                  <span className={`rounded border px-2 py-1 text-xs font-bold ${statusTone}`}>
                    {requiredCompletionPercent}% required docs
                  </span>
                  <span className={`rounded border px-2 py-1 text-xs font-bold ${readiness.tone}`}>
                    {readiness.label}
                  </span>
                  <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold text-gray-700">
                    Required docs {requiredDone}/{requiredItems.length}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-gray-600">
                  {shipment.customer || "No consignee"} - {shipment.destinationCountry || "Country to confirm"} - {shipment.transportMode || "Mode to confirm"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <Button variant="outline" size="sm" className="gap-2" onClick={markPreDispatchConfirmed}>
                  <ClipboardCheck className="h-4 w-4" />
                  Agent Check
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={downloadExportPack}>
                  <Download className="h-4 w-4" />
                  Export Pack
                </Button>
                {isDispatchApproved ? (
                  <Button variant="outline" size="sm" className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={clearDispatchApproval}>
                    <RotateCcw className="h-4 w-4" />
                    Clear Approval
                  </Button>
                ) : (
                  <Button size="sm" className="gap-2" onClick={approveDispatch} disabled={!canApproveDispatch}>
                    <ShieldCheck className="h-4 w-4" />
                    Approve
                  </Button>
                )}
                {shipment.archived ? (
                  <Button variant="outline" size="sm" className="gap-2" onClick={restoreShipment}>
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="gap-2" onClick={archiveShipment}>
                    <Archive className="h-4 w-4" />
                    Archive
                  </Button>
                )}
                <Button variant="outline" size="sm" className="gap-2 border-red-200 text-red-700 hover:bg-red-50" onClick={deleteShipment}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {complianceAlerts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Export Compliance Alerts
            </CardTitle>
            <p className="text-sm text-gray-600">Open checks before loading Africa export shipments.</p>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {complianceAlerts.map((alert) => (
                <button
                  key={`${alert.ref}-${alert.title}`}
                  type="button"
                  onClick={() => {
                    setSelectedRef(alert.ref);
                    setActiveTab(alert.tab);
                  }}
                  className={`rounded-card border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card ${alert.tone}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{alert.ref} - {alert.title}</p>
                      <p className="mt-1 truncate text-xs opacity-80">{alert.detail}</p>
                    </div>
                    <span className="rounded bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase">
                      {alert.tab === "documents" ? "Docs" : "Checks"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="xl:col-span-1">
          <Card className="overflow-hidden xl:sticky xl:top-8">
            <CardHeader className="border-b border-gray-100 p-5">
              <CardTitle className="text-lg">Africa Export Queue</CardTitle>
              <p className="text-sm text-gray-600">Only Africa export shipments appear here.</p>
            </CardHeader>
            <CardContent className="p-4">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-card border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Search exports..."
                />
              </div>
              <div className="mb-3 flex flex-wrap gap-1 rounded-card border border-gray-200 bg-gray-50 p-1">
                {[
                  { id: "all" as ExportQueueFilter, label: "All", count: activeShipments.length, activeClass: "bg-white text-gray-900" },
                  { id: "ready" as ExportQueueFilter, label: "Ready", count: readyShipments.length, activeClass: "bg-green-50 text-green-700" },
                  { id: "missing-docs" as ExportQueueFilter, label: "Docs", count: missingDocsShipments.length, activeClass: "bg-red-50 text-red-700" },
                  { id: "risks" as ExportQueueFilter, label: "Risks", count: riskyShipments.length, activeClass: "bg-red-50 text-red-700" },
                  { id: "approved" as ExportQueueFilter, label: "Approved", count: approvedShipments.length, activeClass: "bg-emerald-50 text-emerald-700" },
                  { id: "pending-approval" as ExportQueueFilter, label: "Pending", count: pendingApprovalShipments.length, activeClass: "bg-amber-50 text-amber-700" },
                  { id: "cancelled" as ExportQueueFilter, label: "Cancelled", count: cancelledShipments.length, activeClass: "bg-gray-200 text-gray-800" },
                  { id: "archived" as ExportQueueFilter, label: "Archive", count: archivedShipments.length, activeClass: "bg-gray-200 text-gray-800" },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setQueueFilter(filter.id)}
                    className={`rounded px-2 py-1.5 text-xs font-bold transition-colors ${
                      queueFilter === filter.id ? `${filter.activeClass} shadow-sm` : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {filter.label} {filter.count}
                  </button>
                ))}
              </div>
              <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                {filteredShipments.length === 0 ? (
                  <div className="rounded-card border border-dashed border-gray-300 p-6 text-center">
                    <Package className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    <p className="text-sm font-semibold text-gray-600">
                      {queueEmptyTitle}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {queueEmptyDetail}
                    </p>
                  </div>
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={handleQueueDragEnd}>
                    <SortableContext items={filteredShipments.map((item) => item.ref)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {filteredShipments.map((item) => {
                          const active = selectedRef === item.ref;
                          const itemReadiness = getReadiness(item);
                          const itemRequired = getRequiredItemsForShipment(item);
                          const itemRequiredDone = itemRequired.filter((doc) => item.documents?.[doc.id]).length;
                          const itemRequiredPercent = itemRequired.length ? Math.round((itemRequiredDone / itemRequired.length) * 100) : 0;
                          const dateMeta = getShipmentDateMeta(item);
                          return (
                            <SortableAfricaQueueItem key={item.ref} id={item.ref}>
                              {(dragHandle) => (
                                <button
                                  type="button"
                                  onClick={() => setSelectedRef(item.ref)}
                                  className={`w-full rounded-card border p-3 text-left transition-colors ${
                                    active ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="flex min-w-0 items-center gap-2">
                                      {dragHandle}
                                      <span className="truncate text-sm font-bold text-gray-900">{item.ref}</span>
                                    </span>
                                    <span className="text-xs font-semibold text-emerald-700">{itemRequiredPercent}%</span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-gray-600">{item.customer}</p>
                                  <p className="mt-1 truncate text-xs text-gray-400">
                                    {item.destinationCountry || "Country to confirm"} - {item.status}
                                  </p>
                                  <div className={`mt-2 flex items-center justify-between gap-2 rounded-card border px-2 py-1.5 ${dateMeta.tone}`}>
                                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold">
                                      <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" />
                                      <span className="truncate">ETD {formatExportDate(item.etd)}</span>
                                    </span>
                                    <span className="flex-shrink-0 text-[10px] font-bold uppercase">{dateMeta.label}</span>
                                  </div>
                                  <p className="mt-1 truncate text-[11px] font-semibold text-gray-500">ETA {formatExportDate(item.eta)}</p>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                                    <div
                                      className="h-full rounded-full bg-emerald-500"
                                      style={{ width: `${itemRequired.length ? (itemRequiredDone / itemRequired.length) * 100 : 0}%` }}
                                    />
                                  </div>
                                  <span className={`mt-2 inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${itemReadiness.tone}`}>
                                    {itemReadiness.label} - docs {itemRequiredDone}/{itemRequired.length}
                                  </span>
                                </button>
                              )}
                            </SortableAfricaQueueItem>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-3">
          <Card className="overflow-hidden">
            <CardContent className="p-2">
              <div className="flex flex-wrap gap-2">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex h-10 items-center gap-2 rounded-card border px-3 text-sm font-semibold transition-colors ${
                      activeTab === id
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {activeTab === "onboarding" && (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <CardTitle>Africa Export Customer Onboarding</CardTitle>
                      <p className="mt-1 text-sm text-gray-600">
                        Complete this requirement confirmation before any new product is manufactured, relabelled, submitted to SGS, or dispatched to an African export customer.
                      </p>
                    </div>
                    <span className="rounded-card border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                      Required before production
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {[
                      "New African export customer",
                      "New customer-specific product line",
                      "New African destination",
                    ].map((trigger) => (
                      <div key={trigger} className="rounded-card border border-emerald-100 bg-emerald-50 p-4">
                        <p className="text-sm font-bold text-emerald-900">{trigger}</p>
                        <p className="mt-1 text-xs text-emerald-700">Start onboarding and confirm destination requirements with the client.</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Client Confirmation Checklist</CardTitle>
                  <p className="text-sm text-gray-600">Ask the client to confirm every applicable customer and destination-specific requirement at the start of export onboarding.</p>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {ONBOARDING_REQUIREMENTS.map((requirement) => (
                      <div key={requirement} className="flex gap-3 rounded-card border border-gray-200 bg-white p-3 text-sm text-gray-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                        <span>{requirement}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Responsibility Split</CardTitle>
                  <p className="text-sm text-gray-600">Each function signs off its part before production, relabelling, SGS submission, or dispatch proceeds.</p>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {ONBOARDING_RESPONSIBILITIES.map((item) => (
                      <div key={item.owner} className="rounded-card border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-bold text-gray-900">{item.owner}</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">{item.responsibility}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden border-emerald-200 bg-emerald-50">
                <CardContent className="p-5">
                  <div className="flex gap-3">
                    <ShieldCheck className="mt-1 h-5 w-5 flex-shrink-0 text-emerald-700" />
                    <div>
                      <p className="text-sm font-bold text-emerald-950">Onboarding gate</p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        The confirmed requirements must be reviewed and signed off before any new product is manufactured, relabelled, submitted to SGS, or dispatched to an African export customer.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "overview" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card className="overflow-hidden xl:col-span-2">
                <CardHeader className="border-b border-gray-100 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>Shipment Setup</CardTitle>
                      <p className="text-sm text-gray-600">Africa client, destination, tariff, Incoterm, and product details.</p>
                    </div>
                    <Button className="gap-2" onClick={() => void saveShipmentSetup()} disabled={!shipment.ref.trim() || !shipment.customer.trim()}>
                      <Save className="h-4 w-4" />
                      Save Setup
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Reference" value={shipment.ref} onChange={(value) => updateShipment({ ref: value })} placeholder="AFX-0001" />
                    <Field label="Africa Client / Consignee" value={shipment.customer} onChange={(value) => updateShipment({ customer: value })} placeholder="Client name" />
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Destination Country</span>
                      <select
                        value={shipment.destinationCountry}
                        onChange={(event) => {
                          updateShipment({ destinationCountry: event.target.value });
                          const rule = countryRules[event.target.value];
                          setCountryRuleDraft({
                            country: event.target.value || "Egypt",
                            title: rule?.title || "",
                            points: rule?.points.join("\n") || "",
                            requiredDocumentIds: rule?.requiredDocumentIds || [],
                          });
                        }}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">Select Africa country</option>
                        {countryOptions.map((country) => (
                          <option key={country} value={country}>{country}</option>
                        ))}
                      </select>
                    </label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-700">HS Codes</span>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-2" onClick={addHsCode}>
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {hsCodeRows.map((code, index) => (
                          <div key={`${index}-${hsCodeRows.length}`} className="flex gap-2">
                            <input
                              value={code}
                              onChange={(event) => updateHsCode(index, event.target.value)}
                              className="min-w-0 flex-1 rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              placeholder={index === 0 ? "Tariff classification" : "Additional HS code"}
                            />
                            {hsCodeRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeHsCode(index)}
                                className="h-10 w-10 flex-shrink-0 rounded-card border border-red-200 text-red-600 transition-colors hover:bg-red-50"
                                title="Remove HS code"
                              >
                                <X className="mx-auto h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button type="button" variant="outline" className="h-10 gap-2" onClick={openTariffLookup}>
                        <ExternalLink className="h-4 w-4" />
                        Lookup Tariff
                      </Button>
                    </div>
                    <Field label="Product Type" value={shipment.productType} onChange={(value) => updateShipment({ productType: value })} placeholder="Food ingredient, flavouring, enzyme" />
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Incoterm</span>
                      <select
                        value={shipment.incoterm}
                        onChange={(event) => updateShipment({ incoterm: event.target.value })}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"].map((term) => (
                          <option key={term} value={term}>{term}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Transport Mode</span>
                      <select
                        value={shipment.transportMode}
                        onChange={(event) => updateShipment({ transportMode: event.target.value })}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {["Road", "Air", "Sea", "Courier"].map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </label>
                    <div className="space-y-3 md:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                          <Clock className="h-4 w-4 text-gray-500" />
                          Transport Lead Time from Johannesburg
                        </span>
                        {!leadTimeGuide && (
                          <span className="rounded bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase text-amber-700">Select country</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {EXPORT_LEAD_TIME_SERVICES.map((service) => {
                          const Icon = service.icon;
                          const leadTime = leadTimeGuide?.[service.id] || "Select destination";
                          const selected = selectedLeadTimeMode === service.id;
                          const practical = leadTimeGuide ? isLeadTimePractical(leadTime) : false;
                          return (
                            <button
                              key={service.id}
                              type="button"
                              onClick={() => {
                                if (!leadTimeGuide) {
                                  showWarning("Select a destination country before choosing a lead time.");
                                  return;
                                }
                                if (!practical) {
                                  showWarning(`${service.label} is ${leadTime.toLowerCase()} for ${shipment.destinationCountry}.`);
                                  return;
                                }
                                const nextEtd = calculateEtdFromEta(shipment.eta, leadTime, customsBufferDays);
                                updateShipment(
                                  { transportMode: service.transportMode, etd: nextEtd || shipment.etd },
                                  { action: "Transport lead time selected", detail: `${service.label}: ${leadTime}${nextEtd ? `, ETD ${nextEtd}` : ""}` },
                                );
                              }}
                              className={`min-h-[92px] rounded-card border p-3 text-center transition-colors ${
                                selected && practical
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                                  : selected
                                    ? "border-amber-300 bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                                  : practical
                                    ? "border-gray-200 bg-white text-gray-800 hover:border-emerald-200 hover:bg-emerald-50"
                                    : "border-gray-200 bg-gray-50 text-gray-500"
                              }`}
                            >
                              <Icon className={`mx-auto mb-2 h-5 w-5 ${selected && practical ? "text-emerald-600" : selected ? "text-amber-600" : "text-gray-500"}`} />
                              <p className="text-sm font-bold">{service.label}</p>
                              <p className="mt-1 text-xs font-semibold">{leadTime}</p>
                            </button>
                          );
                        })}
                      </div>
                      <div className="rounded-card border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                        Estimated transit time depends on carrier routing, border clearance, port congestion and documentation readiness. Add a 2-5 working day customs/border buffer, and more where SGS/COC, permits, health certificates or importer approvals are required.
                      </div>
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Status</span>
                      <select
                        value={shipment.status}
                        onChange={(event) => updateShipmentStatus(event.target.value as ExportStatus)}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {EXPORT_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                    <div className="space-y-3 md:col-span-2">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Field label="Target ETA" value={shipment.eta} onChange={updateEtaTarget} type="date" />
                        <Field label="Calculated ETD" value={shipment.etd || calculatedEtd} onChange={(value) => updateShipment({ etd: value })} type="date" />
                        <Field label="Customs / Docs Buffer Days" value={String(customsBufferDays)} onChange={updateCustomsBuffer} type="number" />
                      </div>
                      <div className="flex flex-col gap-2 rounded-card border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 md:flex-row md:items-center md:justify-between">
                        <span>
                          ETD is calculated from ETA minus the selected service lead time
                          {selectedLeadTime ? ` (${selectedLeadTime})` : ""}
                          {` plus ${customsBufferDays} buffer day${customsBufferDays === 1 ? "" : "s"}.`}
                        </span>
                        <Button type="button" size="sm" variant="outline" className="h-8 flex-shrink-0 gap-2" onClick={applyCalculatedEtd} disabled={!calculatedEtd}>
                          <CalendarDays className="h-3.5 w-3.5" />
                          Use Calculated ETD
                        </Button>
                      </div>
                      {etdMissedDays > 0 && (
                        <div className="flex flex-col gap-3 rounded-card border border-red-200 bg-red-50 p-3 text-xs text-red-800 md:flex-row md:items-center md:justify-between">
                          <span className="font-semibold">
                            Target ETA is at risk: calculated ETD was {formatExportDate(effectiveEtd)}, missed by {etdMissedDays} day{etdMissedDays === 1 ? "" : "s"}.
                            {etaFromToday ? ` Dispatching today moves ETA to ${formatExportDate(etaFromToday)}.` : " Replan the ETA after selecting a practical service."}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="h-8 flex-shrink-0 gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={setEtdToday}>
                              <CalendarDays className="h-3.5 w-3.5" />
                              Set ETD Today
                            </Button>
                            <Button type="button" size="sm" className="h-8 flex-shrink-0 gap-2" onClick={replanEtaFromToday} disabled={!etaFromToday}>
                              <Clock className="h-3.5 w-3.5" />
                              Replan ETA
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <Field label="Qty" value={String(shipment.quantity || "")} onChange={(value) => updateShipment({ quantity: parseNumber(value) })} type="number" />
                    <Field label="Pallets" value={String(shipment.pallets || "")} onChange={(value) => updateShipment({ pallets: parseNumber(value) })} type="number" />
                    <div className="space-y-2 md:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-700">Product Lines</span>
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-2" onClick={addProductLine}>
                          <Plus className="h-3.5 w-3.5" />
                          Add Line
                        </Button>
                      </div>
                      <div className="overflow-x-auto rounded-card border border-gray-200">
                        <table className="w-full min-w-[920px] text-xs">
                          <thead className="bg-gray-50 text-left font-semibold uppercase tracking-wide text-gray-500">
                            <tr>
                              {["Product", "HS Code", "Qty", "Pallets", "Batch", "Notes", ""].map((heading) => (
                                <th key={heading} className="px-3 py-2">{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {(shipment.productLines || []).length === 0 ? (
                              <tr>
                                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">No product lines captured yet.</td>
                              </tr>
                            ) : (shipment.productLines || []).map((line) => (
                              <tr key={line.id}>
                                <td className="p-2"><input value={line.product} onChange={(event) => updateProductLine(line.id, "product", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2"><input value={line.hsCode} onChange={(event) => updateProductLine(line.id, "hsCode", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2"><input type="number" value={line.quantity || ""} onChange={(event) => updateProductLine(line.id, "quantity", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2"><input type="number" value={line.pallets || ""} onChange={(event) => updateProductLine(line.id, "pallets", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2"><input value={line.batch} onChange={(event) => updateProductLine(line.id, "batch", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2"><input value={line.notes} onChange={(event) => updateProductLine(line.id, "notes", event.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" /></td>
                                <td className="p-2 text-right">
                                  <button type="button" onClick={() => removeProductLine(line.id)} className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Origin Preference</span>
                      <select
                        value={shipment.preferenceScheme}
                        onChange={(event) => updateShipment({ preferenceScheme: event.target.value })}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {["To confirm", "No preference", "General COO", "SADC COO", "AfCFTA COO"].map((scheme) => (
                          <option key={scheme} value={scheme}>{scheme}</option>
                        ))}
                      </select>
                    </label>
                    <Field label="Destination Clearing Agent" value={shipment.destinationAgent} onChange={(value) => updateShipment({ destinationAgent: value })} className="md:col-span-2" placeholder="Agent name, email, or contact notes" />
                    <label className="space-y-2 md:col-span-2">
                      <span className="text-sm font-semibold text-gray-700">Shipment Notes</span>
                      <textarea
                        value={shipment.notes}
                        onChange={(event) => updateShipment({ notes: event.target.value })}
                        className="min-h-[90px] w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Operational export instructions only: routing, agent/customer instructions, permits, or document caveats. Product details belong in Product Lines."
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Truck className="h-5 w-5 text-gray-600" />
                        Export Transporters
                      </CardTitle>
                      <p className="mt-1 text-sm text-gray-600">Select a transporter, then use Assign to confirm this shipment.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setShowAddTransporter(true)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="mb-4 rounded-card border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Selected export</p>
                    <p className="mt-1 truncate text-sm font-bold text-gray-900">{shipment.ref || "No export selected"}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <span>{shipment.quantity || "-"} qty</span>
                      <span>{shipment.pallets || "-"} pallets</span>
                      <span>{shipment.status}</span>
                      <span className={`col-span-2 rounded border px-2 py-1 font-bold ${readiness.tone}`}>Readiness: {readiness.label}</span>
                      <span className="col-span-2">
                        Dispatch approval: {shipment.dispatchApprovedAt ? `${shipment.dispatchApprovedAt} by ${shipment.dispatchApprovedBy || "unknown"}` : "Not approved"}
                      </span>
                      {missingRequiredDocs.length > 0 && (
                        <span className="col-span-2 text-red-700">{missingRequiredDocs.length} required document{missingRequiredDocs.length === 1 ? "" : "s"} outstanding</span>
                      )}
                      <span className="col-span-2">Transporter: {assignedTransporter?.name || "Unassigned"}</span>
                    </div>
                  </div>

                  {shipment.assignedTransporterId && (
                    <Button variant="outline" className="mb-3 w-full border-amber-200 text-amber-700 hover:bg-amber-50" onClick={clearAssignment}>
                      Move Back to Unassigned
                    </Button>
                  )}

                  <div className="space-y-2">
                    {transporters.map((transporter) => {
                      const isAssigned = shipment.assignedTransporterId === transporter.id;
                      return (
                        <button
                          key={transporter.id}
                          onClick={() => assignShipment(transporter)}
                          disabled={isAssigned}
                          className={`w-full rounded-card border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                            isAssigned ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-gray-900">{transporter.name}</span>
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                              {transporter.status}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                            <span className="truncate">{transporter.route || "Route to confirm"}</span>
                            <span>{transporter.capacity || 0} pallets</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                            <span className="truncate text-xs text-gray-500">{transporter.contact || "No contact captured"}</span>
                            <span className={`rounded px-2 py-1 text-xs font-bold ${isAssigned ? "bg-emerald-100 text-emerald-700" : "bg-gray-900 text-white"}`}>
                              {isAssigned ? "Assigned" : "Assign"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "documents" && (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900">Required Documents</p>
                      <p className="text-sm text-gray-600">
                        {requiredDone}/{requiredItems.length} required documents complete for {shipment.ref || "the selected shipment"}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button className="gap-2" onClick={() => markRequiredDocuments(true)} disabled={!shipment.ref || requiredItems.length === 0 || requiredDone === requiredItems.length}>
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Required Complete
                      </Button>
                      <Button variant="outline" className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => markRequiredDocuments(false)} disabled={!shipment.ref || requiredDone === 0}>
                        <RotateCcw className="h-4 w-4" />
                        Reopen Required
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {filteredGroups.map((group) => (
                <Card key={group.title} className="overflow-hidden">
                  <CardHeader className="border-b border-gray-100 p-5">
                    <CardTitle className="text-lg">{group.title}</CardTitle>
                    <p className="text-sm text-gray-600">{group.description}</p>
                  </CardHeader>
                  <CardContent className="p-5">
                    <div className="divide-y divide-gray-100 rounded-card border border-gray-200">
                      {group.items.map((item) => {
                        const detail = shipment.documentDetails?.[item.id] || { reference: "", expiry: "", notes: "" };
                        const isRequired = requiredItems.some((doc) => doc.id === item.id);
                        const countryRequired = Boolean(destinationRequirement?.requiredDocumentIds.includes(item.id));
                        return (
                          <div key={item.id} className={`flex gap-3 p-4 hover:bg-gray-50 ${countryRequired ? "bg-emerald-50/60" : ""}`}>
                            <input
                              type="checkbox"
                              checked={!!shipment.documents?.[item.id]}
                              onChange={() => toggleDocument(item.id)}
                              disabled={!shipment.ref}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-gray-900">{item.label}</span>
                                {isRequired && <span className="rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Required</span>}
                                {countryRequired && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Country Rule</span>}
                                {item.conditional && <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Conditional</span>}
                              </div>
                              <p className="mt-1 text-sm text-gray-600">{item.purpose}</p>
                              {item.conditional && <p className="mt-1 text-xs text-amber-700">{item.conditional}</p>}
                              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                                <input
                                  value={detail.reference}
                                  onChange={(event) => updateDocumentDetail(item.id, "reference", event.target.value)}
                                  disabled={!shipment.ref}
                                  className="rounded-card border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  placeholder="Reference / cert no."
                                />
                                <input
                                  type="date"
                                  value={detail.expiry}
                                  onChange={(event) => updateDocumentDetail(item.id, "expiry", event.target.value)}
                                  disabled={!shipment.ref}
                                  className="rounded-card border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                                <input
                                  value={detail.notes}
                                  onChange={(event) => updateDocumentDetail(item.id, "notes", event.target.value)}
                                  disabled={!shipment.ref}
                                  className="rounded-card border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  placeholder="Notes / originals / expiry"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {activeTab === "permits" && (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Pre-dispatch Confirmation</CardTitle>
                  <p className="text-sm text-gray-600">Use this before loading the Africa export.</p>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {PRE_DISPATCH_CHECKS.map((check) => (
                      <div key={check} className="flex gap-3 rounded-card border border-gray-200 bg-white p-3 text-sm text-gray-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                        <span>{check}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {destinationRequirement && (
                <Card className="overflow-hidden">
                  <CardHeader className="border-b border-gray-100 p-5">
                    <CardTitle>{destinationRequirement.title}</CardTitle>
                    <p className="text-sm text-gray-600">Applies to the selected destination country: {shipment.destinationCountry}.</p>
                  </CardHeader>
                  <CardContent className="p-5">
                    <div className="space-y-2">
                      {destinationRequirement.points.map((point) => (
                        <div key={point} className="flex gap-3 rounded-card border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                          <span>{point}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {customerRequirement && (
                <Card className="overflow-hidden border-2 border-red-200">
                  <CardHeader className="border-b border-red-100 bg-red-50 p-5">
                    <CardTitle>{customerRequirement.title}</CardTitle>
                    <p className="text-sm text-red-800">Customer-specific rule for {shipment.customer}. This requirement overrides any instruction to load before authority is confirmed.</p>
                  </CardHeader>
                  <CardContent className="p-5">
                    <div className="space-y-2">
                      {customerRequirement.points.map((point) => (
                        <div key={point} className="flex gap-3 rounded-card border border-red-100 bg-red-50 p-3 text-sm text-red-900">
                          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                          <span>{point}</span>
                        </div>
                      ))}
                      {isYogurtStabiliserShipment(shipment) && (
                        <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                          <p className="font-bold">Product-specific Loading Authority requirement</p>
                          <p className="mt-1">Commodity: Yogurt Stabiliser · Tariff Code: 3824.9990 · Preferred Trade Agreement: SADC · Control / Compliance Document: EMA SI 268 of 2018</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Country Rules Library</CardTitle>
                  <p className="text-sm text-gray-600">Maintain destination-specific requirements for Africa export clients.</p>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Country</span>
                      <select
                        value={countryRuleDraft.country}
                        onChange={(event) => {
                          const rule = countryRules[event.target.value];
                          setCountryRuleDraft({
                            country: event.target.value,
                            title: rule?.title || "",
                            points: rule?.points.join("\n") || "",
                            requiredDocumentIds: rule?.requiredDocumentIds || [],
                          });
                        }}
                        className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {countryOptions.map((country) => (
                          <option key={country} value={country}>{country}</option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="Rule Heading"
                      value={countryRuleDraft.title}
                      onChange={(value) => setCountryRuleDraft((prev) => ({ ...prev, title: value }))}
                      placeholder="Country requirement heading"
                    />
                    <label className="space-y-2 md:col-span-2">
                      <span className="text-sm font-semibold text-gray-700">Requirement Lines</span>
                      <textarea
                        value={countryRuleDraft.points}
                        onChange={(event) => setCountryRuleDraft((prev) => ({ ...prev, points: event.target.value }))}
                        className="min-h-[120px] w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Add one requirement per line."
                      />
                    </label>
                    <div className="space-y-2 md:col-span-2">
                      <span className="text-sm font-semibold text-gray-700">Documents Required by This Country</span>
                      <div className="max-h-64 overflow-y-auto rounded-card border border-gray-200 bg-gray-50 p-3">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {allChecklistItems.map((item) => {
                            const checked = countryRuleDraft.requiredDocumentIds.includes(item.id);
                            return (
                              <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded bg-white p-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => {
                                    setCountryRuleDraft((prev) => ({
                                      ...prev,
                                      requiredDocumentIds: event.target.checked
                                        ? Array.from(new Set([...prev.requiredDocumentIds, item.id]))
                                        : prev.requiredDocumentIds.filter((id) => id !== item.id),
                                    }));
                                  }}
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span>{item.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <Button className="gap-2" onClick={saveCountryRule}>
                        <Save className="h-4 w-4" />
                        Save Country Rule
                      </Button>
                    </div>
                    {(countryRules[countryRuleDraft.country]?.history || []).length > 0 && (
                      <div className="md:col-span-2">
                        <p className="mb-2 text-sm font-semibold text-gray-700">Rule Audit History</p>
                        <div className="max-h-48 space-y-2 overflow-y-auto rounded-card border border-gray-200 bg-gray-50 p-3">
                          {(countryRules[countryRuleDraft.country]?.history || []).map((entry) => (
                            <div key={entry.id} className="rounded bg-white p-2 text-xs text-gray-700">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-gray-900">{entry.action}</span>
                                <span className="text-gray-500">{new Date(entry.at).toLocaleString()}</span>
                              </div>
                              <p className="mt-1">{entry.detail}</p>
                              <p className="mt-1 font-semibold text-gray-500">By {entry.user}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Question for Destination Agent</CardTitle>
                  <p className="text-sm text-gray-600">Send this before dispatch and keep the response with the shipment pack.</p>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
                    {AGENT_QUESTION}
                  </div>
                  <div className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    SADC is mainly needed when the importer wants to claim preferential import duty. If they are not claiming preference, a normal COO or no COO may be enough depending on the destination.
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "incoterms" && (
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-gray-100 p-5">
                <CardTitle>Incoterm Impact</CardTitle>
                <p className="text-sm text-gray-600">Clarify responsibility before quoting or dispatching into Africa.</p>
              </CardHeader>
              <CardContent className="p-5">
                <div className="overflow-hidden rounded-card border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="w-36 p-3 text-left font-semibold text-gray-700">Incoterm</th>
                        <th className="p-3 text-left font-semibold text-gray-700">Exporter Responsibility</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {INCOTERM_GUIDANCE.map((item) => (
                        <tr key={item.term} className={shipment.incoterm.includes(item.term.split(" ")[0]) ? "bg-emerald-50" : "bg-white"}>
                          <td className="p-3 font-bold text-gray-900">{item.term}</td>
                          <td className="p-3 text-gray-700">{item.responsibility}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "history" && (
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-gray-100 p-5">
                <CardTitle>Shipment History</CardTitle>
                <p className="text-sm text-gray-600">Key Africa export actions recorded against the selected shipment.</p>
              </CardHeader>
              <CardContent className="p-5">
                {!shipment.ref ? (
                  <div className="rounded-card border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                    Select or create an Africa export shipment to see its history.
                  </div>
                ) : (shipment.history || []).length === 0 ? (
                  <div className="rounded-card border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                    No history recorded yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(shipment.history || []).map((entry) => (
                      <div key={entry.id} className="rounded-card border border-gray-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-bold text-gray-900">{entry.action}</p>
                          <span className="text-xs font-semibold text-gray-500">
                            {new Date(entry.at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{entry.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowImport(false)}>
          <Card className="max-h-[90vh] w-full max-w-5xl overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="border-b border-gray-100 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Import Africa Export Orders</CardTitle>
                  <p className="mt-1 text-sm text-gray-600">Imports into Africa Exports only. These rows will not appear in local Order Management.</p>
                </div>
                <button className="rounded-card p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setShowImport(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                  <Upload className="h-4 w-4" />
                  Choose File
                </Button>
                <Button variant="outline" className="gap-2" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" />
                  Template
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(event) => handleFileSelect(event.target.files?.[0])}
                />
              </div>

              {importPreview.length === 0 ? (
                <div className="rounded-card border-2 border-dashed border-gray-200 p-10 text-center">
                  <Upload className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm font-semibold text-gray-700">Upload a CSV, XLSX, or XLS file</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Supported columns: Reference, Customer, Destination Country, HS Code, Product Type, Incoterm, Transport Mode, ETD, ETA, Customs Buffer Days, Qty, Pallets, Notes.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-card border border-emerald-200 bg-emerald-50 p-3">
                    <span className="text-sm font-semibold text-emerald-800">
                      {importPreview.length} Africa export shipment{importPreview.length === 1 ? "" : "s"} ready to import
                    </span>
                    <Button onClick={commitImport}>Import to Africa Exports</Button>
                  </div>
                  <div className="overflow-x-auto rounded-card border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {["Reference", "Client", "Country", "HS Code", "Product", "Incoterm", "ETD", "ETA", "Qty", "Pallets"].map((heading) => (
                            <th key={heading} className="p-3 text-left font-semibold text-gray-700">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.slice(0, 100).map((item) => (
                          <tr key={item.ref}>
                            <td className="p-3 font-semibold text-gray-900">{item.ref}</td>
                            <td className="p-3 text-gray-700">{item.customer}</td>
                            <td className="p-3 text-gray-700">{item.destinationCountry || "-"}</td>
                            <td className="p-3 text-gray-700">{item.hsCode || "-"}</td>
                            <td className="p-3 text-gray-700">{item.productType || "-"}</td>
                            <td className="p-3 text-gray-700">{item.incoterm}</td>
                            <td className="p-3 text-gray-700">{item.etd || "-"}</td>
                            <td className="p-3 text-gray-700">{item.eta || "-"}</td>
                            <td className="p-3 text-gray-700">{item.quantity || "-"}</td>
                            <td className="p-3 text-gray-700">{item.pallets || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {showAddTransporter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddTransporter(false)}>
          <Card className="w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="border-b border-gray-100 p-5">
              <CardTitle>Add Africa Export Transporter</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 gap-4">
                <Field label="Transporter Name" value={newTransporter.name} onChange={(value) => setNewTransporter((prev) => ({ ...prev, name: value }))} />
                <Field label="Africa Route / Mode" value={newTransporter.route} onChange={(value) => setNewTransporter((prev) => ({ ...prev, route: value }))} placeholder="SADC road, Africa air, sea freight" />
                <Field label="Contact" value={newTransporter.contact} onChange={(value) => setNewTransporter((prev) => ({ ...prev, contact: value }))} />
                <Field label="Pallet Capacity" type="number" value={String(newTransporter.capacity || "")} onChange={(value) => setNewTransporter((prev) => ({ ...prev, capacity: parseNumber(value) }))} />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={addTransporter}>Add Transporter</Button>
                  <Button className="flex-1" variant="outline" onClick={() => setShowAddTransporter(false)}>Cancel</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder, type = "text", className }) => (
  <label className={`space-y-2 ${className || ""}`}>
    <span className="text-sm font-semibold text-gray-700">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-card border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      placeholder={placeholder}
    />
  </label>
);
