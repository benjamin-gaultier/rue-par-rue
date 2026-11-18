/**
 * GLSL for the detailed buildings. Facades, roofs, paving and water are
 * drawn procedurally: no textures to download, and detail fades to an
 * average colour with distance so far facades do not shimmer.
 *
 * Shared uniforms: u_year (hides what does not stand that year), u_camera
 * (local metres, for haze and reflections), u_sun (unit vector), u_box
 * (the ground box, where everything fades out at the edge).
 */

import { institutionFacades } from './institutionshaders'
import { bridgeFacades } from './bridgeshaders'
import { landmarkFacades } from './landmarkshaders'
import { roadSurface } from './streetshaders'
import { signGlsl } from './signs'

const common = /* glsl */ `
uniform float u_year;
uniform vec3 u_camera;
uniform vec3 u_sun;
uniform vec4 u_box;
uniform vec3 u_fog;
// The cathedral's west front: centre (xy) and axis toward the east (zw); half its width.
uniform vec4 u_front;
uniform float u_frontHalf;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// 1 inside the rectangle lo..hi, antialiased by aa (pixel footprint).
float rect(vec2 p, vec2 lo, vec2 hi, vec2 aa) {
  vec2 s = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
  return s.x * s.y;
}
float edgeFade(vec2 xy) {
  float d = min(min(xy.x - u_box.x, u_box.z - xy.x), min(xy.y - u_box.y, u_box.w - xy.y));
  return smoothstep(0.0, 70.0, d);
}
vec3 haze(vec3 col, vec3 world) {
  float d = length(world - u_camera);
  return mix(col, u_fog, smoothstep(350.0, 1800.0, d) * 0.85);
}
float bayWidth(float st, float seed) {
  if (st < 0.5) return 2.2 + seed * 0.7;
  if (st < 1.5) return 3.1;
  if (st < 2.5) return 2.9;
  if (st > 5.5) return 6.3;
  return 4.8;
}
`

const lifeVertex = /* glsl */ `
attribute vec4 a_life;
bool alive() {
  return u_year >= a_life.x && u_year < a_life.y && !(u_year >= a_life.z && u_year < a_life.w);
}
`

/**
 * Shared by the wall and roof fragments: the integer hash of facades.ts, floor
 * layout, lettering from the sign atlas (u_signs) and recessed openings.
 */
const facadeLib = /* glsl */ `
uniform sampler2D u_signs;
${signGlsl()}
/* ---------- facade library: hashes shared with facades.ts, lettering, recessed openings */

uint ihashu(int a, int b, int c) {
  uint h = (uint(a) * 0x27d4eb2du) ^ (uint(b) * 0x165667b1u) ^ (uint(c) * 0x9e3779b1u);
  h ^= h >> 15u;
  h *= 0x2c1b3c6du;
  h ^= h >> 12u;
  h *= 0x297a2d39u;
  h ^= h >> 15u;
  return h;
}
float ihash(int a, int b, int c) { return float(ihashu(a, b, c) >> 8u) / 16777216.0; }
// Sixteen-step (nibble k) and 256-step (byte k) values from one hash: several choices for the price of one.
float nib(uint h, int k) { return float((h >> uint(4 * k)) & 15u) / 15.0; }
float byteOf(uint h, int k) { return float((h >> uint(8 * k)) & 255u) / 255.0; }

// Ground floor height, number of upper floors and their height (facades.ts floorLayout).
vec3 floorLayout(float st, float eave, float fh) {
  float g = st < 0.5 ? 3.3 : st < 1.5 ? 4.3 : 3.6;
  float n = max(0.0, floor((eave - g - 0.4) / fh + 0.3));
  return vec3(g, n, n > 0.0 ? (eave - g - 0.4) / n : 1.0);
}

// Ground floor bay codes, two bits per bay (facades.ts BAY): 0 plain, 1 shop, 2 shop continued, 3 door.
int bayCode(int codes, int bay) { return (codes >> (2 * (bay % 12))) & 3; }

// Coverage of the word in the given atlas cell, centred on p (metres), in a cell h high and at most maxW wide.
// dp holds the screen derivatives of p, for filtering.
float word(int cell, vec2 p, float h, float maxW, vec4 dp) {
  float ink = texelFetch(u_signs, ivec2(cell, 0), 0).r * 8.0;
  h = min(h, maxW / max(ink, 0.05));
  vec2 c = p / h;
  if (abs(c.x) > ink * 0.5 + 0.1 || abs(c.y) > 0.5) return 0.0;
  vec2 uv = vec2(float(cell % 4) * 8.0 + 4.0 + c.x, 31.5 - float(cell / 4) + c.y) / 32.0;
  return textureGrad(u_signs, uv, dp.xy / (h * 32.0), dp.zw / (h * 32.0)).r;
}

// One digit, h high, centred on p.
float digitGlyph(int d, vec2 p, float h, vec4 dp) {
  vec2 c = p / h;
  if (abs(c.x) > 0.4 || abs(c.y) > 0.5) return 0.0;
  vec2 uv = vec2(float(SIGN_DIGITS % 4) * 8.0 + (float(d) + 0.5) * 0.8 + c.x, 31.5 - float(SIGN_DIGITS / 4) + c.y) / 32.0;
  return textureGrad(u_signs, uv, dp.xy / (h * 32.0), dp.zw / (h * 32.0)).r;
}

// A house number of one or two digits centred on p.
float houseNumber(int n, vec2 p, float h, vec4 dp) {
  if (n < 10) return digitGlyph(n, p, h, dp);
  float s = 0.3 * h;
  return max(digitGlyph(n / 10, p + vec2(s, 0.0), h, dp), digitGlyph(n - (n / 10) * 10, p - vec2(s, 0.0), h, dp));
}

// Looking into an opening lo..hi of a wall, recessed by d, from the wall-space view vector vw
// (x along the wall, y up, z out toward the eye): where the eye ray lands (xy), on what (z: 1 the
// back, 2 the left reveal, 3 the right reveal, 4 the head, 5 the sill) and how deep (w, 0..1).
vec4 recess(vec2 p, vec2 lo, vec2 hi, float d, vec3 vw) {
  vec2 q = p - vw.xy * (d / max(vw.z, 0.05));
  if (q.x >= lo.x && q.x <= hi.x && q.y >= lo.y && q.y <= hi.y) return vec4(q, 1.0, 1.0);
  float tx = q.x < lo.x ? (p.x - lo.x) / max(p.x - q.x, 1e-5) : q.x > hi.x ? (hi.x - p.x) / max(q.x - p.x, 1e-5) : 2.0;
  float ty = q.y < lo.y ? (p.y - lo.y) / max(p.y - q.y, 1e-5) : q.y > hi.y ? (hi.y - p.y) / max(q.y - p.y, 1e-5) : 2.0;
  if (tx < ty) return vec4(mix(p, q, tx), q.x < lo.x ? 2.0 : 3.0, tx);
  return vec4(mix(p, q, ty), q.y < lo.y ? 5.0 : 4.0, ty);
}

// World normal of what recess() landed on.
vec3 recessNormal(float code, vec3 N, vec3 T) {
  return code < 1.5 ? N : code < 2.5 ? T : code < 3.5 ? -T : code < 4.5 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 0.0, 1.0);
}

// Coverage of a line of half-width w at distance d, for a pixel footprint aa: thinner than a pixel, it fades
// in proportion instead of spreading over the pixel (which made far window frames read as white boxes).
float lineAA(float d, float w, float aa) { return (1.0 - smoothstep(w - aa, w + aa, d)) * min(1.0, w / aa); }

// Glazing of a casement window lo..hi at q: 1 where glass, 0 on the frame, the meeting stiles and the bars.
float casement(vec2 q, vec2 lo, vec2 hi, float rows, bool stiles, vec2 aa) {
  float f = 0.055;
  vec2 i0 = lo + f;
  vec2 i1 = hi - f;
  float open = mix(1.0, rect(q, i0, i1, aa), min(1.0, f / max(aa.x, aa.y)));
  float stile = stiles ? lineAA(abs(q.x - 0.5 * (lo.x + hi.x)), 0.024, aa.x) : 0.0;
  float bars = 0.0;
  if (rows > 1.5) {
    float ph = (i1.y - i0.y) / rows;
    float t = abs(fract((q.y - i0.y) / ph + 0.5) - 0.5) * ph;
    bars = lineAA(t, 0.013, aa.y) * step(i0.y + 0.05, q.y) * step(q.y, i1.y - 0.05);
  }
  return open * (1.0 - max(stile, bars));
}

// Louvres of a shutter (persienne) at y: a darker line under each slat.
float louvres(float y, vec2 aa) {
  return 1.0 - 0.35 * smoothstep(0.5, 0.8, fract(y / 0.075)) * (1.0 - smoothstep(0.02, 0.05, aa.y));
}

vec3 frameColour(float h) {
  return h < 0.55 ? vec3(0.90, 0.88, 0.82) : h < 0.75 ? vec3(0.62, 0.66, 0.60) : h < 0.9 ? vec3(0.45, 0.30, 0.22) : vec3(0.55, 0.58, 0.62);
}

vec3 shutterColour(float h) {
  return h < 0.25 ? vec3(0.30, 0.38, 0.30) : h < 0.45 ? vec3(0.52, 0.47, 0.40) : h < 0.6 ? vec3(0.44, 0.50, 0.55) : h < 0.75 ? vec3(0.42, 0.20, 0.16) : h < 0.9 ? vec3(0.66, 0.64, 0.58) : vec3(0.25, 0.30, 0.36);
}
`

/* ------------------------------------------------------------- walls */

export const wallVertex = /* glsl */ `
${common}
${lifeVertex}
attribute vec4 a_a;
attribute vec4 a_b;
attribute vec4 a_c;
varying vec4 v_a;
varying vec4 v_b;
// Integers packed in floats (bay codes, ids): flat, so interpolation cannot round them.
flat varying vec4 v_c;
varying vec3 v_normal;
varying vec3 v_world;
void main() {
  v_a = a_a;
  v_b = a_b;
  v_c = a_c;
  v_normal = normal;
  v_world = position;
  gl_Position = alive() ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

export const wallFragment = /* glsl */ `
${common}
${facadeLib}
varying vec4 v_a;
varying vec4 v_b;
flat varying vec4 v_c;
varying vec3 v_normal;
varying vec3 v_world;

vec3 shopColour(float h) {
  if (h < 0.2) return vec3(0.16, 0.30, 0.22);
  if (h < 0.4) return vec3(0.45, 0.13, 0.10);
  if (h < 0.55) return vec3(0.14, 0.19, 0.32);
  if (h < 0.7) return vec3(0.11, 0.11, 0.11);
  if (h < 0.85) return vec3(0.58, 0.44, 0.20);
  return vec3(0.33, 0.22, 0.14);
}

// Inside a pointed (gothic) arch window of width w, straight sides up to hs.
float lancet(vec2 p, float w, float hs, float h, vec2 aa) {
  float sides = rect(p, vec2(-w * 0.5, 0.0), vec2(w * 0.5, hs), aa);
  float r = w;
  float a1 = 1.0 - smoothstep(r - aa.x, r + aa.x, length(p - vec2(w * 0.5, hs)));
  float a2 = 1.0 - smoothstep(r - aa.x, r + aa.x, length(p - vec2(-w * 0.5, hs)));
  float top = a1 * a2 * step(hs, p.y) * step(p.y, h);
  return max(sides, top);
}

// Inside a pointed arch of half-width hw, sides from z0 up to the springing zs, arcs of radius r.
float pointed(vec2 p, float hw, float z0, float zs, float r, vec2 aa) {
  float sides = rect(p, vec2(-hw, z0), vec2(hw, zs), aa);
  float c = r - hw;
  float d1 = length(p - vec2(-c, zs));
  float d2 = length(p - vec2(c, zs));
  float arch = (1.0 - smoothstep(r - aa.x, r + aa.x, d1)) * (1.0 - smoothstep(r - aa.x, r + aa.x, d2)) * step(zs, p.y);
  return max(sides, arch);
}

