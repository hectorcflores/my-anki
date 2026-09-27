import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../app/data.js', import.meta.url), 'utf8'), context, { timeout: 1000 });
const catalog = { schemaVersion: 1, ...context.window.ANKI };
if (!Array.isArray(catalog.books) || !catalog.books.length) throw new Error('Empty catalog');
writeFileSync(new URL('../app/catalog.json', import.meta.url), JSON.stringify(catalog));
writeFileSync(new URL('../ios/MyAnki/catalog.json', import.meta.url), JSON.stringify(catalog));
console.log(`Exported ${catalog.books.length} books from app/data.js`);
