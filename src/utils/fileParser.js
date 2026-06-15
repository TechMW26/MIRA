// Lazy-load heavy parsers only when needed
import JSZip from 'jszip';

function cleanExtractedText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const mammothModule = await import('mammoth/mammoth.browser');
  const mammoth = mammothModule.default || mammothModule;
  const arrayBuffer = await file.arrayBuffer();
  let rawText = '';

  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = result.value || '';
  } catch (error) {
    console.warn('Mammoth DOCX extraction failed:', error);
  }

  const xmlText = await extractDOCXXmlText(arrayBuffer);
  const bestText = xmlText.length > rawText.length ? xmlText : rawText;
  return cleanExtractedText(bestText);
}

async function extractDOCXXmlText(arrayBuffer) {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlPaths = Object.keys(zip.files)
      .filter((path) => /^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(path))
      .sort((a, b) => {
        if (a === 'word/document.xml') return -1;
        if (b === 'word/document.xml') return 1;
        return a.localeCompare(b);
      });

    const sections = [];
    for (const path of xmlPaths) {
      const fileEntry = zip.file(path);
      if (!fileEntry) continue;
      const xml = await fileEntry.async('text');
      const text = cleanExtractedText(wordXmlToText(xml));
      if (text) sections.push(text);
    }
    return cleanExtractedText(sections.join('\n\n'));
  } catch (error) {
    console.warn('DOCX XML fallback extraction failed:', error);
    return '';
  }
}

function wordXmlToText(xml) {
  if (!xml || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) return '';

  const parts = [];

  function walk(node) {
    if (!node || node.nodeType !== 1) return;
    const name = node.localName;

    if (name === 't') {
      parts.push(node.textContent || '');
      return;
    }

    if (name === 'tab') {
      parts.push('\t');
      return;
    }

    if (name === 'br' || name === 'cr') {
      parts.push('\n');
      return;
    }

    Array.from(node.childNodes || []).forEach(walk);

    if (name === 'tc') parts.push('\t');
    if (name === 'p' || name === 'tr') parts.push('\n');
  }

  walk(doc.documentElement);
  return cleanExtractedText(parts.join(''));
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
