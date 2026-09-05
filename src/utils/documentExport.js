import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak, Header, Footer, PageNumber, ShadingType, ImageRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { marked } from 'marked';
import { sanitizeDocumentContent } from './documentContent.js';

export { detectDocumentRequest, sanitizeDocumentContent } from './documentContent.js';

// Professional Design System
const DESIGN = {
  colors: {
    primary: '#2563eb',
    secondary: '#7c3aed',
    accent: '#8b5cf6',
    dark: '#1e293b',
    text: '#334155',
    lightText: '#64748b',
    border: '#e2e8f0',
    background: '#f8fafc',
    codeBackground: '#f1f5f9',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
  fonts: {
    heading: 'Helvetica',
    body: 'Helvetica',
    code: 'Courier',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
};

function cleanInlineText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ──────────────────────────────────────────────
// Image / Diagram helpers (shared by PDF/DOCX/PPTX)
// ──────────────────────────────────────────────

let _mermaidLibPromise = null;
async function loadMermaid() {
  if (!_mermaidLibPromise) {
    _mermaidLibPromise = import('mermaid').then((mod) => {
      const m = mod.default || mod;
      try {
        m.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'Helvetica, Arial, sans-serif',
        });
      } catch {}
      return m;
    });
  }
  return _mermaidLibPromise;
}

export async function loadImageAsDataUrl(src) {
  if (!src) return null;
  if (typeof src !== 'string') return null;
  if (src.startsWith('data:image/')) return src;

  const readBlob = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // 1. Try direct browser fetch (works for permissive CORS hosts).
  try {
    const res = await fetch(src, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) return await readBlob(blob);
    }
  } catch {}

  // 2. Fall back to our server-side image proxy (bypasses CORS).
  try {
    const proxied = `/api/image?url=${encodeURIComponent(src)}`;
    const res = await fetch(proxied, { cache: 'no-store' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) return await readBlob(blob);
    }
  } catch {}

  return null;
}

