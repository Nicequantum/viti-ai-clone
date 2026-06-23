import { jsPDF } from 'jspdf';
import { DEALERSHIP_DISPLAY_NAME } from '@/lib/constants';
import type { RepairLine, RepairOrder } from '@/types';

const STORY_LINE_HEIGHT = 1.25;
const STORY_PARAGRAPH_GAP = 8;
const MERCEDES_NAVY = { r: 0, g: 31, b: 63 };
const MUTED_GRAY = { r: 85, g: 85, b: 85 };
const LABEL_GRAY = { r: 68, g: 68, b: 68 };
const FOOTER_GRAY = { r: 102, g: 102, b: 102 };

/** Normalize warranty story text for CDK/DMS paste — plain paragraphs, no junk whitespace. */
export function normalizeWarrantyStoryText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function copyPlainTextToClipboard(text: string): Promise<void> {
  const plain = normalizeWarrantyStoryText(text);
  if (!plain) {
    throw new Error('Nothing to copy');
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // fall through to writeText / execCommand
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(plain);
      return;
    } catch {
      // fall through
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = plain;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, plain.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Copy command failed');
  }
}

function setTextColor(doc: jsPDF, color: { r: number; g: number; b: number }): void {
  doc.setTextColor(color.r, color.g, color.b);
}

function ensurePageSpace(doc: jsPDF, y: number, margin: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - margin) {
    doc.addPage();
    return margin;
  }
  return y;
}

function renderPdfLines(
  doc: jsPDF,
  text: string,
  margin: number,
  maxWidth: number,
  startY: number,
  fontSize: number,
  style: 'normal' | 'bold' = 'normal',
  color?: { r: number; g: number; b: number }
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  let y = startY;

  doc.setFont('helvetica', style);
  doc.setFontSize(fontSize);
  if (color) setTextColor(doc, color);

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (let i = 0; i < lines.length; i++) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines[i], margin, y);
    y += lineHeight;
  }

  setTextColor(doc, { r: 0, g: 0, b: 0 });
  return y;
}

function renderSectionTitle(
  doc: jsPDF,
  title: string,
  margin: number,
  maxWidth: number,
  startY: number
): number {
  let y = ensurePageSpace(doc, startY, margin, 24);
  y = renderPdfLines(doc, title, margin, maxWidth, y, 12, 'bold', MERCEDES_NAVY);
  return y + 4;
}

function renderLabelValueRow(
  doc: jsPDF,
  label: string,
  value: string,
  margin: number,
  maxWidth: number,
  startY: number
): number {
  if (!value.trim()) return startY;

  const pageHeight = doc.internal.pageSize.getHeight();
  const fontSize = 10;
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  const labelWidth = maxWidth * 0.3;
  const valueWidth = maxWidth * 0.7;
  let y = ensurePageSpace(doc, startY, margin, lineHeight * 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  setTextColor(doc, LABEL_GRAY);
  doc.text(label, margin, y);

  doc.setFont('helvetica', 'normal');
  setTextColor(doc, { r: 0, g: 0, b: 0 });
  const valueLines = doc.splitTextToSize(value, valueWidth) as string[];

  for (let i = 0; i < valueLines.length; i++) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(valueLines[i], margin + labelWidth, y);
    y += lineHeight;
  }

  return y + 2;
}

function renderStoryParagraphs(
  doc: jsPDF,
  text: string,
  margin: number,
  maxWidth: number,
  startY: number,
  fontSize: number
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  let y = startY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  setTextColor(doc, { r: 0, g: 0, b: 0 });

  const paragraphs = text.split(/\n\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += STORY_PARAGRAPH_GAP;

    const wrapped = doc.splitTextToSize(paragraphs[p], maxWidth) as string[];
    let offset = 0;

    while (offset < wrapped.length) {
      const room = Math.max(1, Math.floor((pageHeight - margin - y) / lineHeight));
      const chunk = wrapped.slice(offset, offset + room);

      if (chunk.length === 0) {
        doc.addPage();
        y = margin;
        continue;
      }

      doc.text(chunk, margin, y, { lineHeightFactor: STORY_LINE_HEIGHT });
      y += chunk.length * lineHeight;
      offset += chunk.length;

      if (offset < wrapped.length) {
        doc.addPage();
        y = margin;
      }
    }
  }

  return y;
}