// Notre-Dame's west front, at position s along the facade (0 = middle) and height z.
// Returns the colour and how much of it is glass.
vec4 westFront(float s, float z, float eave, vec3 stone, vec2 aa) {
  float hw = u_frontHalf;
  float tw = hw * 0.66;
  bool centre = abs(s) < hw - tw;
  float sc = centre ? 0.0 : sign(s) * (hw - tw * 0.5);
  float W = centre ? 2.0 * (hw - tw) : tw;
  float x = s - sc;
  vec2 p = vec2(x, z);
  vec3 col = stone;
  float glass = 0.0;
  vec3 recess = stone * 0.55;
  vec3 dark = vec3(0.16, 0.14, 0.13);
  float course = smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / 0.5) - 0.5) - 0.47);
  col *= 1.0 - 0.1 * course;
  // Corner buttresses of each section.
  if (abs(x) > W * 0.5 - 1.1) col *= 1.06;
  if (abs(abs(x) - (W * 0.5 - 1.1)) < 0.12) col *= 0.8;

  if (z < 14.6) {
    // Portal: archivolts around a carved tympanum, doors with a central pillar.
    float pw = min(W * 0.31, 4.4);
    float outer = pointed(p, pw, 0.0, 6.6, pw * 1.7, aa);
    float r1 = pointed(p, pw - 0.6, 0.0, 6.6, (pw - 0.6) * 1.7, aa);
    float r2 = pointed(p, pw - 1.2, 0.0, 6.6, (pw - 1.2) * 1.7, aa);
    float tym = pointed(p, pw - 1.8, 0.0, 6.6, (pw - 1.8) * 1.7, aa);
    col = mix(col, stone * 0.82, outer);
    col = mix(col, stone * 0.62, r1);
    col = mix(col, stone * 0.74, r2);
    col = mix(col, stone * (0.8 + 0.15 * noise(p * 3.0)), tym);
    float doors = rect(p, vec2(-(pw - 1.8), 0.0), vec2(pw - 1.8, 5.0), aa) * (1.0 - rect(p, vec2(-0.3, 0.0), vec2(0.3, 5.0), aa));
    col = mix(col, vec3(0.30, 0.20, 0.14), doors);
    col = mix(col, stone * 0.9, rect(p, vec2(-(pw - 1.8), 5.0), vec2(pw - 1.8, 5.6), aa));
    // Statues in the jambs.
    float jamb = rect(vec2(abs(x), z), vec2(pw - 0.05, 1.6), vec2(pw + 1.4, 5.0), aa);
    col = mix(col, stone * (0.72 + 0.2 * step(0.5, fract(abs(x) / 0.7))), jamb);
  } else if (z < 15.9) {
    col *= z < 15.2 ? 0.7 : 1.12;
  } else if (z < 21.0) {
    // Gallery of kings: statues in niches across the whole front.
    float nx = mod(s, 1.7) - 0.85;
    float niche = pointed(vec2(nx, z), 0.6, 16.2, 19.9, 1.2, aa);
    col = mix(col, recess, niche);
    float statue = rect(vec2(nx, z), vec2(-0.27, 16.4), vec2(0.27, 19.6), aa) + (1.0 - smoothstep(0.2, 0.22 + aa.x, length(vec2(nx, z - 19.85))));
    col = mix(col, stone * 0.92, clamp(statue, 0.0, 1.0) * niche);
  } else if (z < 22.2) {
    col *= z < 21.5 ? 0.7 : 1.12;
  } else if (z < 37.5) {
    if (centre) {
      // The rose window, in a square frame.
      vec2 q = vec2(x, z - 30.0);
      float R = min(4.8, W * 0.36);
      float r = length(q);
      col = mix(col, stone * 0.85, rect(q, vec2(-R - 0.8), vec2(R + 0.8), aa));
      float inside = 1.0 - smoothstep(R - aa.x, R + aa.x, r);
      float ang = atan(q.y, q.x);
      float spokes = r * abs(sin(fract(ang / 6.2831853 * 12.0) * 3.14159265));
      float tracery = max(1.0 - smoothstep(0.07, 0.1 + aa.x, spokes) * step(R * 0.33, r), 0.0);
      tracery = max(tracery, 1.0 - smoothstep(0.06, 0.09 + aa.x, abs(r - R * 0.33)));
      tracery = max(tracery, 1.0 - smoothstep(0.06, 0.09 + aa.x, abs(r - R * 0.68)));
      col = mix(col, stone * 0.75, (1.0 - smoothstep(R + 0.3, R + 0.4, r)) * (1.0 - inside));
      glass = inside * (1.0 - tracery);
      col = mix(col, stone * 0.8, inside * tracery);
    } else {
      // Twin lancets under a pointed arch, an oculus above.
      float arch = pointed(p, 2.9, 23.5, 31.5, 5.0, aa);
      col = mix(col, stone * 0.72, arch);
      float l = pointed(vec2(abs(x) - 1.35, z), 1.0, 24.0, 31.0, 2.0, aa);
      float oc = 1.0 - smoothstep(0.85, 0.88 + aa.x, length(vec2(x, z - 33.6)));
      glass = max(l, oc) * arch;
    }
  } else if (z < 38.6) {
    col *= z < 38.0 ? 0.7 : 1.12;
  } else if (z < 45.0) {
    // The great gallery: an open arcade of slender columns.
    float gx = mod(s, 1.25) - 0.625;
    float open = pointed(vec2(gx, z), 0.42, 39.4, 43.4, 0.84, aa);
    col = mix(col, vec3(0.34, 0.37, 0.42), open);
    col *= z < 39.4 ? 0.92 : 1.0;
  } else if (z < 46.3) {
    col *= 1.1 - 0.25 * step(0.5, fract(s / 0.45)) * step(45.4, z);
  } else {
    // Belfries: two tall openings with louvres on each face of a tower.
    float off = W * 0.23;
    float bel = pointed(vec2(abs(x) - off, z), 1.3, 48.5, 59.5, 2.6, aa);
    col = mix(col, stone * 0.6, pointed(vec2(abs(x) - off, z), 1.75, 48.0, 59.5, 3.5, aa));
    vec3 louvre = mix(dark, vec3(0.35, 0.33, 0.30), step(0.5, fract(z / 0.42)));
    col = mix(col, louvre, bel);
    // The balustrade around the top of the tower.
    if (z > eave - 1.5) col = mix(col * 1.08, dark, step(0.6, fract(s / 0.5)) * step(z, eave - 0.3));
  }
  col *= z < 0.6 ? 0.85 : 1.0;
  return vec4(col, glass);
}

// Each family of walls compiles only the code it needs (city3d.ts splits the
// walls by style and sets these): one shader with every facade is too big for
// some graphics drivers, which then draw nothing.
#ifdef WALL_LANDMARKS
${landmarkFacades}
#endif
#ifdef WALL_INSTITUTIONS
${institutionFacades}
#endif
#ifdef WALL_BRIDGES
${bridgeFacades}
#endif

void main() {
  float u = v_a.x, z = v_a.y, L = v_a.z, flags = v_a.w;
  float st = v_b.x, seed = v_b.y, eave = v_b.z, fh = v_b.w;
  // Hash an integer id, not the interpolated seed: tiny float differences flip hashes pixel by pixel.
  float sid = floor(seed * 997.0 + 0.5);
  vec2 dx = dFdx(vec2(u, z));
  vec2 dy = dFdy(vec2(u, z));
  vec4 dp = vec4(dx, dy);
  vec2 aa = (abs(dx) + abs(dy)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.06, 0.3, max(aa.x, aa.y));
  int part = int(v_c.x + 0.5);
  int pid = int(v_c.y + 0.5);
  int bid = pid / 64;
  int wid = pid - bid * 64;
  vec3 N = normalize(v_normal);
  vec3 T = vec3(-N.y, N.x, 0.0);
  vec3 V = u_camera - v_world;
  vec3 vw = vec3(dot(V, T), V.z, dot(V, N));
  // Lighting inputs that details may change: the normal (reveals, soffits), ambient occlusion, self-lit signs.
  vec3 nrm = N;
  float ao = 1.0;
  float emissive = 0.0;
  bool ordinary = st < 2.5;

  vec3 wall;
  if (st < 0.5) {
    float hc = ihash(bid, 0, 1);
    wall = hc < 0.16 ? vec3(0.86, 0.80, 0.68) : hc < 0.3 ? vec3(0.78, 0.70, 0.57) : hc < 0.44 ? vec3(0.79, 0.78, 0.74) : hc < 0.56 ? vec3(0.84, 0.73, 0.62)
         : hc < 0.68 ? vec3(0.88, 0.83, 0.70) : hc < 0.78 ? vec3(0.74, 0.66, 0.55) : hc < 0.9 ? vec3(0.82, 0.76, 0.70) : vec3(0.80, 0.70, 0.52);
  } else if (st < 1.5) {
    wall = vec3(0.87, 0.82, 0.72);
  } else if (st < 2.5) {
    wall = seed < 0.5 ? vec3(0.70, 0.56, 0.46) : vec3(0.80, 0.78, 0.74);
  } else if (st < 3.5) {
    wall = vec3(0.79, 0.75, 0.66);
  } else {
    wall = vec3(0.74, 0.70, 0.62);
  }
  wall *= 0.93 + 0.14 * hash(vec2(sid, 3.0));
  // Weathering: soft vertical streaks, and darker plinths.
  wall *= 1.0 - 0.07 * noise(vec2(u * 0.6, z * 0.12) + seed * 17.0);
  // Coal soot darkened Paris from the mid-19th century until the cleaning campaigns of the 1960s.
  float soot = ordinary ? smoothstep(1830.0, 1890.0, u_year) * (1.0 - smoothstep(1960.0, 1980.0, u_year)) : 0.0;
  wall = mix(wall, vec3(dot(wall, vec3(0.3, 0.4, 0.3))) * 0.84, 0.35 * soot);
  vec3 col = wall;
  float glass = 0.0;
  bool cathedral = st > 5.5 && st < 6.5; // only the cathedral style: landmark styles (20+) west of Notre-Dame are not its front
  vec2 rel = v_world.xy - u_front.xy;
  bool front = cathedral && u_frontHalf > 0.0 && dot(normalize(v_normal.xy), -u_front.zw) > 0.9 && dot(rel, u_front.zw) < 4.0;

  if (front) {
    vec2 t = vec2(-u_front.w, u_front.z);
    vec4 f = westFront(dot(rel, t), z, eave, vec3(0.83, 0.79, 0.70) * (0.95 + 0.06 * noise(v_world.xy * 0.4)), aa);
    col = f.rgb;
    glass = f.a;
  }
#ifdef WALL_LANDMARKS
  else if (st > 19.5) {
    vec4 f = landmarkFacade(st, u, z, L, eave, seed, v_world, v_normal, aa);
    col = f.rgb;
    glass = f.a;
  }
#endif
#ifdef WALL_INSTITUTIONS
  else if (st > 9.5) {
    vec4 f = institutionFacade(st, u, z, L, eave, seed, v_world, v_normal, aa);
    col = f.rgb;
    glass = f.a;
  }
#endif
  else if (st > 6.5 && st < 7.5) {
    // Cast-iron garden railing: bars every 14 cm between a bottom and a top rail.
    float d = (0.5 - abs(fract(u / 0.14) - 0.5)) * 0.14;
    bool rail = z < 0.1 || (z > 0.86 && z < 0.93);
    bool bar = z < 1.02 && d < 0.011 + aa.x * 0.5;
    // Far away the bars thin out to a stipple instead of shimmering.
    if (aa.x > 0.02) bar = z < 1.0 && mod(floor(gl_FragCoord.x), 4.0) < 1.0;
    if (!rail && !bar) discard;
    col = vec3(0.09, 0.13, 0.10);
  } else if (st > 4.5 && st < 5.5) {
    // Quay walls: ashlar, a damp band at the waterline, a coping on the parapet.
    float course = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.5) - 0.5) - 0.46);
    col *= 1.0 - 0.18 * course * detail;
    col *= mix(0.62, 1.0, smoothstep(-6.4, -5.2, z));
    if (z > 0.75) col *= 1.12;
  }
#ifdef WALL_BRIDGES
  else if (st > 3.5 && st < 4.5) {
    // Bridges, by kind and period: see bridgeshaders.ts.
    col = bridgeSurface(u, z, L, flags, seed, eave, fh, v_world, v_normal, aa, detail);
  }
