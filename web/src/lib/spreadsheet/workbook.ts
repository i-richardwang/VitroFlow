/**
 * A spreadsheet as data: what each cell holds and the weight it carries, with
 * no opinion about the file format that writes it out. Quantities stay
 * quantities here, so whatever reads the file can chart and compute on them.
 */

/** A cell holds a word, a tally, a share of one, or nothing. */
export type CellValue =
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "count"; count: number }
  | { kind: "rate"; rate: number };

/** How a cell is set: headings carry weight, and may cover their group. */
export interface CellStyle {
  strong?: boolean;
  columns?: number;
  rows?: number;
}

export type WorkbookCell = CellValue & CellStyle;

export const blankCell: WorkbookCell = { kind: "blank" };

export function textCell(text: string, style: CellStyle = {}): WorkbookCell {
  return { kind: "text", text, ...style };
}

export function countCell(count: number, style: CellStyle = {}): WorkbookCell {
  return { kind: "count", count, ...style };
}

export function rateCell(rate: number, style: CellStyle = {}): WorkbookCell {
  return { kind: "rate", rate, ...style };
}

export interface WorkbookColumn {
  /** Width in characters, the unit a spreadsheet sizes columns by. */
  width: number;
}

/** A sheet of cells, its columns sized, its heading rows and keys held in view. */
export interface Workbook {
  sheet: string;
  columns: WorkbookColumn[];
  rows: WorkbookCell[][];
  stickyRows: number;
  stickyColumns: number;
}

const RESERVED = /[\\/?*[\]:]/g;
const MAX_SHEET_NAME = 31;

/** A sheet is named in at most 31 characters, and not with a path or a range. */
export function sheetName(name: string, fallback: string): string {
  const written = name.replace(RESERVED, " ").trim().slice(0, MAX_SHEET_NAME);
  return written.length > 0 ? written : fallback;
}

const UNWRITABLE = /[\\/:*?"<>|\p{Cc}]/gu;

/** A name a file system will take and a browser will not read as a path. */
export function workbookFilename(name: string, fallback: string): string {
  const written = name.replace(UNWRITABLE, " ").replace(/\s+/g, " ").trim();
  return `${written.length > 0 ? written : fallback}.xlsx`;
}
