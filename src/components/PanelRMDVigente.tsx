"use client";

import { VisorPdf, type SaltoPdf } from "./VisorPdf";

interface Props {
  pdfUrl: string;
  salto: SaltoPdf | null;
}

export function PanelRMDVigente({ pdfUrl, salto }: Props) {
  return (
    <div className="h-full min-h-0 border-r border-line">
      <VisorPdf pdfUrl={pdfUrl} salto={salto} />
    </div>
  );
}