#endif
  else if (part > 0) {
    // Relief parts are drawn by detailFragment (their own mesh).
    col = wall;
  } else if (flags > 0.5) {
    // Party wall: blind, a little darker.
    col *= 0.9;
  } else if (st > 2.5) {
    // Monument: ashlar courses and tall pointed windows in tiers.
    float course = smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / 0.55) - 0.5) - 0.47);
    col *= 1.0 - 0.12 * course * detail;
    if (L > 3.0) {
      float bw = L / max(1.0, floor(L / bayWidth(st, seed)));
      float bu = mod(u, bw) - bw * 0.5;
      // Cathedral walls: a buttress between each bay.
      if (cathedral) col *= abs(bu) > bw * 0.5 - 0.7 ? 1.07 : abs(bu) > bw * 0.5 - 0.85 ? 0.8 : 1.0;
      float tier = 10.0;
      float k = floor((z - 3.0) / tier);
      float tz = z - 3.0 - k * tier;
      float top = eave - 2.0;
      if (z > 3.0 && z < top && k >= 0.0) {
        float hgt = min(7.0, top - 3.0 - k * tier - 0.5);
        if (hgt > 2.5) {
          glass = lancet(vec2(bu, tz), 1.5, hgt - 1.5, hgt, aa);
        }
      }
    }
  } else if (L > 1.6 && st < 2.5) {
    // Ordinary buildings are drawn by facadeFragment; this is a plain fallback.
    float bw = L / max(1.0, floor(L / bayWidth(st, seed)));
    vec3 fl = floorLayout(st, eave, fh);
    float fz = mod(z - fl.x, fl.z);
    if (z > fl.x && z < eave - 0.4) glass = rect(vec2(mod(u, bw) - bw * 0.5, fz), vec2(-0.5, fl.z * 0.24), vec2(0.5, fl.z * 0.82), aa);
  }

  // Glass: dark, with the sky reflected toward the top of each pane.
  vec3 view = normalize(V);
  float fres = pow(1.0 - max(dot(N, view), 0.0), 2.0);
  vec3 pane = mix(vec3(0.10, 0.12, 0.14), vec3(0.50, 0.58, 0.66), 0.25 + 0.5 * fres);
  col = mix(col, pane, glass * detail);
  // Far away, windows blend into a darker average.
  col = mix(col, col * 0.86, (1.0 - detail) * step(flags, 0.5) * step(st, 2.5) * step(1.6, L) * step(3.0, z) * float(part == 0));

  float light = 0.62 + 0.48 * max(dot(nrm, u_sun), 0.0);
  light *= mix(0.74, 1.0, smoothstep(0.0, 3.0, st > 3.5 ? v_world.z + 6.5 : v_world.z));
  col *= mix(light * ao, 1.0, emissive);
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- roofs */

export const roofVertex = wallVertex

export const roofFragment = /* glsl */ `
${common}
${facadeLib}
varying vec4 v_a;
varying vec4 v_b;
flat varying vec4 v_c;
varying vec3 v_normal;
varying vec3 v_world;

void main() {
  float u = v_a.x, v = v_a.y, L = v_a.z, slopeLen = v_a.w;
  float mat = v_b.x, kind = v_b.y, st = v_b.z, seed = v_b.w;
  float sid = floor(seed * 997.0 + 0.5);
  int bid = int(sid);
  vec2 dx = dFdx(vec2(u, v));
  vec2 dy = dFdy(vec2(u, v));
  vec2 aa = (abs(dx) + abs(dy)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.05, 0.25, max(aa.x, aa.y));
  vec3 N = normalize(v_normal);
  vec3 nrm = N;
  float ao = 1.0;
  float glass = 0.0;
  vec3 col;
  float tone = 0.9 + 0.2 * hash(vec2(sid, 1.0));
  float soot = st < 2.5 ? smoothstep(1830.0, 1890.0, u_year) * (1.0 - smoothstep(1960.0, 1980.0, u_year)) : 0.0;
  bool dormer = kind > 3.5 && kind < 4.5;
  int part = int(v_c.x + 0.5);
  // Dormer roofs and cheeks take the roof's material; dormer fronts are drawn below.
  bool slate = mat > 0.5 && mat < 1.5 && st > 0.5 && st < 1.5 && ihash(bid, 0, 70) < 0.55 && (kind > 0.5 && kind < 1.5 || dormer);

  if (mat < 0.5) {
    // Clay tiles in staggered courses, each a little different; ridge tiles along the top.
    col = vec3(0.62, 0.34, 0.23) * tone;
    float row = floor(v / 0.27);
    vec2 cell = vec2(floor(u / 0.24 + row * 0.5), row);
    col *= 0.88 + 0.24 * hash(cell + sid * 0.37);
    float edge = smoothstep(0.0, aa.y * 2.0 + 0.01, fract(v / 0.27) - 0.86);
    col *= 1.0 - 0.3 * edge * detail;
    col = mix(col, vec3(0.42, 0.40, 0.30), 0.25 * noise(vec2(u, v) * 0.4 + seed * 9.0));
    // Moss and lichen on the old roofs.
    col = mix(col, vec3(0.36, 0.38, 0.24), 0.3 * smoothstep(0.62, 0.8, noise(vec2(u, v) * 0.9 + seed * 5.0)));
    if (kind > 1.5 && kind < 2.5 && v > slopeLen - 0.22) col = vec3(0.50, 0.28, 0.20) * tone * (0.9 + 0.2 * step(0.5, fract(u / 0.4)));
  } else if (slate) {
    // Slates on the steep slopes of Second Empire mansards.
    col = vec3(0.31, 0.33, 0.37) * tone;
    float row = floor(v / 0.18);
    vec2 cell = vec2(floor(u / 0.28 + row * 0.5), row);
    col *= 0.86 + 0.24 * hash(cell + sid * 0.13);
    col *= 1.0 - 0.3 * smoothstep(0.0, aa.y * 2.0 + 0.01, fract(v / 0.18) - 0.82) * detail;
  } else if (mat < 1.5 || mat > 3.5 && mat < 4.5) {
    // Zinc (light, standing seams) or lead (darker, wider panels).
    bool lead = mat > 3.5;
    col = lead ? vec3(0.42, 0.46, 0.50) : vec3(0.58, 0.62, 0.66) * tone;
    float pitch = lead ? 0.9 : 0.55;
    float seamDist = (0.5 - abs(fract(u / pitch) - 0.5)) * pitch;
    float seam = 1.0 - smoothstep(0.015, 0.015 + aa.x * 2.0, seamDist);
    col *= 1.0 - 0.25 * seam * detail * step(0.5, kind);
    col *= 0.94 + 0.08 * noise(vec2(u * 0.3, v * 2.0) + seed);
  } else if (mat < 2.5) {
    col = vec3(0.70, 0.68, 0.64) * (0.92 + 0.1 * noise(vec2(u, v) * 0.5));
  } else if (mat < 3.5) {
    col = vec3(0.40, 0.50, 0.30) * (0.85 + 0.3 * noise(vec2(u, v) * 0.7));
  } else if (mat < 5.5) {
    col = vec3(0.78, 0.74, 0.66);
  } else {
    // Chimney stacks: plaster or brick, a stone coping, soot at the top.
    bool brick = st > 0.5 && ihash(bid, 0, 71) < 0.5;
    col = brick ? vec3(0.58, 0.32, 0.24) : vec3(0.80, 0.73, 0.63) * tone;
    if (brick) col *= 1.0 - 0.2 * smoothstep(0.0, aa.y * 2.0 + 0.01, fract(v / 0.075) - 0.8) * detail;
    col *= 1.0 - 0.3 * smoothstep(slopeLen - 1.2, slopeLen, v);
    if (v > slopeLen - 0.16) col = vec3(0.74, 0.71, 0.65);
  }

  if (dormer) {
    // a_a: across the front from its middle, up from its sill, width, front height.
    float x = u, y = v, w = L, H = slopeLen;
    vec3 stone = (st > 0.5 && st < 1.5 ? vec3(0.87, 0.82, 0.72) : vec3(0.86, 0.81, 0.71)) * (0.95 + 0.1 * hash(vec2(sid, 3.0)));
    stone = mix(stone, vec3(dot(stone, vec3(0.3, 0.4, 0.3))) * 0.84, 0.35 * soot);
    if (part == 0) {
      // The front: a stone or plaster frame around a casement window, set back.
      col = stone;
      bool arched = st > 0.5 && st < 1.5 && ihash(bid, 0, 72) < 0.5;
      vec2 lo = vec2(-w * 0.5 + 0.17, 0.22), hi = vec2(w * 0.5 - 0.17, H - 0.12);
      float spring = arched ? hi.y - (hi.x - lo.x) * 0.5 : hi.y;
      vec2 p = vec2(x, y);
      float cov = max(rect(p, lo, vec2(hi.x, spring), aa), arched ? (1.0 - smoothstep(hi.x - aa.x, hi.x + aa.x, length(vec2(x, y - spring)))) * step(spring, y) : 0.0);
      col *= 1.0 - 0.12 * (rect(p, lo - 0.06, hi + 0.06, aa) - cov) * detail;
      if (cov > 0.001 && detail > 0.01) {
        vec3 T = vec3(-N.y, N.x, 0.0);
        vec3 V = u_camera - v_world;
        vec4 r = recess(p, lo, vec2(hi.x, hi.y), 0.14, vec3(dot(V, T), V.z, dot(V, N)));
        vec3 inside = stone * (1.0 - 0.3 * r.w);
        float gl = 0.0;
        if (r.z < 1.5) {
          gl = casement(r.xy, lo, hi, 3.0, true, aa);
          inside = frameColour(nib(ihashu(bid, 0, 1), 0));
        }
        col = mix(col, inside, cov * detail);
        glass = gl * cov;
        nrm = normalize(mix(N, recessNormal(r.z, N, T), cov * detail));
      }
    } else if (part == 1) {
      // The pediment, with a moulded base.
      col = stone * (y - H < 0.08 ? 1.12 : 1.02);
      col *= 1.0 - 0.2 * (1.0 - smoothstep(0.03, 0.05, abs(y - H - 0.09))) * detail;
    } else if (part == 2) {
      // Cheeks: zinc on later buildings, plaster on old ones.
      col = st < 0.5 ? stone * 0.92 : vec3(0.56, 0.6, 0.63) * tone;
    }
  } else if (kind > 4.5) {
    // Chimney pots: terracotta, tapering, on a bed of mortar (a_c.x: pots in this row).
    float n = max(1.0, v_c.x);
    float pitch = L / n;
    float x = mod(u, pitch) - pitch * 0.5;
    float r = 0.085 - 0.02 * v / slopeLen;
    if (v > 0.07 && abs(x) > r) discard;
    float c = sqrt(max(0.0, 1.0 - (x / r) * (x / r)));
    col = v < 0.07 ? vec3(0.66, 0.62, 0.56) : vec3(0.66, 0.38, 0.25) * (0.65 + 0.45 * c);
    col *= 1.0 - 0.45 * smoothstep(slopeLen - 0.08, slopeLen, v);
  }

  col *= 1.0 - 0.18 * soot;
  // Glass of the dormer windows.
  vec3 view = normalize(u_camera - v_world);
  float fres = pow(1.0 - max(dot(N, view), 0.0), 2.0);
  col = mix(col, mix(vec3(0.10, 0.12, 0.14), vec3(0.50, 0.58, 0.66), 0.25 + 0.5 * fres), glass * detail);

  float light = 0.55 + 0.55 * max(dot(nrm, u_sun), 0.0);
  col *= light * ao;
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- facades */

/**
 * Facades of ordinary buildings (old houses, Haussmann, modern), in their
 * own mesh: storeys, recessed windows with frames, shutters and guards,
 * shops, doors and carriage doors, house numbers, downpipes, timber frames,
 * and the blind party walls with the advertisements painted on them.
 */
export const facadeFragment = /* glsl */ `
${common}
${facadeLib}
varying vec4 v_a;
varying vec4 v_b;
flat varying vec4 v_c;
varying vec3 v_normal;
varying vec3 v_world;

vec3 shopColour(float h) {
  if (h < 0.2) return vec3(0.16, 0.30, 0.22);
  if (h < 0.4) return vec3(0.45, 0.13, 0.10);
  if (h < 0.55) return vec3(0.14, 0.19, 0.32);
  if (h < 0.7) return vec3(0.11, 0.11, 0.11);
  if (h < 0.85) return vec3(0.58, 0.44, 0.20);
  return vec3(0.33, 0.22, 0.14);
}

