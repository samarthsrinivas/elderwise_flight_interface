import { jsPDF } from "jspdf";
import { type BandTone, bandMeta } from "../../ui/bandColor";
import { type BandInk, bandInk, pdfColor, pdfLayout } from "./pdfTokens";

const PT_TO_MM = 0.3528;
const LINE_FACTOR = 1.4;

export interface PdfDocOptions {
  readonly title?: string;
  readonly subject?: string;
  readonly creationDate?: Date | string;
  readonly fileId?: string;
}

interface WrappedText {
  readonly lines: readonly string[];
  readonly height: number;
}

/**
 * Thin fluent wrapper over jsPDF for the Elderwise report look: teal brand
 * header, accent-bar sections, band chips, quote blocks, footer with page
 * numbers. Millimetre units on A4; every block checks for a page break
 * before drawing. Mutable by design (wraps a jsPDF document being built).
 */
export class PdfDoc {
  private readonly doc: jsPDF;
  private cursor: number;

  constructor(options: PdfDocOptions = {}) {
    this.doc = new jsPDF({ unit: "mm", format: "a4" });
    if (options.creationDate) this.doc.setCreationDate(options.creationDate);
    if (options.fileId) this.doc.setFileId(options.fileId);
    if (options.title || options.subject) {
      this.doc.setProperties({
        title: options.title,
        subject: options.subject,
        creator: "Elderwise",
      });
    }
    this.cursor = pdfLayout.margin;
  }

  private lineHeight(size: number): number {
    return size * PT_TO_MM * LINE_FACTOR;
  }

  private wrap(text: string, width: number, size: number): WrappedText {
    this.doc.setFontSize(size);
    const lines: string[] = this.doc.splitTextToSize(text, width);
    return { lines, height: lines.length * this.lineHeight(size) };
  }

  private ensure(height: number): void {
    const floor = pdfLayout.pageHeight - pdfLayout.footerHeight - 4;
    if (this.cursor + height > floor) {
      this.doc.addPage();
      this.cursor = pdfLayout.margin;
    }
  }

  private text(
    lines: readonly string[],
    x: number,
    size: number,
    color: string,
    style: "normal" | "bold" | "italic" = "normal",
  ): void {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(color);
    for (const line of lines) {
      this.cursor += this.lineHeight(size);
      this.doc.text(line, x, this.cursor);
    }
  }

  brandHeader(subtitle: string, rightLines: readonly string[]): this {
    const { margin, pageWidth, headerHeight } = pdfLayout;
    this.doc.setFillColor(pdfColor.accent);
    this.doc.rect(0, 0, pageWidth, headerHeight, "F");
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(17);
    this.doc.setTextColor("#ffffff");
    this.doc.text("Elderwise", margin, 13);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(10.5);
    this.doc.setTextColor(pdfColor.accentSoft);
    this.doc.text(subtitle, margin, 20);
    this.doc.setFontSize(8.5);
    rightLines.forEach((line, i) => {
      this.doc.text(line, pageWidth - margin, 12 + i * 4.5, { align: "right" });
    });
    this.cursor = headerHeight + 8;
    return this;
  }

  notice(message: string, ink: BandInk): this {
    const width = pdfLayout.contentWidth;
    const wrapped = this.wrap(message, width - 8, 9);
    const boxHeight = wrapped.height + 5;
    this.ensure(boxHeight + 4);
    this.doc.setFillColor(ink.soft);
    this.doc.roundedRect(pdfLayout.margin, this.cursor, width, boxHeight, 1.5, 1.5, "F");
    const startY = this.cursor + 1;
    this.cursor = startY;
    this.text(wrapped.lines, pdfLayout.margin + 4, 9, ink.main);
    this.cursor = startY + boxHeight + 3;
    return this;
  }

