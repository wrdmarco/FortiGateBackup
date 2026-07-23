import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { artifactRelativePath, writeImmutableArtifact } from "./artifact-storage";
import type { LocalFinding, SecurityScoreComponent } from "./rules";

type ReportInput = {
  reportId: string;
  tenantId: string;
  tenantName: string;
  customerName: string;
  fortigateId: string;
  hostname: string;
  model: string;
  fortiOsVersion: string;
  configDate: Date;
  analysisDate: Date;
  score: number;
  scoreDelta: number | null;
  passedControls: number;
  totalControls: number;
  scoreComponents: SecurityScoreComponent[];
  hash: string;
  parserVersion: string;
  rulesetVersion: string;
  summary: string;
  findings: LocalFinding[];
  newFindingIds: string[];
  resolvedFindingIds: string[];
  replacement?: boolean;
};

const PAGE = { width: 595.28, height: 841.89, left: 48, right: 48, top: 76, bottom: 58 };
const CONTENT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
const COLORS = {
  ink: "#13243A",
  body: "#34445A",
  muted: "#68778B",
  line: "#D9E1EA",
  soft: "#F5F7FA",
  navy: "#0B1B30",
  blue: "#315EFB",
  green: "#08775A",
  greenSoft: "#EAF7F2",
  amber: "#A95E00",
  amberSoft: "#FFF4E5",
  red: "#B42318",
  redSoft: "#FDEDEA",
  critical: "#821426",
  white: "#FFFFFF"
} as const;

export async function generateSecurityReport(input: ReportInput) {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
    info: {
      Title: `FortiBackup beveiligingsanalyse ${input.hostname}`,
      Author: "FortiBackup",
      Subject: "Immutable FortiGate-configuratieanalyse",
      Keywords: "FortiGate, FortiOS, configuratieanalyse, informatiebeveiliging"
    },
    bufferPages: true,
    autoFirstPage: false
  });
  doc.on("data", (chunk) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const logo = await loadLogo();
  const addPage = () => addReportPage(doc, logo);

  addPage();
  drawCover(doc, input);
  await drawExecutiveSummary(doc, input, addPage);
  await drawReportDetails(doc, input, addPage);
  await drawChanges(doc, input, addPage);
  await drawFindings(doc, input, addPage);
  await drawPositiveControls(doc, input, addPage);
  await drawMethodology(doc, input, addPage);
  addPageNumbers(doc, input.reportId);

  doc.end();
  const buffer = await complete;
  const file = input.replacement ? `configuration.analysis.${input.reportId}.pdf` : "configuration.analysis.pdf";
  const relative = artifactRelativePath(input.tenantId, input.fortigateId, input.hash, file);
  await writeImmutableArtifact(relative, buffer);
  return { relative, buffer };
}

async function loadLogo() {
  try {
    return await readFile(path.join(process.cwd(), "public", "brand", "forti-backup-logo-dark.svg"), "utf8");
  } catch {
    return null;
  }
}

function addReportPage(doc: PDFKit.PDFDocument, logo: string | null) {
  doc.addPage();
  doc.rect(0, 0, PAGE.width, 52).fill(COLORS.navy);
  if (logo) SVGtoPDF(doc, logo, PAGE.left, 13, { width: 138, height: 26 });
  else doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(16).text("FORTI BACKUP", PAGE.left, 18);
  doc.fillColor("#B8C5D6").font("Helvetica").fontSize(7.5)
    .text("FORTIGATE CONFIGURATIEANALYSE", PAGE.width - 250, 22, { width: 202, align: "right", characterSpacing: 0.7, lineBreak: false });
  doc.moveTo(PAGE.left, PAGE.height - 40).lineTo(PAGE.width - PAGE.right, PAGE.height - 40).lineWidth(0.6).stroke(COLORS.line);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5)
    .text("VERTROUWELIJK - IMMUTABLE RAPPORT", PAGE.left, PAGE.height - 31, { lineBreak: false });
  doc.y = PAGE.top;
}