void main() {
  float u = v_a.x, z = v_a.y, L = v_a.z, flags = v_a.w;
  float st = v_b.x, seed = v_b.y, eave = v_b.z, fh = v_b.w;
  float sid = floor(seed * 997.0 + 0.5);
  vec2 dx = dFdx(vec2(u, z));
  vec2 dy = dFdy(vec2(u, z));
  vec4 dp = vec4(dx, dy);
  vec2 aa = (abs(dx) + abs(dy)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.06, 0.3, max(aa.x, aa.y));
  int pid = int(v_c.y + 0.5);
  int bid = pid / 64;
  int wid = pid - bid * 64;
  vec3 N = normalize(v_normal);
  vec3 T = vec3(-N.y, N.x, 0.0);
  vec3 V = u_camera - v_world;
  vec3 vw = vec3(dot(V, T), V.z, dot(V, N));
  // Lighting inputs that details may change: the normal (reveals), ambient occlusion.
  vec3 nrm = N;
  float ao = 1.0;
  bool ordinary = true;

  // Per building and per wall: one hash each, read nibble by nibble.
  uint hB = ihashu(bid, 0, 0);
  uint hB2 = ihashu(bid, 0, 1);
  uint hWall = ihashu(bid, wid, 99);
  vec3 wall;
  if (st < 0.5) {
    float hc = nib(hB, 0);
    wall = hc < 0.16 ? vec3(0.86, 0.80, 0.68) : hc < 0.3 ? vec3(0.78, 0.70, 0.57) : hc < 0.44 ? vec3(0.79, 0.78, 0.74) : hc < 0.56 ? vec3(0.84, 0.73, 0.62)
         : hc < 0.68 ? vec3(0.88, 0.83, 0.70) : hc < 0.78 ? vec3(0.74, 0.66, 0.55) : hc < 0.9 ? vec3(0.82, 0.76, 0.70) : vec3(0.80, 0.70, 0.52);
  } else if (st < 1.5) {
    wall = vec3(0.87, 0.82, 0.72);
  } else {
    wall = seed < 0.5 ? vec3(0.70, 0.56, 0.46) : vec3(0.80, 0.78, 0.74);
  }
  wall *= 0.93 + 0.14 * hash(vec2(sid, 3.0));
  // Weathering: soft vertical streaks.
  wall *= 1.0 - 0.07 * noise(vec2(u * 0.6, z * 0.12) + seed * 17.0);
  // Coal soot darkened Paris from the mid-19th century until the cleaning campaigns of the 1960s.
  float soot = smoothstep(1830.0, 1890.0, u_year) * (1.0 - smoothstep(1960.0, 1980.0, u_year));
  wall = mix(wall, vec3(dot(wall, vec3(0.3, 0.4, 0.3))) * 0.84, 0.35 * soot);
  vec3 col = wall;
  float glass = 0.0;

  if (flags > 0.5) {
    // ---------------------------------------------------------------- party walls: blind
    col *= 0.9;
    if (ordinary) {
      // Rough render, with rubble stone where it has fallen.
      float rough = noise(v_world.xy * 0.3 + vec2(z * 0.4, u * 0.2));
      col *= 0.94 + 0.08 * noise(vec2(u, z) * 1.7);
      col = mix(col, col * vec3(0.92, 0.88, 0.82), smoothstep(0.68, 0.74, rough) * detail);
      // The neighbours: the one standing at first (until a year), then the latest (from a year).
      float h1 = mod(v_c.z, 1000.0) / 10.0, until1 = 1700.0 + floor(v_c.z / 1000.0);
      float h2 = mod(v_c.w, 1000.0) / 10.0, from2 = 1700.0 + floor(v_c.w / 1000.0);
      float nbH = u_year < until1 ? h1 : u_year >= from2 ? h2 : 0.0;
      // Where a demolished house leant on this wall: its outline, flues and old plaster.
      if (u_year >= until1 && h1 > 0.0 && z < h1 + 0.5 && z > nbH) {
        col *= 0.86 + 0.08 * noise(vec2(u * 2.0, z * 2.0));
        float flue = 1.0 - smoothstep(0.15, 0.17 + aa.x, abs(fract(u / 2.6) - 0.5) * 2.6);
        col *= 1.0 - 0.18 * flue * step(3.0, z);
      }
      // Painted advertisements on high blind walls, about 1880–1960, fading after.
      int ak = int(L * 10.0) + int(eave * 7.0);
      float from = 1878.0 + 35.0 * ihash(bid, ak, 60);
      float zlo = max(nbH, 3.0) + 0.9;
      float zhi = eave - 0.6;
      float W = L - 1.4;
      if (ihash(bid, ak, 61) < 0.5 && u_year >= from && zhi - zlo > 3.2 && W > 4.5) {
        float age = u_year - from;
        float fade = smoothstep(25.0, 75.0, age) * 0.8 + step(1980.0, u_year) * 0.12;
        vec2 c = vec2(u - L * 0.5, z - 0.5 * (zlo + zhi));
        float Hh = min(zhi - zlo, W * 0.6);
        vec2 hs = vec2(W * 0.5, Hh * 0.5);
        if (abs(c.x) < hs.x && abs(c.y) < hs.y) {
          int ad = int(ihashu(bid, ak, 62) % uint(SIGN_ADS));
          float hc = ihash(bid, ak, 63);
          vec3 bg = hc < 0.2 ? vec3(0.12, 0.18, 0.40) : hc < 0.4 ? vec3(0.55, 0.12, 0.10) : hc < 0.55 ? vec3(0.08, 0.08, 0.08) : hc < 0.75 ? vec3(0.80, 0.62, 0.22) : hc < 0.9 ? vec3(0.88, 0.85, 0.76) : vec3(0.16, 0.35, 0.22);
          vec3 ink = hc < 0.55 ? vec3(0.95, 0.88, 0.62) : hc < 0.9 ? vec3(0.45, 0.10, 0.08) : vec3(0.95, 0.92, 0.80);
          float border = 1.0 - rect(c, -hs + 0.18, hs - 0.18, aa);
          vec3 ac = mix(bg, ink, border * 0.8);
          float big = word(adRow(ad, false), c - vec2(0.0, Hh * 0.12), Hh * 0.5, W * 0.88, dp);
          float small = word(adRow(ad, true), c + vec2(0.0, Hh * 0.27), Hh * 0.22, W * 0.8, dp);
          ac = mix(ac, ink, max(big, small));
          col = mix(col, ac, (1.0 - fade) * (0.85 + 0.15 * noise(vec2(u, z) * 3.0)));
        }
      }
    }
  } else if (L > 1.6 && detail > 0.01) {
    // Far away, where detail is 0, the windows fade into the average below and none of this runs.
    vec3 fl = floorLayout(st, eave, fh);
    float g = fl.x, nF = fl.y, fhE = fl.z;
    float nb = max(1.0, floor(L / bayWidth(st, seed)));
    float bw = L / nb;
    float bayF = floor(u / bw);
    int bay = int(bayF);
    float bu = u - (bayF + 0.5) * bw;
    int codes = int(v_c.z + 0.5);
    int fw = int(v_c.w + 0.5);
    int cochere = (fw & 15) - 1;
    bool courtyard = (fw & 16) != 0;
    bool timber = (fw & 32) != 0;
    vec3 iron = vec3(0.11, 0.11, 0.12);
    vec3 frameC = frameColour(nib(hB2, 0));
    bool old = st < 0.5, haus = st > 0.5 && st < 1.5;

    if (z > g && z < eave - 0.4 && nF > 0.0) {
      // Upper floors. Old houses: storeys lower toward the top, windows not quite in line.
      float k, fz, hk;
      if (old) {
        float b = fhE * 0.1 * nib(hB, 1);
        float a = fhE + b * (nF - 1.0) * 0.5;
        float zz = z - g;
        k = b > 1e-3 ? floor(((a + b * 0.5) - sqrt(max(0.0, (a + b * 0.5) * (a + b * 0.5) - 2.0 * b * zz))) / b) : floor(zz / a);
        k = clamp(k, 0.0, nF - 1.0);
        float z0 = a * k - b * k * (k - 1.0) * 0.5;
        hk = a - b * k;
        fz = zz - z0;
      } else {
        k = floor((z - g) / fhE);
        fz = z - g - k * fhE;
        hk = fhE;
      }
      int ik = int(k);
      uint hW = ihashu(bid, bay * 16 + ik, 0);
      float ww = old ? 0.82 + 0.28 * nib(hB, 2) : haus ? 1.25 : 1.55;
      float sill = haus ? hk * 0.12 : hk * 0.24;
      float wh = haus ? hk * 0.7 : hk * 0.58;
      float jx = 0.0;
      if (old) {
        jx = (nib(hW, 0) - 0.5) * 0.3 * nib(hB, 3);
        if (k > nF - 1.5 && nF > 2.0) { ww *= 0.85; wh *= 0.85; }
      }
      vec2 lo = vec2(-ww * 0.5 + jx, sill);
      vec2 hi = vec2(ww * 0.5 + jx, sill + wh);
      vec2 p = vec2(bu, fz);
      bool blind = old && byteOf(hW, 1) < 0.04;
      float depth = haus ? 0.3 : old ? 0.17 : 0.2;

      // Fine features (bands, timber, mouldings, reveals, glazing bars, guards) only close up:
      // dt fades them in, and far away the window is just glass and shutters.
      float dt = detail * smoothstep(0.35, 0.6, detail);
      if (dt > 0.001) {
        // Old houses: a plaster band at each floor; some show their timber frames.
        if (old && nib(hB, 4) < 0.6) {
          float band = rect(vec2(bu, fz), vec2(-bw, -0.02), vec2(bw, 0.13), aa);
          col = mix(col, wall * 1.07, band * dt);
          col = mix(col, wall * 0.8, rect(vec2(bu, fz), vec2(-bw, -0.06), vec2(bw, -0.02), aa) * dt);
        }
        if (timber) {
          vec3 wood = nib(hB, 5) < 0.5 ? vec3(0.30, 0.20, 0.14) : vec3(0.40, 0.16, 0.12);
          float t = lineAA(abs(fz - 0.05), 0.07, aa.y);
          t = max(t, lineAA(abs(fz - sill + 0.05), 0.05, aa.y));
          t = max(t, lineAA(abs(abs(bu - jx) - ww * 0.5 - 0.08), 0.06, aa.x));
          t = max(t, lineAA(abs(abs(bu) - bw * 0.5), 0.07, aa.x));
          // Braces across the piers between the windows.
          float pier = abs(bu) - ww * 0.5 - 0.16;
          float span = bw * 0.5 - ww * 0.5 - 0.16;
          if (pier > 0.0 && span > 0.25) {
            float brace = abs((fz - 0.1) / max(hk - 0.2, 0.5) - pier / span);
            t = max(t, lineAA(brace * span, 0.035, aa.x) * step(0.1, fz) * step(fz, hk - 0.1));
          }
          col = mix(col, wood, t * dt);
          col = mix(col, col * 1.06, (1.0 - t) * dt * 0.5);
        }
        if (haus) {
          // Ashlar joints.
          float j = lineAA(abs(fract(z / 0.52) - 0.5) * 0.52, 0.008, aa.y);
          float jv = lineAA(abs(fract(u / 1.1 + floor(z / 0.52) * 0.5) - 0.5) * 1.1, 0.008, aa.x);
          col *= 1.0 - 0.14 * max(j, jv) * dt;
          // Consoles under the 2nd floor balcony.
          if (ik == 1 || ik == 2) {
            float cz = z - (g + fhE * 1.12 - 0.8);
            float cons = rect(vec2(abs(abs(bu) - bw * 0.5), cz), vec2(-1.0, 0.0), vec2(0.13, 0.6), aa);
            col = mix(col, wall * 1.1 * (0.85 + 0.25 * cz / 0.6), cons * dt);
          }
        }
        // Window surrounds: moulded stone frames and hoods (Haussmann), plain plaster bands (old).
        if (!blind && st < 1.5) {
          float sw = haus ? 0.17 : 0.1;
          float outer = rect(p, lo - sw, hi + sw, aa);
          col = mix(col, wall * (haus ? 1.1 : 1.06), (outer - rect(p, lo, hi, aa)) * dt);
          if (haus) {
            col = mix(col, wall * 0.82, (outer - rect(p, lo - sw + 0.03, hi + sw - 0.03, aa)) * 0.5 * dt);
            if (ik == 1 || ik == 2) {
              float hood = rect(p, vec2(lo.x - 0.32, hi.y + sw), vec2(hi.x + 0.32, hi.y + sw + (ik == 1 ? 0.3 : 0.18)), aa);
              float shade = rect(p, vec2(lo.x - 0.3, hi.y + sw - 0.04), vec2(hi.x + 0.3, hi.y + sw), aa);
              col = mix(col, wall * 1.14, hood * dt);
              col = mix(col, wall * 0.7, shade * dt);
            }
          }
        }
      }
      // Old houses: shutters folded back against the wall.
      bool shutters = old && nib(hW, 4) < 0.55 && u_year > 1760.0;
      bool closed = shutters && nib(hW, 5) < 0.22;
      vec3 shutterC = shutterColour(nib(hB2, 1));
      bool persienne = nib(hB, 6) < (u_year < 1800.0 ? 0.3 : 0.65);
      if (shutters && !closed && !blind) {
        float sh = rect(vec2(abs(bu - jx), fz), vec2(ww * 0.5 + 0.03, sill), vec2(ww + 0.03, sill + wh), aa);
        float slat = persienne ? louvres(fz, aa) : 1.0 - 0.18 * step(0.9, fract(abs(bu - jx) / 0.16)) * dt;
        col = mix(col, shutterC * slat, sh * detail);
      }
      float cov = blind ? 0.0 : rect(p, lo, hi, aa);
      if (blind) {
        col = mix(col, wall * 0.96, rect(p, lo, hi, aa) * dt);
      } else if (closed) {
        // Closed shutters, flush with the wall.
        float meet = lineAA(abs(bu - jx), 0.015, aa.x);
        col = mix(col, shutterC * (persienne ? louvres(fz, aa) : 1.0) * (1.0 - 0.4 * meet * dt), cov * detail);
      } else if (cov > 0.001 && dt < 0.001) {
        glass = cov;
      } else if (cov > 0.001) {
        vec4 r = recess(p, lo, hi, depth, vw);
        vec3 inside;
        float gl = 0.0;
        if (r.z < 1.5) {
          float rows = old ? max(3.0, floor(wh / 0.38)) : haus ? 3.0 : 1.0;
          float gq = casement(r.xy, lo, hi, rows, st < 1.5, aa);
          // Net curtains behind some windows.
          float cur = nib(hW, 6) < 0.35 ? smoothstep(0.2, 0.1, min(r.x - lo.x, hi.x - r.x) / ww) : 0.0;
          inside = mix(frameC, vec3(0.78, 0.76, 0.70), cur * gq);
          gl = gq * (1.0 - cur * 0.7);
        } else {
          // Reveals: the wall's own stone or plaster; Haussmann windows keep folded iron shutters in them.
          inside = wall * (1.0 - 0.25 * r.w);
          if (haus && r.z > 1.5 && r.z < 3.5 && nib(hB, 7) < 0.7) inside = vec3(0.55, 0.55, 0.52) * louvres(r.y, aa);
          if (r.z > 4.5) inside = wall * 1.05;
        }
        // Fading out, the window becomes plain glass.
        gl = mix(1.0, gl, dt);
        col = mix(col, inside, cov * dt);
        glass = gl * cov;
        nrm = normalize(mix(N, recessNormal(r.z, N, T), cov * dt));
        ao = mix(1.0, 0.9, cov * dt);
        // Iron guards across the lower part of the French windows (not on balcony floors).
        bool guard = haus ? (ik != 1 && ik != 4) : old ? nib(hW, 7) < 0.3 && u_year > 1770.0 : false;
        if (guard) {
          float gt = haus ? 0.95 : 0.55;
          float y = fz - sill;
          float bars = lineAA(abs(fract((bu - jx) / 0.11) - 0.5) * 0.11, 0.009, aa.x) * step(y, gt);
          float rails = rect(vec2(bu, y), vec2(lo.x, gt - 0.05), vec2(hi.x, gt), aa) + rect(vec2(bu, y), vec2(lo.x, haus ? 0.55 : 0.0), vec2(hi.x, haus ? 0.58 : 0.03), aa);
          float iro = clamp(bars + rails, 0.0, 1.0) * cov * step(0.0, y) * dt;
          col = mix(col, iron, iro);
          glass *= 1.0 - iro;
          nrm = normalize(mix(nrm, N, iro));
        }
      }
    } else if (z <= g) {
      // ---- the ground floor
      int code = bay < int(nb) ? bayCode(codes, bay) : 0;
      if (haus) {
        // Rusticated stone.
        float groove = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.5) - 0.5) - 0.45);
        col *= 1.0 - 0.22 * groove * detail;
      }
      if ((code == 1 || code == 2) && old) {
        // Shops: their casing (geometry) covers this. Before casings, old houses opened as stalls.
        int s = bay;
        for (int i = 0; i < 3; i++) if (s > 0 && bayCode(codes, s) == 2) s--;
        int e = bay;
        for (int i = 0; i < 3; i++) if (e + 1 < int(nb) && bayCode(codes, e + 1) == 2) e++;
        float x0 = float(s) * bw + 0.18, x1 = float(e + 1) * bw - 0.18;
        vec2 lo = vec2(x0 + 0.2, 0.05), hi = vec2(x1 - 0.2, g - 0.75);
        vec2 p = vec2(u, z);
        float cov = rect(p, lo, hi, aa);
        // The board over the stall, with the trade painted on it.
        int key = wid * 32 + s;
        int trade = int(ihashu(bid, key, 7) % uint(SIGN_TRADES));
        vec3 paint = shopColour(ihash(bid, key, 3));
        float board = rect(p, vec2(x0, g - 0.72), vec2(x1, g - 0.15), aa);
        col = mix(col, paint, board * detail);
        float ink = word(signRow(trade, u_year, false), vec2(u - 0.5 * (x0 + x1), z - (g - 0.435)), 0.55, x1 - x0 - 0.4, dp);
        col = mix(col, vec3(0.9, 0.84, 0.66), ink * board);
        if (cov > 0.001) {
          vec4 r = recess(p, lo, hi, 0.3, vw);
          vec3 inside = r.z < 1.5 ? vec3(0.13, 0.11, 0.09) : paint * (1.0 - 0.4 * r.w);
          if (r.z < 1.5) {
            // A counter with goods, and wooden shutters stacked at the sides.
            float counter = step(r.y, 0.95);
            vec3 goods = shopColour(hash(floor(r.xy * vec2(4.0, 6.0)) + float(bid))) * 0.8;
            inside = mix(inside, mix(paint * 0.8, goods, step(0.85, r.y) * 0.8), counter);
            float sh = step(r.x, lo.x + 0.35) + step(hi.x - 0.35, r.x);
            inside = mix(inside, paint * (0.9 - 0.15 * step(0.85, fract(r.x / 0.12))), clamp(sh, 0.0, 1.0));
          }
          col = mix(col, inside, cov * detail);
          nrm = normalize(mix(N, recessNormal(r.z, N, T), cov * detail));
        }
      } else if (code == 3) {
        // Doors: a carriage door on large buildings, else a house door with a fanlight.
        bool big = bay == cochere;
        float dwid = big ? min(bw - 0.6, 2.9) : old ? 1.05 : 1.3;
        float dh = big ? min(g - 0.35, 4.1) : old ? 2.35 : haus ? 3.2 : 2.5;
        vec2 lo = vec2(-dwid * 0.5, 0.0), hi = vec2(dwid * 0.5, dh);
        vec2 p = vec2(bu, z);
        // Arched head on carriage doors.
        float spring = big ? dh - dwid * 0.32 : dh;
        float archC = big ? 1.0 - smoothstep(1.0, 1.0 + aa.x, length(vec2(bu / (dwid * 0.5), (z - spring) / (dh - spring)))) : 0.0;
        float cov = max(rect(p, lo, vec2(hi.x, spring), aa), archC * step(spring, z));
        // Stone surround.
        float surround = big ? max(rect(p, lo - 0.25, vec2(hi.x + 0.25, spring), aa), (1.0 - smoothstep(1.0, 1.0 + aa.x, length(vec2(bu / (dwid * 0.5 + 0.25), (z - spring) / (dh - spring + 0.25))))) * step(spring, z)) : rect(p, lo - 0.12, hi + 0.12, aa);
        col = mix(col, wall * 1.1, (surround - cov) * detail);
        if (big) col = mix(col, wall * 1.2, rect(p, vec2(-0.18, dh - 0.05), vec2(0.18, dh + 0.25), aa) * detail); // keystone
        if (cov > 0.001) {
          vec4 r = recess(p, lo, vec2(hi.x, max(spring, dh)), big ? 0.38 : 0.25, vw);
          vec3 wood = nib(hWall, 0) < 0.4 ? vec3(0.20, 0.25, 0.20) : nib(hWall, 0) < 0.7 ? vec3(0.32, 0.20, 0.13) : vec3(0.36, 0.14, 0.12);
          if (st > 1.5 && u_year > 1950.0) wood = vec3(0.22, 0.23, 0.24);
          vec3 inside;
          if (r.z < 1.5) {
            vec2 q = r.xy;
            float fan = big ? spring - 0.05 : dh - 0.55;
            if (q.y > fan) {
              // Fanlight: a grille over glass.
              float gr = 1.0 - smoothstep(0.012, 0.012 + aa.x, abs(fract(q.x / 0.14) - 0.5) * 0.14);
              inside = mix(vec3(0.12, 0.13, 0.15), iron, gr);
              glass = (1.0 - gr) * cov * 0.8;
            } else {
              // Two leaves with moulded panels.
              float leafW = big ? dwid * 0.5 : dwid;
              float lx = big ? abs(q.x) : q.x + dwid * 0.5;
              float pz = q.y / fan;
              float panels = rect(vec2(fract(lx / (leafW * 0.5)), pz), vec2(0.15, 0.06), vec2(0.85, 0.44), vec2(aa.x / leafW * 2.0, aa.y / fan)) + rect(vec2(fract(lx / (leafW * 0.5)), pz), vec2(0.15, 0.52), vec2(0.85, 0.94), vec2(aa.x / leafW * 2.0, aa.y / fan));
              inside = wood * (1.0 - 0.2 * panels * detail + 0.1 * (1.0 - panels) * detail);
              if (big) inside *= 1.0 - 0.5 * (1.0 - smoothstep(0.01, 0.01 + aa.x, abs(q.x)));
              if (st > 1.5 && u_year > 1950.0) {
                inside = mix(vec3(0.15, 0.17, 0.19), wood, 1.0 - rect(q, lo + 0.08, vec2(hi.x - 0.08, fan - 0.08), aa));
                glass = rect(q, lo + 0.08, vec2(hi.x - 0.08, fan - 0.08), aa) * cov * 0.7;
              }
              // Knockers / handles.
              inside = mix(inside, vec3(0.75, 0.6, 0.3), (1.0 - smoothstep(0.04, 0.05, length(vec2(abs(q.x) - (big ? 0.35 : dwid * 0.3), q.y - 1.1)))) * detail);
            }
          } else {
            inside = wall * (1.0 - 0.3 * r.w);
          }
          col = mix(col, inside, cov * detail);
          nrm = normalize(mix(N, recessNormal(r.z, N, T), cov * detail));
        }
        // House number: painted from the 1790s, painted on an ochre ground (1805), blue enamel plates (from 1847).
        if (!courtyard && u_year >= 1790.0) {
          int num = 1 + int(ihashu(bid, wid, 20) % 64u);
          vec2 c = vec2(bu - (dh + 0.45 < g ? 0.0 : dwid * 0.5 + 0.35), z - (dh + 0.45 < g ? dh + (big ? 0.5 : 0.3) : 2.4));
          vec2 hs = vec2(num < 10 ? 0.12 : 0.17, 0.11);
          float plate = rect(c, -hs, hs, aa);
          if (u_year >= 1847.0) {
            float edge = plate - rect(c, -hs + 0.02, hs - 0.02, aa);
            vec3 enamel = mix(vec3(0.10, 0.22, 0.50), vec3(0.92, 0.94, 0.95), edge);
            enamel = mix(enamel, vec3(0.95), houseNumber(num, c, 0.17, dp));
            col = mix(col, enamel, plate * detail);
          } else if (u_year >= 1805.0) {
            // Black numbers in streets along the Seine, red in streets running to it.
            bool along = abs(N.y) > abs(N.x);
            col = mix(col, vec3(0.78, 0.60, 0.30), plate * detail * 0.9);
            col = mix(col, along ? vec3(0.08) : vec3(0.55, 0.10, 0.08), houseNumber(num, c, 0.17, dp) * detail);
          } else {
            col = mix(col, vec3(0.1), houseNumber(num, c, 0.15, dp) * detail * 0.85);
          }
        }
      } else {
        // Plain bays: windows with bars (old houses), tall arched openings (Haussmann), windows.
        float ww = old ? 0.9 : haus ? bw - 1.1 : 1.6;
        float sill = old ? 0.9 : haus ? 0.0 : 0.8;
        float top = old ? 2.6 : haus ? g - 0.6 : 2.9;
        vec2 lo = vec2(-ww * 0.5, sill), hi = vec2(ww * 0.5, top);
        vec2 p = vec2(bu, z);
        float spring = haus ? top - ww * 0.5 : top;
        float cov = haus ? max(rect(p, lo, vec2(hi.x, spring), aa), (1.0 - smoothstep(ww * 0.5 - aa.x, ww * 0.5 + aa.x, length(vec2(bu, (z - spring) * 1.0)))) * step(spring, z)) : rect(p, lo, hi, aa);
        if (cov > 0.001) {
          vec4 r = recess(p, lo, vec2(hi.x, top), haus ? 0.35 : 0.2, vw);
          vec3 inside = r.z < 1.5 ? frameC : wall * (1.0 - 0.25 * r.w);
          float gl = 0.0;
          if (r.z < 1.5) gl = casement(r.xy, lo, hi, old ? 4.0 : 3.0, true, aa);
          if (old) {
            float bars = 1.0 - smoothstep(0.012, 0.012 + aa.x, abs(fract(bu / 0.13) - 0.5) * 0.13);
            col = mix(col, iron, bars * cov * detail);
            gl *= 1.0 - bars;
          }
          col = mix(col, inside, cov * detail * (1.0 - gl * 0.0));
          glass = gl * cov;
          nrm = normalize(mix(N, recessNormal(r.z, N, T), cov * detail));
        }
      }
    } else if (z >= eave - 0.4 && z <= eave) {
      // Cornice where there is none in relief (gables, courtyards).
      col *= z > eave - 0.15 ? 1.12 : 0.82;
    }
    // A small attic window in the gable of old houses.
    if (old && z > eave + 0.5) {
      float attic = rect(vec2(u - L * 0.5, z), vec2(-0.35, eave + 0.6), vec2(0.35, eave + 1.5), aa);
      glass = max(glass, attic * step(4.0, L) * step(L, 10.0));
    }
    // Downpipes at one end of the facade, from about 1800 on old houses.
    float pipeFrom = old ? 1800.0 + 60.0 * nib(hWall, 1) : 0.0;
    if (!courtyard && u_year > pipeFrom && L > 3.0 && nib(hWall, 2) < (old ? 0.6 : 0.85)) {
      float px = nib(hWall, 3) < 0.5 ? 0.16 : L - 0.16;
      float d = abs(u - px);
      float r = z < 1.6 ? 0.07 : 0.05;
      if (d < r && z < eave - 0.15) {
        float c = sqrt(max(0.0, 1.0 - (d / r) * (d / r)));
        vec3 metal = z < 1.6 ? vec3(0.18, 0.19, 0.2) : old ? wall * 0.8 : vec3(0.48, 0.5, 0.52);
        col = mix(col, metal * (0.65 + 0.45 * c), detail);
        glass *= 1.0 - detail;
        nrm = normalize(mix(N, N * c + T * (u - px) / r, detail));
        // Collars every two metres.
        col *= 1.0 - 0.3 * (1.0 - smoothstep(0.02, 0.03, abs(fract(z / 2.0) - 0.5) * 2.0)) * detail;
      }
      // The hopper under the gutter.
      if (d < 0.14 && z > eave - 0.6 && z < eave - 0.15) {
        col = mix(col, (old ? wall * 0.75 : vec3(0.45, 0.47, 0.5)) * 0.9, detail);
        glass *= 1.0 - detail;
      }
    }  }

  // Glass: dark, with the sky reflected toward the top of each pane.
  vec3 view = normalize(V);
  float fres = pow(1.0 - max(dot(N, view), 0.0), 2.0);
  vec3 pane = mix(vec3(0.10, 0.12, 0.14), vec3(0.50, 0.58, 0.66), 0.25 + 0.5 * fres);
  col = mix(col, pane, glass * smoothstep(0.0, 0.3, detail));
  // Far away, windows blend into a darker average.
  col = mix(col, col * 0.86, (1.0 - detail) * step(flags, 0.5) * step(1.6, L) * step(3.0, z));

  float light = 0.62 + 0.48 * max(dot(nrm, u_sun), 0.0);
  light *= mix(0.74, 1.0, smoothstep(0.0, 3.0, z));
  col *= light * ao;
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- relief */

