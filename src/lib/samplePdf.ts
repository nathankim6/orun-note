import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { importPdf } from './files';

const Q = [
  ['1. Find the derivative of f(x) = 3x^4 - 2x^2 + 7.', ['12x^3 - 4x', '12x^3 - 2x', '4x^3 - 4x', '3x^3 - 4x', '12x^3 + 4x']],
  ['2. Solve for x:  2(x - 3) = x + 5.', ['8', '11', '-1', '2', '5']],
  ['3. The sum of the first 20 positive odd numbers is', ['200', '380', '400', '420', '441']],
  ['4. If P(A) = 0.5, P(B) = 0.4 and P(A and B) = 0.2, then P(A | B) =', ['0.2', '0.3', '0.4', '0.5', '0.6']],
  ['5. Which of the following best describes the main idea of the passage?', ['Creativity is a rare talent.', 'Creative thinking is a habit.', 'Artists are born, not made.', 'Inspiration cannot be trained.', 'Routines kill originality.']],
  ['6. Evaluate the integral of (3x^2 + 2x) dx from 0 to 1.', ['1', '3/2', '2', '5/2', '3']],
  ['7. How many ways can 5 distinct balls be placed into 3 boxes with no empty box?', ['90', '120', '150', '180', '240']],
  ['8. The largest integer n with 2^n <= 1000 is', ['7', '8', '9', '10', '11']],
] as const;
const PASSAGE = 'Many people believe that creativity is a rare gift reserved for artists and inventors. Yet research on problem solving suggests that creative thinking is a habit rather than a talent. People who regularly expose themselves to unfamiliar ideas, who tolerate ambiguity, and who are willing to produce many imperfect drafts tend to generate more original solutions. In other words, originality is less about waiting for inspiration and more about building routines that invite it.';

export async function buildSamplePdfBytes(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.setTitle('Paperly Sample Worksheet');
  const font = await pdf.embedFont(StandardFonts.TimesRoman); const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const wrap = (t: string, max: number) => { const words = t.split(' '); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) lines.push(cur.trim()); return lines; };
  for (let pg = 0; pg < 4; pg++) {
    const page = pdf.addPage([595.28, 841.89]); const { width, height } = page.getSize();
    page.drawText(String(pg + 1), { x: 40, y: height - 50, size: 18, font: bold }); page.drawText('MATHEMATICS', { x: width / 2 - 60, y: height - 50, size: 16, font: bold }); page.drawText('Paperly Sample', { x: width - 130, y: height - 48, size: 10, font });
    page.drawLine({ start: { x: 40, y: height - 62 }, end: { x: width - 40, y: height - 62 }, thickness: 1.2 });
    page.drawLine({ start: { x: width / 2, y: 70 }, end: { x: width / 2, y: height - 80 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    const cols = [48, width / 2 + 12]; let col = 0; let y = height - 95;
    const items = pg % 2 === 0 ? Q.slice(0, 4) : Q.slice(4);
    if (pg % 2 === 1) { page.drawRectangle({ x: cols[0] - 4, y: y - 118, width: width / 2 - 64, height: 122, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.6 }); wrap(PASSAGE, 52).forEach((ln, i) => page.drawText(ln, { x: cols[0] + 2, y: y - 12 - i * 11.5, size: 8.6, font })); y -= 136; }
    for (const [stem, choices] of items) {
      const lines = wrap(stem, 48); const need = lines.length * 14 + choices.length * 15 + 26;
      if (y - need < 70) { col = 1; y = height - 95; }
      lines.forEach((ln, i) => page.drawText(ln, { x: cols[col], y: y - i * 14, size: 10.5, font: bold }));
      y -= lines.length * 14 + 4;
      choices.forEach((c, i) => { page.drawCircle({ x: cols[col] + 6, y: y - 3 + 2, size: 5, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.6 }); page.drawText(String(i + 1), { x: cols[col] + 3.6, y: y - 4 + 2, size: 7, font }); page.drawText(c, { x: cols[col] + 16, y: y - 2, size: 10, font }); y -= 15; });
      y -= 22;
    }
    page.drawText(`Paperly sample worksheet - page ${pg + 1} of 4. Write on this page with the pen tools.`, { x: 40, y: 48, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
  }
  return pdf.save();
}

export async function createSampleDoc() {
  const bytes = await buildSamplePdfBytes();
  if (Platform.OS === 'web') { const blob = new Blob([bytes as any], { type: 'application/pdf' }); const url = URL.createObjectURL(blob); return importPdf({ uri: url, name: 'Paperly Sample Worksheet.pdf', size: blob.size, file: blob as any, title: '샘플 문제지 (수학)', subject: '수학' }); }
  const tmp = `${FileSystem.cacheDirectory}sample-${Date.now()}.pdf`; // temp plaintext; importPdf encrypts and deletes it
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  await FileSystem.writeAsStringAsync(tmp, btoa(bin), { encoding: 'base64' });
  return importPdf({ uri: tmp, name: 'Paperly Sample Worksheet.pdf', size: bytes.length, title: '샘플 문제지 (수학)', subject: '수학' });
}
