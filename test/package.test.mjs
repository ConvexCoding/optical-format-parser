import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('packed dependency installs, runs and typechecks in an isolated JS/TS consumer', () => {
  const temp = mkdtempSync(join(tmpdir(), 'optical-import-consumer-'));
  const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
    const files = pack.files.map(file => file.path);
    for (const path of ['dist/index.js', 'dist/index.d.ts', 'schema/prescription.schema.json', 'README.md', 'LICENSE', 'docs/compatibility.md']) assert.ok(files.includes(path), 'Missing ' + path);
    assert.ok(files.every(path => !/^(src|test|examples|scripts|node_modules|python)\//.test(path)), 'Unexpected development files in package');
    assert.ok(files.every(path => !path.endsWith('.py')));
    const consumer = join(temp, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    run('npm', ['install', join(temp, pack.filename), '--ignore-scripts', '--offline', '--omit=dev', '--no-audit', '--no-fund'], consumer);
    writeFileSync(join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText, parseBytes, stringify } from 'optical-format-import';
const source = 'NAME consumer\\nUNIT MM\\nENPD 4\\nSURF 0\\nCURV 0\\nDISZ INFINITY\\nSURF 1\\nCURV 0.05\\nDISZ 2\\n';
const data = parseText(source, {format: 'zemax', strict: true});
assert.equal(data.surfaces[1].radiusMm, 20);
assert.deepEqual(data.surfaces[0].thicknessMm, {special: 'positiveInfinity'});
assert.deepEqual(parseBytes(new TextEncoder().encode(source), {format: 'zemax'}).surfaces, data.surfaces);
assert.deepEqual(JSON.parse(stringify(data)), data);
const schema = JSON.parse(readFileSync(new URL(import.meta.resolve('optical-format-import/schema')), 'utf8'));
assert.equal(schema.properties.schemaVersion.const, data.schemaVersion);
const pkg = JSON.parse(readFileSync('./node_modules/optical-format-import/package.json', 'utf8'));
assert.deepEqual(pkg.dependencies, {});
assert.equal(Object.keys(pkg.scripts).some(key => ['install','postinstall','preinstall'].includes(key)), false);
const oslo = parseText('LEN NEW "consumer" 1 1\\nEBR 2; RD 0; NXT; RD 20; END 1\\n', {format:'oslo', strict:true});
assert.equal(oslo.surfaces[1].radiusMm, 20);
`);
    run(process.execPath, ['consumer.mjs'], consumer);
    writeFileSync(join(consumer, 'consumer.mts'), `
import { parseBytes, parseText, stringify } from 'optical-format-import';
import type { NormalizedPrescription, OpticalNumber, ParseOptions } from 'optical-format-import';
const options: ParseOptions = {format:'zemax', strict:true};
const prescription: NormalizedPrescription = parseText('text', options);
const radius: OpticalNumber = prescription.surfaces[0].radiusMm;
if (typeof radius !== 'number') { const special: 'positiveInfinity' | 'negativeInfinity' = radius.special; }
const output: string = stringify(prescription);
async function fromFile(file: File): Promise<NormalizedPrescription> { return parseBytes(await file.arrayBuffer(), options); }
// @ts-expect-error invalid format must fail at compile time
parseText('text', {format:'invalid'});
`);
    const compiler = join(root, 'node_modules/typescript/bin/tsc');
    for (const [module, moduleResolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler']]) {
      writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module, moduleResolution, strict: true, noEmit: true }, include: ['consumer.mts'] }));
      run(process.execPath, [compiler, '-p', 'tsconfig.json'], consumer);
    }
  } finally { rmSync(temp, {recursive:true, force:true}); }
});
