'use strict';
/* WebGL2 compositor. Each pixel layer mirrors its CPU tiles in an RGBA8 texture (only changed tiles are
   uploaded). Layers are composited bottom→top with 17 blend modes, opacity, clipping masks and isolated
   groups into a (half-float when available) framebuffer; the result is drawn to the screen with the view
   transform (zoom / pan / rotate / flip, mip-mapped when zoomed out). */
const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
/* layer masks are ordinary RGBA tile layers: transparent = white (reveal), painted gray/black hides.
   value = 1 − a·(1 − luma) for straight textures, 1 − a + luma(rgb) for premultiplied ones */
const MASKV = `float maskV(sampler2D t, int kind, ivec2 p){ vec4 m = texelFetch(t, p, 0); float l = dot(m.rgb, vec3(0.299,0.587,0.114)); return kind==1 ? clamp(1.0 - m.a + l, 0.0, 1.0) : 1.0 - m.a * (1.0 - l); }`;
const FS_BLEND = `#version 300 es
precision highp float;
uniform sampler2D uB, uS, uClip, uMask; uniform int uMode, uKind, uUseClip, uUseMask, uMaskKind; uniform float uOp, uClipOp; uniform vec4 uColor, uTint;
out vec4 o;
float lum(vec3 c){ return dot(c, vec3(0.3,0.59,0.11)); }
vec3 clipC(vec3 c){ float l=lum(c), n=min(min(c.r,c.g),c.b), x=max(max(c.r,c.g),c.b); if(n<0.0) c=l+(c-l)*l/(l-n); if(x>1.0) c=l+(c-l)*(1.0-l)/(x-l); return c; }
vec3 setLum(vec3 c, float l){ return clipC(c + (l - lum(c))); }
float sat(vec3 c){ return max(max(c.r,c.g),c.b) - min(min(c.r,c.g),c.b); }
vec3 setSat(vec3 c, float s){ float mx=max(max(c.r,c.g),c.b), mn=min(min(c.r,c.g),c.b); return mx>mn ? (c-mn)*s/(mx-mn) : vec3(0.0); }
float sl(float b, float s){ if(s<=0.5) return b-(1.0-2.0*s)*b*(1.0-b); float d = b<=0.25 ? ((16.0*b-12.0)*b+4.0)*b : sqrt(b); return b+(2.0*s-1.0)*(d-b); }
vec3 blend(int m, vec3 b, vec3 s){
  if(m==1) return b*s;
  if(m==2) return b+s-b*s;
  if(m==3) return vec3(b.r<=0.5?2.0*b.r*s.r:1.0-2.0*(1.0-b.r)*(1.0-s.r), b.g<=0.5?2.0*b.g*s.g:1.0-2.0*(1.0-b.g)*(1.0-s.g), b.b<=0.5?2.0*b.b*s.b:1.0-2.0*(1.0-b.b)*(1.0-s.b));
  if(m==4) return min(b,s);
  if(m==5) return max(b,s);
  if(m==6) return vec3(b.r==0.0?0.0:s.r>=1.0?1.0:min(1.0,b.r/(1.0-s.r)), b.g==0.0?0.0:s.g>=1.0?1.0:min(1.0,b.g/(1.0-s.g)), b.b==0.0?0.0:s.b>=1.0?1.0:min(1.0,b.b/(1.0-s.b)));
  if(m==7) return vec3(b.r>=1.0?1.0:s.r<=0.0?0.0:1.0-min(1.0,(1.0-b.r)/s.r), b.g>=1.0?1.0:s.g<=0.0?0.0:1.0-min(1.0,(1.0-b.g)/s.g), b.b>=1.0?1.0:s.b<=0.0?0.0:1.0-min(1.0,(1.0-b.b)/s.b));
  if(m==8) return vec3(s.r<=0.5?2.0*b.r*s.r:1.0-2.0*(1.0-b.r)*(1.0-s.r), s.g<=0.5?2.0*b.g*s.g:1.0-2.0*(1.0-b.g)*(1.0-s.g), s.b<=0.5?2.0*b.b*s.b:1.0-2.0*(1.0-b.b)*(1.0-s.b));
  if(m==9) return vec3(sl(b.r,s.r), sl(b.g,s.g), sl(b.b,s.b));
  if(m==10) return abs(b-s);
  if(m==11) return b+s-2.0*b*s;
  if(m==12) return min(vec3(1.0), b+s);
  if(m==13) return setLum(setSat(s, sat(b)), lum(b));
  if(m==14) return setLum(setSat(b, sat(s)), lum(b));
  if(m==15) return setLum(s, lum(b));
  if(m==16) return setLum(b, lum(s));
  return s;
}
${MASKV}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 B = texelFetch(uB, p, 0);
  vec4 S;
  if(uKind==2) S = uColor;
  else { S = texelFetch(uS, p, 0); if(uKind==1) S.rgb = S.a > 0.0 ? S.rgb / S.a : vec3(0.0); }
  if(uTint.a > 0.0) S.rgb = mix(S.rgb, uTint.rgb, uTint.a);
  float as = S.a * uOp;
  if(uUseClip==1) as *= texelFetch(uClip, p, 0).a * uClipOp;
  if(uUseMask==1) as *= maskV(uMask, uMaskKind, p);
  vec3 cb = B.a > 0.0 ? B.rgb / B.a : vec3(0.0);
  vec3 cs = uMode==0 ? S.rgb : (1.0 - B.a) * S.rgb + B.a * clamp(blend(uMode, cb, S.rgb), 0.0, 1.0);
  o = vec4(as * cs + (1.0 - as) * B.rgb, as + B.a * (1.0 - as));
}`;
/* clip base coverage (alpha only): source alpha × its layer mask */
const FS_CLIPBASE = `#version 300 es
precision highp float; uniform sampler2D uS, uMask; uniform int uKind, uUseMask, uMaskKind; out vec4 o;
${MASKV}
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); float a = uKind==2 ? 1.0 : texelFetch(uS, p, 0).a; if(uUseMask==1) a *= maskV(uMask, uMaskKind, p); o = vec4(0.0, 0.0, 0.0, a); }`;
/* pass-through group: result = mix(backdrop, children composited onto the backdrop, opacity × mask × clip) */
const FS_LERP = `#version 300 es
precision highp float; uniform sampler2D uB, uS, uMask, uClip; uniform int uUseMask, uMaskKind, uUseClip; uniform float uOp, uClipOp; out vec4 o;
${MASKV}
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); float k = uOp; if(uUseMask==1) k *= maskV(uMask, uMaskKind, p); if(uUseClip==1) k *= texelFetch(uClip, p, 0).a * uClipOp; o = mix(texelFetch(uB, p, 0), texelFetch(uS, p, 0), k); }`;
/* grayscale view of a layer mask (Alt-click the mask thumbnail) */
const FS_MASKVIEW = `#version 300 es
precision highp float; uniform sampler2D uMask; uniform int uMaskKind; out vec4 o;
${MASKV}
void main(){ float m = maskV(uMask, uMaskKind, ivec2(gl_FragCoord.xy)); o = vec4(m, m, m, 1.0); }`;
const FS_COPY = `#version 300 es
precision highp float; uniform sampler2D uS; uniform int uKind; out vec4 o;
void main(){ vec4 c = texelFetch(uS, ivec2(gl_FragCoord.xy), 0); if(uKind==0) c.rgb *= c.a; o = c; }`;
const FS_HOMO = `#version 300 es
precision highp float; uniform sampler2D uF; uniform mat3 uH; uniform float uOp; out vec4 o;
void main(){ vec3 q = uH * vec3(gl_FragCoord.xy, 1.0); vec2 uv = q.xy / q.z; if(q.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard; o = texture(uF, uv) * uOp; }`;
const FS_SCALE = `#version 300 es
precision highp float; uniform sampler2D uC; uniform vec2 uOut; uniform int uWhite; out vec4 o;
void main(){ vec4 c = texture(uC, gl_FragCoord.xy / uOut); if(uWhite==1) c = c + (1.0 - c.a) * vec4(1.0); o = c; }`;
const FS_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uC; uniform vec4 uA; uniform vec2 uT, uDoc; uniform float uH, uZ, uDpr; uniform int uNearest; uniform vec3 uChk1, uChk2;
out vec4 o;
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uH - gl_FragCoord.y);
  vec2 d = vec2(uA.x*sp.x + uA.z*sp.y + uT.x, uA.y*sp.x + uA.w*sp.y + uT.y);
  if(d.x >= 0.0 && d.y >= 0.0 && d.x < uDoc.x && d.y < uDoc.y){
    vec4 c = uNearest==1 ? texelFetch(uC, ivec2(d), 0) : texture(uC, d / uDoc);
    float k = mod(floor(sp.x / (8.0*uDpr)) + floor(sp.y / (8.0*uDpr)), 2.0);
    vec3 ck = mix(uChk1, uChk2, k);
    o = vec4(c.rgb + (1.0 - c.a) * ck, 1.0);
  } else {
    vec2 q = max(max(-d, d - uDoc), 0.0); float dist = length(q) * uZ * uDpr;
    float a = 0.32 * exp(-dist / (6.0*uDpr)) + (dist < uDpr ? 0.35 : 0.0);
    o = vec4(0.05, 0.1, 0.18, 1.0) * a;
  }
}`;

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.cfloat = false; // composite in RGBA8 (premultiplied) — half the GPU memory of half-float targets
    this.p = { blend: this.prog(FS_BLEND), clipbase: this.prog(FS_CLIPBASE), lerp: this.prog(FS_LERP), maskview: this.prog(FS_MASKVIEW), copy: this.prog(FS_COPY), homo: this.prog(FS_HOMO), scale: this.prog(FS_SCALE), disp: this.prog(FS_DISPLAY) };
    this.vao = gl.createVertexArray();
    this.lt = new Map(); this.levels = []; this.final = null; this.dw = 0; this.dh = 0; this.zeros = new Uint8Array(TSZ);
    this.dummy = this.tex(1, 1, gl.RGBA8);
    this.mipValid = false;
  }
  prog(fs) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  tex(w, h, fmt, levels = 1) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, levels > 1 ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  target(w, h, levels = 1) {
    const gl = this.gl, fmt = this.cfloat ? gl.RGBA16F : gl.RGBA8, tex = this.tex(w, h, fmt, levels), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  freeTarget(t) { if (!t) return; this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb); }
  ensureDoc() {
    if (this.dw === doc.w && this.dh === doc.h) return;
    for (const pr of this.levels) pr.forEach(t => this.freeTarget(t)); this.levels = [];
    this.freeTarget(this.final); this.freeTarget(this.tmp); this.freeTarget(this.tmpW); this.tmpW = null;
    this.freeTarget(this.cBelow); this.freeTarget(this.cAbove); this.cBelow = this.cAbove = null; this.bk = this.ak = null;
    for (const t of this.clipT || []) this.freeTarget(t); this.clipT = [];
    for (const g of this.lt.values()) this.gl.deleteTexture(g.tex); this.lt.clear();
    this.dw = doc.w; this.dh = doc.h;
    const lv = Math.floor(Math.log2(Math.max(doc.w, doc.h))) + 1;
    this.final = this.target(doc.w, doc.h, lv); this.tmp = null;
  }
  level(d) { if (!this.levels[d]) this.levels[d] = [this.target(doc.w, doc.h), this.target(doc.w, doc.h)]; return this.levels[d]; }
  /* upload changed tiles of a pixel layer */
  sync(L) {
    const gl = this.gl; let g = this.lt.get(L);
    if (!g) { g = { tex: this.tex(doc.w, doc.h, gl.RGBA8), refs: new Array(L.tiles.length) }; this.lt.set(L, g); }
    gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, TS); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const tw = doc.tw;
    for (let i = 0; i < L.tiles.length; i++) {
      const t = L.tiles[i];
      if (t === g.refs[i] && !L.dirty.has(i)) continue;
      if (!t && g.refs[i] === undefined) { g.refs[i] = null; continue; }
      const x = (i % tw) * TS, y = ((i / tw) | 0) * TS, w = Math.min(TS, doc.w - x), h = Math.min(TS, doc.h - y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, t || this.zeros);
      g.refs[i] = t;
    }
    L.dirty.clear(); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    return g.tex;
  }
  gc() { const live = new Set(tileLayers()); for (const [L, g] of this.lt) if (!live.has(L)) { this.gl.deleteTexture(g.tex); this.lt.delete(L); } }
  draw(prog, target, setup) {
    const gl = this.gl; gl.useProgram(prog.p); gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    if (target) gl.viewport(0, 0, target.w, target.h);
    setup(prog.u); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  bindTex(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
  clear(t) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  /* layer source: {tex, kind 0 straight / 1 premult / 2 color} */
  source(L, depth) {
    if (L.type === 'fill') return { kind: 2, color: L.color };
    if (L.type === 'group') { const t = this.composeList(L.children, depth + 1); return { kind: 1, tex: t.tex }; }
    const tex = this.sync(L);
    if (floating && floating.L === L) return { kind: 1, tex: this.floatingTex(tex) };
    const ws = wetSims.get(L); if (ws && ws.gpu && ws.W) return { kind: 1, tex: ws.composite(tex) };
    return { kind: 0, tex };
  }
  floatingTex(layerTex) {
    const gl = this.gl;
    if (!this.tmp) this.tmp = this.target(doc.w, doc.h);
    this.draw(this.p.copy, this.tmp, u => { this.bindTex(0, layerTex, u.uS); gl.uniform1i(u.uKind, 0); });
    if (!floating.gtex || floating.gver !== floating.ver) {
      if (floating.gtex) gl.deleteTexture(floating.gtex);
      const f = floating, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      f.gtex = t; f.gver = f.ver;
    }
    const H = inv3(squareToQuad(floating.quad)); // doc → unit
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.draw(this.p.homo, this.tmp, u => { this.bindTex(0, floating.gtex, u.uF); gl.uniformMatrix3fv(u.uH, true, new Float32Array(H.map((v, i) => v))); gl.uniform1f(u.uOp, 1); });
    gl.disable(gl.BLEND);
    return this.tmp.tex;
  }
  /* layer mask texture of L (or null when it has none / it is disabled) → {tex, kind} */
  maskOf(L) {
    const M = L.mask; if (!M || !L.maskOn) return null;
    const tex = this.sync(M);
    if (floating && floating.L === M) return { tex: this.floatingTex(tex), kind: 1 };
    return { tex, kind: 0 };
  }
  clipTarget(depth) { this.clipT = this.clipT || []; if (!this.clipT[depth]) this.clipT[depth] = this.target(doc.w, doc.h); return this.clipT[depth]; }
  /* coverage texture (alpha) of a clipping base, mask included */
  clipBaseTex(B, src, depth) {
    const gl = this.gl, mk = this.maskOf(B);
    if (B.type === 'pixel' && !mk && src.kind === 0) return src.tex;
    const t = this.clipTarget(depth);
    this.draw(this.p.clipbase, t, u => {
      this.bindTex(0, src.tex || this.dummy, u.uS); this.bindTex(1, mk ? mk.tex : this.dummy, u.uMask);
      gl.uniform1i(u.uKind, src.kind); gl.uniform1i(u.uUseMask, mk ? 1 : 0); gl.uniform1i(u.uMaskKind, mk ? mk.kind : 0);
    });
    return t.tex;
  }
  /* list is composited bottom→top into a ping-pong pair of this depth; startTex (premultiplied) seeds the
     backdrop for pass-through groups. ov: per-layer overrides {hide, op, tint} (animation onion skins) */
  composeList(list, depth, startTex = null, ov = null) {
    const gl = this.gl, pair = this.level(depth); let cur = 0;
    if (startTex) this.draw(this.p.copy, pair[0], u => { this.bindTex(0, startTex, u.uS); gl.uniform1i(u.uKind, 1); });
    else this.clear(pair[0]);
    let lastBase = null, baseCov = null;
    for (let li = 0; li < list.length; li++) {
      const L = list[li], o = ov ? ov.get(L) : null;
      if (!L.clip) { lastBase = L; baseCov = null; }
      if (!L.visible || (o && o.hide)) continue;
      if (L.clip && lastBase && (!lastBase.visible || lastBase === L)) continue;
      const clipped = L.clip && lastBase && lastBase !== L;
      const nextClips = !L.clip && list[li + 1] && list[li + 1].clip;
      const op = L.opacity * (o && o.op != null ? o.op : 1), tint = o && o.tint;
      const dst = pair[1 - cur], back = pair[cur];
      if (L.type === 'group' && L.blend === 'pass-through' && !clipped) {
        if (nextClips) { const iso = this.composeList(L.children, depth + 1); baseCov = this.clipBaseTex(L, { kind: 1, tex: iso.tex }, depth); }
        const res = this.composeList(L.children, depth + 1, back.tex), mk = this.maskOf(L);
        this.draw(this.p.lerp, dst, u => {
          this.bindTex(0, back.tex, u.uB); this.bindTex(1, res.tex, u.uS); this.bindTex(2, mk ? mk.tex : this.dummy, u.uMask); this.bindTex(3, this.dummy, u.uClip);
          gl.uniform1i(u.uUseMask, mk ? 1 : 0); gl.uniform1i(u.uMaskKind, mk ? mk.kind : 0); gl.uniform1i(u.uUseClip, 0); gl.uniform1f(u.uOp, op); gl.uniform1f(u.uClipOp, 1);
        });
        cur = 1 - cur; continue;
      }
      const src = this.source(L, depth);
      if (nextClips) baseCov = this.clipBaseTex(L, src, depth);
      const clipTex = clipped ? baseCov : null, clipOp = clipped ? lastBase.opacity : 1;
      if (clipped && !clipTex) continue;
      const mk = this.maskOf(L);
      this.draw(this.p.blend, dst, u => {
        this.bindTex(0, back.tex, u.uB);
        this.bindTex(1, src.tex || this.dummy, u.uS);
        this.bindTex(2, clipTex || this.dummy, u.uClip);
        this.bindTex(3, mk ? mk.tex : this.dummy, u.uMask);
        gl.uniform1i(u.uMode, BLEND_IDX[L.blend] || 0); gl.uniform1i(u.uKind, src.kind); gl.uniform1i(u.uUseClip, clipTex ? 1 : 0);
        gl.uniform1i(u.uUseMask, mk ? 1 : 0); gl.uniform1i(u.uMaskKind, mk ? mk.kind : 0);
        gl.uniform1f(u.uOp, op); gl.uniform1f(u.uClipOp, clipOp);
        const c = src.color || [0, 0, 0]; gl.uniform4f(u.uColor, c[0], c[1], c[2], 1);
        if (tint) gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3]); else gl.uniform4f(u.uTint, 0, 0, 0, 0);
      });
      cur = 1 - cur;
    }
    return pair[cur];
  }
  /* Fast path while painting: layers below the active one and (normal-blend) layers above it are cached as
     two premultiplied textures, so a frame costs 3 passes instead of one per layer. */
  layerKey(list) {
    let k = '';
    for (const L of list) {
      k += L.id + ':' + L.ver + ':' + (L.visible ? 1 : 0) + ':' + L.opacity + ':' + L.blend + ':' + (L.clip ? 1 : 0) + ':' + L.color.join(',');
      if (L.mask) k += ':m' + L.mask.id + '.' + L.mask.ver + (L.maskOn ? 1 : 0);
      if (wetSims.has(L) || (floating && (floating.L === L || floating.L === L.mask))) k += ':live' + Math.random();
      if (L.children) k += '[' + this.layerKey(L.children) + ']';
      k += '|';
    }
    return k;
  }
  compose() {
    this.ensureDoc();
    const gl = this.gl, list = doc.root, A = doc.active, i = A ? list.indexOf(A) : -1;
    if (doc.showMask && A && A.mask) { // Alt-click on a mask thumbnail: view the mask itself
      const mk = this.maskOf(A) || { tex: this.sync(A.mask), kind: 0 };
      this.draw(this.p.maskview, this.final, u => { this.bindTex(0, mk.tex, u.uMask); gl.uniform1i(u.uMaskKind, mk.kind); });
      this.mipValid = false; return;
    }
    const ov = typeof animOverrides === 'function' ? animOverrides() : null;
    const fast = !ov && i >= 0 && A.type === 'pixel' && !A.clip && list.length > 2 && !(list[i + 1] && list[i + 1].clip) && list.slice(i + 1).every(L => L.blend === 'normal' && !L.clip && !L.mask);
    if (!fast) {
      const res = ov ? this.composeList(ov.list, 0, null, ov.map) : this.composeList(list, 0);
      this.draw(this.p.copy, this.final, u => { this.bindTex(0, res.tex, u.uS); gl.uniform1i(u.uKind, 1); });
      this.mipValid = false; return;
    }
    if (!this.cBelow) { this.cBelow = this.target(doc.w, doc.h); this.cAbove = this.target(doc.w, doc.h); }
    const bk = this.layerKey(list.slice(0, i)), ak = this.layerKey(list.slice(i + 1));
    if (bk !== this.bk) { const r = this.composeList(list.slice(0, i), 0); this.draw(this.p.copy, this.cBelow, u => { this.bindTex(0, r.tex, u.uS); gl.uniform1i(u.uKind, 1); }); this.bk = bk; }
    if (ak !== this.ak) { const r = this.composeList(list.slice(i + 1), 0); this.draw(this.p.copy, this.cAbove, u => { this.bindTex(0, r.tex, u.uS); gl.uniform1i(u.uKind, 1); }); this.ak = ak; }
    const pair = this.level(0);
    let src = { kind: 0 };
    if (A.visible) src = this.source(A, 0);
    const blendInto = (dst, back, tex, kind, mode, op, mk) => this.draw(this.p.blend, dst, u => {
      this.bindTex(0, back.tex, u.uB); this.bindTex(1, tex || this.dummy, u.uS); this.bindTex(2, this.dummy, u.uClip); this.bindTex(3, mk ? mk.tex : this.dummy, u.uMask);
      gl.uniform1i(u.uMode, mode); gl.uniform1i(u.uKind, kind); gl.uniform1i(u.uUseClip, 0); gl.uniform1f(u.uOp, op); gl.uniform1f(u.uClipOp, 1); gl.uniform4f(u.uColor, 0, 0, 0, 1);
      gl.uniform1i(u.uUseMask, mk ? 1 : 0); gl.uniform1i(u.uMaskKind, mk ? mk.kind : 0); gl.uniform4f(u.uTint, 0, 0, 0, 0);
    });
    let cur = this.cBelow;
    if (A.visible) { blendInto(pair[0], this.cBelow, src.tex, src.kind, BLEND_IDX[A.blend] || 0, A.opacity, this.maskOf(A)); cur = pair[0]; }
    blendInto(this.final, cur, this.cAbove.tex, 1, 0, 1);
    this.mipValid = false;
  }
  mips() { if (this.mipValid) return; const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.final.tex); gl.generateMipmap(gl.TEXTURE_2D); this.mipValid = true; }
  display(V, dpr, theme) {
    const gl = this.gl, cv = this.cv, z = Math.hypot(V[0], V[1]);
    if (z < 0.999) this.mips();
    const inv = mat.inv(mat.mul(mat.sc(dpr), V));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.draw(this.p.disp, null, u => {
      gl.viewport(0, 0, cv.width, cv.height);
      this.bindTex(0, this.final.tex, u.uC);
      gl.uniform4f(u.uA, inv[0], inv[1], inv[2], inv[3]); gl.uniform2f(u.uT, inv[4], inv[5]); gl.uniform2f(u.uDoc, doc.w, doc.h);
      gl.uniform1f(u.uH, cv.height); gl.uniform1f(u.uZ, z); gl.uniform1f(u.uDpr, dpr); gl.uniform1i(u.uNearest, z >= 1.99 ? 1 : 0);
      gl.uniform3f(u.uChk1, 1, 1, 1); gl.uniform3f(u.uChk2, 0.86, 0.88, 0.9);
    });
    gl.disable(gl.BLEND);
  }
  /* read composite as straight RGBA8 (doc rows top→bottom) */
  readComposite(x = 0, y = 0, w = doc.w, h = doc.h) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.final.fb);
    const out = new Uint8ClampedArray(w * h * 4);
    if (this.cfloat) {
      const f = new Float32Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, f);
      for (let i = 0; i < f.length; i += 4) { const a = f[i + 3]; if (a > 0) { out[i] = f[i] / a * 255; out[i + 1] = f[i + 1] / a * 255; out[i + 2] = f[i + 2] / a * 255; out[i + 3] = a * 255; } }
    } else {
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      for (let i = 0; i < out.length; i += 4) { const a = out[i + 3]; if (a && a < 255) { out[i] = out[i] * 255 / a; out[i + 1] = out[i + 1] * 255 / a; out[i + 2] = out[i + 2] * 255 / a; } }
    }
    return out;
  }
  pick(x, y) { const d = this.readComposite(clamp(x | 0, 0, doc.w - 1), clamp(y | 0, 0, doc.h - 1), 1, 1); return d; }
  /* scaled composite (premultiplied → optionally flattened on white), RGBA8 rows top→bottom */
  readScaled(w, h, white = true) {
    const gl = this.gl; this.mips();
    if (!this.small || this.small.w !== w || this.small.h !== h) {
      if (this.small) { gl.deleteTexture(this.small.tex); gl.deleteFramebuffer(this.small.fb); }
      const tex = this.tex(w, h, gl.RGBA8), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.small = { tex, fb, w, h };
    }
    this.draw(this.p.scale, this.small, u => { this.bindTex(0, this.final.tex, u.uC); gl.uniform2f(u.uOut, w, h); gl.uniform1i(u.uWhite, white ? 1 : 0); });
    const out = new Uint8ClampedArray(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out); return out;
  }
}