function drawCover(doc: PDFKit.PDFDocument, input: ReportInput) {
  doc.fillColor(COLORS.blue).font("Helvetica-Bold").fontSize(9)
    .text("BEVEILIGINGSANALYSE", PAGE.left, 88, { characterSpacing: 1.2 });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(27)
    .text("FortiGate configuratierapport", PAGE.left, 108, { width: CONTENT_WIDTH });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(11)
    .text(`${safe(input.customerName)}  |  ${safe(input.hostname)}`, PAGE.left, 148, { width: CONTENT_WIDTH });

  const scoreY = 188;
  doc.roundedRect(PAGE.left, scoreY, 188, 134, 9).fill(COLORS.soft);
  doc.circle(PAGE.left + 64, scoreY + 62, 42).lineWidth(8).stroke("#DDE5ED");
  doc.circle(PAGE.left + 64, scoreY + 62, 42)
    .lineWidth(8).strokeColor(scoreColor(input.score))
    .dash(Math.max(1, 2.64 * input.score), { space: 264 })
    .stroke();
  doc.undash();
  doc.fillColor(scoreColor(input.score)).font("Helvetica-Bold").fontSize(25)
    .text(`${input.score}%`, PAGE.left + 25, scoreY + 48, { width: 78, align: "center" });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9)
    .text(scoreLabel(input.score), PAGE.left + 116, scoreY + 34, { width: 60, lineGap: 1 });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5)
    .text("Technische score", PAGE.left + 116, scoreY + 70, { width: 60 });
  doc.fillColor(COLORS.body).font("Helvetica").fontSize(8.5)
    .text(`${input.passedControls} van ${input.totalControls} controles geslaagd`, PAGE.left + 116, scoreY + 91, { width: 60, lineGap: 2 });

  const counts = severityCounts(input.findings);
  const cards = [
    ["Critical", counts.CRITICAL, COLORS.critical, COLORS.redSoft],
    ["High", counts.HIGH, COLORS.red, COLORS.redSoft],
    ["Medium", counts.MEDIUM, COLORS.amber, COLORS.amberSoft],
    ["Low", counts.LOW, "#2D63A3", "#EDF4FC"]
  ] as const;
  cards.forEach(([label, count, color, background], index) => {
    const x = PAGE.left + 208 + (index % 2) * 146;
    const y = scoreY + Math.floor(index / 2) * 68;
    doc.roundedRect(x, y, 134, 58, 7).fill(background);
    doc.fillColor(color).font("Helvetica-Bold").fontSize(22).text(String(count), x + 14, y + 11, { width: 38 });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(label, x + 58, y + 14, { width: 64 });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5).text(count === 1 ? "bevinding" : "bevindingen", x + 58, y + 29, { width: 64 });
  });
  doc.y = 346;
}

async function drawExecutiveSummary(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  await sectionHeading(doc, "Managementsamenvatting", "De belangrijkste uitkomst voor besluitvorming en opvolging.", 90, addPage);
  const summary = safe(input.summary);
  const height = Math.max(76, doc.heightOfString(summary, { width: CONTENT_WIDTH - 32, lineGap: 3 }) + 32);
  await ensureSpace(doc, height, addPage);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, CONTENT_WIDTH, height, 7).fillAndStroke("#F7F9FC", COLORS.line);
  doc.fillColor(COLORS.body).font("Helvetica").fontSize(10).text(summary, PAGE.left + 16, y + 15, {
    width: CONTENT_WIDTH - 32,
    lineGap: 3
  });
  doc.y = y + height + 4;
}