async function rasterizeSvgToPng(svgString, scale = 2) {
  let svg = svgString;
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Mermaid often emits SVGs with only viewBox + style "max-width". Browsers
  // then load the <img> with 0x0 intrinsic size, causing rasterization to fail.
  // Force explicit width/height attributes derived from the viewBox.
  const viewBoxMatch = svg.match(/viewBox="([\d.\-\s]+)"/);
  let vbW = 0, vbH = 0;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      vbW = Math.max(1, parts[2]);
      vbH = Math.max(1, parts[3]);
    }
  }
  if (vbW && vbH) {
    // Replace any existing width/height to remove "100%" / "max-width" styles.
    svg = svg.replace(/\s(width|height)="[^"]*"/g, '');
    svg = svg.replace(/<svg/, `<svg width="${Math.round(vbW)}" height="${Math.round(vbH)}"`);
    // Strip max-width style that some mermaid themes inject inline.
    svg = svg.replace(/style="[^"]*max-width:\s*[^;"]*;?[^"]*"/g, (m) =>
      m.replace(/max-width:\s*[^;"]*;?/g, '')
    );
  }

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const baseW = img.width || img.naturalWidth || vbW || 800;
  const baseH = img.height || img.naturalHeight || vbH || 600;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(baseW * scale));
  canvas.height = Math.max(1, Math.floor(baseH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function renderMermaidToDataUrl(code) {
  if (!code || !code.trim()) return null;
  const cleaned = code.trim();
  try {
    const mermaid = await loadMermaid();
    if (typeof mermaid.parse === 'function') {
      try { await mermaid.parse(cleaned); }
      catch (parseErr) {
        console.warn('Mermaid parse error:', parseErr?.message || parseErr, '\nSource:\n', cleaned);
        return null;
      }
    }
    const id = `mira-mmd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = await mermaid.render(id, cleaned);
    const svg = typeof result === 'string' ? result : result?.svg;
    if (!svg) return null;
    return await rasterizeSvgToPng(svg, 2);
  } catch (err) {
    console.warn('Mermaid render failed:', err?.message || err, '\nSource:\n', cleaned);
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl) {
  const match = /^data:image\/([a-zA-Z0-9.+-]+)/.exec(dataUrl || '');
  const raw = (match ? match[1] : 'png').toLowerCase();
  if (raw === 'jpg' || raw === 'jpeg') return 'JPEG';
  if (raw === 'webp') return 'WEBP';
  if (raw === 'gif') return 'GIF';
  return 'PNG';
}

function dataUrlToUint8Array(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const base64 = dataUrl.slice(commaIdx + 1);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function dataUrlForPptx(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  return dataUrl.replace(/^data:/i, '');
}

async function getImageDimensions(dataUrl) {
  if (!dataUrl) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = dataUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return null;
    return { width, height, ratio: height / width };
  } catch {
    return null;
  }
}

function fitMediaBox({ x, y, w, h }, dimensions, mode = 'contain') {
  if (!dimensions?.width || !dimensions?.height) return { x, y, w, h };
  const mediaRatio = dimensions.width / dimensions.height;
  const boxRatio = w / h;

  if (mode === 'cover') {
    const coverW = mediaRatio > boxRatio ? h * mediaRatio : w;
    const coverH = mediaRatio > boxRatio ? h : w / mediaRatio;
    return { x: x + (w - coverW) / 2, y: y + (h - coverH) / 2, w: coverW, h: coverH };
  }

  const fittedW = mediaRatio > boxRatio ? w : h * mediaRatio;
  const fittedH = mediaRatio > boxRatio ? w / mediaRatio : h;
  return { x: x + (w - fittedW) / 2, y: y + (h - fittedH) / 2, w: fittedW, h: fittedH };
}

function docxImageType(dataUrl) {
  const fmt = imageFormatFromDataUrl(dataUrl).toLowerCase();
  if (fmt === 'jpeg') return 'jpg';
  if (fmt === 'webp') return 'png'; // docx doesn't list webp; png is closest neutral
  return fmt;
}

async function fetchMediaForSection(section) {
  if (section.type === 'mermaid') {
    return await renderMermaidToDataUrl(section.content);
  }
  if (section.type === 'image') {
    return await loadImageAsDataUrl(section.src);
  }
  return null;
}

function getTokenText(token) {
  if (typeof token === 'string') return token;
  return token?.text || token?.raw || '';
}

function looksLikePlainHeading(text, sectionCount) {
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length > 110 || words.length > 14) return false;
  if (/[.!?]$/.test(text)) return false;
  if (sectionCount === 0) return true;
  if (/[:;]\s+/.test(text)) return false;
  return words.length <= 8;
}

// Advanced Markdown Parser with Enhanced Features
function parseMarkdownAdvanced(content) {
  const tokens = marked.lexer(content || '');
  const sections = [];

  const pushTextBlock = (rawText) => {
    const parts = String(rawText || '').split(/\n+/).map(cleanInlineText).filter(Boolean);
    for (const text of parts) {
      if (looksLikePlainHeading(text, sections.length)) {
        const depth = sections.length === 0 ? 1 : 2;
        sections.push({
          type: `heading${depth}`,
          content: text,
          level: depth,
          id: text.toLowerCase().replace(/[^\w]+/g, '-'),
        });
      } else {
        sections.push({
          type: 'paragraph',
          content: text,
          formatting: { bold: /\*\*|__/.test(rawText), italic: /(^|[^*])\*[^*]/.test(rawText), hasLink: /\[[^\]]+\]\([^)]+\)/.test(rawText) },
        });
      }
    }
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        sections.push({
          type: `heading${token.depth}`,
          content: cleanInlineText(token.text),
          level: token.depth,
          id: token.text.toLowerCase().replace(/[^\w]+/g, '-'),
        });
        break;

      case 'paragraph': {
        const raw = String(token.raw || token.text || '').trim();
        // Detect standalone image lines: ![alt](src "title")
        const standalone = raw.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/);
        if (standalone) {
          sections.push({
            type: 'image',
            src: standalone[2],
            alt: standalone[1] || '',
            title: standalone[3] || '',
          });
          break;
        }
        // Extract inline images and emit them as separate image sections
        const inlineTokens = Array.isArray(token.tokens) ? token.tokens : [];
        const inlineImages = inlineTokens.filter((t) => t && t.type === 'image');
        if (inlineImages.length) {
          const remaining = cleanInlineText(token.text || raw);
          if (remaining) pushTextBlock(remaining);
          inlineImages.forEach((img) => {
            sections.push({
              type: 'image',
              src: img.href,
              alt: img.text || '',
              title: img.title || '',
            });
          });
          break;
        }
        pushTextBlock(token.text || token.raw || '');
        break;
      }

      case 'list':
        sections.push({
          type: token.ordered ? 'ordered-list' : 'bullet-list',
          items: token.items.map(item => ({
            text: cleanInlineText(item.text),
            checked: item.checked,
          })),
        });
        break;

      case 'code': {
        const lang = (token.lang || '').toLowerCase();
        if (lang === 'mermaid') {
          sections.push({ type: 'mermaid', content: token.text || '' });
        } else {
          sections.push({
            type: 'code',
            content: token.text,
            language: token.lang || 'text',
          });
        }
        break;
      }

      case 'blockquote':
        sections.push({
          type: 'blockquote',
          content: cleanInlineText(token.text),
        });
        break;

      case 'table':
        sections.push({
          type: 'table',
          header: token.header.map(h => cleanInlineText(getTokenText(h))),
          rows: token.rows.map(row => row.map(cell => cleanInlineText(getTokenText(cell)))),
          align: token.align,
        });
        break;

      case 'hr':
        sections.push({ type: 'divider' });
        break;

      case 'space':
        sections.push({ type: 'space' });
        break;

      case 'image':
        sections.push({
          type: 'image',
          src: token.href,
          alt: token.text || '',
          title: token.title || '',
        });
        break;
    }
  }

  return sections;
}

// Get current document style from localStorage
function getCurrentStyle() {
  const styleKey = localStorage.getItem('mira_document_style') || 'professional';
  const styles = {
    professional: { primary: [37, 99, 235], secondary: [30, 64, 175], accent: [59, 130, 246] },
    modern: { primary: [139, 92, 246], secondary: [124, 58, 237], accent: [167, 139, 250] },
    minimal: { primary: [0, 0, 0], secondary: [55, 65, 81], accent: [107, 114, 128] },
    elegant: { primary: [146, 64, 14], secondary: [120, 53, 15], accent: [217, 119, 6] },
    creative: { primary: [236, 72, 153], secondary: [219, 39, 119], accent: [244, 114, 182] },
    academic: { primary: [30, 58, 138], secondary: [30, 64, 175], accent: [59, 130, 246] },
  };
  return styles[styleKey] || styles.professional;
}

function getGeneratedDate() {
  return new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function rgbToHex(rgb) {
  return rgb.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function titleFromFilename(filename = '') {
  const base = filename.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Document';
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getDocumentMeta(sections, filename) {
  const titleSource = sections.find((section) => section.type === 'heading1')
    || sections.find((section) => section.type === 'heading2')
    || sections.find((section) => section.type === 'paragraph');
  const title = cleanInlineText(titleSource?.content) || titleFromFilename(filename);
  const subtitleSource = sections.find((section) => section.content && section.content !== title && section.content.length <= 120);
  const subtitle = subtitleSource?.content && subtitleSource.content !== title ? cleanInlineText(subtitleSource.content) : '';
  return { title, subtitle };
}

function getRenderableSections(sections, meta) {
  let skippedTitle = false;
  let skippedSubtitle = false;
  return sections.filter((section) => {
    if (!skippedTitle && section.content === meta.title && ['heading1', 'heading2', 'paragraph'].includes(section.type)) {
      skippedTitle = true;
      return false;
    }
    if (meta.subtitle && !skippedSubtitle && section.content === meta.subtitle && ['heading1', 'heading2', 'paragraph'].includes(section.type)) {
      skippedSubtitle = true;
      return false;
    }
    return section.type !== 'space';
  });
}

function countWords(text = '') {
  const cleaned = cleanInlineText(text);
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

function getDocumentProfile(sections) {
  const stats = {
    headings: 0,
    paragraphs: 0,
    lists: 0,
    tables: 0,
    code: 0,
    visuals: 0,
    words: 0,
  };

  for (const section of sections) {
    if (/^heading/.test(section.type)) stats.headings += 1;
    if (section.type === 'paragraph' || section.type === 'blockquote') stats.paragraphs += 1;
    if (section.type === 'bullet-list' || section.type === 'ordered-list') {
      stats.lists += 1;
      stats.words += section.items.reduce((sum, item) => sum + countWords(item.text), 0);
    }
    if (section.type === 'table') {
      stats.tables += 1;
      stats.words += [...section.header, ...section.rows.flat()].reduce((sum, cell) => sum + countWords(cell), 0);
    }
    if (section.type === 'code') stats.code += 1;
    if (section.type === 'image' || section.type === 'mermaid') stats.visuals += 1;
    if (section.content) stats.words += countWords(section.content);
  }

  let kind = 'editorial';
  if (stats.code >= 2 || (stats.code >= 1 && stats.words < 900)) kind = 'technical';
  else if (stats.tables >= 2 || (stats.tables >= 1 && stats.lists >= 2)) kind = 'analytical';
  else if (stats.visuals >= 2 || (stats.visuals >= 1 && stats.paragraphs <= 3)) kind = 'visual';
  else if (stats.lists >= 3 && stats.paragraphs <= stats.lists + 1) kind = 'briefing';
  else if (stats.headings >= 5 || stats.words > 1100) kind = 'report';

  const density = stats.words > 1200 ? 'longform' : stats.words > 520 ? 'standard' : 'compact';
  return { kind, density, stats };
}

function getDocumentRecipe(profile, style) {
  const primary = rgbToHex(style.primary);
  const accent = rgbToHex(style.accent);
  const recipes = {
    technical: {
      cover: 'technical',
      section: 'terminal',
      slide: 'split',
      titleSize: 36,
      primary,
      accent,
      dark: '0F172A',
      soft: 'F1F5F9',
    },
    analytical: {
      cover: 'data',
      section: 'ruled',
      slide: 'dashboard',
      titleSize: 38,
      primary,
      accent,
      dark: '111827',
      soft: 'F8FAFC',
    },
    visual: {
      cover: 'gallery',
      section: 'gallery',
      slide: 'canvas',
      titleSize: 40,
      primary,
      accent,
      dark: '111827',
      soft: 'F8FAFC',
    },
    briefing: {
      cover: 'briefing',
      section: 'cards',
      slide: 'cards',
      titleSize: 38,
      primary,
      accent,
      dark: '0F172A',
      soft: 'F8FAFC',
    },
    report: {
      cover: 'report',
      section: 'chapter',
      slide: 'report',
      titleSize: 36,
      primary,
      accent,
      dark: '0F172A',
      soft: 'F8FAFC',
    },
    editorial: {
      cover: 'editorial',
      section: 'editorial',
      slide: 'editorial',
      titleSize: 40,
      primary,
      accent,
      dark: '0F172A',
      soft: 'F8FAFC',
    },
  };
  return recipes[profile.kind] || recipes.editorial;
}

// ==================== PROFESSIONAL PDF GENERATION ====================
export async function generatePDF(content, filename = 'document.pdf') {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const sections = parseMarkdownAdvanced(sanitizeDocumentContent(content));
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 18;
  const contentWidth = pageWidth - 2 * margin;
  const style = getCurrentStyle();
  const meta = getDocumentMeta(sections, filename);
  const renderSections = getRenderableSections(sections, meta);
  const generatedDate = getGeneratedDate();
  const profile = getDocumentProfile(renderSections);
  const recipe = getDocumentRecipe(profile, style);
  let y = 34;

  doc.setProperties({
    title: meta.title,
    subject: meta.subtitle || meta.title,
  });

  const setFill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  const drawCover = () => {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    if (recipe.cover === 'technical') {
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.15);
      for (let gx = 0; gx <= pageWidth; gx += 14) doc.line(gx, 0, gx, pageHeight);
      for (let gy = 0; gy <= pageHeight; gy += 14) doc.line(0, gy, pageWidth, gy);
      setFill(style.accent);
      doc.roundedRect(margin, 44, 28, 3, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(32);
      doc.setTextColor(248, 250, 252);
      const titleLines = doc.splitTextToSize(meta.title, contentWidth - 10);
      doc.text(titleLines, margin, 86);
      if (meta.subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12.5);
        doc.setTextColor(203, 213, 225);
        doc.text(doc.splitTextToSize(meta.subtitle, contentWidth - 20), margin, 86 + titleLines.length * 11 + 8);
      }
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(`${profile.stats.code} code block${profile.stats.code === 1 ? '' : 's'}  /  ${profile.stats.words} words`, margin, pageHeight - 23);
      doc.text(generatedDate, margin, pageHeight - 15);
      return;
    }

    if (recipe.cover === 'data') {
      setFill(style.primary);
      doc.rect(0, 0, pageWidth, 42, 'F');
      setFill(style.accent);
      doc.rect(0, 42, pageWidth, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(30);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(meta.title, contentWidth), margin, 83);
      if (meta.subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(71, 85, 105);
        doc.text(doc.splitTextToSize(meta.subtitle, contentWidth), margin, 108);
      }
      const metrics = [
        ['Sections', profile.stats.headings || 1],
        ['Tables', profile.stats.tables],
        ['Visuals', profile.stats.visuals],
      ];
      metrics.forEach(([label, value], idx) => {
        const x = margin + idx * 50;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, 148, 42, 26, 3, 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        setText(style.primary);
        doc.text(String(value), x + 5, 161);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text(label, x + 5, 169);
      });
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(generatedDate, margin, pageHeight - 14);
      return;
    }

    if (recipe.cover === 'gallery') {
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      setFill(style.primary);
      doc.roundedRect(pageWidth - 68, 28, 48, 82, 8, 8, 'F');
      setFill(style.accent);
      doc.roundedRect(pageWidth - 96, 78, 62, 88, 8, 8, 'F');
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(pageWidth - 78, 116, 44, 62, 8, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(34);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(meta.title, contentWidth - 34), margin, 72);
      if (meta.subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12.5);
        doc.setTextColor(71, 85, 105);
        doc.text(doc.splitTextToSize(meta.subtitle, contentWidth - 48), margin, 112);
      }
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(generatedDate, margin, pageHeight - 14);
      return;
    }

    if (recipe.cover === 'briefing') {
      setFill(style.accent);
      doc.rect(0, 0, 8, pageHeight, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(38);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(meta.title, contentWidth - 10), margin, 82);
      if (meta.subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(13);
        doc.setTextColor(71, 85, 105);
        doc.text(doc.splitTextToSize(meta.subtitle, contentWidth - 10), margin, 124);
      }
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, 164, contentWidth, 30, 4, 4, 'F');
      setText(style.primary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('BRIEFING DOCUMENT', margin + 7, 176);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.text(`${profile.stats.lists} list groups  /  ${profile.stats.headings || 1} sections`, margin + 7, 186);
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(generatedDate, margin, pageHeight - 14);
      return;
    }

    setFill(style.primary);
    doc.rect(0, 0, pageWidth, recipe.cover === 'report' ? 9 : 3, 'F');
    setFill(style.accent);
    doc.rect(margin, pageHeight / 2 - 40, recipe.cover === 'report' ? 2.4 : 1.2, 80, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(recipe.cover === 'report' ? 30 : 34);
    doc.setTextColor(15, 23, 42);
    const titleLines = doc.splitTextToSize(meta.title, contentWidth - 14);
    const titleY = pageHeight / 2 - 24;
    doc.text(titleLines, margin + 8, titleY);
    let cursorY = titleY + titleLines.length * 11 + 6;
    if (meta.subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(13);
      doc.setTextColor(71, 85, 105);
      const subtitleLines = doc.splitTextToSize(meta.subtitle, contentWidth - 14);
      doc.text(subtitleLines, margin + 8, cursorY);
      cursorY += subtitleLines.length * 6.5;
    }
    void cursorY;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(generatedDate, margin, pageHeight - 14);
  };

  const drawPageChrome = (pageIndex, totalPages) => {
    if (pageIndex === 1) return;
    doc.setPage(pageIndex);

    // Minimal running header: just the document title, lightweight
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(meta.title.slice(0, 90), margin, 11);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, 14, pageWidth - margin, 14);

    // Footer: page number only, right-aligned. No branding line.
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${pageIndex - 1} / ${Math.max(totalPages - 1, 1)}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
  };

  const checkPageBreak = (requiredSpace) => {
    if (y + requiredSpace > pageHeight - 30) {
      doc.addPage();
      y = 34;
      return true;
    }
    return false;
  };

  const renderWrappedText = (lines, x, lineHeight, options = {}) => {
    for (const line of lines) {
      checkPageBreak(lineHeight + 4);
      doc.text(line, x, y, options);
      y += lineHeight;
    }
  };

  drawCover();
  doc.addPage();
  y = 34;

  if (renderSections.length === 0) {
    renderSections.push({ type: 'paragraph', content: 'No document content was available to export.' });
  }

  let chapterNumber = 0;

  for (const section of renderSections) {

    if (section.type === 'heading1') {
      chapterNumber += 1;
      checkPageBreak(24);
      const lines = doc.splitTextToSize(section.content, contentWidth - 18);

      if (recipe.section === 'terminal') {
        const boxHeight = Math.max(24, lines.length * 8 + 16);
        doc.setFillColor(15, 23, 42);
        doc.roundedRect(margin, y - 8, contentWidth, boxHeight, 3, 3, 'F');
        setFill(style.accent);
        doc.circle(margin + 8, y, 1.6, 'F');
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(248, 250, 252);
        doc.text(lines, margin + 16, y + 3);
        y += boxHeight + 8;
      } else if (recipe.section === 'ruled') {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        setText(style.primary);
        doc.text(String(chapterNumber).padStart(2, '0'), margin, y - 2);
        setDraw(style.accent);
        doc.setLineWidth(0.8);
        doc.line(margin + 12, y - 4, pageWidth - margin, y - 4);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(17, 24, 39);
        doc.text(lines, margin, y + 8);
        y += Math.max(24, lines.length * 8 + 12);
      } else if (recipe.section === 'gallery') {
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(margin, y - 8, contentWidth, 26, 5, 5, 'F');
        setFill(style.primary);
        doc.roundedRect(pageWidth - margin - 36, y - 8, 36, 26, 5, 5, 'F');
        doc.setFontSize(17);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(lines, margin + 8, y + 5);
        y += Math.max(30, lines.length * 8 + 16);
      } else if (recipe.section === 'cards') {
        setFill(style.accent);
        doc.roundedRect(margin, y - 7, 9, 9, 2, 2, 'F');
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(String(chapterNumber), margin + 4.5, y - 0.8, { align: 'center' });
        doc.setFontSize(18);
        doc.setTextColor(15, 23, 42);
        doc.text(lines, margin + 14, y);
        y += Math.max(22, lines.length * 8 + 10);
      } else {
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(margin, y - 8, contentWidth, 20, 3, 3, 'F');
        setFill(style.accent);
        doc.roundedRect(margin, y - 8, 4, 20, 2, 2, 'F');
        doc.setFontSize(17);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(lines, margin + 10, y + 4);
        y += Math.max(24, lines.length * 8 + 14);
      }

    } else if (section.type === 'heading2') {
      checkPageBreak(17);
      setDraw(style.accent);
      doc.setLineWidth(1.2);
      doc.line(margin, y - 2, margin + 16, y - 2);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y + 5);
      y += lines.length * 7 + 9;

    } else if (section.type === 'heading3') {
      checkPageBreak(13);
      doc.setFontSize(11.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y + 3);
      y += lines.length * 6 + 6;

    } else if (section.type === 'paragraph') {
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(section.content, contentWidth);
      renderWrappedText(lines, margin, 5.8);
      y += 3;

    } else if (section.type === 'bullet-list' || section.type === 'ordered-list') {
      section.items.forEach((item, idx) => {
        checkPageBreak(9);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        const bullet = section.type === 'ordered-list' ? `${idx + 1}.` : '';
        const lines = doc.splitTextToSize(item.text, contentWidth - 10);
        if (section.type === 'ordered-list') {
          doc.setFont('helvetica', 'bold');
          setText(style.primary);
          doc.text(bullet, margin + 1, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
        } else {
          setFill(style.accent);
          doc.circle(margin + 3, y - 1.2, 1.5, 'F');
        }
        doc.text(lines, margin + 10, y);
        y += lines.length * 5.8 + 4;
      });
      y += 2;

    } else if (section.type === 'code') {
      const codeLines = section.content.split('\n');
      const boxHeight = Math.min(codeLines.length * 4.8 + 14, 102);
      checkPageBreak(boxHeight + 5);
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, y - 3, contentWidth, boxHeight, 3, 3, 'F');
      if (section.language && section.language !== 'text') {
        setFill(style.accent);
        doc.roundedRect(margin + 5, y + 2, 28, 6, 2, 2, 'F');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(section.language.toUpperCase().slice(0, 10), margin + 7, y + 6.4);
      }
      doc.setFontSize(9);
      doc.setFont('courier', 'normal');
      doc.setTextColor(226, 232, 240);
      const displayLines = codeLines.slice(0, Math.floor((boxHeight - 12) / 4.8));
      displayLines.forEach((line, idx) => {
        doc.text(line.substring(0, 105), margin + 6, y + 15 + idx * 4.8);
      });
      y += boxHeight + 8;

    } else if (section.type === 'blockquote') {
      const lines = doc.splitTextToSize(section.content, contentWidth - 16);
      const boxHeight = lines.length * 5.8 + 12;
      checkPageBreak(boxHeight);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y - 4, contentWidth, boxHeight, 3, 3, 'F');
      setFill(style.accent);
      doc.rect(margin, y - 4, 3, boxHeight, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      doc.text(lines, margin + 9, y + 4);
      y += boxHeight + 6;

    } else if (section.type === 'table') {
      checkPageBreak(30);
      doc.autoTable({
        startY: y,
        head: [section.header],
        body: section.rows,
        theme: 'striped',
        headStyles: {
          fillColor: style.primary,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 10,
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          fontSize: 10,
          cellPadding: 3,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        styles: { lineColor: [226, 232, 240], lineWidth: 0.1 },
        margin: { left: margin, right: margin, top: 32, bottom: 28 },
      });
      y = doc.lastAutoTable.finalY + 10;

    } else if (section.type === 'divider') {
      checkPageBreak(5);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;

    } else if (section.type === 'image' || section.type === 'mermaid') {
      const dataUrl = await fetchMediaForSection(section);
      if (dataUrl) {
        let imgW = contentWidth;
        let imgH = contentWidth * 0.6;
        try {
          const props = doc.getImageProperties(dataUrl);
          const pxToMm = 25.4 / 96;
          const naturalW = props.width * pxToMm;
          const naturalH = props.height * pxToMm;
          const ratio = props.height / props.width;
          imgW = Math.min(contentWidth, Math.max(60, naturalW));
          imgH = imgW * ratio;
          const maxH = pageHeight - 60;
          if (imgH > maxH) {
            imgH = maxH;
            imgW = imgH / ratio;
            if (imgW > contentWidth) {
              imgW = contentWidth;
              imgH = imgW * ratio;
            }
          }
          // Ignore unused vars
          void naturalH;
        } catch {}
        checkPageBreak(imgH + 14);
        const format = imageFormatFromDataUrl(dataUrl);
        const xPos = margin + (contentWidth - imgW) / 2;
        try {
          doc.addImage(dataUrl, format, xPos, y, imgW, imgH, undefined, 'FAST');
          y += imgH + 4;
        } catch (err) {
          console.warn('PDF addImage failed:', err);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(148, 163, 184);
          doc.text(section.type === 'mermaid' ? '[Diagram could not be embedded]' : '[Image could not be embedded]', margin, y);
          y += 8;
        }
        const caption = section.alt || section.title;
        if (caption) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(100, 116, 139);
          const capLines = doc.splitTextToSize(caption, contentWidth);
          capLines.forEach((line) => {
            checkPageBreak(5);
            doc.text(line, pageWidth / 2, y + 3, { align: 'center' });
            y += 4.5;
          });
          y += 4;
        } else {
          y += 4;
        }
      } else {
        const fallback = section.type === 'mermaid'
          ? '[Diagram could not be rendered]'
          : `[Image unavailable${section.alt ? `: ${section.alt}` : ''}]`;
        checkPageBreak(10);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(148, 163, 184);
        doc.text(fallback, margin, y);
        y += 8;
      }

    } else if (section.type === 'space') {
      y += 5;
    }
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    drawPageChrome(pageIndex, totalPages);
  }

  doc.save(filename);
}

// ==================== PROFESSIONAL DOCX GENERATION ====================
export async function generateDOCX(content, filename = 'document.docx') {
  const sections = parseMarkdownAdvanced(sanitizeDocumentContent(content));
  const meta = getDocumentMeta(sections, filename);
  const renderSections = getRenderableSections(sections, meta);
  const style = getCurrentStyle();
  const primary = rgbToHex(style.primary);
  const accent = rgbToHex(style.accent);
  const generatedDate = getGeneratedDate();
  const profile = getDocumentProfile(renderSections);
  const recipe = getDocumentRecipe(profile, style);
  const children = [];

  const darkCover = recipe.cover === 'technical';
  const coverParagraphs = [
    new Paragraph({
      children: [new TextRun({ text: meta.title, bold: true, color: darkCover ? 'FFFFFF' : '0F172A', size: recipe.cover === 'report' ? 48 : 52 })],
      shading: darkCover ? { type: ShadingType.SOLID, fill: '0F172A' } : undefined,
      border: darkCover
        ? { left: { color: accent, space: 1, style: BorderStyle.SINGLE, size: 36 } }
        : { top: { color: accent, space: 1, style: BorderStyle.SINGLE, size: 12 } },
      indent: darkCover ? { left: 240 } : undefined,
      spacing: { before: darkCover ? 360 : 480, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.subtitle || '', color: darkCover ? 'CBD5E1' : '475569', size: 26 })],
      shading: darkCover ? { type: ShadingType.SOLID, fill: '0F172A' } : undefined,
      indent: darkCover ? { left: 240 } : undefined,
      spacing: { after: 360 },
    }),
    new Paragraph({
      children: [new TextRun({ text: generatedDate, color: darkCover ? '94A3B8' : '94A3B8', size: 20 })],
      shading: darkCover ? { type: ShadingType.SOLID, fill: '0F172A' } : undefined,
      border: {
        top: { style: BorderStyle.SINGLE, size: 6, color: accent },
      },
      spacing: { before: 120, after: 900 },
    }),
  ];

  if (recipe.cover === 'data' || recipe.cover === 'briefing') {
    coverParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${profile.stats.headings || 1} sections`, bold: true, color: primary, size: 22 }),
          new TextRun({ text: `   ${profile.stats.tables} tables   ${profile.stats.visuals} visuals   ${profile.stats.lists} list groups`, color: '64748B', size: 22 }),
        ],
        shading: { type: ShadingType.SOLID, fill: 'F8FAFC' },
        spacing: { before: 120, after: 480 },
      })
    );
  }

  coverParagraphs.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(...coverParagraphs);

  const contentSections = renderSections.length
    ? renderSections
    : [{ type: 'paragraph', content: 'No document content was available to export.' }];

  for (const section of contentSections) {
    if (section.type === 'heading1') {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.content, bold: true, color: '0F172A', size: 34 })],
          heading: HeadingLevel.HEADING_1,
          shading: { type: ShadingType.SOLID, fill: 'F8FAFC' },
          indent: { left: 180 },
          spacing: { before: 480, after: 240 },
          border: {
            left: { color: accent, space: 1, style: BorderStyle.SINGLE, size: 28 },
          },
        })
      );

    } else if (section.type === 'heading2') {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.content, bold: true, color: '1E293B', size: 30 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 420, after: 180 },
          border: {
            bottom: { color: 'E2E8F0', space: 1, style: BorderStyle.SINGLE, size: 6 },
          },
        })
      );

    } else if (section.type === 'heading3') {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.content, bold: true, color: '334155', size: 24 })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 280, after: 140 },
        })
      );

    } else if (section.type === 'paragraph') {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.content,
              size: 24,
              color: '334155',
            }),
          ],
          spacing: { before: 120, after: 160, line: 320 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );

    } else if (section.type === 'bullet-list') {
      section.items.forEach((item) => {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: item.text, color: '334155', size: 23 })],
            bullet: { level: 0 },
            spacing: { before: 80, after: 80, line: 300 },
          })
        );
      });

    } else if (section.type === 'ordered-list') {
      section.items.forEach((item, idx) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${idx + 1}. `, bold: true, color: primary, size: 23 }),
              new TextRun({ text: item.text, color: '334155', size: 23 }),
            ],
            spacing: { before: 80, after: 80, line: 300 },
            indent: { left: 360 },
          })
        );
      });

    } else if (section.type === 'code') {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.content,
              font: 'Courier New',
              size: 20,
              color: 'E2E8F0',
            }),
          ],
          spacing: { before: 240, after: 240 },
          shading: { type: ShadingType.SOLID, fill: '0F172A' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: '1E293B' },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: '1E293B' },
            left: { style: BorderStyle.SINGLE, size: 8, color: accent },
            right: { style: BorderStyle.SINGLE, size: 8, color: '1E293B' },
          },
        })
      );

    } else if (section.type === 'blockquote') {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.content,
              italics: true,
              color: '64748B',
              size: 22,
            }),
          ],
          spacing: { before: 240, after: 240 },
          indent: { left: 720 },
          shading: { type: ShadingType.SOLID, fill: 'F8FAFC' },
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: accent },
          },
        })
      );

    } else if (section.type === 'table') {
      const tableRows = [
        new TableRow({
          children: section.header.map(
            (h) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 22 })],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                shading: { type: ShadingType.SOLID, fill: primary },
              })
          ),
        }),
        ...section.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: cell, color: '334155', size: 21 })] })],
                    shading: { type: ShadingType.SOLID, fill: 'FFFFFF' },
                  })
              ),
            })
        ),
      ];

      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
        })
      );

    } else if (section.type === 'divider') {
      children.push(
        new Paragraph({
          text: '',
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
          },
          spacing: { before: 240, after: 240 },
        })
      );

    } else if (section.type === 'image' || section.type === 'mermaid') {
      const dataUrl = await fetchMediaForSection(section);
      const bytes = dataUrl ? dataUrlToUint8Array(dataUrl) : null;
      if (dataUrl && bytes) {
        let width = 520;
        let height = 320;
        const dimensions = await getImageDimensions(dataUrl);
        if (dimensions) {
          const maxW = 560;
          const maxH = 360;
          width = Math.min(maxW, dimensions.width);
          height = Math.round(width * dimensions.ratio);
          if (height > maxH) {
            height = maxH;
            width = Math.round(height / dimensions.ratio);
          }
        }
        try {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 240, after: 120 },
              children: [
                new ImageRun({
                  data: bytes,
                  transformation: { width, height },
                  type: docxImageType(dataUrl),
                }),
              ],
            })
          );
          const caption = section.alt || section.title;
          if (caption) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 240 },
                children: [new TextRun({ text: caption, italics: true, color: '64748B', size: 20 })],
              })
            );
          }
        } catch (err) {
          console.warn('DOCX image embed failed:', err);
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `[Image: ${section.alt || section.src || 'diagram'}]`, italics: true, color: '94A3B8', size: 20 })],
            })
          );
        }
      } else {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: section.type === 'mermaid' ? '[Diagram could not be rendered]' : `[Image unavailable${section.alt ? `: ${section.alt}` : ''}]`, italics: true, color: '94A3B8', size: 20 })],
          })
        );
      }
    }
  }

  const header = new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: meta.title, color: '94A3B8', size: 18 }),
        ],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: 'Page ', color: '64748B', size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], color: '64748B', size: 18 }),
          new TextRun({ text: ' of ', color: '64748B', size: 18 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '64748B', size: 18 }),
        ],
      }),
    ],
  });

  const doc = new Document({
    title: meta.title,
    description: meta.subtitle || meta.title,
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        properties: {
          page: {
            margin: {
              top: 1240,
              right: 1440,
              bottom: 1240,
              left: 1440,
              header: 720,
              footer: 720,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== PROFESSIONAL PPTX GENERATION ====================
export async function generatePPTX(content, filename = 'presentation.pptx') {
  const pptx = new PptxGenJS();
  const sections = parseMarkdownAdvanced(sanitizeDocumentContent(content));
  const meta = getDocumentMeta(sections, filename);
  const renderSections = getRenderableSections(sections, meta);
  const style = getCurrentStyle();
  const primaryHex = rgbToHex(style.primary);
  const accentHex = rgbToHex(style.accent);
  const generatedDate = getGeneratedDate();
  const profile = getDocumentProfile(renderSections);
  const recipe = getDocumentRecipe(profile, style);

  pptx.layout = 'LAYOUT_16x9';
  pptx.title = meta.title;
  pptx.subject = meta.subtitle || meta.title;

  const titleSlide = pptx.addSlide();
  const darkTitle = recipe.cover === 'technical';
  titleSlide.background = { color: darkTitle ? '0F172A' : 'FFFFFF' };
  if (recipe.cover === 'technical') {
    for (let x = 0; x <= 13.4; x += 0.6) titleSlide.addShape(pptx.ShapeType.line, { x, y: 0, w: 0, h: 7.5, line: { color: '1E293B', transparency: 40, width: 0.4 } });
    for (let yLine = 0; yLine <= 7.5; yLine += 0.6) titleSlide.addShape(pptx.ShapeType.line, { x: 0, y: yLine, w: 13.4, h: 0, line: { color: '1E293B', transparency: 40, width: 0.4 } });
    titleSlide.addShape(pptx.ShapeType.rect, { x: 0.65, y: 1.0, w: 0.9, h: 0.08, fill: { color: accentHex }, line: { color: accentHex } });
  } else if (recipe.cover === 'data') {
    titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.34, h: 1.0, fill: { color: primaryHex }, line: { color: primaryHex } });
    titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.0, w: 13.34, h: 0.08, fill: { color: accentHex }, line: { color: accentHex } });
  } else if (recipe.cover === 'gallery') {
    titleSlide.addShape(pptx.ShapeType.rect, { x: 9.3, y: 0.7, w: 2.3, h: 4.7, fill: { color: primaryHex }, line: { color: primaryHex, transparency: 100 } });
    titleSlide.addShape(pptx.ShapeType.rect, { x: 10.4, y: 1.6, w: 2.1, h: 4.4, fill: { color: accentHex }, line: { color: accentHex, transparency: 100 } });
  } else if (recipe.cover === 'briefing') {
    titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: accentHex }, line: { color: accentHex } });
  } else {
    titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.34, h: recipe.cover === 'report' ? 0.22 : 0.08, fill: { color: primaryHex }, line: { color: primaryHex } });
  }

  titleSlide.addText(meta.title, {
    x: 0.7, y: recipe.cover === 'data' ? 1.8 : 2.25, w: 8.9, h: 1.25,
    fontSize: recipe.titleSize, bold: true, color: darkTitle ? 'F8FAFC' : '0F172A', fit: 'shrink', valign: 'mid',
    margin: 0,
  });
  if (meta.subtitle) {
    titleSlide.addText(meta.subtitle, {
      x: 0.7, y: recipe.cover === 'data' ? 3.05 : 3.45, w: 8.7, h: 0.65,
      fontSize: 17, color: darkTitle ? 'CBD5E1' : '475569', fit: 'shrink', valign: 'top',
      margin: 0,
    });
  }
  if (recipe.cover === 'data' || recipe.cover === 'briefing') {
    const metrics = [
      ['Sections', profile.stats.headings || 1],
      ['Tables', profile.stats.tables],
      ['Visuals', profile.stats.visuals],
    ];
    metrics.forEach(([label, value], idx) => {
      titleSlide.addShape(pptx.ShapeType.rect, { x: 0.7 + idx * 1.7, y: 4.65, w: 1.35, h: 0.58, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } });
      titleSlide.addText(String(value), { x: 0.86 + idx * 1.7, y: 4.74, w: 0.35, h: 0.18, fontSize: 16, bold: true, color: primaryHex, margin: 0 });
      titleSlide.addText(label, { x: 1.18 + idx * 1.7, y: 4.78, w: 0.62, h: 0.15, fontSize: 7.5, color: '64748B', margin: 0 });
    });
  }
  titleSlide.addText(generatedDate, {
    x: 0.7, y: 5.95, w: 8.6, h: 0.25,
    fontSize: 9.5, color: darkTitle ? '94A3B8' : '94A3B8',
    margin: 0,
  });

  // Structured content items per slide: { type, text, isBullet, isNumbered, isSubheading }
  let currentSlide = null;
  let slideItems = [];
  let slideTitle = '';
  let contentSlideCount = 0;
  const MAX_ITEMS_PER_SLIDE = recipe.slide === 'cards' ? 5 : 7;

  const addSlideHeader = (slide, title, fontSize = 24) => {
    if (recipe.slide === 'split' || recipe.slide === 'report') {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: accentHex }, line: { color: accentHex } });
    }
    if (recipe.slide === 'dashboard') {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.34, h: 0.18, fill: { color: primaryHex }, line: { color: primaryHex } });
    }
    slide.addText(title, {
      x: 0.55, y: 0.33, w: 11.5, h: 0.62,
      fontSize, bold: true, color: '0F172A', valign: 'middle', fit: 'shrink', margin: 0,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y: 1.05, w: recipe.slide === 'dashboard' ? 1.15 : 0.65, h: 0.05,
      fill: { color: accentHex }, line: { color: accentHex },
    });
  };

  const ensureContentSlide = (title = 'Overview') => {
    if (currentSlide) return;
    currentSlide = pptx.addSlide();
    currentSlide.background = { color: 'FFFFFF' };
    addSlideHeader(currentSlide, title, 26);
    slideTitle = title;
    slideItems = [];
  };

  const textOptionsForItem = (item, compact = false) => {
    if (item.isSubheading) return { bold: true, fontSize: compact ? 13 : 17, color: '1E293B', breakLine: true };
    if (item.isBullet) return { bullet: { indent: compact ? 10 : 15 }, fontSize: compact ? 12 : 15, color: '334155', breakLine: true };
    if (item.isNumbered) return { bullet: { type: 'number', indent: compact ? 10 : 15 }, fontSize: compact ? 12 : 15, color: '334155', breakLine: true };
    return { fontSize: compact ? 12.5 : 15, color: '334155', breakLine: true };
  };

  const renderTextBlock = (slide, chunk, box, compact = false) => {
    if (!chunk.length) return;
    const textArr = chunk.map(item => ({ text: item.text, options: textOptionsForItem(item, compact) }));
    slide.addText(textArr, { ...box, valign: 'top', paraSpaceAfter: compact ? 4 : 7, fit: 'shrink', margin: 0.08, breakLine: false });
  };

  const renderCards = (slide, chunk) => {
    const columns = chunk.length > 3 ? 2 : 1;
    const cardW = columns === 2 ? 5.7 : 11.2;
    const cardH = columns === 2 ? 0.76 : 0.86;
    chunk.forEach((item, idx) => {
      const col = idx % columns;
      const row = Math.floor(idx / columns);
      const x = 0.7 + col * 6.0;
      const y = 1.45 + row * (cardH + 0.18);
      slide.addShape(pptx.ShapeType.rect, { x, y, w: cardW, h: cardH, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 } });
      slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: cardH, fill: { color: item.isSubheading ? primaryHex : accentHex }, line: { color: item.isSubheading ? primaryHex : accentHex } });
      slide.addText(item.text, { x: x + 0.22, y: y + 0.12, w: cardW - 0.38, h: cardH - 0.18, fontSize: item.isSubheading ? 13.5 : 12.5, bold: item.isSubheading, color: '334155', fit: 'shrink', margin: 0 });
    });
  };

  const renderStatement = (slide, chunk) => {
    const text = chunk.map(item => item.text).join('\n');
    slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.55, w: 0.12, h: 3.2, fill: { color: accentHex }, line: { color: accentHex } });
    slide.addText(text, { x: 1.0, y: 1.65, w: 10.6, h: 3.0, fontSize: 23, bold: false, color: '1E293B', fit: 'shrink', breakLine: false, margin: 0 });
  };

  const flushSlide = () => {
    if (!currentSlide || slideItems.length === 0) return;

    for (let i = 0; i < slideItems.length; i += MAX_ITEMS_PER_SLIDE) {
      const chunk = slideItems.slice(i, i + MAX_ITEMS_PER_SLIDE);
      contentSlideCount += 1;
      const slide = i === 0 ? currentSlide : (() => {
        const s = pptx.addSlide();
        s.background = { color: 'FFFFFF' };
        addSlideHeader(s, slideTitle + ' (cont.)');
        return s;
      })();

      const totalWords = chunk.reduce((sum, item) => sum + countWords(item.text), 0);
      const bulletCount = chunk.filter(item => item.isBullet || item.isNumbered).length;
      if (chunk.length <= 2 && totalWords <= 55 && recipe.slide !== 'dashboard') {
        renderStatement(slide, chunk);
      } else if (recipe.slide === 'cards' || bulletCount >= 4) {
        renderCards(slide, chunk);
      } else if (recipe.slide === 'dashboard' || contentSlideCount % 2 === 0) {
        renderTextBlock(slide, chunk.slice(0, Math.ceil(chunk.length / 2)), { x: 0.65, y: 1.42, w: 5.55, h: 4.6 }, true);
        renderTextBlock(slide, chunk.slice(Math.ceil(chunk.length / 2)), { x: 6.7, y: 1.42, w: 5.55, h: 4.6 }, true);
      } else {
        renderTextBlock(slide, chunk, { x: 0.72, y: 1.4, w: 11.1, h: 4.65 });
      }
    }
  };

  const deckSections = renderSections.length
    ? renderSections
    : [{ type: 'paragraph', content: 'No document content was available to export.' }];

  for (const section of deckSections) {
    if (section.type === 'heading1' || section.type === 'heading2') {
      flushSlide();
      currentSlide = pptx.addSlide();
      currentSlide.background = { color: 'FFFFFF' };
      addSlideHeader(currentSlide, section.content, section.type === 'heading1' ? 30 : 24);
      slideTitle = section.content;
      slideItems = [];

    } else if (section.type === 'heading3') {
      ensureContentSlide(slideTitle || 'Overview');
      slideItems.push({ text: section.content, isSubheading: true });

    } else if (section.type === 'paragraph') {
      ensureContentSlide(slideTitle || 'Overview');
      slideItems.push({ text: section.content });

    } else if (section.type === 'bullet-list') {
      ensureContentSlide(slideTitle || 'Overview');
      section.items.forEach(item => slideItems.push({ text: item.text, isBullet: true }));

    } else if (section.type === 'ordered-list') {
      ensureContentSlide(slideTitle || 'Overview');
      section.items.forEach((item, idx) => slideItems.push({ text: `${idx + 1}. ${item.text}`, isNumbered: true }));

    } else if (section.type === 'code') {
      flushSlide();
      const codeSlide = pptx.addSlide();
      codeSlide.background = { color: 'FFFFFF' };
      addSlideHeader(codeSlide, section.language ? section.language.toUpperCase() + ' Code' : 'Code');
      codeSlide.addText(section.content.substring(0, 800), {
        x: 0.65, y: 1.35, w: 12.05, h: 4.9,
        fontSize: 12.5, fontFace: 'Courier New', color: recipe.cover === 'technical' ? 'E2E8F0' : '1E293B',
        fill: { color: recipe.cover === 'technical' ? '0F172A' : 'F1F5F9' }, valign: 'top', fit: 'shrink', margin: 0.12,
      });
      currentSlide = null;
      slideItems = [];
      slideTitle = '';

    } else if (section.type === 'table') {
      flushSlide();
      const tableSlide = pptx.addSlide();
      tableSlide.background = { color: 'FFFFFF' };
      addSlideHeader(tableSlide, 'Table');
      const tableData = [
        section.header.map(h => ({ text: h, options: { bold: true, fill: primaryHex, color: 'FFFFFF', align: 'center' } })),
        ...section.rows.map(row => row.map(cell => ({ text: cell, options: { color: '334155' } }))),
      ];
      tableSlide.addTable(tableData, {
        x: 0.55, y: 1.35, w: 12.2,
        fontSize: 11.5,
        border: { pt: 1, color: 'E2E8F0' },
        fill: { color: 'FFFFFF' },
        rowH: 0.38,
      });
      currentSlide = null;
      slideItems = [];
      slideTitle = '';
    } else if (section.type === 'image' || section.type === 'mermaid') {
      flushSlide();
      const dataUrl = await fetchMediaForSection(section);
      const mediaSlide = pptx.addSlide();
      mediaSlide.background = { color: 'FFFFFF' };
      const captionTitle = section.alt || (section.type === 'mermaid' ? 'Diagram' : 'Image');
      addSlideHeader(mediaSlide, captionTitle);
      const pptxImageData = dataUrlForPptx(dataUrl);
      if (pptxImageData) {
        const frame = recipe.slide === 'canvas'
          ? { x: 0.75, y: 1.28, w: 11.85, h: 4.95 }
          : { x: 1.0, y: 1.35, w: 11.1, h: 4.65 };
        const dimensions = await getImageDimensions(dataUrl);
        const fitted = fitMediaBox(frame, dimensions, 'contain');
        mediaSlide.addShape(pptx.ShapeType.rect, {
          ...frame,
          fill: { color: 'F8FAFC' },
          line: { color: 'E2E8F0', width: 1 },
        });
        try {
          mediaSlide.addImage({
            data: pptxImageData,
            ...fitted,
            altText: captionTitle,
          });
          if (section.title || section.alt) {
            mediaSlide.addText(section.title || section.alt, {
              x: frame.x, y: frame.y + frame.h + 0.12, w: frame.w, h: 0.28,
              fontSize: 9.5, italic: true, color: '64748B', align: 'center', fit: 'shrink', margin: 0,
            });
          }
        } catch (err) {
          console.warn('PPTX image embed failed:', err);
          mediaSlide.addText(section.type === 'mermaid' ? 'Diagram could not be embedded.' : 'Image could not be embedded.', {
            x: 0.5, y: 2.7, w: 12.2, h: 0.5,
            fontSize: 14, italic: true, color: '94A3B8', align: 'center',
          });
        }
      } else {
        mediaSlide.addText(section.type === 'mermaid' ? 'Diagram could not be rendered.' : 'Image unavailable.', {
          x: 0.5, y: 2.5, w: 12.2, h: 0.5,
          fontSize: 14, italic: true, color: '94A3B8', align: 'center',
        });
      }
      currentSlide = null;
      slideItems = [];
      slideTitle = '';
    }
  }

  flushSlide();

  await pptx.writeFile({ fileName: filename });
}

// Main export function
export async function exportDocument(content, format, filename) {
  try {
    switch (format) {
      case 'pdf':
        await generatePDF(content, filename || 'document.pdf');
        break;
      case 'docx':
        await generateDOCX(content, filename || 'document.docx');
        break;
      case 'pptx':
        await generatePPTX(content, filename || 'presentation.pptx');
        break;
      default:
        throw new Error('Unsupported format');
    }
    return true;
  } catch (error) {
    console.error('Export error:', error);
    throw error;
  }
}
