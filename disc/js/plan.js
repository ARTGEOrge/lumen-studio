// Lumen Disc — what to ask ffmpeg for. Kept free of the page so Node tests can use it.
import { STANDARDS } from './dvd.js';

export const AUDIO_K = 192;
export const SAMPLE = { w: 1280, h: 720, dur: 20 };
export const inputName = (c) => c.id + (c.name.match(/\.[a-z0-9]+$/i)?.[0] || '.mp4').toLowerCase();

// Reads what ffmpeg prints about each input.
export function parseProbe(logs) {
  const out = {}; let cur = null;
  for (const line of logs) {
    const f = line.match(/^@@FILE (.+)$/);
    if (f) { cur = out[f[1]] = { dur: 0, video: null, audio: false }; continue; }
    if (!cur) continue;
    let m = line.match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) cur.dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = line.match(/Stream #\d+:\d+.*?: Video: (\w+)(.*)/);
    if (m && !cur.video && !/attached pic/.test(line)) {
      const size = m[2].match(/, (\d{2,5})x(\d{2,5})/), sar = m[2].match(/SAR (\d+):(\d+)/), fps = m[2].match(/([\d.]+) fps/);
      if (size) cur.video = { codec: m[1], w: +size[1], h: +size[2], sar: sar && +sar[2] ? +sar[1] / +sar[2] : 1, fps: fps ? +fps[1] : 0, rot: 0 };
    }
    if (/Stream #\d+:\d+.*?: Audio: /.test(line)) cur.audio = true;
    m = line.match(/rotation of (-?[\d.]+) degrees/);
    if (m && cur.video && Math.abs(Math.abs(+m[1]) - 90) < 1) cur.video.rot = 90;
  }
  return out;
}

// Size the picture into the DVD frame, keeping its shape (letterbox or pillarbox).
export function fitFrame(c, std, aspect) {
  const [W, H] = std.size, D = aspect === '16:9' ? 16 / 9 : 4 / 3;
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  return c.dar >= D ? { w: W, h: even((H * D) / c.dar) } : { w: even((W * c.dar) / D), h: H };
}

// Frame rates and the GOP sizes a DVD allows. A VOBU (one GOP here) must last
// at least 0.4 s, or ffmpeg's muxer folds it into the one before.
const GOP = { ntsc: { fps: 30000 / 1001, min: 12, max: 18 }, pal: { fps: 25, min: 10, max: 15 } };

// Picks every key frame: chapters land on exact frames and each GOP stays
// within the DVD limits. A chapter too close to the next one is dropped.
export function keyframes(total, chapterFrames, g) {
  const cuts = [0];
  for (const f of [...chapterFrames].sort((a, b) => a - b)) if (f - cuts[cuts.length - 1] >= g.min && total - f >= g.min) cuts.push(f);
  const kf = [], kept = [];
  for (let i = 0; i < cuts.length; i++) {
    let a = cuts[i];
    const b = i + 1 < cuts.length ? cuts[i + 1] : total, L = b - a;
    let k = Math.ceil(L / g.max);
    if (i + 1 < cuts.length && L / k < g.min) {   // cannot split evenly: merge into the next chapter
      cuts.splice(i + 1, 1); i--; continue;
    }
    kept.push(a);
    for (let j = 0; j < k; j++) { kf.push(a); a += Math.floor(L / k) + (j < L % k ? 1 : 0); }
  }
  return { kf, chapters: kept };
}

// Builds the ffmpeg command. Returns the args, the files to mount, and the
// chapter start times (seconds) that the encoder will really cut at.
export function buildArgs(list, p) {
  const std = p.std, pal = std === STANDARDS.pal, g = GOP[pal ? 'pal' : 'ntsc'];
  const [W, H] = std.size, args = ['-hide_banner', '-stats_period', '0.5', '-stats'];
  const graph = [], files = []; let n = 0;
  const frames = list.map((c) => Math.max(1, Math.round(c.dur * g.fps)));
  list.forEach((c, k) => {
    const d = (frames[k] / g.fps).toFixed(6);
    let vi, ai;
    if (c.sample) {
      args.push('-f', 'lavfi', '-i', `testsrc2=size=${SAMPLE.w}x${SAMPLE.h}:rate=30:duration=${SAMPLE.dur}`); vi = n++;
      args.push('-f', 'lavfi', '-i', `sine=frequency=440:beep_factor=4:sample_rate=48000:duration=${SAMPLE.dur}`); ai = n++;
    } else {
      files.push({ name: inputName(c), data: c.blob });
      args.push('-i', '/in/' + inputName(c)); vi = n++;
      if (c.audio) ai = vi;
      else { args.push('-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=48000:cl=stereo'); ai = n++; }
    }
    const f = fitFrame(c, std, p.aspect);
    // tpad holds the last picture if a stream ends a little before its stated length.
    graph.push(`[${vi}:v:0]setpts=PTS-STARTPTS,fps=${std.rate},tpad=stop=-1:stop_mode=clone,trim=end_frame=${frames[k]},` +
      `scale=${f.w}:${f.h}:flags=bicubic,setsar=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[v${k}]`);
    graph.push(`[${ai}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=${d}[a${k}]`);
  });
  graph.push(list.map((_, k) => `[v${k}][a${k}]`).join('') + `concat=n=${list.length}:v=1:a=1[vc][ac]`);
  graph.push(`[vc]setdar=${p.aspect === '16:9' ? '16/9' : '4/3'}[vo]`);
  const total = frames.reduce((s, x) => s + x, 0);
  const { kf, chapters } = keyframes(total, p.chapters.map((t) => Math.round(t * g.fps)), g);
  args.push('-filter_complex', graph.join(';'), '-map', '[vo]', '-map', '[ac]',
    '-target', pal ? 'pal-dvd' : 'ntsc-dvd',
    '-b:v', p.videoK + 'k', '-maxrate', '9000k', '-bufsize', '1835k', '-g', '1000', '-bf', '2',
    '-flags', '+cgop', '-sc_threshold', '1000000000',
    '-force_key_frames', kf.slice(1).map((f) => ((f - 0.25) / g.fps).toFixed(4)).join(',') || '0',
    '-c:a', 'ac3', '-b:a', AUDIO_K + 'k', '-ar', '48000', '-ac', '2', '-aspect', p.aspect, '-f', 'dvd', '-y', '/out/disc.vob');
  return { args, files, chapters: chapters.map((f) => f / g.fps), duration: total / g.fps };
}
