'use strict';
/* Lumen Cut — WebGL2 compositor. Renders the sequence at time t into a canvas: every video track bottom→top,
   each clip as a layer (transform, crop, colour, blur) composited with opacity and transition effects.
   Used by the Program monitor (fed by <video> elements) and by the offline exporter (fed by decoded VideoFrames). */
(function () {
  const VS = `#version 300 es
  in vec2 a; uniform mat3 M; out vec2 uv;
  void main(){ uv = a; vec3 p = M * vec3(a, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); }`;
  const FS_LAYER = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T; uniform vec4 crop; uniform float expo, bri, con, sat, temp; uniform int premul; out vec4 o;
  void main(){
    if (uv.x < crop.x || uv.y < crop.y || uv.x > 1.0 - crop.z || uv.y > 1.0 - crop.w) { o = vec4(0.0); return; }
    vec4 c = texture(T, uv);
    vec3 rgb = premul == 1 ? (c.a > 0.0 ? c.rgb / c.a : vec3(0.0)) : c.rgb;
    rgb *= exp2(expo);
    rgb += bri;
    rgb = (rgb - 0.5) * con + 0.5;
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722)); rgb = mix(vec3(l), rgb, sat);
    rgb *= vec3(1.0 + temp * 0.22, 1.0 + temp * 0.04, 1.0 - temp * 0.22);
    rgb = clamp(rgb, 0.0, 1.0);
    o = vec4(rgb * c.a, c.a);
  }`;
  const FS_BLUR = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T; uniform vec2 dir; out vec4 o;
  void main(){ vec2 st = vec2(uv.x, 1.0 - uv.y); vec4 s = vec4(0.0); float w = 0.0;
    for (int i = -16; i <= 16; i++) { float f = float(i); float k = exp(-f * f / 56.9); s += texture(T, st + dir * f) * k; w += k; }
    o = s / w; }`;
  const FS_COMP = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T; uniform float op, p, feather; uniform int mode; uniform vec2 off; uniform vec4 dip; out vec4 o;
  void main(){
    vec2 sv = uv - off;
    if (sv.x < 0.0 || sv.x > 1.0 || sv.y < 0.0 || sv.y > 1.0) discard;
    vec4 c = texture(T, vec2(sv.x, 1.0 - sv.y));
    float m = 1.0;
    if (mode == 1) m = smoothstep(p + feather, p - feather, uv.x);      // reveal left→right
    if (mode == 2) m = smoothstep(p - feather, p + feather, uv.x);      // hide left→right
    c.rgb = mix(c.rgb, dip.rgb * c.a, dip.a);
    o = c * op * m;
  }`;
  const FS_FILL = `#version 300 es
  precision highp float; uniform vec4 col; out vec4 o; void main(){ o = col; }`;

  function prog(gl, vs, fs) {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }
  const hexRgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const FULL = new Float32Array([2, 0, 0, 0, -2, 0, -1, 1, 1]);   // a∈[0,1]² → clip space, top-left origin

  class Compositor {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw new Error('WebGL2 not available');
      this.pL = prog(gl, VS, FS_LAYER); this.pB = prog(gl, VS, FS_BLUR); this.pC = prog(gl, VS, FS_COMP); this.pF = prog(gl, VS, FS_FILL);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.tex = new Map(); this.titleCache = new Map(); this.fbos = null; this.w = 0; this.h = 0;
      this.offline = null;
    }
    resize(w, h) {
      if (this.w === w && this.h === h) return;
      this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h;
      const gl = this.gl;
      if (this.fbos) this.fbos.forEach(f => { gl.deleteTexture(f.t); gl.deleteFramebuffer(f.f); });
      this.fbos = [0, 1].map(() => { const t = this.newTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    newTex() { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
    upload(key, src, premul, version) {
      const gl = this.gl; let e = this.tex.get(key);
      if (!e) { e = { t: this.newTex(), v: null }; this.tex.set(key, e); }
      gl.bindTexture(gl.TEXTURE_2D, e.t);
      if (version == null || e.v !== version) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premul);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (err) { return null; }
        e.v = version;
      }
      return e.t;
    }
    dropTextures(keep) { for (const [k, e] of this.tex) if (!keep.has(k)) { this.gl.deleteTexture(e.t); this.tex.delete(k); } }

    /* Layers active on track `tr` at time t → [{clip, t, comp:{mode,p,off,dip,op}}] */
    static layersAt(tr, t) {
      const clips = LC.clipsOn(tr.id).filter(c => !c.disabled);
      const trs = LC.project.transitions.filter(x => x.track === tr.id);
      const out = []; const eps = 1e-6;
      for (const x of trs) {
        const r = LC.trRegion(x); if (t < r.s - eps || t >= r.e - eps) continue;
        const p = Math.min(1, Math.max(0, (t - r.s) / (r.e - r.s)));
        const a = x.a && LC.clip(x.a), b = x.b && LC.clip(x.b);
        if (a && a.disabled || b && b.disabled) continue;
        const dipc = x.type === 'dipwhite' ? [1, 1, 1] : [0, 0, 0], isDip = x.type === 'dipblack' || x.type === 'dipwhite';
        if (a && b) {
          if (isDip) { if (p < .5) out.push({ clip: a, comp: { dip: [...dipc, p * 2] } }); else out.push({ clip: b, comp: { dip: [...dipc, 2 - p * 2] } }); }
          else if (x.type === 'push') { out.push({ clip: a, comp: { off: [-p, 0] } }, { clip: b, comp: { off: [1 - p, 0] } }); }
          else { out.push({ clip: a, comp: {} }); out.push({ clip: b, comp: x.type === 'dissolve' ? { op: p } : x.type === 'wipe' ? { mode: 1, p } : { off: [1 - p, 0] } }); }
        } else if (b) {
          out.push({ clip: b, comp: isDip ? { dip: [...dipc, 1 - p] } : x.type === 'dissolve' ? { op: p } : x.type === 'wipe' ? { mode: 1, p } : { off: [1 - p, 0] } });
        } else {
          out.push({ clip: a, comp: isDip ? { dip: [...dipc, p] } : x.type === 'dissolve' ? { op: 1 - p } : x.type === 'wipe' ? { mode: 2, p } : { off: [-p, 0] } });
        }
        return out;
      }
      const c = clips.find(c => t >= c.start - eps && t < c.start + c.dur - eps);
      if (c) out.push({ clip: c, comp: {} });
      return out;
    }

    /* getSrc(clip, srcTime) → {src, w, h, key, premul?} | 'offline' | null.  opts.scale: output/project size ratio */
    render(t, getSrc, opts = {}) {
      const gl = this.gl, P = LC.project, S = P.settings;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
      const bg = hexRgb(S.bg); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const used = new Set(); let drawn = 0;
      for (const tr of LC.videoTracks()) {
        if (tr.mute) continue;
        for (const L of Compositor.layersAt(tr, t)) { if (this.drawLayer(L.clip, t, L.comp, getSrc, used)) drawn++; }
      }
      if (opts.gc !== false) this.dropTextures(used);
      return drawn;
    }
    drawLayer(c, t, comp, getSrc, used) {
      const gl = this.gl, S = LC.project.settings, W = this.w, H = this.h, k = W / S.w;
      const tl = Math.min(Math.max(t - c.start, 0), c.dur);
      let tex, sw, sh, premul = false;
      if (c.type === 'title') {
        const can = this.titleCanvas(c, t - c.start); if (!can) return false;
        tex = this.upload('title:' + c.id, can, true, can._ver); sw = W; sh = H; premul = true; used.add('title:' + c.id);
      } else {
        const m = LC.mediaOf(c);
        let st = LC.srcTime(c, t);
        if (m && c.type === 'video') st = Math.min(Math.max(st, 0), Math.max(0, m.duration - 1 / Math.max(24, S.fps)));
        let s = getSrc(c, st);
        if (s === 'offline' || (!s && m && LC.rt.media.get(m.id)?.status === 'offline')) s = { src: offlineCanvas(), w: 640, h: 360, key: 'offline', version: 1 };
        if (!s) return false;
        tex = this.upload(s.key, s.src, s.premul, s.version); if (!tex) return false; used.add(s.key);
        sw = s.w; sh = s.h; premul = !!s.premul;
      }
      const pos = LC.valueAt(c, 'pos', tl), scale = LC.valueAt(c, 'scale', tl) / 100, rot = LC.valueAt(c, 'rot', tl) * Math.PI / 180;
      const opacity = Math.max(0, Math.min(1, LC.valueAt(c, 'opacity', tl) / 100)), pr = c.props;
      // fit source into frame, then scale
      const fit = c.type === 'title' ? 1 : Math.min(W / sw, H / sh);
      const qw = sw * fit * scale, qh = sh * fit * scale, cx = pos[0] * W, cy = pos[1] * H;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      // pixel = C + R*((a-0.5)*Q) ; clip = (2px/W - 1, 1 - 2py/H)
      const ax = qw * cs, ay = qw * sn, bx = -qh * sn, by = qh * cs;
      const ox = cx - .5 * ax - .5 * bx, oy = cy - .5 * ay - .5 * by;
      const M = new Float32Array([2 * ax / W, -2 * ay / H, 0, 2 * bx / W, -2 * by / H, 0, 2 * ox / W - 1, 1 - 2 * oy / H, 1]);
      // pass 1: layer → fbo0
      const F = this.fbos;
      gl.bindFramebuffer(gl.FRAMEBUFFER, F[0].f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND);
      const L = this.pL; gl.useProgram(L.p);
      gl.uniformMatrix3fv(L.u.M, false, M); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(L.u.T, 0);
      gl.uniform4f(L.u.crop, pr.crop[0] / 100, pr.crop[1] / 100, pr.crop[2] / 100, pr.crop[3] / 100);
      gl.uniform1f(L.u.expo, pr.exposure); gl.uniform1f(L.u.bri, pr.brightness / 200); gl.uniform1f(L.u.con, 1 + pr.contrast / 100);
      gl.uniform1f(L.u.sat, pr.saturation / 100); gl.uniform1f(L.u.temp, pr.temperature / 100); gl.uniform1i(L.u.premul, premul ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      let src = F[0];
      if (pr.blur > 0) {                       // separable gaussian, σ = blur px (project space), 33 taps over ±3σ
        const step = (3 * pr.blur * k) / 16; const B = this.pB; gl.useProgram(B.p); gl.uniformMatrix3fv(B.u.M, false, FULL); gl.uniform1i(B.u.T, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F[1].f); gl.bindTexture(gl.TEXTURE_2D, F[0].t); gl.uniform2f(B.u.dir, step / W, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F[0].f); gl.bindTexture(gl.TEXTURE_2D, F[1].t); gl.uniform2f(B.u.dir, 0, step / H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // pass 2: composite onto the output
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.BLEND);
      const C = this.pC; gl.useProgram(C.p); gl.uniformMatrix3fv(C.u.M, false, FULL); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(C.u.T, 0);
      gl.uniform1f(C.u.op, opacity * (comp.op ?? 1)); gl.uniform1i(C.u.mode, comp.mode || 0); gl.uniform1f(C.u.p, comp.p ?? 0); gl.uniform1f(C.u.feather, 0.012);
      const off = comp.off || [0, 0]; gl.uniform2f(C.u.off, off[0], off[1]);
      const d = comp.dip || [0, 0, 0, 0]; gl.uniform4f(C.u.dip, d[0], d[1], d[2], d[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    }
    /* ---------- titles (Canvas 2D → texture) ---------- */
    titleCanvas(c, tl) {
      const W = this.w, H = this.h, k = W / LC.project.settings.w;
      let e = this.titleCache.get(c.id);
      if (!e || e.can.width !== W || e.can.height !== H) { const can = new OffscreenCanvas(W, H); e = { can, key: null }; this.titleCache.set(c.id, e); can._ver = 0; }
      const st = LC.titleState(c, tl);
      const key = JSON.stringify(c.title) + '|' + st.key + '|' + W;
      if (e.key !== key) { e.key = key; e.can._ver++; LC.drawTitle(e.can.getContext('2d'), W, H, k, c.title, st); }
      return e.can;
    }
  }
  LC.Compositor = Compositor;

  /* Title animation state at local time tl */
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  LC.titleState = (c, tl) => {
    const T = c.title, d = Math.max(.05, Math.min(T.animDur, c.dur / 2));
    const pin = T.animIn === 'none' ? 1 : ease(tl / d), pout = T.animOut === 'none' ? 1 : ease((c.dur - tl) / d);
    let alpha = 1, dy = 0, sc = 1, chars = Infinity;
    const apply = (kind, p, dir) => {
      if (kind === 'fade') alpha *= p;
      else if (kind === 'slide') { alpha *= p; dy += (1 - p) * .07 * dir; }
      else if (kind === 'zoom') { alpha *= p; sc *= .75 + .25 * p; }
      else if (kind === 'typewriter') { if (dir > 0) { const n = T.text.length; chars = Math.min(chars, Math.floor(Math.max(0, tl) / Math.max(.02, Math.min(.06, (c.dur * .6) / Math.max(1, n))))); } else alpha *= p; }
    };
    apply(T.animIn, pin, 1); apply(T.animOut, pout, -1);
    return { alpha, dy, sc, chars, key: `${alpha.toFixed(3)}|${dy.toFixed(4)}|${sc.toFixed(3)}|${chars}` };
  };
  LC.drawTitle = (ctx, W, H, k, T, st) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    if (st.alpha <= 0.001) return;
    const size = T.size * k, lh = size * 1.18;
    ctx.font = `${T.italic ? 'italic ' : ''}${T.bold ? 700 : 400} ${size}px "${T.font}", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    let text = T.text; if (isFinite(st.chars)) text = text.slice(0, st.chars);
    const full = T.text.split('\n'), lines = text.split('\n');
    const widths = full.map(l => ctx.measureText(l).width), bw = Math.max(1, ...widths), bh = full.length * lh;
    const x = T.x * W, y = (T.y + st.dy) * H;
    const left = T.align === 'left' ? x : T.align === 'right' ? x - bw : x - bw / 2;
    ctx.globalAlpha = st.alpha;
    ctx.translate(x, y); ctx.scale(st.sc, st.sc); ctx.translate(-x, -y);
    if (T.box) {
      const pad = T.boxPad * k; ctx.fillStyle = T.boxColor; ctx.globalAlpha = st.alpha * T.boxOpacity / 100;
      const r = Math.min(12 * k, pad); ctx.beginPath(); ctx.roundRect(left - pad, y - bh / 2 - pad * .6, bw + pad * 2, bh + pad * 1.2, r); ctx.fill();
      ctx.globalAlpha = st.alpha;
    }
    ctx.textAlign = T.align;
    lines.forEach((ln, i) => {
      const ly = y - bh / 2 + lh * (i + .5);
      if (T.shadow) { ctx.shadowColor = T.shadowColor; ctx.shadowBlur = T.shadowBlur * k; ctx.shadowOffsetX = ctx.shadowOffsetY = T.shadowDist * k; }
      if (T.stroke && T.strokeWidth > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = T.strokeColor; ctx.lineWidth = T.strokeWidth * 2 * k; ctx.strokeText(ln, x, ly); ctx.shadowColor = 'transparent'; }
      ctx.fillStyle = T.color; ctx.fillText(ln, x, ly);
      ctx.shadowColor = 'transparent';
    });
    if (isFinite(st.chars) && st.chars < T.text.length) {                      // typing caret
      const li = lines.length - 1, ly = y - bh / 2 + lh * (li + .5), lw = ctx.measureText(lines[li]).width;
      const cx = T.align === 'left' ? x + lw : T.align === 'right' ? x : x - widths[li] / 2 + lw;
      ctx.fillStyle = T.color; ctx.fillRect(cx + size * .06, ly - size * .45, Math.max(2, size * .06), size * .9);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  };

  let offCan = null;
  function offlineCanvas() {
    if (offCan) return offCan;
    offCan = document.createElement('canvas'); offCan.width = 640; offCan.height = 360; const x = offCan.getContext('2d');
    x.fillStyle = '#b3241b'; x.fillRect(0, 0, 640, 360);
    for (let i = -360; i < 640; i += 40) { x.fillStyle = 'rgba(0,0,0,.12)'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 20, 0); x.lineTo(i + 380, 360); x.lineTo(i + 360, 360); x.fill(); }
    x.fillStyle = '#fff'; x.font = '700 40px "Segoe UI"'; x.textAlign = 'center'; x.fillText('Media Offline', 320, 175); x.font = '20px "Segoe UI"'; x.fillText('File → Relink Media… to locate it', 320, 215);
    return offCan;
  }
})();
