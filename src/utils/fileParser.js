// Lazy-load heavy parsers only when needed

async function extractPDF(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    pages.push(`[Page ${i}]\n${pageText}`);
  }

  return pages.join('\n\n');
}

async function extractDOCX(file) {
  const mammoth = await import('mammoth/mammoth.browser');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

const TEXT_EXTS = ['txt','md','csv','log','json','xml','yaml','yml','js','jsx','ts','tsx','py','java','c','cpp','h','hpp','html','css','scss','svg','sh','bash','rs','go','rb','php','sql','toml','ini','env'];
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript'];

export async function extractFileText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || '';

  if (ext === 'pdf' || mime === 'application/pdf') {
    return extractPDF(file);
  }

  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDOCX(file);
  }

  const isText = TEXT_MIME_PREFIXES.some(p => mime.startsWith(p)) || TEXT_EXTS.includes(ext);
  if (isText) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(`[Could not read ${file.name}]`);
      reader.readAsText(file);
    });
  }

  return null; // binary file with no text extraction
}

export function isExtractableFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || '';
  return (
    ext === 'pdf' ||
    ext === 'docx' ||
    TEXT_EXTS.includes(ext) ||
    TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))
  );
}
