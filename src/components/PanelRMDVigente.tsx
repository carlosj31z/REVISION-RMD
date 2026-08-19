"use client";

import { VisorPdf, type SaltoPdf } from "./VisorPdf";

interface Props {
  pdfUrl: string;
  salto: SaltoPdf | null;
  onBlobInvalido?: () => void;
  archivo?: File;
}

export function PanelRMDVigente({ pdfUrl, salto, onBlobInvalido, archivo }: Props) {
  return (
    <div className="h-full min-h-0 border-r border-line">
      <VisorPdf pdfUrl={pdfUrl} salto={salto} onBlobInvalido={onBlobInvalido} archivo={archivo} />
    </div>
  );
}
