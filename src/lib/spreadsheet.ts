/**
 * Spreadsheet utility — drop-in replacement for the vulnerable `xlsx` package.
 * Uses `exceljs` under the hood while exposing the same call-sites used
 * throughout the app (read, json_to_sheet, sheet_to_json, writeFile, etc.).
 */
import ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Row = Record<string, unknown>;

interface SheetData {
  headers: string[];
  rows: Row[];
  /** Every non-empty row as a plain array, header row included (only set when reading). */
  rawRows?: unknown[][];
}

interface Workbook {
  SheetNames: string[];
  Sheets: Record<string, SheetData>;
}

interface ReadOptions {
  type?: "string" | "array";
  cellDates?: boolean;
}

interface SheetToJsonOptions {
  raw?: boolean;
  defval?: unknown;
  header?: number | "A";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Parse a spreadsheet from a string (CSV/TSV) or ArrayBuffer (.xlsx).
 */
export async function read(
  data: string | ArrayBuffer,
  opts?: ReadOptions,
): Promise<Workbook> {
  if (opts?.type === "string" || typeof data === "string") {
    return readCSV(data as string);
  }
  return readXLSX(data as ArrayBuffer);
}

function readCSV(text: string): Workbook {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0)
    return { SheetNames: ["Sheet1"], Sheets: { Sheet1: { headers: [], rows: [] } } };

  // Detect delimiter
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseCSVLine(lines[0], delim);
  const rows: Row[] = [];
  const rawRows: unknown[][] = [headers];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delim);
    rawRows.push(values);
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return { SheetNames: ["Sheet1"], Sheets: { Sheet1: { headers, rows, rawRows } } };
}

function parseCSVLine(line: string, delim: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

async function readXLSX(buffer: ArrayBuffer): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const result: Workbook = { SheetNames: [], Sheets: {} };

  wb.eachSheet((sheet) => {
    result.SheetNames.push(sheet.name);
    const headers: string[] = [];
    const rows: Row[] = [];
    const rawRows: unknown[][] = [];

    sheet.eachRow((row, rowNumber) => {
      const values = (row.values as unknown[]).slice(1); // exceljs is 1-indexed
      rawRows.push(Array.from(values, unwrapCellValue));
      if (rowNumber === 1) {
        values.forEach((v) => headers.push(String(v ?? "")));
      } else {
        const rowObj: Row = {};
        headers.forEach((h, idx) => {
          let val = values[idx];
          // Handle ExcelJS cell value objects
          if (val && typeof val === "object" && "result" in (val as Record<string, unknown>)) {
            val = (val as Record<string, unknown>).result;
          }
          rowObj[h] = val ?? "";
        });
        rows.push(rowObj);
      }
    });

    result.Sheets[sheet.name] = { headers, rows, rawRows };
  });

  return result;
}

/** Flatten ExcelJS cell objects (formulas, rich text, hyperlinks) to their plain value. */
function unwrapCellValue(val: unknown): unknown {
  if (val === null || val === undefined) return "";
  if (typeof val !== "object" || val instanceof Date) return val;
  const obj = val as Record<string, unknown>;
  if ("result" in obj) return unwrapCellValue(obj.result);
  if (Array.isArray(obj.richText)) return (obj.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
  if ("text" in obj) return unwrapCellValue(obj.text);
  return "";
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function jsonToSheet(data: Row[]): SheetData {
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(data[0]);
  return { headers, rows: data };
}

export function aoaToSheet(data: unknown[][]): SheetData {
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = data[0].map((v) => String(v ?? ""));
  const rows: Row[] = [];
  for (let i = 1; i < data.length; i++) {
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = data[i]?.[idx] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function bookNew(): Workbook {
  return { SheetNames: [], Sheets: {} };
}

export function bookAppendSheet(
  wb: Workbook,
  sheet: SheetData,
  name: string,
): void {
  wb.SheetNames.push(name);
  wb.Sheets[name] = sheet;
}

export function sheetToCSV(sheet: SheetData): string {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [sheet.headers.map(escape).join(",")];
  for (const row of sheet.rows) {
    lines.push(sheet.headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export function sheetToJson(
  sheet: SheetData,
  opts?: SheetToJsonOptions,
): Row[] | unknown[][] {
  // header: 1 returns arrays-of-arrays (first row is headers)
  if (opts?.header === 1) {
    const result: unknown[][] = [sheet.headers];
    for (const row of sheet.rows) {
      result.push(sheet.headers.map((h) => row[h] ?? ""));
    }
    return result;
  }
  return sheet.rows;
}

export async function writeFile(
  wb: Workbook,
  filename: string,
): Promise<void> {
  const excelWb = new ExcelJS.Workbook();

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const ws = excelWb.addWorksheet(name);

    // Add header row
    ws.addRow(sheet.headers);
    // Style header row
    ws.getRow(1).font = { bold: true };

    // Add data rows
    for (const row of sheet.rows) {
      ws.addRow(sheet.headers.map((h) => row[h] ?? ""));
    }

    // Auto-width columns
    ws.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = Math.min(len, 50);
      });
      col.width = maxLen + 2;
    });
  }

  const buffer = await excelWb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Convenience namespace (mirrors `import * as XLSX from "xlsx"`)
// ---------------------------------------------------------------------------
export const utils = {
  json_to_sheet: jsonToSheet,
  aoa_to_sheet: aoaToSheet,
  book_new: bookNew,
  book_append_sheet: bookAppendSheet,
  sheet_to_csv: sheetToCSV,
  sheet_to_json: sheetToJson,
};