function renderHeader(doc: jsPDF, roNumber: string, margin: number, maxWidth: number, startY: number): number {
  let y = startY;

  y = renderPdfLines(doc, DEALERSHIP_DISPLAY_NAME, margin, maxWidth, y, 17, 'bold', MERCEDES_NAVY);
  y += 4;
  y = renderPdfLines(doc, `Warranty Story • RO #${roNumber}`, margin, maxWidth, y, 12, 'normal', MUTED_GRAY);
  y += 10;

  doc.setDrawColor(MERCEDES_NAVY.r, MERCEDES_NAVY.g, MERCEDES_NAVY.b);
  doc.setLineWidth(1.5);
  doc.line(margin, y, margin + maxWidth, y);

  return y + 18;
}

function renderFooter(doc: jsPDF, margin: number, maxWidth: number, auditHash?: string): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 35;
  const date = new Date().toLocaleDateString();
  let footerText = `Generated by Merlin • ${date}`;
  if (auditHash) {
    footerText += ` • Audit Ref: ${auditHash.substring(0, 16)}...`;
  }

  doc.setDrawColor(238, 238, 238);
  doc.setLineWidth(0.5);
  doc.line(margin, footerY - 10, margin + maxWidth, footerY - 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setTextColor(doc, FOOTER_GRAY);
  doc.text(footerText, margin + maxWidth / 2, footerY, { align: 'center' });
  setTextColor(doc, { r: 0, g: 0, b: 0 });
}

export function exportWarrantyStoryPdf(
  ro: RepairOrder,
  line: RepairLine,
  storyOverride?: string,
  auditHash?: string
): void {
  const story = normalizeWarrantyStoryText(storyOverride ?? line.warrantyStory ?? '');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 45;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;

  let y = margin;
  y = renderHeader(doc, ro.roNumber, margin, maxWidth, y);

  y = renderSectionTitle(doc, 'Vehicle Information', margin, maxWidth, y);
  const vehicle = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ');
  if (vehicle) {
    y = renderLabelValueRow(doc, 'Vehicle:', vehicle, margin, maxWidth, y);
  }
  if (ro.vehicle.vin) {
    y = renderLabelValueRow(doc, 'VIN:', ro.vehicle.vin, margin, maxWidth, y);
  }
  if (ro.vehicle.mileageIn) {
    y = renderLabelValueRow(doc, 'Mileage:', ro.vehicle.mileageIn, margin, maxWidth, y);
  }
  if (ro.vehicle.engine) {
    y = renderLabelValueRow(doc, 'Engine:', ro.vehicle.engine, margin, maxWidth, y);
  }
  y = renderLabelValueRow(doc, 'Line:', `${line.lineNumber} — ${line.description}`, margin, maxWidth, y);

  y = renderSectionTitle(doc, 'Customer Concern', margin, maxWidth, y);
  y = renderPdfLines(doc, line.customerConcern?.trim() || '[Not documented]', margin, maxWidth, y, 10);
  y += 8;

  y = renderSectionTitle(doc, 'Technician Notes', margin, maxWidth, y);
  y = renderPdfLines(doc, line.technicianNotes?.trim() || '[Not documented]', margin, maxWidth, y, 10);
  y += 8;

  y = renderSectionTitle(doc, 'Warranty Story', margin, maxWidth, y);
  y = renderStoryParagraphs(doc, story, margin, maxWidth, y, 10);

  renderFooter(doc, margin, maxWidth, auditHash);

  doc.save(`RO-${ro.roNumber}-Line${line.lineNumber}-Warranty.pdf`);
}

export async function copyFormattedStory(
  _ro: RepairOrder,
  line: RepairLine,
  storyOverride?: string
): Promise<void> {
  const storyEl = typeof document !== 'undefined' ? document.getElementById(`warranty-story-${line.id}`) : null;
  const raw =
    storyOverride ??
    (storyEl instanceof HTMLTextAreaElement ? storyEl.value : undefined) ??
    line.warrantyStory ??
    '';
  await copyPlainTextToClipboard(raw);
}