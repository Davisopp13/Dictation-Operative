// Regenerate with: node --import tsx scripts/generate-quick-start.ts
// Set DO_SHARP_PACKAGE to an installed sharp package directory to also render PNG.
// The export uses DO's existing logo, Lucide icons, and Stage and Page colors.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Mic,
  Sparkles,
  Clipboard,
  ArrowRight,
  Layers,
  Monitor,
  ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { quickStart } from '../lib/quick-start';

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
function lines(value: string, length: number) {
  const result: string[] = [];
  for (const word of value.split(/\s+/)) {
    if (
      !result.length ||
      result[result.length - 1].length + word.length + 1 > length
    )
      result.push(word);
    else result[result.length - 1] += ` ${word}`;
  }
  return result;
}
function text(
  value: string,
  x: number,
  y: number,
  size = 20,
  fill = '#17243c',
  weight = 400,
) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escape(value)}</text>`;
}
function paragraph(
  value: string,
  x: number,
  y: number,
  length: number,
  size = 20,
  fill = '#4b5872',
) {
  return lines(value, length)
    .map((line, i) => text(line, x, y + i * (size * 1.5), size, fill))
    .join('');
}
function icon(
  Icon: LucideIcon,
  x: number,
  y: number,
  size = 32,
  color = '#245ce5',
) {
  return `<g transform="translate(${x} ${y})">${renderToStaticMarkup(createElement(Icon, { size, color, strokeWidth: 1.8 }))}</g>`;
}
const logo = readFileSync(
  new URL('../public/icons/icon-192.png', import.meta.url),
).toString('base64');
const icons = [Mic, Sparkles, Clipboard];
const steps = quickStart.steps
  .map((step, index) => {
    const y = 382 + index * 258;
    return `<rect x="40" y="${y}" width="1120" height="238" rx="20" fill="white" stroke="#e0e6f0"/>
    <rect x="68" y="${y + 28}" width="80" height="80" rx="20" fill="#edf1fc"/>
    ${icon(icons[index], 89, y + 49, 38)}${text(`0${index + 1}`, 91, y + 160, 30, '#646f86', 500)}
    ${text(step.title, 180, y + 48, 32, '#17243c', 700)}${text(step.caption, 390, y + 45, 22, '#245ce5', 600)}
    ${paragraph(step.body, 180, y + 88, 88)}
    ${paragraph(step.tip, 180, y + 179, 97, 18)}
  `;
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1870" viewBox="0 0 1200 1870" role="img" aria-labelledby="title desc">
<title id="title">Dictation Operative — DO in 60 seconds</title>
<desc id="desc">A quick guide to Capture, Refine, and Use, with Mac dictation and device Sync instructions.</desc>
<defs><linearGradient id="stage" x2="1" y2="1"><stop stop-color="#010a2d"/><stop offset="1" stop-color="#0b2f7a"/></linearGradient></defs>
<rect width="1200" height="1870" fill="#f7f8fc"/>
<g font-family="'Space Grotesk', 'Geist', Arial, sans-serif">
<rect x="40" y="32" width="1120" height="322" rx="24" fill="url(#stage)"/>
<image x="76" y="65" width="64" height="64" href="data:image/png;base64,${logo}"/>
${text('DICTATION OPERATIVE', 156, 103, 23, '#ffffff', 700)}
${text('START HERE · QUICK GUIDE', 76, 166, 16, '#6ea8ff', 700)}
${text(quickStart.title, 73, 223, 52, '#ffffff', 700)}
${text(quickStart.subtitle, 76, 260, 24, '#9cb4e8')}
${icon(Mic, 76, 299, 24, '#6ea8ff')}${text('Capture', 111, 320, 21, '#ffffff', 600)}
${icon(ArrowRight, 227, 299, 24, '#6ea8ff')}${icon(Sparkles, 287, 299, 24, '#6ea8ff')}${text('Refine', 322, 320, 21, '#ffffff', 600)}
${icon(ArrowRight, 430, 299, 24, '#6ea8ff')}${icon(Clipboard, 490, 299, 24, '#6ea8ff')}${text('Use', 525, 320, 21, '#ffffff', 600)}
${steps}
<rect x="40" y="1170" width="1120" height="200" rx="20" fill="#edf1fc"/>
${icon(Layers, 72, 1202)}${text('Try it: three thoughts, one email.', 120, 1230, 28, '#244477', 700)}
${text('1. Record three project updates.', 76, 1280, 21, '#244477')}
${text('2. Select and order them in Compose.', 76, 1325, 21, '#244477')}
${text('3. Choose Email → Create draft.', 627, 1280, 21, '#244477')}
${text('4. Review, copy, and send in your email app.', 627, 1325, 21, '#244477')}
${icon(Monitor, 68, 1410)}${text('On your Mac', 116, 1437, 27, '#17243c', 700)}
${paragraph(quickStart.mac, 68, 1481, 47, 20)}
${paragraph('Set up the native Mac app, microphone and Accessibility permissions, and a speech model first. Use your own shortcut if you changed it.', 68, 1620, 52, 18)}
${icon(ArrowLeftRight, 625, 1410)}${text('Across devices', 673, 1437, 27, '#17243c', 700)}
${paragraph(quickStart.sync, 625, 1481, 48, 20)}
${paragraph('Send clipboard or Receive latest transfers text and images. Keep the web app open and both devices online. Mac and web histories stay separate.', 625, 1650, 51, 18)}
<path d="M68 1778 H1132" stroke="#e0e6f0"/>
${text('Allow microphone access and follow voice & AI setup prompts before recording.', 68, 1808, 18, '#4b5872')}
${text('Web transcription and AI need internet. Full guide: dictationoperative.com/help', 68, 1839, 18, '#4b5872')}
</g></svg>`;
writeFileSync(
  new URL('../public/docs/do-quick-start.svg', import.meta.url),
  svg,
);
console.log('Created public/docs/do-quick-start.svg');
if (process.env.DO_SHARP_PACKAGE) {
  const sharp = createRequire(import.meta.url)(process.env.DO_SHARP_PACKAGE);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(
      new URL('../public/docs/do-quick-start.png', import.meta.url).pathname,
    );
  console.log('Created public/docs/do-quick-start.png');
}
