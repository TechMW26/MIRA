import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak, TableOfContents } from 'docx';
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

// Function to remove asterisks from text
function removeAsterisks(text) {
  if (!text) return '';
  // Remove all * characters
  return text.replace(/\*/g, '');
}

// Advanced Markdown Parser with Enhanced Features
function parseMarkdownAdvanced(content) {
  // Remove asterisks from entire content first
  const cleanContent = removeAsterisks(content);
  const tokens = marked.lexer(cleanContent);
  const sections = [];
  let currentSection = null;

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        sections.push({
          type: `heading${token.depth}`,
          content: removeAsterisks(token.text),
          level: token.depth,
          id: token.text.toLowerCase().replace(/[^\w]+/g, '-'),
        });
        break;

      case 'paragraph':
        // Detect special formatting
        const text = removeAsterisks(token.text);
        const isBold = text.includes('**');
        const isItalic = text.includes('*');
        const hasLink = text.includes('[');
        
        sections.push({
          type: 'paragraph',
          content: text,
          formatting: { bold: isBold, italic: isItalic, hasLink },
        });
        break;

      case 'list':
        sections.push({
          type: token.ordered ? 'ordered-list' : 'bullet-list',
          items: token.items.map(item => ({
            text: removeAsterisks(item.text),
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
          content: removeAsterisks(token.text),
        });
        break;

      case 'table':
        sections.push({
          type: 'table',
          header: token.header.map(h => removeAsterisks(h.text)),
          rows: token.rows.map(row => row.map(cell => removeAsterisks(cell.text))),
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

// ==================== PROFESSIONAL PDF GENERATION ====================
export async function generatePDF(content, filename = 'document.pdf') {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const sections = parseMarkdownAdvanced(content);
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let y = 30;
  let pageNum = 1;
  
  // Get selected style colors
  const style = getCurrentStyle();

  // Check page break
  const checkPageBreak = (requiredSpace) => {
    if (y + requiredSpace > pageHeight - 25) {
      doc.addPage();
      pageNum++;
      y = 30;
      return true;
    }
    return false;
  };

  // Process sections
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (section.type === 'heading1') {
      checkPageBreak(25);
      
      // Large heading with underline
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y);
      y += lines.length * 10;
      
      // Accent line
      doc.setDrawColor(139, 92, 246);
      doc.setLineWidth(1.5);
      doc.line(margin, y, margin + 50, y);
      y += 12;

    } else if (section.type === 'heading2') {
      checkPageBreak(20);
      
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 65, 85);
      
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y);
      y += lines.length * 8 + 8;

    } else if (section.type === 'heading3') {
      checkPageBreak(15);
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y);
      y += lines.length * 7 + 6;

    } else if (section.type === 'paragraph') {
      checkPageBreak(15);
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      
      const lines = doc.splitTextToSize(section.content, contentWidth);
      doc.text(lines, margin, y);
      y += lines.length * 6 + 5;

    } else if (section.type === 'bullet-list' || section.type === 'ordered-list') {
      section.items.forEach((item, idx) => {
        checkPageBreak(10);
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        
        const bullet = section.type === 'ordered-list' ? `${idx + 1}.` : '•';
        const lines = doc.splitTextToSize(item.text, contentWidth - 10);
        
        doc.text(bullet, margin + 2, y);
        doc.text(lines, margin + 10, y);
        y += lines.length * 6 + 3;
      });
      y += 3;

    } else if (section.type === 'code') {
      const codeLines = section.content.split('\n');
      const boxHeight = Math.min(codeLines.length * 5 + 10, 100);
      
      checkPageBreak(boxHeight + 5);
      
      // Code block background
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, y - 3, contentWidth, boxHeight, 3, 3, 'F');
      
      // Language label
      if (section.language && section.language !== 'text') {
        doc.setFillColor(139, 92, 246);
        doc.roundedRect(margin + 5, y - 2, 30, 5, 2, 2, 'F');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(section.language.toUpperCase(), margin + 7, y + 2);
      }
      
      // Code content
      doc.setFontSize(9);
      doc.setFont('courier', 'normal');
      doc.setTextColor(30, 41, 59);
      
      const displayLines = codeLines.slice(0, Math.floor((boxHeight - 10) / 5));
      displayLines.forEach((line, idx) => {
        doc.text(line.substring(0, 100), margin + 5, y + 10 + idx * 5);
      });
      
      y += boxHeight + 8;

    } else if (section.type === 'blockquote') {
      checkPageBreak(15);
      
      // Left border
      doc.setDrawColor(139, 92, 246);
      doc.setLineWidth(2);
      doc.line(margin, y - 2, margin, y + 15);
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      
      const lines = doc.splitTextToSize(section.content, contentWidth - 10);
      doc.text(lines, margin + 8, y);
      y += lines.length * 6 + 8;

    } else if (section.type === 'table') {
      checkPageBreak(30);
      
      doc.autoTable({
        startY: y,
        head: [section.header],
        body: section.rows,
        theme: 'grid',
        headStyles: {
          fillColor: [37, 99, 235],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 10,
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          fontSize: 10,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: margin, right: margin },
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

  doc.save(filename);
}

// ==================== PROFESSIONAL DOCX GENERATION ====================
export async function generateDOCX(content, filename = 'document.docx') {
  const sections = parseMarkdownAdvanced(content);
  const children = [];

  // Process content
  for (const section of sections) {
    if (section.type === 'heading1') {
      children.push(
        new Paragraph({
          text: section.content,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 480, after: 240 },
          border: {
            bottom: {
              color: '8B5CF6',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 24,
            },
          },
        })
      );

    } else if (section.type === 'heading2') {
      children.push(
        new Paragraph({
          text: section.content,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 360, after: 180 },
        })
      );

    } else if (section.type === 'heading3') {
      children.push(
        new Paragraph({
          text: section.content,
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
          spacing: { before: 120, after: 120 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );

    } else if (section.type === 'bullet-list') {
      section.items.forEach((item) => {
        children.push(
          new Paragraph({
            text: item.text,
            bullet: { level: 0 },
            spacing: { before: 100, after: 100 },
          })
        );
      });

    } else if (section.type === 'ordered-list') {
      section.items.forEach((item, idx) => {
        children.push(
          new Paragraph({
            text: item.text,
            numbering: { reference: 'default-numbering', level: 0 },
            spacing: { before: 100, after: 100 },
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
              color: '1E293B',
            }),
          ],
          spacing: { before: 240, after: 240 },
          shading: { fill: 'F1F5F9' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
            left: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
            right: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' },
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
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: '8B5CF6' },
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
                    text: h,
                    bold: true,
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                shading: { fill: '2563EB' },
              })
          ),
        }),
        ...section.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph(cell)],
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

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
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
  const sections = parseMarkdownAdvanced(content);

  pptx.layout = 'LAYOUT_16x9';
  pptx.author = '';
  pptx.company = '';
  pptx.subject = '';
  pptx.title = '';

  // Title Slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: '2563EB' };
  
  titleSlide.addText('Document', {
    x: 1,
    y: 2.5,
    w: 8,
    h: 1,
    fontSize: 48,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
  });
  
  titleSlide.addText('Presentation', {
    x: 1,
    y: 3.8,
    w: 8,
    h: 0.5,
    fontSize: 24,
    color: 'E0E7FF',
    align: 'center',
  });

  // Structured content items per slide: { type, text, isBullet, isNumbered, isSubheading }
  let currentSlide = null;
  let slideItems = [];
  let slideTitle = '';
  const MAX_ITEMS_PER_SLIDE = 7;

  const addSlideHeader = (slide, title, fontSize = 28) => {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.2, fill: { color: '2563EB' } });
    slide.addText(title, { x: 0.5, y: 0.2, w: 9, h: 0.9, fontSize, bold: true, color: 'FFFFFF', valign: 'middle' });
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

  for (const section of sections) {
    if (section.type === 'heading1' || section.type === 'heading2') {
      flushSlide();
      currentSlide = pptx.addSlide();
      currentSlide.background = { color: 'FFFFFF' };
      addSlideHeader(currentSlide, section.content, section.type === 'heading1' ? 34 : 28);
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
        section.header.map(h => ({ text: h, options: { bold: true, fill: '2563EB', color: 'FFFFFF', align: 'center' } })),
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
  // Never auto-export if user uploaded a file — they're asking about it, not creating one
  if (hasFileAttachments) return null;

  const lower = message.toLowerCase();

  // Must have explicit creation/export intent verb
  const createIntent = /\b(create|generate|make|export|download|write|produce|build|give me|save as|convert to)\b/.test(lower);
  if (!createIntent) return null;

  if (/\b(as|to|in|a|the)?\s*(pdf)\b/.test(lower) && createIntent) return 'pdf';
  if (/\b(as|to|in|a|the)?\s*(docx|word document|word file)\b/.test(lower) && createIntent) return 'docx';
  if (/\b(as|to|in|a|the)?\s*(pptx|powerpoint|presentation|slides)\b/.test(lower) && createIntent) return 'pptx';

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