  section(title: string): this {
    this.ensure(14);
    this.cursor += 6;
    this.doc.setFillColor(pdfColor.accent);
    this.doc.rect(pdfLayout.margin, this.cursor, 1.4, 4.6, "F");
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10.5);
    this.doc.setTextColor(pdfColor.text);
    this.doc.text(title.toUpperCase(), pdfLayout.margin + 4, this.cursor + 3.8);
    this.cursor += 6.5;
    this.doc.setDrawColor(pdfColor.border);
    this.doc.setLineWidth(0.25);
    this.doc.line(pdfLayout.margin, this.cursor, pdfLayout.pageWidth - pdfLayout.margin, this.cursor);
    this.cursor += 1;
    return this;
  }

  private chip(label: string, x: number, y: number, ink: BandInk): number {
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", "bold");
    const width = this.doc.getTextWidth(label) + 5;
    this.doc.setFillColor(ink.soft);
    this.doc.roundedRect(x, y, width, 5, 2.5, 2.5, "F");
    this.doc.setTextColor(ink.main);
    this.doc.text(label, x + 2.5, y + 3.6);
    return width;
  }

  domainRow(title: string, band: BandTone | null, note: string): this {
    const noteWrap = this.wrap(note, pdfLayout.contentWidth, 9.5);
    this.ensure(9 + noteWrap.height);
    this.cursor += 4;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(11);
    this.doc.setTextColor(pdfColor.text);
    this.doc.text(title, pdfLayout.margin, this.cursor + 3.5);
    const titleWidth = this.doc.getTextWidth(title);
    if (band === null) {
      this.chip("Skipped", pdfLayout.margin + titleWidth + 4, this.cursor, {
        main: pdfColor.textSubtle,
        soft: pdfColor.surfaceMuted,
      });
    } else {
      this.chip(bandMeta(band).label, pdfLayout.margin + titleWidth + 4, this.cursor, bandInk[band]);
    }
    this.cursor += 4;
    if (note !== "") {
      this.text(noteWrap.lines, pdfLayout.margin, 9.5, pdfColor.textMuted);
    }
    return this;
  }

  paragraph(content: string, color: string = pdfColor.text): this {
    const wrapped = this.wrap(content, pdfLayout.contentWidth, 9.5);
    this.ensure(wrapped.height + 2);
    this.cursor += 1;
    this.text(wrapped.lines, pdfLayout.margin, 9.5, color);
    return this;
  }

  quoteRow(prompt: string, answer: string, quote: string | null): this {
    const promptWrap = this.wrap(prompt, pdfLayout.contentWidth - 5, 9);
    const detail = quote === null ? `${answer} (answered by tap)` : `${answer} - "${quote}"`;
    const detailWrap = this.wrap(detail, pdfLayout.contentWidth - 5, 9);
    const blockHeight = promptWrap.height + detailWrap.height + 4;
    this.ensure(blockHeight + 3);
    this.cursor += 3;
    this.doc.setFillColor(pdfColor.accentSoft);
    this.doc.rect(pdfLayout.margin, this.cursor, 1, blockHeight - 1, "F");
    const x = pdfLayout.margin + 4;
    this.text(promptWrap.lines, x, 9, pdfColor.textMuted);
    this.cursor += 0.5;
    this.text(detailWrap.lines, x, 9, pdfColor.text, quote === null ? "normal" : "italic");
    return this;
  }

  finish(disclaimer: string): Uint8Array {
    const pages = this.doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      this.doc.setPage(page);
      const y = pdfLayout.pageHeight - pdfLayout.footerHeight;
      this.doc.setDrawColor(pdfColor.border);
      this.doc.setLineWidth(0.25);
      this.doc.line(pdfLayout.margin, y, pdfLayout.pageWidth - pdfLayout.margin, y);
      this.doc.setFont("helvetica", "italic");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(pdfColor.textSubtle);
      this.doc.text(disclaimer, pdfLayout.margin, y + 5, {
        maxWidth: pdfLayout.contentWidth - 26,
      });
      this.doc.setFont("helvetica", "normal");
      this.doc.text(`Page ${page} of ${pages}`, pdfLayout.pageWidth - pdfLayout.margin, y + 5, {
        align: "right",
      });
    }
    return new Uint8Array(this.doc.output("arraybuffer"));
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function pdfCreationDateWithOffset(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;
  return [
    "D:",
    shifted.getUTCFullYear(),
    pad2(shifted.getUTCMonth() + 1),
    pad2(shifted.getUTCDate()),
    pad2(shifted.getUTCHours()),
    pad2(shifted.getUTCMinutes()),
    pad2(shifted.getUTCSeconds()),
    sign,
    pad2(offsetHours),
    "'",
    pad2(offsetRemainderMinutes),
    "'",
  ].join("");
}