async function drawReportDetails(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  await sectionHeading(doc, "Scope en rapportgegevens", "Identificatie van de onderzochte immutable configuratie.", 180, addPage);
  const delta = input.scoreDelta === null ? "Geen eerdere analyse" : `${input.scoreDelta >= 0 ? "+" : ""}${input.scoreDelta} procentpunt`;
  const rows = [
    ["Tenant", safe(input.tenantName), "Klant", safe(input.customerName)],
    ["FortiGate", safe(input.hostname), "Model", safe(input.model)],
    ["FortiOS", safe(input.fortiOsVersion), "Scoreverschil", delta],
    ["Configuratiedatum", iso(input.configDate), "Analysedatum", iso(input.analysisDate)],
    ["Parser", safe(input.parserVersion), "Ruleset", safe(input.rulesetVersion)],
    ["Configuratiehash", safe(input.hash), "Rapport-ID", safe(input.reportId)]
  ];
  for (const row of rows) {
    await ensureSpace(doc, 38, addPage);
    const y = doc.y;
    doc.moveTo(PAGE.left, y + 35).lineTo(PAGE.width - PAGE.right, y + 35).lineWidth(0.5).stroke(COLORS.line);
    drawDetail(doc, row[0], row[1], PAGE.left, y, 235);
    drawDetail(doc, row[2], row[3], PAGE.left + 260, y, 239);
    doc.y = y + 38;
  }
}

async function drawChanges(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  await sectionHeading(doc, "Verandering sinds de vorige configuratie", "Nieuwe en opgeloste technische aandachtspunten.", 105, addPage);
  const items = [
    ["Nieuwe bevindingen", input.newFindingIds.length, input.newFindingIds.length ? input.newFindingIds.join(", ") : "Geen nieuwe bevindingen vastgesteld."],
    ["Opgeloste bevindingen", input.resolvedFindingIds.length, input.resolvedFindingIds.length ? input.resolvedFindingIds.join(", ") : "Geen eerder vastgestelde bevindingen opgelost."]
  ] as const;
  for (const [label, count, detail] of items) {
    const textHeight = doc.heightOfString(safe(detail), { width: CONTENT_WIDTH - 112, lineGap: 2 });
    const height = Math.max(48, textHeight + 24);
    await ensureSpace(doc, height + 8, addPage);
    const y = doc.y;
    doc.roundedRect(PAGE.left, y, CONTENT_WIDTH, height, 6).fillAndStroke(COLORS.soft, COLORS.line);
    doc.fillColor(COLORS.blue).font("Helvetica-Bold").fontSize(17).text(String(count), PAGE.left + 14, y + 13, { width: 28, align: "center" });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(label, PAGE.left + 56, y + 10, { width: 150 });
    doc.fillColor(COLORS.body).font("Helvetica").fontSize(8.5).text(safe(detail), PAGE.left + 190, y + 10, { width: CONTENT_WIDTH - 204, lineGap: 2 });
    doc.y = y + height + 8;
  }
}

async function drawFindings(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  await sectionHeading(doc, "Technische bevindingen", "Gesorteerd op ernst. Objectnamen sluiten aan op de FortiGate-configuratie.", 100, addPage);
  const findings = [...input.findings].sort((a, b) => rank(a.severity) - rank(b.severity));
  if (!findings.length) {
    await emptyState(doc, "Geen technische bevindingen vastgesteld.", addPage);
    return;
  }
  let previousSeverity = "";
  for (const finding of findings) {
    if (finding.severity !== previousSeverity) {
      await severityHeading(doc, finding.severity, findings.filter((item) => item.severity === finding.severity).length, addPage);
      previousSeverity = finding.severity;
    }
    await findingCard(doc, finding, addPage);
  }
}

