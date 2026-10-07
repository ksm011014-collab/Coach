const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let offset = start; offset + 8 <= end;) {
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) { size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new Error('Invalid MP4 box');
    result.push({ type: buffer.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function timing(buffer) {
  const child = (parent, type) => boxes(buffer, parent.start, parent.end).find(box => box.type === type);
  const movie = boxes(buffer).find(box => box.type === 'moov');
  if (!movie) throw new Error('MP4 movie metadata missing');
  for (const track of boxes(buffer, movie.start, movie.end).filter(box => box.type === 'trak')) {
    const media = child(track, 'mdia');
    if (!media) continue;
    const handler = child(media, 'hdlr');
    if (!handler || buffer.toString('ascii', handler.start + 8, handler.start + 12) !== 'vide') continue;
    const header = child(media, 'mdhd');
    const scale = buffer.readUInt32BE(header.start + (buffer[header.start] === 1 ? 20 : 12));
    const samples = child(child(child(media, 'minf'), 'stbl'), 'stts');
    const entries = buffer.readUInt32BE(samples.start + 4);
    let frames = 0;
    let ticks = 0;
    const deltas = new Set();
    for (let index = 0; index < entries; index++) {
      const count = buffer.readUInt32BE(samples.start + 8 + index * 8);
      const delta = buffer.readUInt32BE(samples.start + 12 + index * 8);
      frames += count;
      ticks += count * delta;
      deltas.add(delta);
    }
    return { frames: frames || null, timescale: scale, media_duration_seconds: ticks ? ticks / scale : null,
      average_fps: frames && ticks ? frames * scale / ticks : null, variable_frame_duration: frames ? deltas.size > 1 : null,
      timing_source: frames ? 'stts' : 'unavailable_in_stts' };
  }
  throw new Error('Video track missing');
}

async function main() {
  const [input, output, startArgument, endArgument] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/inspect_motion_video.cjs input.mp4 output-prefix [start-seconds end-seconds]');
  if (fs.existsSync(`${output}.json`) || fs.existsSync(`${output}.png`)) throw new Error('Choose a new output prefix');
  const buffer = fs.readFileSync(input);
  const metadata = { file: path.basename(input), sha256: crypto.createHash('sha256').update(buffer).digest('hex'), ...timing(buffer) };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input type="file"><video muted></video><canvas></canvas>');
    await page.locator('input').setInputFiles(path.resolve(input));
    const frames = await page.evaluate(async ({ startArgument, endArgument }) => {
      const video = document.querySelector('video');
      video.src = URL.createObjectURL(document.querySelector('input').files[0]);
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Video decode failed')); });
      const start = startArgument === undefined ? 0 : Number(startArgument);
      const end = endArgument === undefined ? video.duration : Number(endArgument);
      if (!(start >= 0 && end > start && end <= video.duration + 0.001)) throw new Error('Invalid sample interval');
      const canvas = document.querySelector('canvas');
      canvas.width = 1280; canvas.height = 1104;
      const context = canvas.getContext('2d');
      context.fillStyle = '#101820'; context.fillRect(0, 0, canvas.width, canvas.height);
      const times = [];
      for (let index = 0; index < 16; index++) {
        const time = Math.min(video.duration - 0.001, start + (end - start) * (index + 0.5) / 16);
        await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
        const left = (index % 4) * 320;
        const top = Math.floor(index / 4) * 276;
        const scale = Math.min(320 / video.videoWidth, 248 / video.videoHeight);
        const width = video.videoWidth * scale, height = video.videoHeight * scale;
        context.drawImage(video, left + (320 - width) / 2, top + (248 - height) / 2, width, height);
        context.fillStyle = '#ffffff'; context.font = '16px sans-serif';
        context.fillText(`${time.toFixed(3)} s`, left + 8, top + 267);
        times.push(time);
      }
      return { width: video.videoWidth, height: video.videoHeight, duration_seconds: video.duration, sampled_seconds: times, png: canvas.toDataURL('image/png').split(',')[1] };
    }, { startArgument, endArgument });
    const { png, ...details } = frames;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(`${output}.png`, Buffer.from(png, 'base64'), { flag: 'wx' });
    fs.writeFileSync(`${output}.json`, JSON.stringify({ ...metadata, ...details }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...metadata, ...details }));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
