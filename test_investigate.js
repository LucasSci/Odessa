const fs = require('fs');

const content = fs.readFileSync('src/CaptureStudio.tsx', 'utf-8');
const searchIndex = content.indexOf('/ocr/process');
console.log('Index of /ocr/process:', searchIndex);
if (searchIndex !== -1) {
    console.log(content.slice(searchIndex - 100, searchIndex + 100));
}

const ingestIndex = content.indexOf('/automation/ingest');
console.log('Index of /automation/ingest:', ingestIndex);
if (ingestIndex !== -1) {
    console.log(content.slice(ingestIndex - 100, ingestIndex + 100));
}
