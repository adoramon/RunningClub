import fs from 'node:fs/promises';

const inputPath = process.argv[2];
const outputDir = process.argv[3];
if (!inputPath || !outputDir) throw new Error('用法：node build-history-jsonl.mjs <历史json路径> <输出目录>');

const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const batchId = `legacy-import-${payload.checksum.slice(0, 16)}`;
const writeJsonLines = async (name, documents) => {
  const text = documents.map(document => JSON.stringify(document)).join('\n') + '\n';
  await fs.writeFile(`${outputDir}/${name}.jsonl`, text, 'utf8');
};

await fs.mkdir(outputDir, { recursive: true });
await writeJsonLines('historical_members', payload.members.map(member => ({ _id: member.legacyMemberKey, ...member, importBatchId: batchId })));
await writeJsonLines('historical_monthly_records', payload.records.map(record => ({ _id: record.legacyRecordKey, ...record, importBatchId: batchId })));
await writeJsonLines('history_import_batches', [{ _id: batchId, sourceFileName: payload.sourceFileName, sourceSheet: payload.sourceSheet, periodCount: payload.periods.length, memberCount: payload.members.length, recordCount: payload.records.length, checksum: payload.checksum, status: 'completed' }]);
await writeJsonLines('fund_ledger', [{ _id: 'legacy-opening-2026-07', month: '2026-07', entryType: 'opening_balance', amount: -257, status: 'confirmed', note: '历史期末余额结转', importBatchId: batchId }]);
console.log(JSON.stringify({ outputDir, members: payload.members.length, records: payload.records.length, batchId }));
