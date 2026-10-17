'use strict';
/* Lumen Darkroom — WebGL2 develop engine.
   Pipeline (all passes are full-screen quads):
     1. geometry  : source (sRGB texture, mipmapped → linear) → crop / straighten / rotate / flip → RGBA16F linear "G"
     2. blur A    : small-radius gaussian of G (texture, colour noise reduction)
     3. blur B    : large-radius gaussian of G (clarity, dehaze, tone masks) — radius is relative to the image,
                    so thumbnails, the live view and full-size exports look the same
     4. develop   : WB, exposure, dehaze, tone, presence, HSL, grading, curve, detail, effects → RGBA8 "OUT"
   OUT is blitted to the visible canvas or read back for thumbnails / export / histogram. */
const Engine = (() => {
  const VS = `#version 300 es
in vec2 aP; out vec2 vUV;
void main(){ vUV = vec2(aP.x*.5+.5, .5-aP.y*.5); gl_Position = vec4(aP,0.,1.); }`;

  const FS_GEOM = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uS; uniform float uBias;
${Geo.GLSL}
uniform vec4 uSpot[192]; uniform int uNSpots;      // per spot: (dst.xy, src.xy) square coords, (radius, feather, opacity, heal), (first texel, points, -, -)
uniform highp sampler2D uPts;                       // stroke spots: texel = bbox, then the points (square coords)
uniform vec3 uVigC;                                 // lens vignetting: amount, exponent, on
uniform vec2 uCA;                                   // lateral CA: red / blue radial scale
uniform float uSplit, uBefore;
vec2 gX, gY;                                        // texture gradients (computed in uniform control flow)
vec3 tex(vec2 s){ return textureGrad(uS, s, gX, gY).rgb; }
vec3 texL(vec2 s, float lod){ return textureLod(uS, s, lod).rgb; }
vec3 healOffset(vec2 q, vec2 D, vec2 S, float r){
  // membrane-style interpolation of the colour difference along the spot boundary (Shepard weights)
  float lod = max(0., log2(r*max(float(textureSize(uS,0).x), float(textureSize(uS,0).y))*.12));
  vec3 acc = vec3(0.); float ws = 0.;
  for (int k = 0; k < 16; k++) {
    float a = float(k)*.39269908; vec2 dir = vec2(cos(a), sin(a))*r*1.08;
    vec3 d = texL((D + dir)/uSq, lod) - texL((S + dir)/uSq, lod);
    vec2 e = q - dir; float w = 1./(dot(e,e) + r*r*.02);
    acc += d*w; ws += w;
  }
  return acc/ws;
}
vec3 sampleSrc(vec2 s, bool fx){
  vec3 c = tex(s);
  if (!fx) return c;
  vec2 P = s*uSq;
  for (int i = 0; i < 64; i++) {
    if (i >= uNSpots) break;
    vec4 a = uSpot[3*i], b = uSpot[3*i+1], e3 = uSpot[3*i+2];
    if (e3.y > .5) {   // brush-stroke spot: distance to the polyline, heal across the stroke
      int st = int(e3.x), n = int(e3.y);
      vec4 bb = texelFetch(uPts, ivec2(st % 1024, st / 1024), 0);
      if (P.x < bb.x || P.y < bb.y || P.x > bb.z || P.y > bb.w) continue;
      vec2 prev = texelFetch(uPts, ivec2((st + 1) % 1024, (st + 1) / 1024), 0).xy, Q = prev, T = vec2(1., 0.); float best = length(P - prev);
      for (int k = 1; k < 300; k++) {
        if (k >= n) break;
        int t = st + 1 + k; vec2 cur = texelFetch(uPts, ivec2(t % 1024, t / 1024), 0).xy, e = cur - prev; float l2 = dot(e, e);
        if (l2 > 1e-12) { float u = clamp(dot(P - prev, e)/l2, 0., 1.); vec2 q = prev + e*u; float dd = length(P - q); if (dd < best) { best = dd; Q = q; T = e/sqrt(l2); } }
        prev = cur;
      }
      if (best >= b.x) continue;
      float w = (1. - smoothstep(b.x*(1. - b.y), b.x, best))*b.z;
      vec2 off = a.zw - a.xy; vec3 src = tex((P + off)/uSq);
      if (b.w > .5) {
        vec2 N = vec2(-T.y, T.x); float lod = max(0., log2(b.x*max(float(textureSize(uS,0).x), float(textureSize(uS,0).y))*.15));
        vec2 A = Q + N*b.x*1.15, B = Q - N*b.x*1.15;
        vec3 dA = texL(A/uSq, lod) - texL((A + off)/uSq, lod), dB = texL(B/uSq, lod) - texL((B + off)/uSq, lod);
        src = max(src + mix(dB, dA, clamp(dot(P - Q, N)/b.x*.5 + .5, 0., 1.)), vec3(0.));
      }
      c = mix(c, src, w);
      continue;
    }
    float d = length(P - a.xy);
    if (d >= b.x) continue;
    float w = (1. - smoothstep(b.x*(1. - b.y), b.x, d))*b.z;
    vec2 sp = (P - a.xy + a.zw)/uSq;
    vec3 src = tex(sp);
    if (b.w > .5) src = max(src + healOffset(P - a.xy, a.xy, a.zw, b.x), vec3(0.));
    c = mix(c, src, w);
  }
  return c;
}
void main(){
  vec2 cs = toCorr(vUV);
  vec2 s = cs.x < -.5 ? vec2(-1.) : toRaw(cs);
  float bs = exp2(uBias); gX = dFdx(s)*bs; gY = dFdy(s)*bs;
  if (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) { o = vec4(0.); return; }
  bool fx = !(uBefore > .5 || vUV.x < uSplit);
  vec3 c;
  if (fx && (uCA.x != 0. || uCA.y != 0.)) {
    vec2 Q = (s - .5)*uSq;
    c = vec3(sampleSrc((Q*(1. + uCA.x))/uSq + .5, true).r, sampleSrc(s, true).g, sampleSrc((Q*(1. + uCA.y))/uSq + .5, true).b);
  } else c = sampleSrc(s, fx);
  if (fx && uVigC.z > .5) {
    vec2 Q = (s - .5)*uSq; float r2 = dot(Q,Q)/(dot(uSq,uSq)*.25);
    c *= max(0., 1. + uVigC.x*pow(r2, uVigC.y));
  }
  o = vec4(c, 1.);
}`;

  // mask pass: evaluates one mask (shape × brush × range) per draw; additive blending sums the local adjustments
  const FS_MASK = `#version 300 es
precision highp float;
in vec2 vUV;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
${Geo.GLSL}
uniform sampler2D uG, uBrush;
uniform int uType; uniform float uHasBrush, uInvert, uAmt; uniform int uMode;
uniform vec4 uP0, uP1;                // linear: p0, p1 (square) | radial: centre, radii; uP1: cos, sin, feather
uniform vec4 uRange, uRangeC;         // mode(0/1/2), lo, hi, smooth | L, a, b, tolerance
uniform vec4 uA0, uA1, uA2;
float enc1(float x){ x = max(x,0.); return x < .0031308 ? 12.92*x : 1.055*pow(x, 1./2.4) - .055; }
vec3 oklab(vec3 c){
  vec3 l = vec3(.4122214708*c.r + .5363325363*c.g + .0514459929*c.b, .2119034982*c.r + .6806995451*c.g + .1073969566*c.b, .0883024619*c.r + .2817188376*c.g + .6299787005*c.b);
  l = pow(max(l, vec3(0.)), vec3(1./3.));
  return vec3(.2104542553*l.x + .7936177850*l.y - .0040720468*l.z, 1.9779984951*l.x - 2.4285922050*l.y + .4505937099*l.z, .0259040371*l.x + .7827717662*l.y - .8086757660*l.z);
}
void main(){
  vec2 s = toSource(vUV);
  vec2 P = s*uSq;
  float m = 0.;
  if (uType == 0) {
    vec2 d = uP0.zw - uP0.xy; float t = dot(P - uP0.xy, d)/max(dot(d,d), 1e-9);
    m = 1. - smoothstep(0., 1., clamp(t, 0., 1.));
  } else if (uType == 1) {
    vec2 q = P - uP0.xy; q = vec2(q.x*uP1.x + q.y*uP1.y, -q.x*uP1.y + q.y*uP1.x);
    float d = length(q/uP0.zw); float f = max(uP1.z, .002);
    m = 1. - smoothstep(1. - f, 1., d);
  }
  if (uType < 2 && uInvert > .5) m = 1. - m;
  if (uHasBrush > .5) {
    vec2 b = (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) ? vec2(0.) : texture(uBrush, s).rg;
    m = max(m, b.r)*(1. - b.g);
  }
  if (uRange.x > .5) {
    vec3 g = texture(uG, vec2(vUV.x, 1. - vUV.y)).rgb;
    if (uRange.x < 1.5) {
      float Y = enc1(dot(g, vec3(.2126,.7152,.0722))); float sm = max(uRange.w, .002);
      m *= smoothstep(uRange.y - sm, uRange.y, Y)*(1. - smoothstep(uRange.z, uRange.z + sm, Y));
    } else {
      vec3 L = oklab(g); vec3 d = L - uRangeC.xyz; float dist = length(vec3(d.x*.5, d.y, d.z));
      float tol = .015 + uRangeC.w*.22;
      m *= 1. - smoothstep(tol*.45, tol, dist);
    }
  }
  m *= uAmt;
  if (uMode == 1) { o0 = vec4(m, m, m, 1.); o1 = vec4(0.); o2 = vec4(0.); return; }
  o0 = uA0*m; o1 = uA1*m; o2 = uA2*m;
}`;

  const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o; uniform sampler2D uT;
void main(){ o = texture(uT, vec2(vUV.x, 1.-vUV.y)); }`;

  const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o; uniform sampler2D uT; uniform vec2 uD; uniform float uSig;
void main(){
  vec2 tc = vec2(vUV.x, 1.-vUV.y); vec4 a = vec4(0.); float ws = 0.;
  for (int i = -12; i <= 12; i++) { float f = float(i); float w = exp(-f*f/(2.*uSig*uSig)); a += texture(uT, tc + uD*f)*w; ws += w; }
  o = a/ws;
}`;

  const FS_DEV = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uG, uA, uB, uCurve, uL0, uL1, uL2, uLM;
uniform float uHasL, uOverlay, uVis; uniform vec2 uFringe;
uniform vec2 uPx;           // 1/output size
uniform vec4 uView;         // crop-uv = uView.xy + vUV*uView.zw (for vignette / grain)
uniform vec2 uFull;         // full crop size in output pixels
uniform vec2 uTT; uniform float uExp;
uniform float uCon, uHi, uSh, uWh, uBl, uTex, uCla, uDehaze, uVib, uSat, uBW;
uniform float uHue[8], uHSat[8], uLum[8];
uniform vec3 uGS, uGM, uGH, uGL; uniform float uGBal, uGBlend;
uniform vec4 uSharp;        // amount, radius(px), detail, masking
uniform vec2 uNR;           // luminance, colour
uniform vec4 uVig;          // amount, midpoint, roundness, feather
uniform vec3 uGrain;        // amount, size, roughness
uniform float uSplit, uBefore;
uniform mat3 uCal; uniform float uShT;  // calibration: primaries matrix (linear RGB), shadows tint
uniform float uClip;        // clipping warning overlay (screen only)
const vec3 LW = vec3(.2126,.7152,.0722);
float luma(vec3 c){ return dot(c, LW); }
vec3 enc(vec3 x){ x = max(x, vec3(0.)); return mix(12.92*x, 1.055*pow(x, vec3(1./2.4)) - .055, step(.0031308, x)); }
float enc1(float x){ x = max(x,0.); return x < .0031308 ? 12.92*x : 1.055*pow(x, 1./2.4) - .055; }
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y)/(6.*d + e)), d/(q.x + e), q.x);
}
vec3 wbMul(float t, float n){ vec3 m = vec3(exp2(t*.9), exp2(-n*.6), exp2(-t*.9)); return m/dot(m, LW); }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1., 2./3., 1./3.))*6. - 3.); return c.z*mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float contrastCurve(float x, float k){
  float xc = clamp(x, 0., 1.); float s = xc*xc*(3.-2.*xc);
  float y = k >= 0. ? mix(xc, s, k) : mix(xc, 2.*xc - s, -k);
  return y + (x - xc);
}
void main(){
  vec2 tc = vec2(vUV.x, 1.-vUV.y);
  vec4 g0 = texture(uG, tc); vec3 c = g0.rgb;
  if (uBefore > .5 || vUV.x < uSplit) { o = vec4(enc(c), g0.a); return; }
  // ---- local adjustments (sum of all masks): exposure, contrast, highlights, shadows | temp, tint, saturation, clarity | dehaze, sharpness, noise
  vec4 L0 = vec4(0.), L1 = vec4(0.), L2 = vec4(0.);
  if (uHasL > .5) { L0 = texture(uL0, tc); L1 = texture(uL1, tc); L2 = texture(uL2, tc); }
  float nrL = clamp(uNR.x + L2.z, 0., 1.);

  // ---- noise reduction (bilateral luminance + chroma smoothing) ----
  if (nrL > 0.) {
    float cy = enc1(luma(c)); float rs = .015 + .09*nrL; vec3 acc = vec3(0.); float ws = 0.;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec3 s = texture(uG, tc + vec2(float(i), float(j))*uPx).rgb; float d = enc1(luma(s)) - cy;
      float w = exp(-float(i*i + j*j)/(2.*(.8 + 1.6*nrL)) - d*d/(2.*rs*rs)); acc += s*w; ws += w; }
    c = mix(c, acc/ws, min(1., nrL*1.4));
  }
  vec3 cA = texture(uA, tc).rgb;
  if (uNR.y > 0.) { float lc = luma(c), la = max(luma(cA), 1e-5); c = mix(c, cA*(lc/la), uNR.y); }
  // ---- defringe: desaturate purple / green fringes along strong edges ----
  if (uFringe.x > 0. || uFringe.y > 0.) {
    vec3 e = enc(c); vec3 hv = rgb2hsv(clamp(e, 0., 1.));
    float edge = smoothstep(.015, .07, abs(enc1(luma(c)) - enc1(luma(cA))) + length(e - enc(cA))*.5);
    float bp = smoothstep(.70, .76, hv.x)*(1. - smoothstep(.90, .96, hv.x)), bg = smoothstep(.20, .25, hv.x)*(1. - smoothstep(.42, .47, hv.x));
    float w = clamp(edge*(bp*uFringe.x + bg*uFringe.y)*smoothstep(.04, .15, hv.y), 0., 1.);
    c = mix(c, vec3(luma(c)), w);
  }
  // local negative sharpness = soften
  if (L2.y < 0.) c = mix(c, cA, clamp(-L2.y, 0., 1.));

  // ---- sharpening (detail computed on the perceptual luminance, added after tone) ----
  float sharpD = 0.;
  float sAmt = uSharp.x + max(L2.y, 0.)*1.2;
  if (sAmt > 0.) {
    float r = uSharp.y; float b = 0.; float wsum = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      float w = (i == 0 && j == 0) ? 4. : (i == 0 || j == 0) ? 2. : 1.;
      b += enc1(luma(texture(uG, tc + vec2(float(i), float(j))*uPx*r).rgb))*w; wsum += w; }
    b /= wsum; float y0 = enc1(luma(c)); float d = y0 - b;
    float thr = (1. - uSharp.z)*.012; d = sign(d)*max(abs(d) - thr, 0.);
    float gx = enc1(luma(texture(uG, tc + vec2(uPx.x*2.,0.)).rgb)) - enc1(luma(texture(uG, tc - vec2(uPx.x*2.,0.)).rgb));
    float gy = enc1(luma(texture(uG, tc + vec2(0.,uPx.y*2.)).rgb)) - enc1(luma(texture(uG, tc - vec2(0.,uPx.y*2.)).rgb));
    float edge = smoothstep(uSharp.w*.12, uSharp.w*.12 + .04, length(vec2(gx,gy)));
    sharpD = sAmt*1.6*d*mix(1., edge, step(.001, uSharp.w));
  }

  // ---- white balance, exposure ----
  vec3 k = wbMul(uTT.x + L1.x, uTT.y + L1.y)*exp2(uExp + L0.x);
  c *= k; vec3 bB = texture(uB, tc).rgb*k; cA *= k;
  // ---- calibration (camera primaries hue / saturation; neutrals are preserved by construction) ----
  c = uCal*c; bB = uCal*bB; cA = uCal*cA;

  // ---- dehaze (dark-channel style, using the large blur as the haze map) ----
  float dz = clamp(uDehaze + L2.x, -1., 1.);
  if (dz > 0.) {
    float A = .95; float dark = clamp(min(min(bB.r,bB.g),bB.b)/A, 0., 1.);
    float t = max(1. - dz*.9*dark, .12);
    c = max((c - A*(1.-t))/t, 0.); bB = max((bB - A*(1.-t))/t, 0.); cA = max((cA - A*(1.-t))/t, 0.);
    float l = luma(c); c = mix(vec3(l), c, 1. + dz*.25);
  } else if (dz < 0.) {
    float hz = -dz; vec3 fog = vec3(.75)*mix(1., luma(bB)*1.3 + .2, .5);
    c = mix(c, fog, hz*.6); bB = mix(bB, fog, hz*.6); cA = mix(cA, fog, hz*.6);
  }

  // ---- to perceptual space ----
  vec3 p = enc(c);
  float Y = luma(p), YB = enc1(luma(bB)), YA = enc1(luma(cA));
  float dY = 0.;
  dY += uTex*1.1*(Y - YA);
  float mid = 1. - pow(abs(2.*Y - 1.), 2.);
  dY += (uCla + L1.w)*.85*(Y - YB)*(.35 + .65*mid);

  // ---- tone: highlights / shadows (local masks), whites / blacks (end points) ----
  float Ym = clamp(mix(Y, YB, .55), 0., 1.);
  float shM = pow(1. - smoothstep(0., .62, Ym), 1.6), hiM = smoothstep(.35, 1., Ym);
  float sh = clamp(uSh + L0.w, -1.5, 1.5), hi = clamp(uHi + L0.z, -1.5, 1.5);
  dY += sh*.36*shM*(sh > 0. ? (1. - .5*Y) : (.4 + Y));
  dY += hi*.34*hiM*(hi < 0. ? (.3 + .7*Y) : (1.05 - Y)*1.5);
  p += dY + sharpD;
  // whites / blacks: soft levels on the end points
  if (uWh != 0. || uBl != 0.) {
    vec3 t = smoothstep(0., 1., clamp(p, 0., 1.));
    float wp = 1. - uWh*.18, bp = -uBl*.18;
    p += (p/wp - p)*t + ((p - bp)/(1. - bp) - p)*(1. - t);
  }

  // ---- contrast ----
  float con = clamp(uCon + L0.y, -1., 1.5);
  p = vec3(contrastCurve(p.r, con), contrastCurve(p.g, con), contrastCurve(p.b, con));
  // ---- calibration: shadows tint (green - / magenta +) ----
  if (uShT != 0.) { float sw = pow(1. - smoothstep(0., .6, clamp(luma(p), 0., 1.)), 1.5); p += vec3(.5, -1., .5)*uShT*.07*sw; }

  // ---- vibrance / saturation ----
  float gy = luma(p);
  float sat = max(max(p.r,p.g),p.b) - min(min(p.r,p.g),p.b);
  vec3 hsv0 = rgb2hsv(clamp(p, 0., 1.));
  float skin = 1. - .6*exp(-pow((hsv0.x - .07)/.05, 2.));
  float vib = uVib > 0. ? uVib*(1. - clamp(sat*1.4, 0., 1.))*skin : uVib;
  p = gy + (p - gy)*max(0., (1. + uSat)*(1. + vib)*max(0., 1. + L1.z));

  // ---- HSL colour mixer (8 bands) ----
  {
    vec3 h = rgb2hsv(clamp(p, 0., 1.)); float H = h.x*360.;
    float C[9] = float[9](0., 30., 60., 120., 180., 240., 270., 300., 360.);
    float hs = 0., ss = 0., ls = 0.;
    for (int i = 0; i < 8; i++) {
      if (H >= C[i] && H < C[i+1]) {
        float t = smoothstep(.12, .88, (H - C[i])/(C[i+1] - C[i])); int j = i == 7 ? 0 : i + 1;
        hs = mix(uHue[i], uHue[j], t); ss = mix(uHSat[i], uHSat[j], t); ls = mix(uLum[i], uLum[j], t);
      }
    }
    if (hs != 0. || ss != 0. || ls != 0.) {
      float w = smoothstep(0., .12, h.y);          // leave neutrals alone
      float over = max(max(p.r,p.g),p.b) - h.z;    // keep values above 1
      h.x = fract(h.x + hs*w*(30./360.) + 1.);
      h.y = clamp(h.y*(1. + ss*w), 0., 1.);
      vec3 q = hsv2rgb(h); float l0 = luma(q);
      q *= 1. + ls*.55*w*h.y*(1. - .4*l0);
      p = q + over*0.;
    }
  }

  // ---- black & white ----
  if (uBW > .5) p = vec3(luma(p));

  // ---- colour grading (shadows / midtones / highlights) ----
  {
    float L = clamp(luma(p), 0., 1.);
    float Lb = pow(L, exp2(-uGBal*1.2));
    float sp = 1.5 + (1. - uGBlend)*2.5;
    float ws = pow(1. - Lb, sp), wh = pow(Lb, sp); float wm = max(0., 1. - ws - wh);
    p += ws*uGS + wm*uGM + wh*uGH;
    p += (ws*uGL.x + wm*uGL.y + wh*uGL.z)*.25;
  }

  // ---- tone curve (LUT: master composed with R/G/B) ----
  vec3 pc = clamp(p, 0., 1.)*(255./256.) + .5/256.;
  p = vec3(texture(uCurve, vec2(pc.r, .5)).r, texture(uCurve, vec2(pc.g, .5)).g, texture(uCurve, vec2(pc.b, .5)).b);

  // ---- effects: post-crop vignette, grain ----
  vec2 cu = uView.xy + vUV*uView.zw;
  if (uVig.x != 0.) {
    vec2 d = (cu - .5)*2.; float asp = uFull.x/uFull.y;
    vec2 circ = asp > 1. ? vec2(d.x*asp, d.y) : vec2(d.x, d.y/asp);
    vec2 q = mix(d, circ/max(asp, 1./asp), clamp(uVig.z*.5 + .5, 0., 1.));
    float r = length(q)/1.4142*1.25;
    float v = smoothstep(uVig.y, uVig.y + max(uVig.w, .02), r);
    if (uVig.x < 0.) p *= 1. + uVig.x*v; else p = mix(p, vec3(1.), uVig.x*v);
  }
  if (uGrain.x > 0.) {
    vec2 gp = cu*uFull/max(uFull.x, uFull.y)*(900./uGrain.y);
    float n = vnoise(gp) - .5; n = mix(n, (vnoise(gp*2.7 + 17.) - .5), uGrain.z*.6);
    float L = luma(p); p += n*uGrain.x*.32*(1. - .6*abs(2.*L - 1.));
  }
  if (uOverlay > .5) p = mix(p, vec3(1., .16, .1), texture(uLM, tc).r*.6);
  if (uVis > .5) { float e = abs(Y - YA)*14. + abs(Y - YB)*2.; p = vec3(1. - clamp(e, 0., 1.)); }
  if (uClip > .5) {                                // clipping warnings: highlights red, shadows blue
    vec3 q = clamp(p, 0., 1.);
    if (max(q.r, max(q.g, q.b)) >= .999) { o = vec4(1., 0., 0., g0.a); return; }
    if (max(q.r, max(q.g, q.b)) <= .001) { o = vec4(0., .35, 1., g0.a); return; }
  }
  p += (hash(gl_FragCoord.xy + .37) - .5)/255.;    // dither
  o = vec4(clamp(p, 0., 1.), g0.a);
}`;

  let gl = null, canvas = null, progs = {}, vao = null, maxTex = 4096, hasFloat = false;
  const fbos = {}, sources = new Map();   // key → {tex, w, h, used}
  let curveTex = null, curveKey = '';
  let lastGeom = null;   // info about the last geometry pass (for the eyedropper)

  function compile(fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.loc = {}; p.u = n => (n in p.loc ? p.loc[n] : (p.loc[n] = gl.getUniformLocation(p, n)));
    return p;
  }
  function init() {
    if (gl) return true;
    canvas = document.createElement('canvas'); canvas.className = 'dr-gl';
    gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
    if (!gl) return false;
    hasFloat = !!gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
    maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    progs.geom = compile(FS_GEOM); progs.mask = compile(FS_MASK); progs.down = compile(FS_DOWN); progs.blur = compile(FS_BLUR); progs.dev = compile(FS_DEV);
    vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    curveTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, curveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('WebGL context lost'); });
    return true;
  }

  function fbo(name, w, h, fmt) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let f = fbos[name];
    if (f && f.w === w && f.h === h && f.fmt === fmt) return f;
    if (f) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); }
    gl.activeTexture(gl.TEXTURE15);   // never disturb the units bound for a pass
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const float = fmt === 'f' && hasFloat;
    const levels = name.endsWith('G') ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (fbos[name] = { tex, fb, w, h, fmt: float ? 'f' : 'b', levels });
  }
  function freeBig() { Object.keys(fbos).forEach(k => { const f = fbos[k]; if (f.w * f.h > 4e6) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); delete fbos[k]; } }); }

  /* ---------- sources ---------- */
  // img: ImageBitmap | HTMLCanvasElement | HTMLImageElement | ImageData
  function setSource(key, img) {
    init();
    let w = img.width, h = img.height;
    if (Math.max(w, h) > maxTex) {
      const s = maxTex / Math.max(w, h), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      if (img instanceof ImageData) { const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(img, 0, 0); img = t; }
      x.drawImage(img, 0, 0, c.width, c.height); img = c; w = c.width; h = c.height;
    }
    dropSource(key);
    gl.activeTexture(gl.TEXTURE15);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const s = { tex, w, h, used: performance.now() }; sources.set(key, s);
    // keep memory bounded: at most 6 cached sources
    // (the develop view's 'work:' textures are managed by the caller and never evicted here)
    const evictable = [...sources.entries()].filter(([k]) => k !== key && !k.startsWith('work:'));
    if (evictable.length > 6) dropSource(evictable.sort((a, b) => a[1].used - b[1].used)[0][0]);
    return s;
  }
  function dropSource(key) { const s = sources.get(key); if (s) { gl.deleteTexture(s.tex); sources.delete(key); } }
  const hasSource = key => sources.has(key);
  const sourceSize = key => { const s = sources.get(key); return s ? { w: s.w, h: s.h } : null; };

  /* ---------- geometry ---------- */
  // oriented dims after 90° rotations
  function orientedSize(w, h, crop) { return (crop.rot & 1) ? { w: h, h: w } : { w, h }; }
  // cropped image size in source pixels
  function cropSize(w, h, crop, full) {
    const o = orientedSize(w, h, crop);
    return full ? o : { w: Math.max(1, o.w * crop.w), h: Math.max(1, o.h * crop.h) };
  }
  // maps crop-uv (u,v) → source uv
  function mapper(w, h, crop, full) {
    const o = orientedSize(w, h, crop), a = (crop.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const cx = full ? 0 : crop.x, cy = full ? 0 : crop.y, cw = full ? 1 : crop.w, ch = full ? 1 : crop.h;
    return (u, v) => {
      const px = (cx + u * cw - .5) * o.w, py = (cy + v * ch - .5) * o.h;
      // undo straighten (image displayed rotated by +a)
      const qx = ca * px + sa * py, qy = -sa * px + ca * py;
      let ou = qx / o.w + .5, ov = qy / o.h + .5;
      if (crop.flipH) ou = 1 - ou; if (crop.flipV) ov = 1 - ov;
      for (let i = 0; i < ((crop.rot % 4) + 4) % 4; i++) { const t = ou; ou = ov; ov = 1 - t; }
      return [ou, ov];
    };
  }
  // is the crop rect fully inside the straightened image?
  function cropInside(w, h, crop) {
    const o = orientedSize(w, h, crop), a = (crop.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = (crop.x + u * crop.w - .5) * o.w, py = (crop.y + v * crop.h - .5) * o.h;
      const qx = ca * px + sa * py, qy = -sa * px + ca * py;
      if (Math.abs(qx) > o.w / 2 + 1e-6 || Math.abs(qy) > o.h / 2 + 1e-6) return false;
    }
    return true;
  }
  // shrink crop around its centre until it fits inside the straightened image
  function constrainCrop(w, h, crop) {
    const c = { ...crop };
    c.x = Math.max(0, Math.min(1 - c.w, c.x)); c.y = Math.max(0, Math.min(1 - c.h, c.y));
    if (cropInside(w, h, c)) return c;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, t = { ...c, w: c.w * m, h: c.h * m, x: cx - c.w * m / 2, y: cy - c.h * m / 2 }; if (cropInside(w, h, t)) lo = m; else hi = m; }
    // try to also pull toward the centre if still failing
    let r = { ...c, w: c.w * lo, h: c.h * lo, x: cx - c.w * lo / 2, y: cy - c.h * lo / 2 };
    if (lo < .02) { lo = 0; hi = 1; const base = { ...c, x: .5 - c.w / 2, y: .5 - c.h / 2 }; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, t = { ...base, w: c.w * m, h: c.h * m, x: .5 - c.w * m / 2, y: .5 - c.h * m / 2 }; if (cropInside(w, h, t)) lo = m; else hi = m; } r = { ...base, w: c.w * lo, h: c.h * lo, x: .5 - c.w * lo / 2, y: .5 - c.h * lo / 2 }; }
    return r;
  }

  /* ---------- tone curve LUT ---------- */
  function splineLUT(pts) {
    const p = (pts && pts.length >= 2 ? pts : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
    const n = p.length, out = new Float32Array(256);
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    // monotone cubic (Fritsch–Carlson)
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(d[i]) < 1e-9) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    for (let k = 0; k < 256; k++) {
      const x = k / 255; let y;
      if (x <= xs[0]) y = ys[0]; else if (x >= xs[n - 1]) y = ys[n - 1];
      else {
        let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
        const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
        y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
      }
      out[k] = Math.min(1, Math.max(0, y));
    }
    return out;
  }
  // master LUT = point curve o parametric (region) curve
  function masterLUT(curve, pcurve) {
    const M = splineLUT(curve?.rgb); if (Tonal.isPCDefault(pcurve)) return M;
    const P = Tonal.paramLUT(pcurve), out = new Float32Array(256);
    for (let i = 0; i < 256; i++) out[i] = lookLUT(M, P[i]);
    return out;
  }
  const lookLUT = (L, v) => { const x = Math.max(0, Math.min(1, v)) * 255, i = Math.min(254, Math.floor(x)), f = x - i; return L[i] * (1 - f) + L[i + 1] * f; };
  function updateCurve(curve, pcurve) {
    const key = JSON.stringify([curve || null, pcurve || null]);
    if (key === curveKey) return; curveKey = key;
    const M = masterLUT(curve, pcurve), R = splineLUT(curve?.r), G = splineLUT(curve?.g), B = splineLUT(curve?.b);
    const look = lookLUT;
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const m = M[i];
      data[i * 4] = Math.round(look(R, m) * 255); data[i * 4 + 1] = Math.round(look(G, m) * 255); data[i * 4 + 2] = Math.round(look(B, m) * 255); data[i * 4 + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, curveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /* ---------- settings → uniforms ---------- */
  function wbMult(temp, tint) {
    const r = Math.pow(2, temp / 100 * .9), b = Math.pow(2, -temp / 100 * .9), g = Math.pow(2, -tint / 100 * .6);
    const l = .2126 * r + .7152 * g + .0722 * b; return [r / l, g / l, b / l];
  }
  // solve temp/tint that neutralise a linear RGB sample
  function solveWB(rgb) {
    const [r, g, b] = rgb.map(x => Math.max(1e-5, x));
    const temp = 100 * Math.log2(b / r) / 1.8;
    const tint = -100 * (Math.log2(r / g) + .9 * temp / 100) / .6;
    return { temp: Math.max(-100, Math.min(100, temp)), tint: Math.max(-100, Math.min(100, tint)) };
  }
  function gradeColor(h, s) {
    // zero-luminance chroma offset for hue h (deg), saturation s (0..100)
    const hsv = x => { const k = n => (n + x / 60) % 6; const f = n => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)); return [f(5), f(3), f(1)]; };
    const c = hsv(h), l = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
    return c.map(v => (v - l) * (s / 100) * .3);
  }

  function drawTo(f, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  /* render(key, settings, opt)
     opt.outW/outH: pixel size of the output
     opt.view: {x,y,w,h} sub-rectangle of the cropped frame (crop-uv) to render (default full)
     opt.fullCrop: ignore crop (crop editing mode; straighten / rotate / flip still applied)
     opt.split: 0..1 before/after split position (-1 off); opt.before: render the unedited image
     opt.extraSharpen: added sharpening (export for screen)
     opt.target: 'screen' (blit to Engine.canvas) or 'fbo' (default) */
  /* ---------- brush rasters (mask strokes) → RG8 textures ---------- */
  const brushTex = new Map();   // raster entry → {tex, ver}
  let zeroTex = null;
  function getZero() {
    if (zeroTex) return zeroTex;
    gl.activeTexture(gl.TEXTURE15); zeroTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, zeroTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return zeroTex;
  }
  function brushTexture(ent) {
    let t = brushTex.get(ent);
    gl.activeTexture(gl.TEXTURE15); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!t) {
      // free textures of evicted rasters first
      brushTex.forEach((v, k) => { if (k.dead) { gl.deleteTexture(v.tex); brushTex.delete(k); } });
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ent.w, ent.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ent.w, ent.h, gl.RG, gl.UNSIGNED_BYTE, ent.data);
      t = { tex, ver: ent.ver }; brushTex.set(ent, t); ent.dirty = null;
    } else if (t.ver !== ent.ver) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      const d = ent.dirty || { y0: 0, y1: ent.h };
      const y0 = Math.max(0, d.y0), y1 = Math.min(ent.h, d.y1);
      if (y1 > y0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, ent.w, y1 - y0, gl.RG, gl.UNSIGNED_BYTE, ent.data.subarray(y0 * ent.w * 2, y1 * ent.w * 2));
      t.ver = ent.ver; ent.dirty = null;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return t.tex;
  }
  function mrt(name, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let f = fbos[name]; if (f && f.w === w && f.h === h) return f;
    if (f) { f.texs.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(f.fb); }
    gl.activeTexture(gl.TEXTURE15);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const texs = [0, 1, 2].map(i => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); return t;
    });
    return (fbos[name] = { fb, w, h, texs, mrt: true, tex: texs[0] });
  }
  // stroke-spot points → RGBA32F data texture (1024 texels per row)
  let ptsTex = null, ptsKey = '';
  function ptsTexture(arr) {
    if (!ptsTex) { gl.activeTexture(gl.TEXTURE15); ptsTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ptsTex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); ptsKey = null; }
    const key = arr.join(',');
    if (key !== ptsKey) {
      ptsKey = key; const n = Math.max(1, arr.length / 4), W = Math.min(1024, n), H = Math.ceil(n / 1024), d = new Float32Array(W * H * 4); d.set(arr);
      gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, ptsTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, d);
    }
    return ptsTex;
  }
  const maskHasAdj = m => Model.LOCAL.some(([k]) => m.adj[k]);
  function setGeoUniforms(P, gu) {
    gl.uniform3fv(P.u('uA1x'), gu.A1x); gl.uniform3fv(P.u('uA1y'), gu.A1y); gl.uniform3fv(P.u('uA2x'), gu.A2x); gl.uniform3fv(P.u('uA2y'), gu.A2y);
    gl.uniformMatrix3fv(P.u('uHinv'), false, gu.Hinv); gl.uniform2fv(P.u('uOsz'), gu.osz); gl.uniform2fv(P.u('uSq'), gu.sq); gl.uniform1f(P.u('uK'), gu.K);
  }
  function maskUniforms(P, g, m) {
    const sq = g.sq, adj = m.adj, f = v => v / 100;
    gl.uniform1i(P.u('uType'), m.type === 'linear' ? 0 : m.type === 'radial' ? 1 : 2);
    gl.uniform1f(P.u('uInvert'), m.invert ? 1 : 0); gl.uniform1f(P.u('uAmt'), m.amount / 100);
    if (m.type === 'linear') { const l = m.lin; gl.uniform4f(P.u('uP0'), l.x0 * sq[0], l.y0 * sq[1], l.x1 * sq[0], l.y1 * sq[1]); gl.uniform4f(P.u('uP1'), 1, 0, 0, 0); }
    else { const r = m.rad, a = r.angle * Math.PI / 180; gl.uniform4f(P.u('uP0'), r.cx * sq[0], r.cy * sq[1], r.rx, r.ry); gl.uniform4f(P.u('uP1'), Math.cos(a), Math.sin(a), r.feather / 100, 0); }
    const rg = m.range;
    gl.uniform4f(P.u('uRange'), rg.mode === 'lum' ? 1 : rg.mode === 'color' ? 2 : 0, rg.lo / 100, rg.hi / 100, rg.smooth / 100 * .5);
    gl.uniform4f(P.u('uRangeC'), rg.L, rg.a, rg.b, rg.tol / 100);
    gl.uniform4f(P.u('uA0'), adj.exposure, f(adj.contrast), f(adj.highlights), f(adj.shadows));
    gl.uniform4f(P.u('uA1'), f(adj.temp), f(adj.tint), f(adj.saturation), f(adj.clarity));
    gl.uniform4f(P.u('uA2'), f(adj.dehaze), f(adj.sharpness), f(adj.noise), 0);
  }
  function bindBrush(P, ref, m, g) {
    let tex = null;
    if (m.strokes.length && typeof Masks !== 'undefined') { const ent = Masks.raster(ref, m, g.w, g.h); if (ent) tex = brushTexture(ent); }
    gl.uniform1f(P.u('uHasBrush'), tex ? 1 : 0); bindTex(1, tex || getZero());
  }

  /* render(key, settings, opt)
     opt.outW/outH: pixel size of the output
     opt.view: {x,y,w,h} sub-rectangle of the cropped frame (crop-uv) to render (default full)
     opt.fullCrop: ignore crop (crop editing mode; straighten / rotate / flip still applied)
     opt.split: 0..1 before/after split position (-1 off); opt.before: render the unedited image
     opt.extraSharpen: added sharpening (export for screen)
     opt.overlay: id of a mask whose weight is tinted red; opt.visSpots: edge visualisation (spot removal)
     opt.noLocal: skip spots and masks
     opt.target: 'screen' (blit to Engine.canvas) or 'fbo' (default) */
  function render(key, st, opt) {
    const src = sources.get(key); if (!src) return null; src.used = performance.now();
    const ref = key.split(':')[1] || key;    // file id: brush rasters are cached per original
    const full = !!opt.fullCrop, view = opt.view || { x: 0, y: 0, w: 1, h: 1 };
    const outW = Math.max(1, Math.round(opt.outW)), outH = Math.max(1, Math.round(opt.outH));
    // full crop size in output px
    const fullW = outW / view.w, fullH = outH / view.h, fullLong = Math.max(fullW, fullH);
    gl.disable(gl.BLEND); gl.bindVertexArray(vao);

    // 1. geometry (crop / straighten / rotate / flip, upright, lens corrections, spot removal)
    const g = Geo.build(src.w, src.h, st, full, view), gu = Geo.uniforms(g);
    const slot = opt.slot || 'v';
    const G = fbo(slot + 'G', outW, outH, 'f');
    let P = progs.geom; gl.useProgram(P);
    setGeoUniforms(P, gu);
    const scale = Math.max(outW / src.w, outH / src.h) * g.scale;
    gl.uniform1f(P.u('uBias'), scale < .5 ? -.35 : 0);
    const spots = opt.noLocal ? [] : (st.spots || []).slice(0, 64), sd = new Float32Array(192 * 4), pts = [];
    spots.forEach((p, i) => {
      let st0 = 0, n = 0;
      if (p.pts && p.pts.length > 1) {
        const q = p.pts.map(([u, v]) => [u * g.sq[0], v * g.sq[1]]), xs = q.map(t => t[0]), ys = q.map(t => t[1]);
        st0 = pts.length / 4; n = q.length;
        pts.push(Math.min(...xs) - p.r, Math.min(...ys) - p.r, Math.max(...xs) + p.r, Math.max(...ys) + p.r); q.forEach(t => pts.push(t[0], t[1], 0, 0));
      }
      sd.set([p.x * g.sq[0], p.y * g.sq[1], p.sx * g.sq[0], p.sy * g.sq[1], p.r, Math.max(.02, p.feather / 100), p.opacity / 100, p.mode === 'heal' ? 1 : 0, st0, n, 0, 0], i * 12);
    });
    gl.uniform4fv(P.u('uSpot[0]'), sd); gl.uniform1i(P.u('uNSpots'), spots.length);
    gl.uniform1i(P.u('uPts'), 2); bindTex(2, ptsTexture(pts));
    const ln = st.lens || {};
    gl.uniform3f(P.u('uVigC'), (ln.vig || 0) / 100 * 1.4, .6 + (ln.vigMid ?? 50) / 100 * 2.4, ln.vig ? 1 : 0);
    gl.uniform2f(P.u('uCA'), (ln.caR || 0) * 4e-5, (ln.caB || 0) * 4e-5);
    gl.uniform1f(P.u('uSplit'), opt.split == null ? -1 : opt.split); gl.uniform1f(P.u('uBefore'), opt.before ? 1 : 0);
    gl.uniform1i(P.u('uS'), 0); bindTex(0, src.tex);
    drawTo(G, outW, outH);
    bindTex(0, G.tex); gl.generateMipmap(gl.TEXTURE_2D);
    if (slot === 'v') lastGeom = { outW, outH };

    // 2./3. blurs
    const blur = (name, sigmaPx) => {
      const s = Math.min(1, 2.6 / Math.max(sigmaPx, .01));
      const bw = Math.max(4, Math.round(outW * s)), bh = Math.max(4, Math.round(outH * s)), sig = Math.max(.35, Math.min(4, sigmaPx * s));
      const D = fbo(slot + name, bw, bh, 'f'), T = fbo(slot + name + 't', bw, bh, 'f');
      P = progs.down; gl.useProgram(P); gl.uniform1i(P.u('uT'), 0); bindTex(0, G.tex); drawTo(D, bw, bh);
      P = progs.blur; gl.useProgram(P); gl.uniform1i(P.u('uT'), 0); gl.uniform1f(P.u('uSig'), sig);
      gl.uniform2f(P.u('uD'), 1 / bw, 0); bindTex(0, D.tex); drawTo(T, bw, bh);
      gl.uniform2f(P.u('uD'), 0, 1 / bh); bindTex(0, T.tex); drawTo(D, bw, bh);
      return D;
    };
    const A = blur('A', Math.max(.6, .0022 * fullLong)), B = blur('B', .016 * fullLong);

    // 3b. masks → summed local adjustments (3 × RGBA16F), optional overlay weight of one mask
    const masks = opt.noLocal || opt.before || !hasFloat ? [] : (st.masks || []).filter(m => m.on && maskHasAdj(m));
    let Lf = null, LM = null;
    const maskPass = () => { P = progs.mask; gl.useProgram(P); setGeoUniforms(P, gu); gl.uniform1i(P.u('uG'), 0); gl.uniform1i(P.u('uBrush'), 1); bindTex(0, G.tex); };
    if (masks.length) {
      Lf = mrt(slot + 'L', outW, outH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, Lf.fb); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.viewport(0, 0, Lf.w, Lf.h); [0, 1, 2].forEach(i => gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0]));
      maskPass(); gl.uniform1i(P.u('uMode'), 0);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      masks.forEach(m => { maskUniforms(P, g, m); bindBrush(P, ref, m, g); gl.bindFramebuffer(gl.FRAMEBUFFER, Lf.fb); gl.viewport(0, 0, Lf.w, Lf.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); });
      gl.disable(gl.BLEND);
    }
    const ovm = opt.overlay && !opt.before ? (st.masks || []).find(m => m.id === opt.overlay) : null;
    if (ovm) {
      LM = fbo(slot + 'LM', outW, outH, 'b');
      maskPass(); gl.uniform1i(P.u('uMode'), 1); maskUniforms(P, g, ovm); bindBrush(P, ref, ovm, g);
      drawTo(LM, outW, outH);
    }

    // 4. develop
    updateCurve(st.curve, st.pcurve);
    const OUT = fbo(slot + 'OUT', outW, outH, 'b');
    P = progs.dev; gl.useProgram(P);
    ['uG', 'uA', 'uB', 'uCurve', 'uL0', 'uL1', 'uL2', 'uLM'].forEach((n, i) => gl.uniform1i(P.u(n), i));
    bindTex(0, G.tex); bindTex(1, A.tex); bindTex(2, B.tex); bindTex(3, curveTex);
    const z = getZero();
    bindTex(4, Lf ? Lf.texs[0] : z); bindTex(5, Lf ? Lf.texs[1] : z); bindTex(6, Lf ? Lf.texs[2] : z); bindTex(7, LM ? LM.tex : z);
    gl.uniform1f(P.u('uHasL'), Lf ? 1 : 0); gl.uniform1f(P.u('uOverlay'), LM ? 1 : 0); gl.uniform1f(P.u('uVis'), opt.visSpots ? 1 : 0);
    gl.uniform2f(P.u('uFringe'), opt.before ? 0 : (ln.fringeP || 0) / 20, opt.before ? 0 : (ln.fringeG || 0) / 20);
    gl.uniform2f(P.u('uPx'), 1 / outW, 1 / outH);
    gl.uniform4f(P.u('uView'), view.x, view.y, view.w, view.h);
    gl.uniform2f(P.u('uFull'), fullW, fullH);
    gl.uniform2f(P.u('uTT'), st.wb.temp / 100, st.wb.tint / 100); gl.uniform1f(P.u('uExp'), st.exposure);
    const f = v => v / 100;
    gl.uniform1f(P.u('uCon'), f(st.contrast)); gl.uniform1f(P.u('uHi'), f(st.highlights)); gl.uniform1f(P.u('uSh'), f(st.shadows));
    gl.uniform1f(P.u('uWh'), f(st.whites)); gl.uniform1f(P.u('uBl'), f(st.blacks));
    gl.uniform1f(P.u('uTex'), f(st.texture)); gl.uniform1f(P.u('uCla'), f(st.clarity)); gl.uniform1f(P.u('uDehaze'), f(st.dehaze));
    gl.uniform1f(P.u('uVib'), f(st.vibrance)); gl.uniform1f(P.u('uSat'), f(st.saturation)); gl.uniform1f(P.u('uBW'), st.bw ? 1 : 0);
    gl.uniform1fv(P.u('uHue[0]'), st.hsl.hue.map(f)); gl.uniform1fv(P.u('uHSat[0]'), st.hsl.sat.map(f)); gl.uniform1fv(P.u('uLum[0]'), st.hsl.lum.map(f));
    const gr = st.grade;
    gl.uniform3fv(P.u('uGS'), gradeColor(gr.sh.h, gr.sh.s)); gl.uniform3fv(P.u('uGM'), gradeColor(gr.mid.h, gr.mid.s)); gl.uniform3fv(P.u('uGH'), gradeColor(gr.hi.h, gr.hi.s));
    gl.uniform3f(P.u('uGL'), f(gr.sh.l), f(gr.mid.l), f(gr.hi.l)); gl.uniform1f(P.u('uGBal'), f(gr.bal)); gl.uniform1f(P.u('uGBlend'), f(gr.blend));
    const zoom = fullLong / Math.max(cropSize(src.w, src.h, st.crop, full).w, cropSize(src.w, src.h, st.crop, full).h) / g.scale;  // output px per working px
    const sAmt = (st.sharpen.amount + (opt.extraSharpen || 0)) / 100;
    gl.uniform4f(P.u('uSharp'), sAmt, Math.max(.5, st.sharpen.radius * Math.min(1.5, zoom)), st.sharpen.detail / 100, st.sharpen.mask / 100);
    gl.uniform2f(P.u('uNR'), st.nr.lum / 100, st.nr.color / 100);
    const vg = st.vignette;
    gl.uniform4f(P.u('uVig'), f(vg.amount), .25 + vg.mid / 100 * .85, f(vg.round), vg.feather / 100 * .9);
    gl.uniform3f(P.u('uGrain'), st.grain.amount / 100, .5 + st.grain.size / 100 * 2.5, st.grain.rough / 100);
    gl.uniform1f(P.u('uSplit'), opt.split == null ? -1 : opt.split); gl.uniform1f(P.u('uBefore'), opt.before ? 1 : 0);
    const cm = Tonal.calibMatrix(st.calib);   // row-major -> GLSL column-major
    gl.uniformMatrix3fv(P.u('uCal'), false, [cm[0], cm[3], cm[6], cm[1], cm[4], cm[7], cm[2], cm[5], cm[8]]);
    gl.uniform1f(P.u('uShT'), f(st.calib?.shTint || 0)); gl.uniform1f(P.u('uClip'), opt.clip ? 1 : 0);
    drawTo(OUT, outW, outH);

    if (opt.target === 'screen') {
      if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, OUT.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, outW, outH, 0, 0, outW, outH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }
    return { w: outW, h: outH };
  }

  // read OUT as top-down ImageData
  function readOut(slot = 'v') {
    const f = fbos[slot + 'OUT']; if (!f) return null;
    const px = new Uint8Array(f.w * f.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const img = new ImageData(f.w, f.h), row = f.w * 4;
    for (let y = 0; y < f.h; y++) img.data.set(px.subarray((f.h - 1 - y) * row, (f.h - y) * row), y * row);
    return img;
  }
  // subsampled RGB histogram of OUT (256 bins × 3)
  function histogram(slot = 'v', maxSamples = 160000) {
    const f = fbos[slot + 'OUT']; if (!f) return null;
    const px = new Uint8Array(f.w * f.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const n = f.w * f.h, step = Math.max(1, Math.floor(n / maxSamples));
    for (let i = 0; i < n; i += step) {
      const j = i * 4; if (px[j + 3] < 128) continue;
      H[0][px[j]]++; H[1][px[j + 1]]++; H[2][px[j + 2]]++; H[3][Math.round(.2126 * px[j] + .7152 * px[j + 1] + .0722 * px[j + 2])]++;
    }
    return H;
  }
  // average linear (pre-WB) colour of the geometry buffer around output pixel (x,y) (top-down)
  function sampleLinear(x, y, r = 3) {
    const Gf = fbos.vG; if (!Gf || !lastGeom) return null;
    x = Math.round(x); y = Math.round(y);
    const x0 = Math.max(0, x - r), y0 = Math.max(0, Gf.h - 1 - y - r), w = Math.min(Gf.w - x0, r * 2 + 1), h = Math.min(Gf.h - y0, r * 2 + 1);
    if (w <= 0 || h <= 0) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, Gf.fb);
    let out = [0, 0, 0], cnt = 0;
    if (Gf.fmt === 'f') {
      const px = new Float32Array(w * h * 4); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, px);
      for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > .5) { out[0] += px[i * 4]; out[1] += px[i * 4 + 1]; out[2] += px[i * 4 + 2]; cnt++; }
    } else {
      const px = new Uint8Array(w * h * 4); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 128) { out[0] += px[i * 4] / 255; out[1] += px[i * 4 + 1] / 255; out[2] += px[i * 4 + 2] / 255; cnt++; }
    }
    return cnt ? out.map(v => v / cnt) : null;
  }

  return {
    init, setSource, dropSource, hasSource, sourceSize, sourceKeys: () => [...sources.keys()], render, readOut, histogram, sampleLinear, freeBig,
    cropSize, orientedSize, constrainCrop, cropInside, mapper, splineLUT, masterLUT, solveWB, wbMult,
    get canvas() { init(); return canvas; }, get gl() { return gl; }, get maxTex() { init(); return maxTex; }, get hasFloat() { return hasFloat; }
  };
})();
