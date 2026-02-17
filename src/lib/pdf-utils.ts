import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface PdfAnnotation {
  id: string;
  type: "text" | "rect";
  page: number; // 1-based index
  x: number;
  y: number;
  text?: string;
  width?: number;
  height?: number;
  color?: string;
}

export async function modifyPdf(
  file: File, 
  annotations: PdfAnnotation[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    if (ann.page > pages.length) continue;
    const page = pages[ann.page - 1];
    const { height } = page.getSize();

    // NOTE: PDF coordinates start at bottom-left. 
    // Browser DOM coordinates start at top-left.
    // We must flip the Y axis: pdfY = height - domY.

    if (ann.type === "text" && ann.text) {
      page.drawText(ann.text, {
        x: ann.x,
        y: height - ann.y, 
        size: 12,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
    }
  }

  return await pdfDoc.save();
}
