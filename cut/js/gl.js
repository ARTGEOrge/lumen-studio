'use strict';
/* Lumen Cut — WebGL2 compositor. Renders the sequence at time t into a canvas: every video track bottom→top,
   each clip as a layer (transform, crop, chroma key, Lumetri-style grade, curves, LUT, blur) composited into a
   ping-pong accumulation buffer with opacity, blend mode and transition effects. Adjustment layers re-grade the
   accumulated image below them. Used by the Program monitor (fed by <video> elements) and by the offline exporter
   (fed by decoded VideoFrames). */
(function () {
  const VS = `#version 300 es
  in vec2 a; uniform mat3 M; out vec2 uv;
  void main(){ uv = a; vec3 p = M * vec3(a, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); }`;
  const FS_LAYER = `#version 300 es
  precision highp float; precision highp sampler3D;
  in vec2 uv; uniform sampler2D T; uniform sampler2D Cv; uniform sampler3D L;
  uniform vec4 crop; uniform int premul, flipY, keyOn, matte, curveOn, lutOn, raw;
  uniform vec3 keyCol; uniform float keyTol, keySoft, keySpill, keyFeather, keyChoke; uniform vec2 ts;
  uniform float expo, bri, con, sat, temp, tint, hi, sh, wh, bl, vib, vig, lutAmt, lutN, cvAmt;
  uniform vec4 wS, wM, wH;
  out vec4 o;
  vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r - 0.331264*c.g + 0.5*c.b, 0.5*c.r - 0.418688*c.g - 0.081312*c.b); }
  vec4 src(vec2 p){ vec4 c = texture(T, flipY == 1 ? vec2(p.x, 1.0 - p.y) : p); vec3 rgb = premul == 1 ? (c.a > 0.0 ? c.rgb / c.a : vec3(0.0)) : c.rgb; return vec4(rgb, c.a); }
  float keyA(vec3 rgb){ float d = distance(cbcr(rgb), cbcr(keyCol)); return smoothstep(keyTol, keyTol + keySoft + 1e-4, d); }
  void main(){
    vec4 cr = crop;
    if (uv.x < cr.x || uv.y < cr.y || uv.x > 1.0 - cr.z || uv.y > 1.0 - cr.w) { o = vec4(0.0); return; }
    vec4 c = src(uv); vec3 rgb = c.rgb; float a = c.a;
    if (raw == 1) { o = vec4(rgb * a, a); return; }
    if (keyOn == 1) {
      float m = keyA(rgb);
      if (keyFeather > 0.0) {
        float s = m, n = 1.0;
        for (int i = 0; i < 12; i++) { float ang = float(i) * 0.5235988; vec2 dir = vec2(cos(ang), sin(ang)) * ts * keyFeather;
          s += keyA(src(uv + dir * 0.5).rgb) + keyA(src(uv + dir).rgb); n += 2.0; }
        m = s / n;
      }
      if (keyChoke > 0.0) m = clamp((m - keyChoke) / (1.0 - keyChoke), 0.0, 1.0);
      vec2 kc = cbcr(keyCol);
      if (keySpill > 0.0 && length(kc) > 0.02) {               // remove key-coloured chroma (spill) keeping luma
        vec2 kd = normalize(kc), pc = cbcr(rgb); float s = dot(pc, kd);
        if (s > 0.0) { float y = dot(rgb, vec3(0.299, 0.587, 0.114)); pc -= kd * s * keySpill;
          rgb = clamp(vec3(y + 1.402 * pc.y, y - 0.344136 * pc.x - 0.714136 * pc.y, y + 1.772 * pc.x), 0.0, 1.0); }
      }
      a *= m;
      if (matte == 1) { o = vec4(vec3(a), 1.0); return; }
    } else if (matte == 1) { o = vec4(vec3(a), 1.0); return; }
    rgb *= exp2(expo);
    float bp = -bl * 0.2, wp = 1.0 - wh * 0.2; rgb = (rgb - bp) / max(1e-3, wp - bp);
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float mS = 1.0 - smoothstep(0.0, 0.6, l), mH = smoothstep(0.4, 1.0, l), mM = clamp(1.0 - abs(l - 0.5) * 2.0, 0.0, 1.0);
    rgb += (sh * mS + hi * mH) * 0.3;
    rgb += bri;
    rgb = (rgb - 0.5) * con + 0.5;
    rgb += (wS.rgb + wS.a) * mS + (wM.rgb + wM.a) * mM + (wH.rgb + wH.a) * mH;
    l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float sp = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
    rgb = mix(vec3(l), rgb, sat * (1.0 + vib * (1.0 - clamp(sp * 1.6, 0.0, 1.0))));
    rgb *= vec3(1.0 + temp * 0.22 + tint * 0.08, 1.0 + temp * 0.04 - tint * 0.16, 1.0 - temp * 0.22 + tint * 0.08);
    rgb = clamp(rgb, 0.0, 1.0);
    if (curveOn == 1) { float q = 255.0 / 256.0, h = 0.5 / 256.0; rgb = mix(rgb, vec3(texture(Cv, vec2(rgb.r * q + h, 0.5)).r, texture(Cv, vec2(rgb.g * q + h, 0.5)).g, texture(Cv, vec2(rgb.b * q + h, 0.5)).b), cvAmt); }
    if (lutOn == 1) { vec3 lc = texture(L, rgb * ((lutN - 1.0) / lutN) + 0.5 / lutN).rgb; rgb = mix(rgb, lc, lutAmt); }
    if (vig != 0.0) { float vd = smoothstep(0.3, 1.0, length(uv - 0.5) * 1.41421); rgb = vig < 0.0 ? rgb * (1.0 + vig * vd) : mix(rgb, vec3(1.0), vig * vd); }
    rgb = clamp(rgb, 0.0, 1.0);
    o = vec4(rgb * a, a);
  }`;
  const FS_BLUR = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T; uniform vec2 dir; out vec4 o;
  void main(){ vec2 st = vec2(uv.x, 1.0 - uv.y); vec4 s = vec4(0.0); float w = 0.0;
    for (int i = -16; i <= 16; i++) { float f = float(i); float k = exp(-f * f / 56.9); s += texture(T, st + dir * f) * k; w += k; }
    o = s / w; }`;
  const FS_COMP = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T, B; uniform float op, p, feather; uniform int mode, blend; uniform vec2 off; uniform vec4 dip; out vec4 o;
  float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
  vec3 clipC(vec3 c){ float l = lum(c), n = min(c.r, min(c.g, c.b)), x = max(c.r, max(c.g, c.b));
    if (n < 0.0) c = l + (c - l) * l / max(1e-5, l - n); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(1e-5, x - l); return c; }
  vec3 setLum(vec3 c, float l){ return clipC(c + (l - lum(c))); }
  float satv(vec3 c){ return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
  vec3 setSat(vec3 c, float s){ float mn = min(c.r, min(c.g, c.b)), mx = max(c.r, max(c.g, c.b)); return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0); }
  float sl(float b, float s){ if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b); float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b); return b + (2.0 * s - 1.0) * (d - b); }
  float hl(float b, float s){ return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
  vec3 bf(vec3 b, vec3 s, int m){
    if (m == 1) return min(b, s);
    if (m == 2) return b * s;
    if (m == 3) return vec3(b.r >= 1.0 ? 1.0 : s.r <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b.r) / s.r), b.g >= 1.0 ? 1.0 : s.g <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b.g) / s.g), b.b >= 1.0 ? 1.0 : s.b <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b.b) / s.b));
    if (m == 4) return max(b, s);
    if (m == 5) return b + s - b * s;
    if (m == 6) return vec3(b.r <= 0.0 ? 0.0 : s.r >= 1.0 ? 1.0 : min(1.0, b.r / (1.0 - s.r)), b.g <= 0.0 ? 0.0 : s.g >= 1.0 ? 1.0 : min(1.0, b.g / (1.0 - s.g)), b.b <= 0.0 ? 0.0 : s.b >= 1.0 ? 1.0 : min(1.0, b.b / (1.0 - s.b)));
    if (m == 7) return min(vec3(1.0), b + s);
    if (m == 8) return vec3(hl(s.r, b.r), hl(s.g, b.g), hl(s.b, b.b));
    if (m == 9) return vec3(sl(b.r, s.r), sl(b.g, s.g), sl(b.b, s.b));
    if (m == 10) return vec3(hl(b.r, s.r), hl(b.g, s.g), hl(b.b, s.b));
    if (m == 11) return abs(b - s);
    if (m == 12) return b + s - 2.0 * b * s;
    if (m == 13) return setLum(setSat(s, satv(b)), lum(b));
    if (m == 14) return setLum(setSat(b, satv(s)), lum(b));
    if (m == 15) return setLum(s, lum(b));
    if (m == 16) return setLum(b, lum(s));
    return s;
  }
  void main(){
    vec4 bd = texture(B, vec2(uv.x, 1.0 - uv.y));
    vec2 sv = uv - off; vec4 c = vec4(0.0);
    if (sv.x >= 0.0 && sv.x <= 1.0 && sv.y >= 0.0 && sv.y <= 1.0) {
      c = texture(T, vec2(sv.x, 1.0 - sv.y));
      float m = 1.0;
      if (mode == 1) m = smoothstep(p + feather, p - feather, uv.x);      // reveal left→right
      if (mode == 2) m = smoothstep(p - feather, p + feather, uv.x);      // hide left→right
      c.rgb = mix(c.rgb, dip.rgb * c.a, dip.a);
      c *= op * m;
    }
    vec3 cs = c.a > 0.0 ? c.rgb / c.a : vec3(0.0), cb = bd.a > 0.0 ? bd.rgb / bd.a : vec3(0.0);
    vec3 r = blend == 0 ? cs : mix(cs, clamp(bf(cb, cs, blend), 0.0, 1.0), bd.a);
    o = vec4(bd.rgb * (1.0 - c.a) + r * c.a, c.a + bd.a * (1.0 - c.a));
  }`;
  const FS_COPY = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D T; out vec4 o; void main(){ o = vec4(texture(T, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0); }`;

  function prog(gl, vs, fs) {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }
  const hexRgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  LC.hexRgb = hexRgb;
  const FULL = new Float32Array([2, 0, 0, 0, -2, 0, -1, 1, 1]);   // a∈[0,1]² → clip space, top-left origin
  const BLEND_IDX = Object.fromEntries(LC.BLEND_MODES.map((b, i) => [b[0], i]));

  class Compositor {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw new Error('WebGL2 not available');
      this.pL = prog(gl, VS, FS_LAYER); this.pB = prog(gl, VS, FS_BLUR); this.pC = prog(gl, VS, FS_COMP); this.pX = prog(gl, VS, FS_COPY);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.tex = new Map(); this.titleCache = new Map(); this.fbos = null; this.w = 0; this.h = 0;
      this.curveTex = new Map(); this.lutTex = new Map(); this.view = {};
      // dummy textures so unused samplers are always complete
      this.dummy2 = this.newTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      this.dummy3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, this.dummy3); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    resize(w, h) {
      if (this.w === w && this.h === h) return;
      this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h;
      const gl = this.gl;
      if (this.fbos) this.fbos.forEach(f => { gl.deleteTexture(f.t); gl.deleteFramebuffer(f.f); });
      // 0,1: layer scratch · 2,3: accumulation ping-pong
      this.fbos = [0, 1, 2, 3].map(() => { const t = this.newTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    newTex() { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
    upload(key, src, premul, version) {
      const gl = this.gl; let e = this.tex.get(key);
      if (!e) { e = { t: this.newTex(), v: null }; this.tex.set(key, e); }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, e.t);
      if (version == null || e.v !== version) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premul);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (err) { return null; }
        e.v = version;
      }
      return e.t;
    }
    dropTextures(keep) { for (const [k, e] of this.tex) if (!keep.has(k)) { this.gl.deleteTexture(e.t); this.tex.delete(k); } }
    curvesTexture(c) {
      const gl = this.gl, sig = JSON.stringify(c.curves); let e = this.curveTex.get(c.id);
      if (e && e.sig === sig) return e.t;
      if (!e) { e = { t: this.newTex() }; this.curveTex.set(c.id, e); }
      gl.bindTexture(gl.TEXTURE_2D, e.t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, LC.curvesTexData(c.curves)); e.sig = sig; return e.t;
    }
    lutTexture(lut) {
      const gl = this.gl; let e = this.lutTex.get(lut.id);
      if (e && e.src === lut.data) return e;
      const d = LC.lutData(lut);
      if (!e) { const t = gl.createTexture(); e = { t }; this.lutTex.set(lut.id, e); }
      gl.bindTexture(gl.TEXTURE_3D, e.t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R].forEach(p => gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, d.size, d.size, d.size, 0, gl.RGB, gl.FLOAT, d.data);
      e.src = lut.data; e.size = d.size; return e;
    }

    /* Layers active on track `tr` at time t → [{clip, t, comp:{mode,p,off,dip,op}}] */
    static layersAt(tr, t) {
      const clips = LC.clipsOn(tr.id).filter(c => !c.disabled);
      const trs = LC.project.transitions.filter(x => x.track === tr.id && !LC.isAudioTrType(x.type));
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

    /* getSrc(clip, srcTime) → {src, w, h, key, premul?} | 'offline' | null */
    /* accumulation ping-pong buffers for nesting depth d (depth 0 = fbos 2,3) */
    accFor(d) {
      if (d === 0) return [this.fbos[2], this.fbos[3]];
      this.nestFbos = this.nestFbos || [];
      let A = this.nestFbos[d];
      if (!A || A.w !== this.w || A.h !== this.h) {
        const gl = this.gl; if (A) A.forEach(f => { gl.deleteTexture(f.t); gl.deleteFramebuffer(f.f); });
        A = [0, 1].map(() => { const t = this.newTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; });
        A.w = this.w; A.h = this.h; this.nestFbos[d] = A;
      }
      return A;
    }
    /* composite the current LC.project sequence at time t into the depth-d accumulation buffer; returns its texture */
    renderSeq(t, getSrc, used, d) {
      const gl = this.gl, S = LC.project.settings, A = this.accFor(d), prev = this.L;
      this.L = { A, cur: 0, d };
      gl.bindFramebuffer(gl.FRAMEBUFFER, A[0].f); gl.viewport(0, 0, this.w, this.h);
      if (d > 0) gl.clearColor(0, 0, 0, 0);                       // nested sequences are transparent where empty
      else if (this.view.raw) gl.clearColor(0, 0, 0, 1);
      else { const bg = hexRgb(S.bg); gl.clearColor(bg[0], bg[1], bg[2], 1); }
      gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND);
      let drawn = 0;
      for (const tr of LC.videoTracks()) {
        if (tr.mute) continue;
        for (const L of Compositor.layersAt(tr, t)) {
          if (d === 0 && this.view.raw && L.clip.id !== this.view.raw) continue;
          if (this.drawLayer(L.clip, t, L.comp, getSrc, used)) drawn++;
        }
      }
      const out = A[this.L.cur].t; this.drawn = (this.drawn || 0) + drawn; this.L = prev;
      return out;
    }
    render(t, getSrc, opts = {}) {
      const gl = this.gl, used = new Set(); this.drawn = 0; LC._nestPath = '';
      const tex = this.renderSeq(t, getSrc, used, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
      const X = this.pX; gl.useProgram(X.p); gl.uniformMatrix3fv(X.u.M, false, FULL); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(X.u.T, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (opts.gc !== false) this.dropTextures(used);
      return this.drawn;
    }
    drawLayer(c, t, comp, getSrc, used) {
      const gl = this.gl, S = LC.project.settings, W = this.w, H = this.h, k = W / S.w, F = this.fbos;
      const tl = Math.min(Math.max(t - c.start, 0), c.dur), V = (key) => LC.valueAt(c, key, tl);
      let tex, sw, sh, premul = false, flip = 0, M, spp = 1;
      if (c.type === 'adjust') {
        tex = this.L.A[this.L.cur].t; sw = W; sh = H; flip = 1; M = FULL;
      } else {
        if (c.type === 'nest') {           // render the nested sequence first (its own buffers), then treat it as a layer
          if (this.L.d + 1 >= LC.MAX_NEST || !c.seq) return false;
          const ti = LC.srcTime(c, t), path = LC._nestPath;
          LC._nestPath = path + c.id + '/';
          try { tex = LC.withSeq(c.seq, () => this.renderSeq(ti, getSrc, used, this.L.d + 1)); } finally { LC._nestPath = path; }
          if (!tex) return false;
          sw = W; sh = H; premul = true; flip = 1;
        } else if (c.type === 'title') {
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
        const pos = V('pos'), scale = V('scale') / 100, rot = V('rot') * Math.PI / 180;
        const fit = c.type === 'title' || c.type === 'nest' ? 1 : Math.min(W / sw, H / sh);
        const qw = sw * fit * scale, qh = sh * fit * scale, cx = pos[0] * W, cy = pos[1] * H; spp = k / Math.max(1e-6, fit * scale);
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const ax = qw * cs, ay = qw * sn, bx = -qh * sn, by = qh * cs;
        const ox = cx - .5 * ax - .5 * bx, oy = cy - .5 * ay - .5 * by;
        M = new Float32Array([2 * ax / W, -2 * ay / H, 0, 2 * bx / W, -2 * by / H, 0, 2 * ox / W - 1, 1 - 2 * oy / H, 1]);
      }
      const opacity = Math.max(0, Math.min(1, V('opacity') / 100)), pr = c.props;
      // pass 1: layer → F0
      gl.bindFramebuffer(gl.FRAMEBUFFER, F[0].f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND);
      const L = this.pL, u = L.u; gl.useProgram(L.p);
      gl.uniformMatrix3fv(u.M, false, M);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.T, 0);
      const crop = c.type === 'adjust' || c.type === 'title' ? [0, 0, 0, 0] : V('crop');
      gl.uniform4f(u.crop, crop[0] / 100, crop[1] / 100, crop[2] / 100, crop[3] / 100);
      gl.uniform1i(u.premul, premul ? 1 : 0); gl.uniform1i(u.flipY, flip);
      const raw = this.view.raw === c.id; gl.uniform1i(u.raw, raw ? 1 : 0);
      const key = c.key && c.key.on && c.type !== 'adjust' && c.type !== 'title' ? c.key : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, F[0].f); gl.viewport(0, 0, W, H);
      gl.uniform1i(u.keyOn, key ? 1 : 0); gl.uniform1i(u.matte, this.view.matte === c.id ? 1 : 0);
      if (key) {
        gl.uniform3fv(u.keyCol, hexRgb(key.color)); gl.uniform1f(u.keyTol, key.tol / 100 * .4); gl.uniform1f(u.keySoft, key.soft / 100 * .3);
        gl.uniform1f(u.keySpill, key.spill / 100); gl.uniform1f(u.keyFeather, key.feather * spp); gl.uniform1f(u.keyChoke, key.choke / 100 * .9);
        gl.uniform2f(u.ts, 1 / sw, 1 / sh);
      }
      gl.uniform1f(u.expo, V('exposure')); gl.uniform1f(u.bri, V('brightness') / 200); gl.uniform1f(u.con, 1 + V('contrast') / 100);
      gl.uniform1f(u.sat, V('saturation') / 100); gl.uniform1f(u.temp, V('temperature') / 100); gl.uniform1f(u.tint, V('tint') / 100);
      gl.uniform1f(u.hi, V('highlights') / 100); gl.uniform1f(u.sh, V('shadows') / 100); gl.uniform1f(u.wh, V('whites') / 100); gl.uniform1f(u.bl, V('blacks') / 100);
      gl.uniform1f(u.vib, V('vibrance') / 100); gl.uniform1f(u.vig, V('vignette') / 100);
      gl.uniform4fv(u.wS, LC.wheelVec(V('wS'), .25)); gl.uniform4fv(u.wM, LC.wheelVec(V('wM'), .2)); gl.uniform4fv(u.wH, LC.wheelVec(V('wH'), .2));
      const curveOn = LC.curvesActive(c.curves);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, curveOn ? this.curvesTexture(c) : this.dummy2); gl.uniform1i(u.Cv, 1); gl.uniform1i(u.curveOn, curveOn ? 1 : 0); if (curveOn) gl.uniform1f(u.cvAmt, Math.max(0, Math.min(1, V('curveAmt') / 100)));
      const lut = c.lut && c.lut.amt > 0 && LC.lutById(c.lut.id);
      let lt = null; if (lut) { try { lt = this.lutTexture(lut); } catch (e) { lt = null; } }
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, lt ? lt.t : this.dummy3); gl.uniform1i(u.L, 2); gl.uniform1i(u.lutOn, lt ? 1 : 0);
      if (lt) { gl.uniform1f(u.lutAmt, c.lut.amt / 100); gl.uniform1f(u.lutN, lt.size); }
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const blur = raw ? 0 : V('blur');
      if (blur > 0) {                       // separable gaussian, σ = blur px (project space), 33 taps over ±3σ
        const step = (3 * blur * k) / 16; const B = this.pB; gl.useProgram(B.p); gl.uniformMatrix3fv(B.u.M, false, FULL); gl.uniform1i(B.u.T, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F[1].f); gl.bindTexture(gl.TEXTURE_2D, F[0].t); gl.uniform2f(B.u.dir, step / W, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F[0].f); gl.bindTexture(gl.TEXTURE_2D, F[1].t); gl.uniform2f(B.u.dir, 0, step / H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // pass 2: composite F0 over the accumulated image (ping-pong) with blend mode
      const Lv = this.L, dst = Lv.A[1 - Lv.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f);
      const C = this.pC; gl.useProgram(C.p); gl.uniformMatrix3fv(C.u.M, false, FULL);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F[0].t); gl.uniform1i(C.u.T, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, Lv.A[Lv.cur].t); gl.uniform1i(C.u.B, 1); gl.activeTexture(gl.TEXTURE0);
      const mat = this.view.matte === c.id || raw;
      gl.uniform1f(C.u.op, mat ? 1 : opacity * (comp.op ?? 1)); gl.uniform1i(C.u.mode, comp.mode || 0); gl.uniform1f(C.u.p, comp.p ?? 0); gl.uniform1f(C.u.feather, 0.012);
      gl.uniform1i(C.u.blend, mat ? 0 : (BLEND_IDX[pr.blend] || 0));
      const off = comp.off || [0, 0]; gl.uniform2f(C.u.off, off[0], off[1]);
      const d = comp.dip || [0, 0, 0, 0]; gl.uniform4f(C.u.dip, d[0], d[1], d[2], d[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      Lv.cur = 1 - Lv.cur;
      return true;
    }
    /* read one pixel of the presented frame (canvas pixel coords, top-left origin) → [r,g,b] 0..255 */
    readPixel(x, y) {
      const gl = this.gl, px = new Uint8Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(Math.max(0, Math.min(this.w - 1, Math.round(x))), Math.max(0, Math.min(this.h - 1, this.h - 1 - Math.round(y))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
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
  /* every leaf layer visible at time t, descending into nested sequences: cb(clip, timeInItsSequence, nestPath).
     Runs synchronously (it swaps the active sequence while descending). */
  LC.walkVideo = (t, cb, path = '', depth = 0) => {
    for (const tr of LC.videoTracks()) {
      if (tr.mute) continue;
      for (const L of Compositor.layersAt(tr, t)) {
        const c = L.clip;
        if (c.type === 'nest') { if (depth + 1 < LC.MAX_NEST && c.seq) { const ti = LC.srcTime(c, t); LC.withSeq(c.seq, () => LC.walkVideo(ti, cb, path + c.id + '/', depth + 1)); } }
        else cb(c, t, path);
      }
    }
  };

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