/**
 * The relief of ordinary buildings, in its own mesh so the facade shader
 * stays small: cornices and string courses, balcony slabs and railings,
 * awnings, shopfront casings and projecting signs (PART in facades.ts).
 */
export const detailFragment = /* glsl */ `
${common}
${facadeLib}
varying vec4 v_a;
varying vec4 v_b;
flat varying vec4 v_c;
varying vec3 v_normal;
varying vec3 v_world;

vec3 shopColour(float h) {
  if (h < 0.2) return vec3(0.16, 0.30, 0.22);
  if (h < 0.4) return vec3(0.45, 0.13, 0.10);
  if (h < 0.55) return vec3(0.14, 0.19, 0.32);
  if (h < 0.7) return vec3(0.11, 0.11, 0.11);
  if (h < 0.85) return vec3(0.58, 0.44, 0.20);
  return vec3(0.33, 0.22, 0.14);
}

void main() {
  float u = v_a.x, z = v_a.y, L = v_a.z, flags = v_a.w;
  float st = v_b.x, seed = v_b.y;
  float sid = floor(seed * 997.0 + 0.5);
  vec2 dx = dFdx(vec2(u, z));
  vec2 dy = dFdy(vec2(u, z));
  vec4 dp = vec4(dx, dy);
  vec2 aa = (abs(dx) + abs(dy)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.06, 0.3, max(aa.x, aa.y));
  int part = int(v_c.x + 0.5);
  int pid = int(v_c.y + 0.5);
  int bid = pid / 64;
  int wid = pid - bid * 64;
  vec3 N = normalize(v_normal);
  vec3 T = vec3(-N.y, N.x, 0.0);
  vec3 V = u_camera - v_world;
  vec3 vw = vec3(dot(V, T), V.z, dot(V, N));
  vec3 nrm = N;
  float ao = 1.0;
  float emissive = 0.0;
  float glass = 0.0;
  // The building's own plaster or stone, as the facade shader picks it.
  vec3 wall;
  if (st < 0.5) {
    float hc = nib(ihashu(bid, 0, 0), 0);
    wall = hc < 0.16 ? vec3(0.86, 0.80, 0.68) : hc < 0.3 ? vec3(0.78, 0.70, 0.57) : hc < 0.44 ? vec3(0.79, 0.78, 0.74) : hc < 0.56 ? vec3(0.84, 0.73, 0.62)
         : hc < 0.68 ? vec3(0.88, 0.83, 0.70) : hc < 0.78 ? vec3(0.74, 0.66, 0.55) : hc < 0.9 ? vec3(0.82, 0.76, 0.70) : vec3(0.80, 0.70, 0.52);
  } else if (st < 1.5) {
    wall = vec3(0.87, 0.82, 0.72);
  } else {
    wall = seed < 0.5 ? vec3(0.70, 0.56, 0.46) : vec3(0.80, 0.78, 0.74);
  }
  wall *= 0.93 + 0.14 * hash(vec2(sid, 3.0));
  float soot = smoothstep(1830.0, 1890.0, u_year) * (1.0 - smoothstep(1960.0, 1980.0, u_year));
  wall = mix(wall, vec3(dot(wall, vec3(0.3, 0.4, 0.3))) * 0.84, 0.35 * soot);
  vec3 col = wall;
  float railAlpha = 1.0;
  {
    int side = int(v_c.z + 0.5);
    vec3 stone = wall * 1.04;
    vec3 zinc = vec3(0.55, 0.58, 0.60) * (1.0 - 0.25 * soot);
    if (part == 1) {
      // Cornices and string courses (a_a.w: kind × 1000 + bottom height).
      float kind = floor(flags / 1000.0);
      float z0 = flags - kind * 1000.0;
      float h = kind < 0.5 ? 0.4 : kind < 1.5 ? 0.65 : kind < 2.5 ? 0.28 : 0.27;
      float t = (z - z0) / h;
      if (side == 0) {
        if (kind > 0.5 && kind < 1.5) {
          // Haussmann cornice: a fillet, dentils, a shadow, the corona and the zinc gutter.
          col = stone * 1.05;
          if (t > 0.15 && t < 0.42) col = mix(stone * 0.7, stone * 1.02, mix(0.6, step(0.45, fract(u / 0.2)), detail));
          else if (t >= 0.42 && t < 0.52) col = stone * 0.58;
          else if (t >= 0.52 && t < 0.87) col = stone * 1.1;
          else if (t >= 0.87) col = zinc;
        } else if (kind < 0.5) {
          // Plaster cornice of an old house: a bead, a cove, a fillet; a zinc gutter in the 19th century.
          col = t < 0.22 ? wall * 1.08 : t < 0.65 ? wall * mix(0.68, 1.0, (t - 0.22) / 0.43) : wall * 1.1;
          if (t > 0.72 && u_year > 1800.0 + 60.0 * ihash(bid, 0, 80)) col = zinc * 0.9;
        } else if (kind < 2.5) {
          col = wall * (t > 0.8 ? 1.12 : 1.02);
        } else {
          col = stone * (t < 0.2 ? 0.78 : 1.07);
        }
      } else if (side == 1) {
        // Underside, in shade; modillions under a Haussmann cornice.
        col = wall * 0.82;
        ao = 0.62;
        if (kind > 0.5 && kind < 1.5) {
          float m = (1.0 - smoothstep(0.1, 0.1 + aa.x, abs(fract(u / 0.62) - 0.5) * 0.62)) * detail;
          col = mix(col, stone * 1.05, m);
          ao = mix(ao, 0.9, m);
        }
      } else if (side == 2) {
        col = kind > 0.5 && kind < 1.5 ? zinc : kind < 0.5 ? (u_year > 1800.0 ? zinc * 0.9 : wall * 0.85) : wall * 1.05;
      }
    } else if (part == 2) {
      // Balcony slab (a_a.w: its top).
      float t = flags - z;
      if (side == 0) col = t < 0.05 ? stone * 1.08 : t < 0.09 ? stone * 0.72 : stone;
      else if (side == 1) {
        // Consoles under the slab, between the windows.
        col = wall * 0.78;
        ao = 0.66;
        float bw = L / max(1.0, floor(L / bayWidth(st, seed)));
        float du = abs(u - floor(u / bw + 0.5) * bw);
        float cons = (1.0 - smoothstep(0.15, 0.15 + aa.x, du)) * detail;
        col = mix(col, stone, cons);
        ao = mix(ao, 0.92, cons);
      } else col = stone * (side == 2 ? 0.92 : 1.0);
    } else if (part == 3) {
      // Cast-iron balcony railing: bars, a middle rail, a band of scrolls under the handrail.
      float y = z - flags;
      float px = max(aa.x, aa.y);
      bool solid;
      if (px > 0.03) {
        // Far: the rails, and the bars as a see-through band (a stipple would sparkle).
        solid = y > 0.0 && y < 1.0;
        if (y < 0.92 && y > 0.06) railAlpha = 0.5;
      } else {
        float w = 0.009 + px * 0.5;
        float bar = abs(fract(u / 0.12) - 0.5) * 0.12;
        bool rails = y > 0.94 || y < 0.05 || abs(y - 0.73) < 0.018;
        float r = length(vec2((fract(u / 0.24) - 0.5) * 0.24, y - 0.835));
        bool scroll = y > 0.73 && y < 0.94 && abs(r - 0.072) < w + 0.002;
        bool post = abs(fract(u / 1.5 + 0.5) - 0.5) * 1.5 < w * 2.5;
        solid = rails || (bar < w && y < 0.73) || scroll || post;
      }
      if (!solid) discard;
      col = vec3(0.09, 0.09, 0.10);
    } else if (part == 4) {
      // Shop awning: striped canvas until the 1950s, plain with the shop's name after.
      int info = int(v_c.w + 0.5);
      int trade = info - (info / 32) * 32;
      int key = wid * 32 + info / 32;
      float hm = ihash(bid, key, 31);
      // Shopfronts were modernised mostly in the 1960s and 1970s; a few old ones survive.
      bool modern = u_year >= 1950.0 + 45.0 * hm * hm && ihash(bid, key, 32) >= 0.18;
      float hc = ihash(bid, key, 33);
      vec3 c1 = hc < 0.25 ? vec3(0.62, 0.12, 0.10) : hc < 0.5 ? vec3(0.16, 0.38, 0.22) : hc < 0.7 ? vec3(0.15, 0.22, 0.42) : hc < 0.85 ? vec3(0.55, 0.32, 0.12) : vec3(0.42, 0.12, 0.16);
      vec3 ecru = vec3(0.88, 0.84, 0.74);
      bool striped = ihash(bid, key, 34) < 0.75;
      col = modern ? c1 : striped ? mix(ecru, c1, mix(0.5, step(0.5, fract(u / 0.5)), detail)) : ecru * 0.93;
      if (side == 0) {
        if (!modern) {
          float k = 2.0 * fract(u / 0.3) - 1.0;
          if (z < 0.1 * (1.0 - sqrt(max(0.0, 1.0 - k * k)))) discard;
          col = mix(col, c1, step(z, 0.16) * (striped ? 0.0 : 1.0));
        } else {
          float ink = word(signRow(trade, u_year, true), vec2(u - L * 0.5, z - 0.14), 0.34, L - 0.5, dp);
          col = mix(col, vec3(0.96, 0.95, 0.92), ink);
        }
      } else if (dot(V, N) < 0.0) {
        // Seen from below, daylight comes through the canvas.
        nrm = -N;
        col *= 0.82;
        ao = 1.15;
      }
    } else if (part == 5) {
      // Shopfront casing (a_a: x along it, z, its width, its top).
      int info = int(v_c.w + 0.5);
      int trade = info - (info / 32) * 32;
      int key = wid * 32 + info / 32;
      float W = L, top = flags, x = u;
      float hm = ihash(bid, key, 31);
      // Shopfronts were modernised mostly in the 1960s and 1970s; a few old ones survive.
      bool modern = u_year >= 1950.0 + 45.0 * hm * hm && ihash(bid, key, 32) >= 0.18;
      vec3 paint = shopColour(ihash(bid, key, 3));
      vec3 metal = vec3(0.24, 0.25, 0.26);
      float fz0 = top - 0.62;
      float pil = modern ? 0.09 : 0.24;
      if (side != 0) {
        col = modern ? metal : paint * 0.92;
      } else if (z > fz0) {
        // The fascia and its lettering.
        vec3 board = modern ? (ihash(bid, key, 35) < 0.5 ? paint * 1.35 : vec3(0.1, 0.1, 0.11)) : paint;
        col = board;
        if (!modern && z > top - 0.09) col = paint * 1.25;
        if (!modern && z < fz0 + 0.05) col = paint * 1.18;
        int cell = signRow(trade, u_year, modern);
        vec2 tp = vec2(x - W * 0.5, z - 0.5 * (fz0 + 0.05 + top - 0.09));
        float maxW = W - 2.0 * pil - 0.25;
        float ink = word(cell, tp, 0.62, maxW, dp);
        vec3 letters = modern ? vec3(0.96) : ihash(bid, key, 36) < 0.6 ? vec3(0.86, 0.68, 0.32) : vec3(0.93, 0.90, 0.80);
        if (!modern) col = mix(col, col * 0.4, word(cell, tp + vec2(-0.012, 0.012), 0.62, maxW, dp) * 0.7);
        col = mix(col, letters, ink * mix(0.6, 1.0, detail));
      } else if (x < pil || x > W - pil) {
        // Pilasters with a sunk panel.
        float px0 = x < pil ? x : W - x;
        col = modern ? metal : paint * (1.0 - 0.2 * rect(vec2(px0, z), vec2(0.06, 0.3), vec2(pil - 0.06, fz0 - 0.25), aa) * detail);
      } else {
        // Display windows and the shop door, set back behind the frame.
        float doorW = 0.95;
        float dpos = ihash(bid, key, 37);
        float dc = W < 2.6 ? W * 0.5 : dpos < 0.33 ? pil + doorW * 0.5 + 0.08 : dpos < 0.66 ? W * 0.5 : W - pil - doorW * 0.5 - 0.08;
        float riser = modern ? 0.12 : 0.62;
        bool inDoor = abs(x - dc) < doorW * 0.5;
        vec2 lo = inDoor ? vec2(dc - doorW * 0.5 + 0.05, 0.0) : vec2(pil, riser);
        vec2 hi = vec2(inDoor ? dc + doorW * 0.5 - 0.05 : W - pil, fz0 - 0.07);
        vec2 p = vec2(x, z);
        col = modern ? metal : paint;
        if (!modern && z < riser && !inDoor) col *= 1.0 - 0.2 * rect(vec2(fract((x - pil) / 0.85), z), vec2(0.12, 0.12), vec2(0.88, riser - 0.12), vec2(aa.x / 0.85, aa.y)) * detail;
        float cov = rect(p, lo, hi, aa);
        if (cov > 0.001) {
          vec4 r = recess(p, lo, hi, 0.12, vw);
          vec3 inside;
          float gl = 0.0;
          if (r.z < 1.5) {
            vec2 q = r.xy;
            float seg = (hi.x - lo.x) / max(1.0, floor((hi.x - lo.x) / 1.0));
            float mull = modern ? 0.0 : 1.0 - smoothstep(0.025, 0.025 + aa.x, abs(fract((q.x - lo.x) / seg + 0.5) - 0.5) * seg);
            float frame = 1.0 - rect(q, lo + 0.05, hi - 0.05, aa);
            float panel = inDoor && !modern && q.y < 0.95 ? 1.0 : 0.0;
            float bar = max(max(mull * (inDoor ? 0.0 : 1.0), frame), panel);
            // Behind the glass: a dim shop with goods on shelves; brighter and lit in modern shops.
            vec3 goods = shopColour(hash(floor(q * vec2(3.0, 5.0)) + float(bid))) * 0.7 + 0.15;
            // Modern shops are lit: pale shelves of goods, a bright back wall.
            float shelf = step(0.45, hash(floor(q * vec2(5.0, 6.0)) + float(key))) * step(q.y, 2.1) * (inDoor ? 0.0 : 1.0);
            vec3 room = modern ? mix(vec3(0.80, 0.76, 0.68), goods * 1.1, 0.6 * shelf) * (1.0 - 0.25 * step(0.85, fract(q.y / 0.45)) * shelf)
                               : mix(vec3(0.16, 0.13, 0.11), goods, step(0.5, hash(floor(q * vec2(6.0, 9.0)) + float(key))) * step(q.y, lo.y + 0.9) * (inDoor ? 0.0 : 0.7));
            inside = mix(room, modern ? metal : paint * 0.95, bar);
            gl = (1.0 - bar) * (modern ? 0.32 : 0.6);
            emissive = modern ? (1.0 - bar) * 0.5 : 0.0;
          } else {
            inside = (modern ? metal : paint) * (1.0 - 0.3 * r.w);
          }
          col = mix(col, inside, cov);
          glass = gl * cov;
          nrm = normalize(mix(N, recessNormal(r.z, N, T), cov));
          emissive *= cov;
        }
      }
    } else if (part == 6) {
      // Projecting signs (a_a: x out from the wall, y up, reach, height).
      int kind = int(v_c.z + 0.5);
      int trade = int(v_c.w + 0.5);
      float x = u, y = z, D = L, H = flags;
      vec3 iron = vec3(0.09, 0.09, 0.10);
      float a = 0.0;
      col = iron;
      if (kind < 7) {
        // The iron bracket: a bar from the wall and a stay below it.
        float bar = rect(vec2(x, y), vec2(0.0, H - 0.05), vec2(D, H - 0.01), aa);
        float sx = x / (D * 0.62);
        float stay = (1.0 - smoothstep(0.014, 0.014 + aa.y, abs(y - (H - 0.5 + 0.46 * sx)))) * step(sx, 1.0);
        a = max(bar, stay);
      }
      vec2 c = vec2(x - D * 0.58, y - (H - 0.08) * 0.5);
      float sh = 0.0;
      vec3 sc = col;
      if (kind == 0) {
        // A painted board hung from the bracket, with the trade written on it.
        vec2 lo = vec2(0.14, 0.06), hi = vec2(D - 0.04, H - 0.16);
        sh = rect(vec2(x, y), lo, hi, aa);
        vec3 bg = shopColour(ihash(bid, trade, 39));
        float border = 1.0 - rect(vec2(x, y), lo + 0.04, hi - 0.04, aa);
        float ink = word(signRow(trade, u_year, false), vec2(x - 0.5 * (lo.x + hi.x), y - 0.5 * (lo.y + hi.y)), 0.5, hi.x - lo.x - 0.12, dp);
        sc = mix(mix(bg, vec3(0.85, 0.68, 0.32), border), vec3(0.92, 0.86, 0.66), ink);
      } else if (kind == 1) {
        // A bunch of grapes (wine shops).
        vec2 g = vec2(c.x, y - (H - 0.2));
        float row = floor(-g.y / 0.1);
        float inRows = step(0.0, row) * step(row, 4.0);
        float halfW = 0.2 - row * 0.04;
        vec2 cell = vec2(fract((g.x + halfW) / 0.1) - 0.5, fract(-g.y / 0.1) - 0.5) * 0.1;
        sh = inRows * step(abs(g.x), halfW + 0.04) * (1.0 - smoothstep(0.045, 0.045 + aa.x, length(cell)));
        sc = mix(vec3(0.30, 0.10, 0.25), vec3(0.75, 0.62, 0.30), step(0.5, ihash(bid, trade, 40))) * (0.75 + 0.5 * (0.05 - length(cell + 0.015)) / 0.05);
      } else if (kind == 2) {
        // The barber's brass basin.
        float r = length(c);
        sh = (1.0 - smoothstep(0.22, 0.22 + aa.x, r)) * (1.0 - (1.0 - smoothstep(0.08, 0.08 + aa.x, length(c - vec2(0.0, 0.2)))));
        sc = vec3(0.80, 0.62, 0.28) * (0.8 + 0.4 * smoothstep(0.22, 0.0, r)) * (1.0 - 0.25 * step(abs(r - 0.15), 0.012));
      } else if (kind == 3 || kind == 7) {
        // The tobacconist's carrot: a red double cone; lit and flatter after about 1960.
        vec2 k = vec2(abs(c.x) / 0.15, abs(c.y) / 0.42);
        sh = 1.0 - smoothstep(1.0, 1.0 + aa.x * 6.0, k.x + k.y);
        sc = vec3(0.70, 0.10, 0.08) * (kind == 7 ? 1.25 : 0.85 + 0.3 * (1.0 - k.x));
        if (abs(c.y) < 0.03 || abs(abs(c.y) - 0.2) < 0.02) sc = kind == 7 ? vec3(0.95) : vec3(0.85, 0.68, 0.3);
        emissive = kind == 7 ? sh * 0.6 : 0.0;
      } else if (kind == 4) {
        // A flag sign with the name of the shop.
        vec2 lo = vec2(0.1, 0.0), hi = vec2(D, H - 0.12);
        sh = rect(vec2(x, y), lo, hi, aa);
        bool m = u_year > 1950.0;
        vec3 bg = trade == 5 ? vec3(0.12, 0.16, 0.36) : m ? vec3(0.62, 0.10, 0.10) : shopColour(ihash(bid, trade, 41));
        float border = 1.0 - rect(vec2(x, y), lo + 0.04, hi - 0.04, aa);
        float ink = word(signRow(trade, u_year, m), vec2(x - 0.5 * (lo.x + hi.x), y - 0.5 * (lo.y + hi.y)), 0.5, hi.x - lo.x - 0.1, dp);
        sc = mix(mix(bg, vec3(0.88, 0.80, 0.55), border), vec3(0.97, 0.94, 0.85), ink);
        emissive = m ? sh * 0.25 : 0.0;
      } else if (kind == 5 || kind == 8) {
        // The pharmacy cross; green neon after about 1960.
        vec2 k = abs(c);
        float arm = 0.24, w = 0.085;
        sh = max(rect(k, vec2(-1.0), vec2(w, arm), aa), rect(k, vec2(-1.0), vec2(arm, w), aa));
        float inner = max(rect(k, vec2(-1.0), vec2(w - 0.025, arm - 0.025), aa), rect(k, vec2(-1.0), vec2(arm - 0.025, w - 0.025), aa));
        sc = kind == 8 ? mix(vec3(0.85, 1.0, 0.85), vec3(0.1, 0.85, 0.3), inner) : mix(vec3(0.9), vec3(0.15, 0.55, 0.25), inner);
        emissive = kind == 8 ? sh : 0.0;
      } else if (kind == 6) {
        // A gilded horse head (horse butchers).
        vec2 k = c - vec2(0.0, 0.05);
        float head = 1.0 - smoothstep(1.0, 1.05, length(vec2(k.x - 0.08, k.y + 0.12) / vec2(0.09, 0.2)));
        float neck = 1.0 - smoothstep(1.0, 1.05, length(vec2(k.x + 0.03, k.y - 0.02) / vec2(0.13, 0.24)));
        float ear = rect(k, vec2(-0.02, 0.18), vec2(0.04, 0.3), aa);
        sh = max(max(head, neck), ear);
        sc = vec3(0.82, 0.64, 0.28) * (0.8 + 0.3 * noise(k * 20.0));
      }
      if (kind >= 7) a = 0.0;
      col = mix(col, sc, sh);
      a = max(a, sh);
      if (a < 0.5) discard;
      nrm = N;
    }
  }
  vec3 view = normalize(V);
  float fres = pow(1.0 - max(dot(N, view), 0.0), 2.0);
  col = mix(col, mix(vec3(0.10, 0.12, 0.14), vec3(0.50, 0.58, 0.66), 0.25 + 0.5 * fres), glass * detail);
  float light = 0.62 + 0.48 * max(dot(nrm, u_sun), 0.0);
  light *= mix(0.74, 1.0, smoothstep(0.0, 3.0, v_world.z));
  col *= mix(light * ao, 1.0, emissive);
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a * railAlpha);
}
`

