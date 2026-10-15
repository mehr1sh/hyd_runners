import { extractText, getDocumentProxy } from "unpdf";

/** Maximum pages read from a timetable PDF; longer documents are unlikely to be a weekly timetable. */
export const MAX_PDF_PAGES = 20;

/** Text layer of a PDF, one line per text row. Throws when the file cannot be opened. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // unpdf/pdf.js may transfer the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text.join("\n");
  } finally {
    await pdf.cleanup();
  }
}
