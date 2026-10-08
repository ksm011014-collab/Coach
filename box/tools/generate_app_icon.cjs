const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const assets = path.join(root, 'windows', 'BoxingCoach.Desktop', 'Assets');
  fs.mkdirSync(assets, {recursive:true});
  const mark = fs.readFileSync(path.join(root, 'web/brand/seonrang-mark.png')).toString('base64');
  const icon = padding => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="104" fill="#050505"/><image x="${padding}" y="${padding}" width="${512-padding*2}" height="${512-padding*2}" href="data:image/png;base64,${mark}"/></svg>`;
  const svg = icon(48);
  const icons = path.join(root,'web/icons');
  fs.writeFileSync(path.join(icons,'app-icon.svg'),svg);
  fs.writeFileSync(path.join(icons,'app-icon-maskable.svg'),icon(96).replace('rx="104"','rx="0"'));
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({path:path.join(assets,'JDC.png'),omitBackground:true});
    await page.screenshot({path:path.join(icons,'app-icon-512.png'),omitBackground:true});
    await page.setViewportSize({width:192,height:192});
    await page.screenshot({path:path.join(icons,'app-icon-192.png'),omitBackground:true});
    await page.setViewportSize({width:180,height:180});
    await page.screenshot({path:path.join(icons,'apple-touch-icon.png'),omitBackground:true});
    await page.setViewportSize({width:512,height:512});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${icon(96).replace('rx="104"','rx="0"')}`);
    await page.screenshot({path:path.join(icons,'app-icon-maskable-512.png'),omitBackground:true});
    const android = path.join(root,'android/app/src/main/res/drawable-nodpi');
    fs.mkdirSync(android,{recursive:true});
    await page.screenshot({path:path.join(android,'ic_launcher.png'),omitBackground:true});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
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
  console.log('Seonrang web, Android and multi-size Windows icons generated. No executable built.');
})().catch(error => {console.error(error.message);process.exitCode=1;});