async function findingCard(doc: PDFKit.PDFDocument, finding: LocalFinding, addPage: () => void) {
  const title = safe(finding.title);
  const explanation = safe(finding.explanation);
  const evidence = safe(finding.evidence);
  const remediation = safe(finding.remediation);
  const innerWidth = CONTENT_WIDTH - 32;
  const height = 19
    + doc.heightOfString(title, { width: innerWidth, lineGap: 2 })
    + doc.heightOfString(explanation, { width: innerWidth, lineGap: 2.5 })
    + doc.heightOfString(evidence, { width: innerWidth - 72, lineGap: 2 })
    + doc.heightOfString(remediation, { width: innerWidth - 72, lineGap: 2 })
    + 72;
  await ensureSpace(doc, Math.min(height, 520), addPage);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, CONTENT_WIDTH, height, 7).fillAndStroke(COLORS.white, COLORS.line);
  doc.rect(PAGE.left, y, 5, height).fill(severityColor(finding.severity));
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5)
    .text(safe(finding.category).toUpperCase(), PAGE.left + 16, y + 13, { width: innerWidth, characterSpacing: 0.6 });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12)
    .text(title, PAGE.left + 16, y + 29, { width: innerWidth, lineGap: 2 });
  let cursor = doc.y + 10;
  doc.fillColor(COLORS.body).font("Helvetica").fontSize(9).text(explanation, PAGE.left + 16, cursor, { width: innerWidth, lineGap: 2.5 });
  cursor = doc.y + 12;
  cursor = labelledText(doc, "Bewijs", evidence, cursor, innerWidth);
  cursor = labelledText(doc, "Advies", remediation, cursor + 8, innerWidth);
  doc.y = Math.max(y + height + 10, cursor + 8);
}

async function drawPositiveControls(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  await sectionHeading(doc, "Positieve beveiligingsmaatregelen", "Geslaagde controles die aantoonbaar bijdragen aan de technische score.", 100, addPage);
  const components = input.scoreComponents.filter((item) => item.passed > 0);
  if (!components.length) {
    await emptyState(doc, "Geen toepasselijke geslaagde controles geregistreerd.", addPage);
    return;
  }
  for (const component of components) {
    const detail = `${component.passed} van ${component.passed + component.failed} toepasselijke controles geslaagd. Bijdrage: ${component.earned} van ${component.possible} gewogen punten.`;
    const height = Math.max(62, doc.heightOfString(detail, { width: CONTENT_WIDTH - 78, lineGap: 2 }) + 42);
    await ensureSpace(doc, height + 9, addPage);
    const y = doc.y;
    doc.roundedRect(PAGE.left, y, CONTENT_WIDTH, height, 7).fillAndStroke(COLORS.greenSoft, "#B8DECf");
    doc.circle(PAGE.left + 25, y + 25, 10).fill(COLORS.green);
    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text("OK", PAGE.left + 15, y + 21, { width: 20, align: "center" });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10.5).text(safe(component.title), PAGE.left + 48, y + 12, { width: CONTENT_WIDTH - 62 });
    doc.fillColor(COLORS.body).font("Helvetica").fontSize(8.5).text(detail, PAGE.left + 48, doc.y + 5, { width: CONTENT_WIDTH - 62, lineGap: 2 });
    doc.y = y + height + 9;
  }
}

async function drawMethodology(doc: PDFKit.PDFDocument, input: ReportInput, addPage: () => void) {
  if (doc.y > 300) addPage();
  await sectionHeading(doc, "Methodiek en interpretatie", "Technische context voor correcte lezing van dit rapport.", 150, addPage);
  const paragraphs = [
    `De score is lokaal en deterministisch berekend met parser ${safe(input.parserVersion)} en ruleset ${safe(input.rulesetVersion)}. De score is het percentage behaalde gewogen punten van alle toepasselijke controles. Goede instellingen tellen daardoor expliciet positief mee.`,
    "Azure AI Foundry kan uitsluitend veilige, getokeniseerde en geclassificeerde gegevens gebruiken voor de managementsamenvatting en toelichting. De ruwe FortiOS-configuratie, credentials, objectmapping en dit PDF-rapport verlaten de FortiBackup-server niet.",
    "Dit immutable rapport hoort bij exact één configuratiehash. Dispositions zoals geaccepteerd risico of false positive wijzigen de oorspronkelijke bevinding, severity, technische score en PDF niet."
  ];
  for (const paragraph of paragraphs) {
    await ensureSpace(doc, doc.heightOfString(paragraph, { width: CONTENT_WIDTH, lineGap: 3 }) + 20, addPage);
    doc.fillColor(COLORS.body).font("Helvetica").fontSize(9).text(paragraph, PAGE.left, doc.y, { width: CONTENT_WIDTH, lineGap: 3 });
    doc.moveDown(0.9);
  }
}

