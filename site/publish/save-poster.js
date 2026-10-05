// Saves the poster the browser captured (a saved tool result: [{type, text}] whose text is a JSON
// string with { ready, w, h, jpeg }) as a JPEG file.
const fs = require('fs');
const [resultFile, out] = process.argv.slice(2);
const text = JSON.parse(fs.readFileSync(resultFile, 'utf8')).map((x) => x.text).join('').split(/\n\s*Tab Context:/)[0].trim();
let data = JSON.parse(text);
if (typeof data === 'string') data = JSON.parse(data);
if (!data.ready) throw new Error('the scene was not drawn yet');
const buf = Buffer.from(data.jpeg, 'base64');
if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
fs.writeFileSync(out, buf);
console.log(`${out}: ${buf.length} bytes, canvas ${data.w}x${data.h}`);
