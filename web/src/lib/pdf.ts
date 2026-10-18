// Turns the on-screen report into a real PDF file the owner can send on WhatsApp. The page is drawn by the browser
// (so Hindi and Telugu look exactly as on screen), then cut into A4 pages. The libraries load only when needed.

export async function reportPdf(el: HTMLElement, filename: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: Math.max(el.scrollWidth, 900) });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const imgW = pageW - margin * 2;
  const pxPerMm = canvas.width / imgW;
  const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);
  for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
    const h = Math.min(sliceH, canvas.height - y);
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = h;
    part.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerMm);
  }
  return new File([pdf.output('blob')], filename, { type: 'application/pdf' });
}

/** Opens the phone's share sheet with the PDF attached (WhatsApp is listed there); false when the browser cannot share files. */
export async function sharePdf(file: File, title: string, text: string): Promise<boolean> {
  // Any browser that can share files (phones, and Chrome or Edge on Windows with WhatsApp installed) shows its share sheet with the PDF attached.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title, text });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return true; // the owner closed the share sheet
    return false;
  }
}

export function downloadFileBlob(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
