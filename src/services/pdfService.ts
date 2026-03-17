import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source for pdfjs using Vite's ?url import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractTextFromPdfWithPassword(base64Pdf: string, password?: string): Promise<string> {
  try {
    const binaryString = atob(base64Pdf);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      password: password
    });

    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => (item as any).str)
        .join(' ');
      fullText += pageText + '\n';
    }

    await pdf.destroy();
    return fullText;
  } catch (error: any) {
    if (error.name === 'PasswordException' || (error.name === 'UnknownErrorException' && error.message.includes('password'))) {
      throw new Error('PDF_ENCRYPTED_OR_INVALID_PASSWORD');
    }
    throw error;
  }
}

export async function isPdfEncrypted(base64Pdf: string): Promise<boolean> {
  try {
    const binaryString = atob(base64Pdf);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    await pdf.destroy();
    return false;
  } catch (error: any) {
    // PasswordException is the standard name for encrypted PDFs in PDF.js
    if (error.name === 'PasswordException' || error.message?.toLowerCase().includes('password')) {
      return true;
    }
    console.error("PDF.js error in isPdfEncrypted:", error);
    return false;
  }
}
