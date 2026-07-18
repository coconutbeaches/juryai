import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = 'src/schemas/juryai-case-record-v0.1.2.schema.json';
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
schema.$defs.audit.properties.schema_version.const = '0.1.2';
fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

const packagePath = 'package.json';
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
delete packageJson.scripts.pretest;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

fs.rmSync(fileURLToPath(import.meta.url), { force: true });
