'use strict';
/* GPU watercolor simulation (WebGL2 + float render targets + float blending). Same model as the CPU
   WetSim in wet.js, but every tick runs as one fragment pass over the wet region (MRT: water, suspended
   pigment, deposited pigment), dabs are splatted with blending (MAX for water, ADD for pigment) and the
   layer is displayed live as base ⊕ wet paint straight from the GPU. Only when the paint has dried are
   the pixels read back once and written into the layer's tiles (undo-able like any stroke). */
const WGL_DEPOSIT = `#version 300 es
precision highp float;
uniform vec2 uC, uOrg; uniform vec4 uI; uniform float uH, uIH, uGk, uGd, uGthr; uniform int uTip, uUseSel;
uniform sampler2D uTipT, uG, uSel, uP; uniform vec4 uOut; uniform int uMode; out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy + uOrg, d = p - uC;
  float u = uI.x*d.x + uI.y*d.y, v = uI.z*d.x + uI.w*d.y, r2 = u*u + v*v;
  vec4 cur = uMode == 1 ? texelFetch(uP, ivec2(gl_FragCoord.xy), 0) : vec4(0.0);
  if (r2 >= 1.0) { if (uMode == 1) { o = cur; return; } discard; }
  float a;
  if (uTip == 1) a = texture(uTipT, vec2(u, v) * 0.5 + 0.5).r;
  else { float r = sqrt(r2); a = r <= uH ? 1.0 : smoothstep(0.0, 1.0, (1.0 - r) * uIH); }
  if (uGd > 0.0) { float g = texelFetch(uG, ivec2(mod(floor(p * uGk), 512.0)), 0).r; a *= 1.0 - uGd + uGd * clamp((g - uGthr) * 4.0, 0.0, 1.0); }
  if (uUseSel == 1) a *= texelFetch(uSel, ivec2(p), 0).r;
  if (a < 0.003) { if (uMode == 1) { o = cur; return; } discard; }
  if (uMode == 0) { float g0 = texelFetch(uG, ivec2(mod(floor(p), 512.0)), 0).r; float f = clamp(a * 3.2 - (0.5 - g0) * 0.9, 0.0, 1.0); o = vec4(uOut.r * f, f > 0.05 ? 1.0 : 0.0, 0.0, 0.0); }
  else { float target = uOut.a * clamp(a * 2.2, 0.0, 1.0), add = max(0.0, target - cur.a) * 0.5 + target * 0.045; o = cur + vec4(uOut.rgb * add, add); }
}`;
const WGL_TICK = `#version 300 es
precision highp float;
uniform sampler2D uW, uP, uG; uniform ivec2 uSize; uniform vec2 uOrg;
uniform float kw, kp, ke, gran, evap, bleedT;
layout(location=0) out vec4 oW; layout(location=1) out vec4 oP; layout(location=2) out vec4 oD;
float Wv(ivec2 c){ return texelFetch(uW, clamp(c, ivec2(0), uSize - 1), 0).r; }
vec4 Pv(ivec2 c){ return texelFetch(uP, clamp(c, ivec2(0), uSize - 1), 0); }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 w0 = texelFetch(uW, c, 0).rg; float wi = w0.r; vec4 pi = Pv(c);
  ivec2 nb[4] = ivec2[4](c + ivec2(-1, 0), c + ivec2(1, 0), c + ivec2(0, -1), c + ivec2(0, 1));
  float wn[4]; for (int e = 0; e < 4; e++) wn[e] = Wv(nb[e]);
  float mx = max(max(wn[0], wn[1]), max(wn[2], wn[3]));
  if (wi <= 0.0 && pi.a <= 0.0 && mx <= 0.0) { oW = vec4(0.0, w0.g, 0.0, 0.0); oP = vec4(0.0); oD = vec4(0.0); return; }
  vec2 dp = gl_FragCoord.xy + uOrg;
  float g = texelFetch(uG, ivec2(mod(floor(dp * 0.5), 512.0)), 0).r;
  float nw = wi;
  if (wi > 0.0) {
    float sum = 0.0, dry = 0.0;
    for (int e = 0; e < 4; e++) { if (wn[e] > 0.0) sum += wn[e] - wi; else dry += 1.0; }
    nw += kw * sum; if (dry > 0.0 && wi > 0.14) nw -= wi * kw * 0.5 * dry;
  } else if (mx > 0.22 && g + mx * 0.15 > bleedT) nw = mx * kw * 1.5;
  nw -= evap * (nw < 0.5 ? 2.2 - nw * 2.4 : 1.0);
  if (nw < 0.004) nw = 0.0;
  vec4 p = pi;
  if (wi > 0.0) for (int e = 0; e < 4; e++) {
    if (wn[e] <= 0.0) continue;
    vec4 q = Pv(nb[e]); float mn = min(wi, wn[e]);
    p += (q - pi) * kp * (mn > 0.33 ? 1.0 : mn * 3.0);
    float dw = wn[e] - wi;
    if (dw > 0.0) p += q * min(0.05, ke * dw * 0.25); else p -= pi * min(0.05, -ke * dw * 0.25);
  }
  p = max(p, vec4(0.0));
  vec4 dd = vec4(0.0);
  if (p.a > 0.0) { float dep = nw <= 0.0 ? 1.0 : 0.003 + gran * (1.0 - g) * (1.0 - g); dd = p * dep; p -= dd; if (p.a < 2e-4) { dd += p; p = vec4(0.0); } }
  oW = vec4(nw, max(w0.g, nw > 0.03 ? 1.0 : 0.0), 0.0, 1.0); oP = p; oD = dd;
}`;
const WGL_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uBase, uP, uD, uSel, uW, uBl; uniform vec2 uOrg; uniform ivec2 uSize, uOff; uniform int uUseSel, uLock, uStraight; uniform float uEdge;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy) + uOff; vec4 b = texelFetch(uBase, p, 0); vec4 res = b;
  ivec2 q = p - ivec2(uOrg);
  if (q.x >= 0 && q.y >= 0 && q.x < uSize.x && q.y < uSize.y) {
    vec4 w = texelFetch(uD, q, 0) + texelFetch(uP, q, 0);
    float fp = texelFetch(uW, q, 0).g, bl = texelFetch(uBl, q, 0).r, e = clamp((fp - bl) * 2.6, 0.0, 1.0);
    w *= mix(0.9, 1.0 + 1.9 * uEdge, e * fp);
    if (w.a > 0.0005) {
      if (w.a > 1.0) w /= w.a;
      vec3 s = w.rgb / w.a; float ow = b.a * (1.0 - w.a), oa = w.a + ow;
      vec3 r = (w.rgb + b.rgb * ow) / oa;
      if (b.a > 0.0) r += (b.rgb * ((1.0 - w.a) + s * w.a) - r) * (b.a * 0.7);
      if (uLock == 1) oa = b.a;
      if (uUseSel == 1) { float sv = texelFetch(uSel, p, 0).r; r = mix(b.rgb, r, sv); oa = mix(b.a, oa, sv); }
      res = vec4(r, oa);
    }
  }
  o = uStraight == 1 ? res : vec4(res.rgb * res.a, res.a);
}`;
const WGL_SHIFT = `#version 300 es
precision highp float; uniform sampler2D uS; uniform ivec2 uOff, uSize; out vec4 o;
void main(){ ivec2 c = ivec2(gl_FragCoord.xy) - uOff; o = (c.x >= 0 && c.y >= 0 && c.x < uSize.x && c.y < uSize.y) ? texelFetch(uS, c, 0) : vec4(0.0); }`;

const WGL_BLUR = `#version 300 es
precision highp float; uniform sampler2D uS; uniform ivec2 uDir, uSize; uniform int uR, uCh; out vec4 o;
void main(){ ivec2 c = ivec2(gl_FragCoord.xy); float s = 0.0, n = 0.0;
  for (int k = -16; k <= 16; k++) { if (k < -uR || k > uR) continue; ivec2 q = clamp(c + uDir * k, ivec2(0), uSize - 1); vec4 v = texelFetch(uS, q, 0); s += uCh == 1 ? v.g : v.r; n += 1.0; }
  o = vec4(s / n, 0.0, 0.0, 1.0); }`;
const WT = 64;
const wglRes = { ready: null, tips: {}, grain: {}, sel: null, selV: -1 };
function wetGLAvailable() {
  if (wglRes.ready !== null) return wglRes.ready;
  try {
    const gl = R && R.gl; if (!gl || !R.float || !gl.getExtension('EXT_float_blend')) return wglRes.ready = false;
    wglRes.dep = R.prog(WGL_DEPOSIT); wglRes.tick = R.prog(WGL_TICK); wglRes.comp = R.prog(WGL_COMPOSITE); wglRes.shift = R.prog(WGL_SHIFT); wglRes.blur = R.prog(WGL_BLUR);
    // probe: MRT framebuffer with our formats must be complete
    const t1 = R.tex(4, 4, gl.RG16F), t2 = R.tex(4, 4, gl.RGBA16F), t3 = R.tex(4, 4, gl.RGBA32F), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t2, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t3, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(fb); [t1, t2, t3].forEach(t => gl.deleteTexture(t)); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return wglRes.ready = ok;
  } catch (e) { console.warn('GPU watercolor unavailable: ' + e.message); return wglRes.ready = false; }
}
function wglFloatTex(w, h, data, linear) {
  const gl = R.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, data);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function wglTip(name) { const m = tipMap(name); if (!m) return null; return wglRes.tips[name] || (wglRes.tips[name] = wglFloatTex(TIPN, TIPN, m, true)); }
function wglGrain(type) { return wglRes.grain[type] || (wglRes.grain[type] = wglFloatTex(GRAINN, GRAINN, grainMap(type) || grainMap('cold'), false)); }
function wglSelTex() {
  const gl = R.gl;
  if (!doc.sel) return null;
  if (wglRes.selV === doc.selV && wglRes.selDoc === doc && wglRes.sel) return wglRes.sel;
  if (wglRes.sel) gl.deleteTexture(wglRes.sel);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, doc.w, doc.h, 0, gl.RED, gl.UNSIGNED_BYTE, doc.sel); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  wglRes.sel = t; wglRes.selV = doc.selV; wglRes.selDoc = doc; return t;
}

class WetSimGL {
  constructor(L) {
    this.L = L; this.gpu = true; this.touched = new Set(); this.painting = true; this.age = 0; this.dryLimit = 2;
    this.evap = 0.0006; this.firstState = null; this.cur = 0; this.box = null; this.W = null; this.paper = doc.paper === 'none' ? 'cold' : doc.paper;
    this.doc = doc; this.ticks = 0;
    this.gw = Math.ceil(doc.w / WT); this.gh = Math.ceil(doc.h / WT);
    this.tT = new Float64Array(this.gw * this.gh).fill(-1e9); this.on = new Uint8Array(this.gw * this.gh);
  }
  /* activity of 64-px doc tiles: ticks only run where paint was put down recently (and next to it) */
  markTiles(x0, y0, x1, y1) {
    const a = Math.max(0, (x0 / WT) | 0), b = Math.min(this.gw - 1, ((x1 - 1) / WT) | 0), c = Math.max(0, (y0 / WT) | 0), d = Math.min(this.gh - 1, ((y1 - 1) / WT) | 0);
    for (let ty = c; ty <= d; ty++) for (let tx = a; tx <= b; tx++) this.tT[ty * this.gw + tx] = this.ticks;
  }
  activeFlags() {
    const gw = this.gw, gh = this.gh, N = this.painting ? 300 : Math.ceil(this.brush.dryTime * 60 * 1.5) + 20, lim = this.ticks - N, f = new Uint8Array(gw * gh);
    for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
      if (this.tT[ty * gw + tx] < lim) continue;
      for (let y = Math.max(0, ty - 1); y <= Math.min(gh - 1, ty + 1); y++) for (let x = Math.max(0, tx - 1); x <= Math.min(gw - 1, tx + 1); x++) f[y * gw + x] = 1;
    }
    return f;
  }
  rects(flags, pad = 0) { // merge tile runs into region-space rects
    const out = [], gw = this.gw;
    for (let ty = 0; ty < this.gh; ty++) {
      let tx = 0;
      while (tx < gw) {
        if (!flags[ty * gw + tx]) { tx++; continue; }
        let e = tx; while (e < gw && flags[ty * gw + e]) e++;
        const x0 = Math.max(0, tx * WT - pad - this.x0), y0 = Math.max(0, ty * WT - pad - this.y0), x1 = Math.min(this.w, e * WT + pad - this.x0), y1 = Math.min(this.h, (ty + 1) * WT + pad - this.y0);
        if (x1 > x0 && y1 > y0) out.push([x0, y0, x1 - x0, y1 - y0]);
        tx = e;
      }
    }
    return out;
  }
  alloc(x0, y0, w, h) {
    const gl = R.gl, old = this.W ? { x0: this.x0, y0: this.y0, w: this.w, h: this.h, W: this.W[this.cur], P: this.P[this.cur], D: this.D } : null;
    const mk = (fmt) => { const t = R.tex(w, h, fmt); return t; };
    const W = [mk(gl.RG16F), mk(gl.RG16F)], P = [mk(gl.RGBA16F), mk(gl.RGBA16F)], D = mk(gl.RGBA32F), Bt = [mk(gl.R16F), mk(gl.R16F)];
    const fb = atts => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); atts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)); gl.drawBuffers(atts.map((_, i) => gl.COLOR_ATTACHMENT0 + i)); return f; };
    const fbT = [fb([W[1], P[1], D]), fb([W[0], P[0], D])], fbW = [fb([W[0]]), fb([W[1]])], fbP = [fb([P[0]]), fb([P[1]])], fbD = fb([D]), fbB = [fb([Bt[0]]), fb([Bt[1]])];
    for (const f of [fbT[0], fbW[0], fbP[0], fbD]) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbT[0]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbT[1]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    const nw = { x0, y0, w, h, Wt: W, Pt: P, D, fbT, fbW, fbP, fbD };
    if (old) { // shift old state into the new textures
      const off = [old.x0 - x0, old.y0 - y0];
      const copy = (src, dstFb) => R.draw(wglRes.shift, { fb: dstFb, w, h }, u => { R.bindTex(0, src, u.uS); gl.uniform2i(u.uOff, off[0], off[1]); gl.uniform2i(u.uSize, old.w, old.h); });
      copy(old.W, fbW[0]); copy(old.P, fbP[0]); copy(old.D, fbD); copy(old.W, fbW[1]); copy(old.P, fbP[1]);
      this.free();
      if (this.box) this.box = [this.box[0] + off[0], this.box[1] + off[1], this.box[2] + off[0], this.box[3] + off[1]];
    }
    this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.W = W; this.P = P; this.D = D; this.fbT = fbT; this.fbW = fbW; this.fbP = fbP; this.fbD = fbD; this.Bt = Bt; this.fbB = fbB; this.cur = 0; this.blurV = -1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  free() {
    const gl = R.gl; if (!this.W) return;
    [...this.W, ...this.P, this.D, ...this.Bt].forEach(t => gl.deleteTexture(t));
    [...this.fbT, ...this.fbW, ...this.fbP, this.fbD, ...this.fbB].forEach(f => gl.deleteFramebuffer(f));
    this.W = null;
  }
  ensure(x0, y0, x1, y1) {
    const m = 160;
    let nx0 = Math.max(0, Math.floor(x0 - m)), ny0 = Math.max(0, Math.floor(y0 - m)), nx1 = Math.min(doc.w, Math.ceil(x1 + m)), ny1 = Math.min(doc.h, Math.ceil(y1 + m));
    if (this.W && nx0 >= this.x0 && ny0 >= this.y0 && nx1 <= this.x0 + this.w && ny1 <= this.y0 + this.h) return;
    if (this.W) {
      nx0 = Math.min(nx0, this.x0); ny0 = Math.min(ny0, this.y0); nx1 = Math.max(nx1, this.x0 + this.w); ny1 = Math.max(ny1, this.y0 + this.h);
      const gx = Math.round((nx1 - nx0) * 0.5), gy = Math.round((ny1 - ny0) * 0.5);
      if (nx0 < this.x0) nx0 = Math.max(0, nx0 - gx); if (nx1 > this.x0 + this.w) nx1 = Math.min(doc.w, nx1 + gx);
      if (ny0 < this.y0) ny0 = Math.max(0, ny0 - gy); if (ny1 > this.y0 + this.h) ny1 = Math.min(doc.h, ny1 + gy);
    }
    this.alloc(nx0, ny0, nx1 - nx0, ny1 - ny0);
  }
  growBox(x0, y0, x1, y1) { // region coords, grow-only (cells outside never change)
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.w, x1); y1 = Math.min(this.h, y1);
    const b = this.box; if (!b) this.box = [x0, y0, x1, y1]; else { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
  }
  deposit(S, cx, cy, M, alpha, col, P, rad) {
    const R0 = dabRect(S, cx, cy, M, 2); if (!R0) return;
    this.ensure(R0[0], R0[1], R0[2], R0[3]);
    const gl = R.gl, b = this.brush, pr = wglRes.dep;
    const { i0, i1, i2, i3, h, ih } = tipSetup(M, rad, b.hardness);
    const rx0 = R0[0] - this.x0, ry0 = R0[1] - this.y0, rx1 = R0[2] - this.x0, ry1 = R0[3] - this.y0;
    this.growBox(rx0 - 2, ry0 - 2, rx1 + 2, ry1 + 2); this.markTiles(R0[0], R0[1], R0[2], R0[3]);
    const water = b.water * (0.55 + 0.45 * P.p), pig = b.pigment * alpha;
    const tipT = wglTip(b.tip), selT = wglSelTex(), G = wglGrain(this.paper);
    const gk = 1 / Math.max(0.25, b.grainScale * (doc.paperScale || 1)), gthr = 1 - (0.35 + 0.45 * P.p);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(rx0, ry0, rx1 - rx0, ry1 - ry0); gl.enable(gl.BLEND);
    const setup = (u, out) => {
      gl.uniform2f(u.uC, cx, cy); gl.uniform2f(u.uOrg, this.x0, this.y0); gl.uniform4f(u.uI, i0, i1, i2, i3);
      gl.uniform1f(u.uH, h); gl.uniform1f(u.uIH, ih); gl.uniform1i(u.uTip, tipT ? 1 : 0);
      R.bindTex(0, tipT || R.dummy, u.uTipT); R.bindTex(1, G, u.uG); R.bindTex(2, selT || R.dummy, u.uSel);
      gl.uniform1f(u.uGk, gk); gl.uniform1f(u.uGd, b.grain); gl.uniform1f(u.uGthr, gthr); gl.uniform1i(u.uUseSel, selT ? 1 : 0);
      gl.uniform4f(u.uOut, out[0], out[1], out[2], out[3]); gl.uniform1i(u.uMode, out.mode); R.bindTex(3, this.P[this.cur], u.uP);
    };
    gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    R.draw(pr, { fb: this.fbW[this.cur], w: this.w, h: this.h }, u => setup(u, Object.assign([water, 0, 0, 0], { mode: 0 })));
    gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
    // pigment moves toward a target concentration: read-modify-write into the back buffer, then copy the dab rect back
    const back = 1 - this.cur;
    R.draw(pr, { fb: this.fbP[back], w: this.w, h: this.h }, u => setup(u, Object.assign([col[0], col[1], col[2], pig], { mode: 1 })));
    R.draw(wglRes.shift, { fb: this.fbP[this.cur], w: this.w, h: this.h }, u => { R.bindTex(0, this.P[back], u.uS); gl.uniform2i(u.uOff, 0, 0); gl.uniform2i(u.uSize, this.w, this.h); });
    gl.disable(gl.SCISSOR_TEST);
    markDirty(this.L);
  }
  endStroke() {
    this.painting = false; this.age = 0;
    const b = this.brush; this.dryLimit = b.dryTime * 1.4 + 0.4;
    this.evap = 1 / (Math.max(0.3, b.dryTime) * 60) * 0.8;
  }
  tick() {
    if (!this.box || !this.W) return;
    const gl = R.gl, b = this.brush, k = this.cur;
    const flags = this.activeFlags(), rects = this.rects(flags);
    // tiles that just went idle: copy their latest state into the other buffer so ping-pong stays consistent
    const idle = new Uint8Array(flags.length); let anyIdle = false;
    for (let i = 0; i < flags.length; i++) if (this.on[i] && !flags[i]) { idle[i] = 1; anyIdle = true; }
    this.on = flags; this.ticks++;
    if (!rects.length) { if (anyIdle) this.freeze(idle); return; }
    gl.enable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbT[k]);
    for (const r of rects) { gl.scissor(r[0], r[1], r[2], r[3]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); }
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    const setup = u => {
      R.bindTex(0, this.W[k], u.uW); R.bindTex(1, this.P[k], u.uP); R.bindTex(2, wglGrain(this.paper), u.uG);
      gl.uniform2i(u.uSize, this.w, this.h); gl.uniform2f(u.uOrg, this.x0, this.y0);
      gl.uniform1f(u.kw, (0.1 + 0.14 * b.bleed) * 0.25); gl.uniform1f(u.kp, 0.18 * 0.25); gl.uniform1f(u.ke, 0.9 * b.edge); gl.uniform1f(u.gran, b.gran * 0.022);
      gl.uniform1f(u.evap, this.painting ? 0.0007 : this.evap); gl.uniform1f(u.bleedT, 1.02 - 0.5 * b.bleed);
    };
    for (const r of rects) { gl.scissor(r[0], r[1], r[2], r[3]); R.draw(wglRes.tick, { fb: this.fbT[k], w: this.w, h: this.h }, setup); }
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    this.cur = 1 - k;
    if (anyIdle) this.freeze(idle);
    // water can creep one cell per tick
    if (this.spread == null) this.spread = 0;
    const bx = this.box; if (this.spread < 60) { this.spread++; this.growBox(bx[0] - 1, bx[1] - 1, bx[2] + 1, bx[3] + 1); }
    this.lastRects = rects;
    markDirty(this.L);
  }
  freeze(idle) {
    const gl = R.gl, c = this.cur, o = 1 - c;
    gl.enable(gl.SCISSOR_TEST);
    for (const r of this.rects(idle)) {
      gl.scissor(r[0], r[1], r[2], r[3]);
      R.draw(wglRes.shift, { fb: this.fbW[o], w: this.w, h: this.h }, u => { R.bindTex(0, this.W[c], u.uS); gl.uniform2i(u.uOff, 0, 0); gl.uniform2i(u.uSize, this.w, this.h); });
      R.draw(wglRes.shift, { fb: this.fbP[o], w: this.w, h: this.h }, u => { R.bindTex(0, this.P[c], u.uS); gl.uniform2i(u.uOff, 0, 0); gl.uniform2i(u.uSize, this.w, this.h); });
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  render() { }
  /* blurred wet footprint (for the dark wet edge) — two separable box passes over the active box */
  edgeBlur(all) {
    const gl = R.gl, bx = this.box; if (!bx) return;
    const r = Math.round(clamp((this.brush?.size || 40) * 0.07, 2, 12)) | 0; this.edgeR = r;
    const rects = all ? [[Math.max(0, bx[0] - r), Math.max(0, bx[1] - r), bx[2] - bx[0] + 2 * r, bx[3] - bx[1] + 2 * r]] : this.rects(this.on, r * 2);
    gl.enable(gl.SCISSOR_TEST);
    for (const q of rects) { gl.scissor(q[0], q[1], q[2], q[3]); R.draw(wglRes.blur, { fb: this.fbB[0], w: this.w, h: this.h }, u => { R.bindTex(0, this.W[this.cur], u.uS); gl.uniform2i(u.uDir, 1, 0); gl.uniform2i(u.uSize, this.w, this.h); gl.uniform1i(u.uR, r); gl.uniform1i(u.uCh, 1); }); }
    for (const q of rects) { gl.scissor(q[0], q[1], q[2], q[3]); R.draw(wglRes.blur, { fb: this.fbB[1], w: this.w, h: this.h }, u => { R.bindTex(0, this.Bt[0], u.uS); gl.uniform2i(u.uDir, 0, 1); gl.uniform2i(u.uSize, this.w, this.h); gl.uniform1i(u.uR, r); gl.uniform1i(u.uCh, 0); }); }
    gl.disable(gl.SCISSOR_TEST);
  }
  bindComp(u, selT) {
    const gl = R.gl;
    R.bindTex(1, this.P[this.cur], u.uP); R.bindTex(2, this.D, u.uD); R.bindTex(3, selT || R.dummy, u.uSel); R.bindTex(4, this.W[this.cur], u.uW); R.bindTex(5, this.Bt[1], u.uBl);
    gl.uniform2f(u.uOrg, this.x0, this.y0); gl.uniform2i(u.uSize, this.w, this.h); gl.uniform1i(u.uUseSel, selT ? 1 : 0); gl.uniform1i(u.uLock, this.L.lockAlpha ? 1 : 0);
    gl.uniform1f(u.uEdge, this.brush ? this.brush.edge : 0.6);
  }
  /* live display: base layer ⊕ wet paint (premultiplied, doc size) */
  composite(baseTex) {
    const gl = R.gl;
    if (!R.tmpW) R.tmpW = R.target(doc.w, doc.h);
    const selT = wglSelTex();
    this.edgeBlur();
    R.draw(wglRes.comp, R.tmpW, u => { R.bindTex(0, baseTex, u.uBase); this.bindComp(u, selT); gl.uniform2i(u.uOff, 0, 0); gl.uniform1i(u.uStraight, 0); });
    return R.tmpW.tex;
  }
  finish(maxMs = 120) {
    if (wetSims.get(this.L) !== this) return;
    wetSims.delete(this.L);
    if (!this.W) return;
    const gl = R.gl, t0 = performance.now();
    // a few fast GPU ticks so fresh paint still settles (skipped when it has already dried naturally)
    const nat = !this.painting && this.age >= this.dryLimit;
    this.painting = false; if (this.evap < 0.04) this.evap = 0.05;
    for (let n = 0; n < (nat ? 2 : 14) && performance.now() - t0 < maxMs; n++) this.tick();
    // deposit remaining suspended pigment: D += P
    const bx = this.box;
    if (bx) {
      gl.enable(gl.SCISSOR_TEST); gl.scissor(bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1]);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      R.draw(R.p.copy, { fb: this.fbD, w: this.w, h: this.h }, u => { R.bindTex(0, this.P[this.cur], u.uS); gl.uniform1i(u.uKind, 1); });
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbP[this.cur]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); // suspended pigment is now deposited
      gl.disable(gl.SCISSOR_TEST);
      // composite base ⊕ paint on the GPU (straight RGBA8), read back once, write into the tiles
      const w = bx[2] - bx[0], h = bx[3] - bx[1], X = this.x0 + bx[0], Y = this.y0 + bx[1];
      if (w > 0 && h > 0) {
        const baseTex = R.sync(this.L), selT = wglSelTex();
        const tex = R.tex(w, h, gl.RGBA8), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        this.edgeBlur(true);
        R.draw(wglRes.comp, { fb, w, h }, u => { R.bindTex(0, baseTex, u.uBase); this.bindComp(u, selT); gl.uniform2i(u.uOff, X, Y); gl.uniform1i(u.uStraight, 1); });
        const out = new Uint8ClampedArray(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
        gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
        if (previewing) { const g = R.lt.get(this.L); if (g) { gl.deleteTexture(g.tex); R.lt.delete(this.L); } }
        writeRegion(this.L, X, Y, w, h, out, true);
        for (let ty = (Y / TS) | 0; ty <= ((Y + h - 1) / TS | 0); ty++) for (let tx = (X / TS) | 0; tx <= ((X + w - 1) / TS | 0); tx++) { const i = ty * doc.tw + tx; if (this.L.tiles[i]) this.touched.add(i); }
      }
    }
    this.free(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.doc === doc && typeof onWetDried === 'function') onWetDried(this);
  }
}
