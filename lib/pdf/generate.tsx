import { pdf } from "@react-pdf/renderer";
import { CVDocument, CoverLetterDocument } from "../cvDocument";
import { CVPdf } from "./CVPdf";
import { CoverLetterPdf } from "./CoverLetterPdf";

export async function generateCVPdfBlob(doc: CVDocument): Promise<Blob> {
  return pdf(<CVPdf doc={doc} />).toBlob();
}

export async function generateCoverLetterPdfBlob(doc: CoverLetterDocument): Promise<Blob> {
  return pdf(<CoverLetterPdf doc={doc} />).toBlob();
}
