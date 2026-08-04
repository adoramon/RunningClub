import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const sourcePath = process.argv[2];
const outputPath = process.argv[3];
if (!sourcePath || !outputPath) throw new Error('用法：node build-legacy-import.mjs <xlsx路径> <输出json路径>');

const toA1 = (column, row) => {
  let letters = '';
  let value = column + 1;
  while (value) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return `${letters}${row + 1}`;
};
const raw = value => (value === undefined ? null : value);
const numberValue = value => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) return Number(value.trim());
  return null;
};
const parseMonth = label => {
  const match = String(label).match(/(\d{4})年(\d{1,2})月/);
  if (!match) throw new Error(`无法解析月份：${label}`);
  return `${match[1]}-${match[2].padStart(2, '0')}`;
};

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItemAt(0);
const values = sheet.getUsedRange().values;
const sourceSheet = sheet.name;
const periods = [];

for (let targetColumn = 1; targetColumn < values[1].length; targetColumn += 2) {
  const label = values[1][targetColumn];
  if (!label) continue;
  periods.push({ month: parseMonth(label), label: String(label), targetColumn, actualColumn: targetColumn + 1 });
}

const members = [];
for (let row = 3; row < values.length; row += 1) {
  const alias = values[row][0];
  if (!alias || !String(alias).trim()) continue;
  const normalizedAlias = String(alias).trim();
  const legacyMemberKey = `legacy-member-${String(members.length + 1).padStart(3, '0')}`;
  members.push({ legacyMemberKey, alias: normalizedAlias, normalizedAlias, sourceRow: row + 1, claimStatus: 'unclaimed' });
}

const records = [];
for (const member of members) {
  const row = member.sourceRow - 1;
  for (const period of periods) {
    const targetRaw = raw(values[row][period.targetColumn]);
    const actualRaw = raw(values[row][period.actualColumn]);
    const actualText = typeof actualRaw === 'string' ? actualRaw.trim() : '';
    const fundMatch = actualText.match(/[交收]\s*(\d+(?:\.\d+)?)\s*元/);
    const equivalentKm = numberValue(actualRaw);
    const recordState = equivalentKm !== null ? 'distance' : fundMatch ? 'fund' : actualRaw === null ? 'empty' : 'note';
    records.push({
      legacyRecordKey: `${member.legacyMemberKey}-${period.month}`,
      legacyMemberKey: member.legacyMemberKey,
      month: period.month,
      targetRaw,
      actualRaw,
      targetKm: numberValue(targetRaw),
      equivalentKm,
      fundAmount: fundMatch ? Number(fundMatch[1]) : null,
      recordState,
      source: { sheet: sourceSheet, row: member.sourceRow, targetCell: toA1(period.targetColumn + 1, row), actualCell: toA1(period.actualColumn + 1, row), monthLabel: period.label }
    });
  }
}

const payload = { sourceFileName: sourcePath.split('/').pop(), sourceSheet, periods, members, records };
payload.checksum = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
await fs.mkdir(outputPath.slice(0, outputPath.lastIndexOf('/')), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(payload));
console.log(JSON.stringify({ members: members.length, periods: periods.length, records: records.length, checksum: payload.checksum }));
