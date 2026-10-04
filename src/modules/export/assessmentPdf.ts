import type { AssessmentSession } from "../assessment/types";
import { PdfDoc } from "./PdfDoc";
import { buildReportModel } from "./reportModel";

/**
 * Builds the PDF report bytes for an AssessmentSession.
 * Returns Uint8Array suitable for savePdf.
 */
export async function buildAssessmentPdf(
  session: AssessmentSession,
): Promise<Uint8Array> {
  const model = buildReportModel(session);
  const doc = new PdfDoc({
    title: model.title,
    subject: `Elderwise Check-in: ${model.participantLine}`,
  });

  doc.brandHeader(model.title, [model.date, model.participantLine]);

  // Overall status notice
  doc.domainRow("Overall Status", model.overallBand, `Overall check-in band is ${model.overallBandLabel}.`);

  if (model.summaryText) {
    doc.section("Assessment Summary");
    doc.paragraph(model.summaryText);
  }

  for (const sec of model.sections) {
    doc.section(sec.title);
    if (sec.band) {
      doc.domainRow("Domain Status", sec.band, "");
    }
    for (const row of sec.rows) {
      doc.quoteRow(row.label, row.value, row.note ?? null);
    }
  }

  return doc.finish(model.disclaimer);
}