async function sectionHeading(doc: PDFKit.PDFDocument, title: string, subtitle: string, required: number, addPage: () => void) {
  await ensureSpace(doc, required, addPage);
  doc.moveDown(1.2);
  doc.fillColor(COLORS.blue).font("Helvetica-Bold").fontSize(7.5).text("FORTIBACKUP", PAGE.left, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.35);
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text(title, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.25);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(subtitle, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.9);
}

async function severityHeading(doc: PDFKit.PDFDocument, severity: string, count: number, addPage: () => void) {
  await ensureSpace(doc, 55, addPage);
  doc.moveDown(0.3);
  doc.fillColor(severityColor(severity)).font("Helvetica-Bold").fontSize(10)
    .text(`${severityLabel(severity)}  |  ${count} ${count === 1 ? "bevinding" : "bevindingen"}`, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.55);
}

function drawDetail(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x, y + 3, { width });
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(value, x, y + 16, { width, ellipsis: true });
}

function labelledText(doc: PDFKit.PDFDocument, label: string, value: string, y: number, width: number) {
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), PAGE.left + 16, y, { width: 62 });
  doc.fillColor(COLORS.body).font("Helvetica").fontSize(8.5).text(value, PAGE.left + 88, y, { width: width - 72, lineGap: 2 });
  return doc.y;
}

async function emptyState(doc: PDFKit.PDFDocument, text: string, addPage: () => void) {
  await ensureSpace(doc, 58, addPage);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, CONTENT_WIDTH, 48, 6).fillAndStroke(COLORS.greenSoft, "#B8DECF");
  doc.fillColor(COLORS.green).font("Helvetica-Bold").fontSize(9).text(text, PAGE.left + 16, y + 18, { width: CONTENT_WIDTH - 32 });
  doc.y = y + 58;
}

async function ensureSpace(doc: PDFKit.PDFDocument, height: number, addPage: () => void) {
  if (doc.y + height > PAGE.height - PAGE.bottom - 12) addPage();
}

function addPageNumbers(doc: PDFKit.PDFDocument, reportId: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    const label = `Rapport ${safe(reportId)}  |  Pagina ${index + 1} van ${range.count}`;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5);
    doc.text(label, PAGE.width - PAGE.right - doc.widthOfString(label), PAGE.height - 31, { lineBreak: false });
  }
}

function severityCounts(findings: LocalFinding[]) {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
}

function safe(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 4000);
}

function iso(value: Date) {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(value) + " UTC";
}

function rank(value: string) {
  const rankIndex = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(value);
  return rankIndex < 0 ? 99 : rankIndex;
}

function scoreColor(score: number) {
  return score >= 80 ? COLORS.green : score >= 60 ? COLORS.amber : COLORS.red;
}

function scoreLabel(score: number) {
  return score >= 90 ? "Sterk" : score >= 80 ? "Goed" : score >= 60 ? "Aandacht nodig" : "Hoog risico";
}

function severityColor(value: string) {
  return value === "CRITICAL" ? COLORS.critical : value === "HIGH" ? COLORS.red : value === "MEDIUM" ? COLORS.amber : "#2D63A3";
}

function severityLabel(value: string) {
  return value === "CRITICAL" ? "CRITICAL" : value === "HIGH" ? "HIGH" : value === "MEDIUM" ? "MEDIUM" : "LOW";
}
