"use client";

/**
 * Export layer.
 *
 * CSV and print are synchronous and dependency-free. Excel and PDF pull their
 * (heavy) libraries in on demand so the initial bundle never carries an
 * exporter the user may not open.
 */

type Cell = string | number | boolean | null | undefined;

function toCsvValue(v: Cell): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------
 * CSV
 * ---------------------------------------------------------------------- */

export function downloadCsv(name: string, headers: string[], rows: Cell[][]): void {
  const lines = [
    headers.map(toCsvValue).join(","),
    ...rows.map((r) => r.map(toCsvValue).join(",")),
  ];
  // BOM so Excel opens UTF-8 correctly on Windows.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${name}-${stamp()}.csv`);
}

/* -------------------------------------------------------------------------
 * Excel
 * ---------------------------------------------------------------------- */

export interface Sheet {
  name: string;
  headers: string[];
  rows: Cell[][];
}

export async function downloadExcel(name: string, sheets: Sheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");

  const workbook = sheets.map((sheet) => ({
    // Excel rejects sheet names over 31 chars or containing []:*?/\.
    sheet: sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31),
    stickyRowsCount: 1,
    columns: sheet.headers.map((h, i) => ({
      width: Math.min(
        46,
        Math.max(
          12,
          h.length + 4,
          ...sheet.rows.slice(0, 80).map((r) => String(r[i] ?? "").length + 2),
        ),
      ),
    })),
    data: [
      sheet.headers.map((h) => ({
        value: h,
        type: String,
        fontWeight: "bold" as const,
        backgroundColor: "#DDF1E5",
        color: "#0D7A3F",
        align: "left" as const,
      })),
      ...sheet.rows.map((row) =>
        row.map((cell) => {
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return { type: Number, value: cell };
          }
          if (typeof cell === "boolean") return { type: Boolean, value: cell };
          return { type: String, value: cell == null ? null : String(cell) };
        }),
      ),
    ],
  }));

  const blob = await writeXlsxFile(workbook as never).toBlob();
  triggerDownload(blob, `${name}-${stamp()}.xlsx`);
}

/* -------------------------------------------------------------------------
 * PDF
 * ---------------------------------------------------------------------- */

export interface PdfSection {
  title: string;
  subtitle?: string;
  /** Free text rendered above the table. */
  note?: string;
  headers?: string[];
  rows?: Cell[][];
  /** Key-value pairs rendered as a two-column summary block. */
  facts?: { label: string; value: string }[];
}

export async function downloadPdf(
  title: string,
  meta: { subtitle?: string; generated?: string; scope?: string },
  sections: PdfSection[],
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const MARGIN = 40;

  // Brand header band — the Bayut gradient flattened to its mid stop.
  doc.setFillColor(10, 92, 61);
  doc.rect(0, 0, pageWidth, 76, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, MARGIN, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (meta.subtitle) doc.text(meta.subtitle, MARGIN, 50);
  doc.setTextColor(200, 226, 211);
  doc.setFontSize(7.5);
  doc.text(
    `CPML HR · Generated ${meta.generated ?? new Date().toLocaleString("en-GB")}`,
    MARGIN,
    64,
  );

  let cursor = 100;

  if (meta.scope) {
    doc.setTextColor(80, 107, 90);
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(`Scope: ${meta.scope}`, pageWidth - MARGIN * 2);
    doc.text(lines, MARGIN, cursor);
    cursor += lines.length * 11 + 8;
  }

  for (const section of sections) {
    if (cursor > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      cursor = 50;
    }

    doc.setTextColor(26, 46, 34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.title, MARGIN, cursor);
    cursor += 13;

    if (section.subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(80, 107, 90);
      doc.text(section.subtitle, MARGIN, cursor);
      cursor += 12;
    }

    if (section.note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(80, 107, 90);
      const lines = doc.splitTextToSize(section.note, pageWidth - MARGIN * 2);
      doc.text(lines, MARGIN, cursor);
      cursor += lines.length * 10 + 6;
    }

    if (section.facts?.length) {
      autoTable(doc, {
        startY: cursor,
        margin: { left: MARGIN, right: MARGIN },
        theme: "plain",
        styles: { fontSize: 8.5, cellPadding: 3, textColor: [26, 46, 34] },
        columnStyles: {
          0: { textColor: [80, 107, 90], cellWidth: 190 },
          1: { fontStyle: "bold", halign: "right" },
        },
        body: section.facts.map((f) => [f.label, f.value]),
      });
      cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    }

    if (section.headers?.length && section.rows?.length) {
      autoTable(doc, {
        startY: cursor,
        margin: { left: MARGIN, right: MARGIN },
        head: [section.headers],
        body: section.rows.map((r) => r.map((c) => (c == null ? "—" : String(c)))),
        theme: "grid",
        styles: {
          fontSize: 7.5,
          cellPadding: 3.5,
          lineColor: [196, 216, 202],
          lineWidth: 0.4,
          textColor: [26, 46, 34],
        },
        headStyles: {
          fillColor: [221, 241, 229],
          textColor: [13, 122, 63],
          fontStyle: "bold",
          fontSize: 7,
        },
        alternateRowStyles: { fillColor: [246, 251, 247] },
      });
      cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    }
  }

  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 165, 155);
    doc.text(
      `Page ${i} of ${pages}  ·  Bayut Saudi Arabia · CPML · Internal use only`,
      MARGIN,
      doc.internal.pageSize.getHeight() - 20,
    );
  }

  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp()}.pdf`);
}

/* -------------------------------------------------------------------------
 * Print
 * ---------------------------------------------------------------------- */

export function printView(): void {
  window.print();
}
