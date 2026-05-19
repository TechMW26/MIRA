import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak, Header, Footer, PageNumber, ShadingType } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { marked } from 'marked';

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
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isConversationalDocumentLine(line) {
  const text = String(line || '').trim().replace(/^#{1,6}\s+/, '');
  if (!text) return false;
  return /^(sure|okay|ok|absolutely|of course|certainly)[,!\s-]*(here(?:'s| is)|below is|i(?:'ve| have))?/i.test(text)
    || /^(here(?:'s| is)|below is|the following is)\b[\s\S]*\b(pdf|docx|word|pptx|powerpoint|presentation|document|file|markdown)\b[\s\S]*:?$/i.test(text)
    || /^i(?:'ve| have)\s+(created|generated|prepared|drafted|made)\b[\s\S]*:?$/i.test(text)
    || /^as requested\b[\s\S]*:?$/i.test(text)
    || /^here\s+is\s+the\s+complete\b[\s\S]*:?$/i.test(text);
}

function isDocumentMetaLine(line) {
  const text = String(line || '').trim().replace(/^#{1,6}\s+/, '');
  if (!text) return false;
  return /^\[(page\s+\d+|cover page|front cover|back cover|download button|image:\s*[^\]]+|note:\s*[^\]]*download[^\]]*)\]$/i.test(text)
    || /^download\s+(the\s+)?[\w\s-]*(pdf|docx|word document|pptx|powerpoint|presentation)\s*$/i.test(text)
    || /^\[?note:\s*[\s\S]*\b(download button|google drive|download the pdf|download the document)\b[\s\S]*\]?$/i.test(text);
}

export function sanitizeDocumentContent(content = '') {
  const original = String(content || '').trim();
  if (!original) return '';

  let text = original
    .replace(/^\s*```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/\[Download[^\]]*(?:PDF|DOCX|PPTX|Word|PowerPoint|Presentation|Slides)[^\]]*\]\([^)]*\)/gi, '')
    .replace(/^\s*\[Download Button\]\s*$/gim, '');

  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && (isConversationalDocumentLine(lines[0]) || /^#{1,6}\s*$/.test(lines[0].trim()))) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }

  text = lines
    .filter((line) => !isDocumentMetaLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || original;
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

      case 'paragraph':
        pushTextBlock(token.text || token.raw || '');
        break;

      case 'list':
        sections.push({
          type: token.ordered ? 'ordered-list' : 'bullet-list',
          items: token.items.map(item => ({
            text: cleanInlineText(item.text),
            checked: item.checked,
          })),
        });
        break;

      case 'code':
        sections.push({
          type: 'code',
          content: token.text,
          language: token.lang || 'text',
        });
        break;

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
  let y = 34;

  doc.setProperties({
    title: meta.title,
    subject: meta.subtitle || meta.title,
  });

  const setFill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  const drawCover = () => {
    // Editorial-style cover: clean white with a single accent rule
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Thin top accent band
    setFill(style.primary);
    doc.rect(0, 0, pageWidth, 3, 'F');

    // Vertical accent rule along left margin
    setFill(style.accent);
    doc.rect(margin, pageHeight / 2 - 40, 1.2, 80, 'F');

    // Title block (vertically centered to feel intentional, not corporate)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
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

    // Minimal date footer — no branding
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

  for (const section of renderSections) {

    if (section.type === 'heading1') {
      checkPageBreak(24);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y - 8, contentWidth, 20, 3, 3, 'F');
      setFill(style.accent);
      doc.roundedRect(margin, y - 8, 4, 20, 2, 2, 'F');
      doc.setFontSize(17);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(section.content, contentWidth - 14);
      doc.text(lines, margin + 10, y + 4);
      y += Math.max(24, lines.length * 8 + 14);

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
  const children = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: meta.title, bold: true, color: '0F172A', size: 52 })],
      spacing: { before: 480, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.subtitle || '', color: '475569', size: 26 })],
      spacing: { after: 360 },
    }),
    new Paragraph({
      children: [new TextRun({ text: generatedDate, color: '94A3B8', size: 20 })],
      border: {
        top: { style: BorderStyle.SINGLE, size: 6, color: accent },
      },
      spacing: { before: 120, after: 900 },
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

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

  pptx.layout = 'LAYOUT_16x9';
  pptx.title = meta.title;
  pptx.subject = meta.subtitle || meta.title;

  // Title Slide — minimal deck cover with real title (no placeholders, no branding)
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: 'FFFFFF' };
  titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.45, w: 0.18, h: 1.6, fill: { color: accentHex }, line: { color: accentHex } });
  titleSlide.addText(meta.title, {
    x: 0.7, y: 2.4, w: 8.6, h: 1.0,
    fontSize: 40, bold: true, color: '0F172A', valign: 'middle',
  });
  if (meta.subtitle) {
    titleSlide.addText(meta.subtitle, {
      x: 0.7, y: 3.5, w: 8.6, h: 0.6,
      fontSize: 18, color: '475569', valign: 'top',
    });
  }
  titleSlide.addText(generatedDate, {
    x: 0.7, y: 5.1, w: 8.6, h: 0.3,
    fontSize: 10, color: '94A3B8',
  });

  // Structured content items per slide: { type, text, isBullet, isNumbered, isSubheading }
  let currentSlide = null;
  let slideItems = [];
  let slideTitle = '';
  const MAX_ITEMS_PER_SLIDE = 7;

  const addSlideHeader = (slide, title, fontSize = 24) => {
    // Clean minimal slide header: title + thin accent underline. No filled banner.
    slide.addText(title, {
      x: 0.5, y: 0.35, w: 9, h: 0.7,
      fontSize, bold: true, color: '0F172A', valign: 'middle',
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 1.05, w: 0.6, h: 0.05,
      fill: { color: accentHex }, line: { color: accentHex },
    });
  };

  const flushSlide = () => {
    if (!currentSlide || slideItems.length === 0) return;

    // Split into chunks of MAX_ITEMS_PER_SLIDE
    for (let i = 0; i < slideItems.length; i += MAX_ITEMS_PER_SLIDE) {
      const chunk = slideItems.slice(i, i + MAX_ITEMS_PER_SLIDE);
      const slide = i === 0 ? currentSlide : (() => {
        const s = pptx.addSlide();
        s.background = { color: 'FFFFFF' };
        addSlideHeader(s, slideTitle + ' (cont.)');
        return s;
      })();

      const textArr = chunk.map(item => {
        if (item.isSubheading) return { text: item.text, options: { bold: true, fontSize: 18, color: '1E293B', breakLine: true } };
        if (item.isBullet) return { text: item.text, options: { bullet: { indent: 15 }, fontSize: 16, color: '334155', breakLine: true } };
        if (item.isNumbered) return { text: item.text, options: { bullet: { type: 'number', indent: 15 }, fontSize: 16, color: '334155', breakLine: true } };
        return { text: item.text, options: { fontSize: 16, color: '334155', breakLine: true } };
      });

      slide.addText(textArr, { x: 0.5, y: 1.4, w: 9, h: 4.3, valign: 'top', paraSpaceAfter: 6 });
    }
  };

  for (const section of renderSections) {
    if (section.type === 'heading1' || section.type === 'heading2') {
      flushSlide();
      currentSlide = pptx.addSlide();
      currentSlide.background = { color: 'FFFFFF' };
      addSlideHeader(currentSlide, section.content, section.type === 'heading1' ? 30 : 24);
      slideTitle = section.content;
      slideItems = [];

    } else if (section.type === 'heading3') {
      slideItems.push({ text: section.content, isSubheading: true });

    } else if (section.type === 'paragraph') {
      slideItems.push({ text: section.content });

    } else if (section.type === 'bullet-list') {
      section.items.forEach(item => slideItems.push({ text: item.text, isBullet: true }));

    } else if (section.type === 'ordered-list') {
      section.items.forEach((item, idx) => slideItems.push({ text: `${idx + 1}. ${item.text}`, isNumbered: true }));

    } else if (section.type === 'code') {
      flushSlide();
      const codeSlide = pptx.addSlide();
      codeSlide.background = { color: 'FFFFFF' };
      addSlideHeader(codeSlide, section.language ? section.language.toUpperCase() + ' Code' : 'Code');
      codeSlide.addText(section.content.substring(0, 800), {
        x: 0.5, y: 1.4, w: 9, h: 4.3,
        fontSize: 13, fontFace: 'Courier New', color: '1E293B',
        fill: { color: 'F1F5F9' }, valign: 'top',
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
        x: 0.5, y: 1.5, w: 9,
        fontSize: 14,
        border: { pt: 1, color: 'E2E8F0' },
        fill: { color: 'FFFFFF' },
        rowH: 0.4,
      });
      currentSlide = null;
      slideItems = [];
      slideTitle = '';
    }
  }

  flushSlide();

  await pptx.writeFile({ fileName: filename });
}

// Detect document format request — only triggers on explicit CREATE/GENERATE/DOWNLOAD intent
export function detectDocumentRequest(message, hasFileAttachments = false) {
  void hasFileAttachments;

  const lower = message.toLowerCase();

  // Must have explicit creation/export intent verb
  const createIntent = /\b(create|generate|make|export|download|write|produce|build|give me|save as|convert to)\b/.test(lower);
  if (!createIntent) return null;

  if (/\b(as|to|in|a|the)?\s*(pdf)\b/.test(lower) && createIntent) return 'pdf';
  if (/\b(as|to|in|a|the)?\s*(docx|word document|word file)\b/.test(lower) && createIntent) return 'docx';
  if (/\b(as|to|in|a|the)?\s*(pptx|powerpoint|presentation|slides)\b/.test(lower) && createIntent) return 'pptx';
  if (/\b(download|export|save)\b[\s\S]{0,40}\b(file|document)\b/.test(lower) && createIntent) return 'pdf';

  return null;
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