/* ------------------------------------------------------------- ground */

export const groundVertex = /* glsl */ `
${common}
attribute vec4 a_a;
varying vec3 v_world;
varying float v_kind;
void main() {
  v_world = position;
  v_kind = a_a.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const groundFragment = /* glsl */ `
${common}
${roadSurface}
varying vec3 v_world;
varying float v_kind;
void main() {
  vec2 p = v_world.xy;
  vec2 aa = fwidth(p) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.03, 0.12, max(aa.x, aa.y));
  // The roadway of the year (streetshaders.ts): setts, macadam or asphalt. Bridge decks are main roads.
  vec3 col = roadSurface(p, aa, detail, v_kind > 0.5 ? 1.0 : 0.0);
  // Dirt and wear at a larger scale.
  col *= 0.88 + 0.2 * noise(p * 0.08) - 0.06 * noise(p * 0.9);
  if (v_kind > 0.5) col *= 1.04; // bridge decks
  col *= 0.6 + 0.48 * max(u_sun.z, 0.0);
  float a = edgeFade(p) * 0.97;
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- water */

export const waterFragment = /* glsl */ `
${common}
varying vec3 v_world;
varying float v_kind;
void main() {
  vec2 p = v_world.xy;
  // Ripples: a perturbed normal from two scales of noise.
  float e = 0.6;
  float h0 = noise(p * 0.35) + 0.5 * noise(p * 1.3 + 4.0);
  float hx = noise((p + vec2(e, 0.0)) * 0.35) + 0.5 * noise((p + vec2(e, 0.0)) * 1.3 + 4.0);
  float hy = noise((p + vec2(0.0, e)) * 0.35) + 0.5 * noise((p + vec2(0.0, e)) * 1.3 + 4.0);
  vec3 n = normalize(vec3((h0 - hx) * 0.5, (h0 - hy) * 0.5, 1.0));
  vec3 view = normalize(u_camera - v_world);
  float fres = 0.15 + 0.85 * pow(1.0 - max(dot(n, view), 0.0), 4.0);
  vec3 deep = vec3(0.24, 0.32, 0.31);
  vec3 sky = vec3(0.70, 0.76, 0.80);
  vec3 col = mix(deep, sky, fres * 0.7);
  float spec = pow(max(dot(reflect(-u_sun, n), view), 0.0), 60.0);
  col += vec3(1.0, 0.96, 0.88) * spec * 0.5;
  float a = edgeFade(p);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- gardens */

export const gardenVertex = /* glsl */ `
${common}
${lifeVertex}
varying vec3 v_world;
void main() {
  v_world = position;
  gl_Position = alive() ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

export const gardenFragment = /* glsl */ `
${common}
varying vec3 v_world;
void main() {
  vec2 p = v_world.xy;
  // Lawn: fine blades, patches of darker and drier grass.
  vec3 col = mix(vec3(0.33, 0.45, 0.20), vec3(0.42, 0.52, 0.25), noise(p * 0.35));
  col *= 0.86 + 0.24 * noise(p * 6.0) - 0.1 * noise(p * 0.08 + 7.0);
  col *= 0.6 + 0.48 * max(u_sun.z, 0.0);
  if (edgeFade(p) < 0.5) discard;
  gl_FragColor = vec4(haze(col, v_world), 1.0);
}
`

/* ------------------------------------------------------------- trees */

// Per tree: a_tree = (x, y, height, group), a_tree2 = (planted, seed, girth cm, in a garden).
// Groups: 0 plane, 1 horse chestnut, 2 poplar, 3 lime, 4 other broadleaf, 5 small ornamental, 6 conifer.
const treeCommon = /* glsl */ `
attribute vec4 a_tree;
attribute vec4 a_tree2;
// How grown a tree is: young when planted, full size after about 40 years.
float growth() { return clamp((u_year - a_tree2.x + 3.0) / 40.0, 0.3, 1.0); }
bool planted() { return u_year >= a_tree2.x; }
// Crown radii (horizontal, vertical) as fractions of the height.
vec2 crownShape(float g) {
  if (g < 0.5) return vec2(0.34, 0.30);
  if (g < 1.5) return vec2(0.36, 0.33);
  if (g < 2.5) return vec2(0.15, 0.42);
  if (g < 3.5) return vec2(0.30, 0.33);
  if (g < 4.5) return vec2(0.30, 0.30);
  if (g < 5.5) return vec2(0.44, 0.38);
  return vec2(0.24, 0.46);
}
`

export const crownVertex = /* glsl */ `
${common}
${treeCommon}
varying vec3 v_world;
varying vec3 v_n;
varying float v_h;
varying float v_group;
varying float v_seed;
void main() {
  if (!planted()) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float H = a_tree.z * growth();
  float g = a_tree.w;
  float seed = a_tree2.y;
  vec2 r = crownShape(g);
  vec3 p = normalize(position);
  // A lumpy crown, different for every tree.
  float lump = 1.0 + 0.15 * sin(p.x * 5.0 + seed * 6.3) * sin(p.y * 4.0 + seed * 3.1) * sin(p.z * 6.0 + seed * 9.7)
                   + 0.07 * sin(p.x * 11.0 + p.z * 7.0 + seed * 17.0);
  vec3 q = p * lump;
  float spread = r.x * H;
  if (g > 5.5) spread *= 1.0 - 0.85 * (q.z * 0.5 + 0.5); // conifers: a cone
  vec3 world = vec3(a_tree.x + q.x * spread, a_tree.y + q.y * spread, H * (1.0 - r.y) + q.z * r.y * H);
  v_world = world;
  v_n = p;
  v_h = p.z;
  v_group = g;
  v_seed = seed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

export const crownFragment = /* glsl */ `
${common}
varying vec3 v_world;
varying vec3 v_n;
varying float v_h;
varying float v_group;
varying float v_seed;
void main() {
  vec3 w = v_world;
  float coarse = noise(vec2(w.x * 0.9 + w.z * 0.6, w.y * 0.9 - w.z * 0.5) + v_seed * 13.0);
  float fine = noise(vec2(w.x * 3.1 + w.z * 2.3, w.y * 3.1 - w.z * 1.9) + v_seed * 7.0);
  float px = length(fwidth(w));
  // Leaves: small clumps that only show up close, where they would not shimmer.
  float leaves = noise(vec2(w.x * 9.0 + w.z * 6.0, w.y * 9.0 - w.z * 7.0) + v_seed * 3.0);
  float near = 1.0 - smoothstep(0.03, 0.12, px);
  fine = mix(fine, fine * 0.55 + leaves * 0.45, near);
  vec3 view = normalize(u_camera - w);
  float rim = 1.0 - abs(dot(v_n, view));
  // Ragged edges up close; a solid silhouette far away.
  if (px < 0.3 && fine < rim * 0.5 - 0.06) discard;
  float g = v_group;
  vec3 leaf = g < 0.5 ? vec3(0.36, 0.48, 0.22) : g < 1.5 ? vec3(0.25, 0.38, 0.17) : g < 2.5 ? vec3(0.38, 0.50, 0.26)
            : g < 3.5 ? vec3(0.39, 0.50, 0.21) : g < 5.5 ? vec3(0.33, 0.45, 0.22) : vec3(0.18, 0.30, 0.20);
  vec3 col = leaf * (0.72 + 0.5 * coarse) * (0.88 + 0.24 * fine);
  col *= 1.0 - 0.3 * near * smoothstep(0.55, 0.2, leaves); // shadowed gaps between the clumps
  vec3 n = normalize(v_n + vec3(coarse - 0.5, fine - 0.5, 0.0) * 0.8);
  float light = 0.5 + 0.55 * max(dot(n, u_sun), 0.0);
  light *= mix(0.62, 1.08, v_h * 0.5 + 0.5); // the underside of the crown is in shade
  col *= light;
  if (edgeFade(w.xy) < 0.5) discard;
  gl_FragColor = vec4(haze(col, w), 1.0);
}
`

export const trunkVertex = /* glsl */ `
${common}
${treeCommon}
varying vec3 v_world;
varying vec3 v_n;
varying float v_group;
void main() {
  if (!planted()) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float grow = growth();
  float H = a_tree.z * grow;
  float g = a_tree.w;
  // Cylinder geometry: y is up, from -0.5 to 0.5.
  float t = position.y + 0.5;
  float girth = a_tree2.z > 0.0 ? a_tree2.z / 100.0 : 0.12 * a_tree.z;
  float radius = max(0.06, girth / 6.283 * grow) * (1.0 - 0.4 * t);
  float trunkH = H * (1.0 - crownShape(g).y * 1.4);
  vec3 world = vec3(a_tree.x + position.x * radius, a_tree.y + position.z * radius, t * trunkH);
  v_world = world;
  v_n = normalize(vec3(position.x, position.z, 0.0));
  v_group = g;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

export const trunkFragment = /* glsl */ `
${common}
varying vec3 v_world;
varying vec3 v_n;
varying float v_group;
void main() {
  vec3 col;
  if (v_group < 0.5) {
    // Plane trees shed their bark in patches: cream, olive and grey.
    float patches = noise(vec2(atan(v_n.y, v_n.x) * 2.0, v_world.z * 1.6) + v_world.xy * 3.0);
    col = mix(vec3(0.55, 0.53, 0.42), vec3(0.78, 0.75, 0.62), smoothstep(0.35, 0.65, patches));
  } else {
    float furrow = noise(vec2(atan(v_n.y, v_n.x) * 5.0, v_world.z * 0.8));
    col = vec3(0.30, 0.26, 0.22) * (0.8 + 0.35 * furrow);
  }
  col *= 0.55 + 0.5 * max(dot(v_n, u_sun), 0.0);
  if (edgeFade(v_world.xy) < 0.5) discard;
  gl_FragColor = vec4(haze(col, v_world), 1.0);
}
`

// A soft shadow on the ground under each tree, cast away from the sun.
export const treeShadowVertex = /* glsl */ `
${common}
${treeCommon}
varying vec2 v_p;
varying vec3 v_world;
void main() {
  if (!planted()) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float H = a_tree.z * growth();
  float R = crownShape(a_tree.w).x * H * 1.15;
  vec2 away = -normalize(u_sun.xy) * H * 0.45;
  v_p = position.xy;
  // Above the pavements (15 cm, streets.ts) so street trees keep their shadow.
  vec3 world = vec3(a_tree.xy + away + position.xy * 2.0 * R, 0.17);
  v_world = world;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

export const treeShadowFragment = /* glsl */ `
${common}
varying vec2 v_p;
varying vec3 v_world;
void main() {
  float a = (1.0 - smoothstep(0.15, 0.5, length(v_p))) * 0.32 * edgeFade(v_world.xy);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.05, 0.07, 0.04, a);
}
`

/**
 * A shader with its \`#ifdef NAME ... #endif\` blocks kept for the names
 * given and cut out for the others, before the driver sees it: a smaller
 * program for each family of walls, whatever the driver's preprocessor does.
 */
export function shaderVariant(source: string, enabled: string[]): string {
  return source.replace(/^#ifdef (WALL_\w+)\n([\s\S]*?)^#endif\n/gm, (_all, name: string, body: string) => (enabled.includes(name) ? body : ''))
}
