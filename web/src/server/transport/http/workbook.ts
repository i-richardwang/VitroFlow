import writeExcelFile, { type Cell } from "write-excel-file/node";

import type { Workbook, WorkbookCell } from "../../../lib/spreadsheet/workbook";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A tally is whole unless a mean falls between two; a share reads per hundred. */
const COUNT_FORMAT = "0.#";
const RATE_FORMAT = "0.0%";

/** A cell a heading covers is written by that heading, and left empty here. */
function encode(cell: WorkbookCell): Cell {
  const style = {
    fontWeight: cell.strong ? ("bold" as const) : undefined,
    columnSpan: cell.columns,
    rowSpan: cell.rows,
  };
  switch (cell.kind) {
    case "blank":
      return null;
    case "text":
      return { ...style, value: cell.text, type: String };
    case "count":
      return {
        ...style,
        value: cell.count,
        type: Number,
        format: COUNT_FORMAT,
        align: "right",
      };
    case "rate":
      return {
        ...style,
        value: cell.rate,
        type: Number,
        format: RATE_FORMAT,
        align: "right",
      };
  }
}

/**
 * A name a browser saves the file under. The encoded form carries everything
 * outside ASCII, and the plain form is what a client without it reads.
 */
function attachment(filename: string): string {
  const plain = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

export async function workbookResponse(
  workbook: Workbook,
  filename: string,
): Promise<Response> {
  const file = await writeExcelFile(
    workbook.rows.map((row) => row.map(encode)),
    {
      sheet: workbook.sheet,
      columns: workbook.columns,
      stickyRowsCount: workbook.stickyRows,
      stickyColumnsCount: workbook.stickyColumns,
    },
  ).toBuffer();
  // A Buffer is a window on a shared pool, so the response takes its own bytes.
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return new Response(bytes, {
    headers: {
      "Content-Type": CONTENT_TYPE,
      "Content-Disposition": attachment(filename),
      "Cache-Control": "no-store",
    },
  });
}
