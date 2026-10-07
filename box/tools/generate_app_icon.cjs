const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const assets = path.join(root, 'windows', 'BoxingCoach.Desktop', 'Assets');
  fs.mkdirSync(assets, {recursive:true});
  const svg = fs.readFileSync(path.join(root, 'web/icons/app-icon.svg'), 'utf8');
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({path:path.join(assets,'JDC.png'),omitBackground:true});
    const sizes = [16,24,32,48,64,128,256];
    const images = [];
    for (const size of sizes) {
      await page.setViewportSize({width:size,height:size});
      images.push(await page.screenshot({omitBackground:true}));
    }
    const directory = Buffer.alloc(6 + sizes.length * 16);
    directory.writeUInt16LE(1,2);
    directory.writeUInt16LE(sizes.length,4);
    let offset = directory.length;
    sizes.forEach((size,index) => {
      const entry = 6 + index * 16;
      directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
      directory.writeUInt16LE(1,entry + 4);
      directory.writeUInt16LE(32,entry + 6);
      directory.writeUInt32LE(images[index].length,entry + 8);
      directory.writeUInt32LE(offset,entry + 12);
      offset += images[index].length;
    });
    fs.writeFileSync(path.join(assets,'JDC.ico'),Buffer.concat([directory,...images]));
  } finally { await browser.close(); }
  console.log('JDC PNG and multi-size Windows ICO generated.');
})().catch(error => {console.error(error.message);process.exitCode=1;});
