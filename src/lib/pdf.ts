import { createElement } from "react";
import fontRegular from "../assets/fonts/DejaVuSans.ttf?url";
import fontBold from "../assets/fonts/DejaVuSans-Bold.ttf?url";
import logoUrl from "../assets/logo.png";
import type { StatementData } from "../pdf/types";

/**
 * Builds the PDF in the browser. The PDF library is loaded only when needed,
 * so it does not slow down app start-up.
 */
export async function buildStatementPdf(data: StatementData): Promise<Blob> {
  const [{ pdf, Font }, { StatementDocument, registerStatementFonts }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("../pdf/StatementDocument"),
  ]);
  registerStatementFonts(Font, fontRegular, fontBold);
  return pdf(createElement(StatementDocument, { data: { ...data, logoSrc: data.logoSrc ?? logoUrl } }) as Parameters<typeof pdf>[0]).toBlob();
}

export function pdfFileName(data: StatementData): string {
  const base = data.kind === "settlement" ? "Settlement" : "Calculation";
  const name = (data.project?.name ?? "Free").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rev = data.revision != null ? `-rev${data.revision}` : "";
  return `${base}-${name}${rev}-${data.generatedAt.slice(0, 10)}.pdf`;
}

/** Save a generated file through the browser's normal download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
