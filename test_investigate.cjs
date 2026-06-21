const fs = require('fs');
let content = fs.readFileSync('src/CaptureStudio.tsx', 'utf-8');
const i1 = content.indexOf('addCaptureEvent(');
const i2 = content.indexOf('emitEvent(', i1);
console.log(content.slice(i2 - 200, i2 + 200));
