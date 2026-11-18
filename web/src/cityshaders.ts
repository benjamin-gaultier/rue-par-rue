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
import { landmarkFacades } from './landmarkshaders'

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

/* ------------------------------------------------------------- walls */

export const wallVertex = /* glsl */ `
${common}
${lifeVertex}
attribute vec4 a_a;
attribute vec4 a_b;
varying vec4 v_a;
varying vec4 v_b;
varying vec3 v_normal;
varying vec3 v_world;
void main() {
  v_a = a_a;
  v_b = a_b;
  v_normal = normal;
  v_world = position;
  gl_Position = alive() ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

export const wallFragment = /* glsl */ `
${common}
varying vec4 v_a;
varying vec4 v_b;
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

${landmarkFacades}
${institutionFacades}

void main() {
  float u = v_a.x, z = v_a.y, L = v_a.z, flags = v_a.w;
  float st = v_b.x, seed = v_b.y, eave = v_b.z, fh = v_b.w;
  // Hash an integer id, not the interpolated seed: tiny float differences flip hashes pixel by pixel.
  float sid = floor(seed * 997.0 + 0.5);
  vec2 aa = fwidth(vec2(u, z)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.06, 0.3, max(aa.x, aa.y));

  vec3 wall;
  if (st < 0.5) {
    wall = seed < 0.3 ? vec3(0.86, 0.80, 0.68) : seed < 0.55 ? vec3(0.78, 0.70, 0.57) : seed < 0.8 ? vec3(0.79, 0.78, 0.74) : vec3(0.84, 0.73, 0.62);
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
  } else if (st > 19.5) {
    vec4 f = landmarkFacade(st, u, z, L, eave, seed, v_world, v_normal, aa);
    col = f.rgb;
    glass = f.a;
  } else if (st > 9.5) {
    vec4 f = institutionFacade(st, u, z, L, eave, seed, v_world, v_normal, aa);
    col = f.rgb;
    glass = f.a;
  } else if (st > 6.5 && st < 7.5) {
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
  } else if (st > 3.5 && st < 4.5) {
    // Bridges: arches between piers, cut out of the side walls.
    float n = eave, landEnd = fh;
    float span = (L - 2.0 * landEnd) / n;
    float i = clamp(floor((u - landEnd) / span), 0.0, n - 1.0);
    float du = u - (landEnd + (i + 0.5) * span);
    float hw = span * 0.5 - 1.8;
    float spring = -4.4, crown = -1.4;
    float e = (du / hw) * (du / hw) + ((z - spring) / (crown - spring)) * ((z - spring) / (crown - spring));
    bool opening = u > landEnd && u < L - landEnd && abs(du) < hw && (z < spring || e < 1.0);
    if (opening) discard;
    float voussoir = (z > spring && e < 1.35 && abs(du) < hw + 0.8) ? 0.9 : 1.0;
    col *= voussoir;
    float course = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.55) - 0.5) - 0.46);
    col *= 1.0 - 0.15 * course * detail;
    if (z > 0.0) col *= 1.1;
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
  } else if (L > 1.6) {
    float bw = L / max(1.0, floor(L / bayWidth(st, seed)));
    float bayIdx = floor(u / bw);
    float bu = u - (bayIdx + 0.5) * bw;
    float groundH = st < 0.5 ? 3.3 : st < 1.5 ? 4.3 : 3.6;
    float n = max(0.0, floor((eave - groundH - 0.4) / fh + 0.3));
    float fhE = n > 0.0 ? (eave - groundH - 0.4) / n : 1.0;
    vec3 iron = vec3(0.12, 0.12, 0.13);

    if (z > groundH && z < eave - 0.4 && n > 0.0) {
      float k = floor((z - groundH) / fhE);
      float fz = z - groundH - k * fhE;
      float ww = st < 0.5 ? 0.95 : st < 1.5 ? 1.25 : 1.5;
      float sill = st < 1.5 && st > 0.5 ? fhE * 0.12 : fhE * 0.24;
      float wh = st < 1.5 && st > 0.5 ? fhE * 0.7 : fhE * 0.58;
      vec2 p = vec2(bu, fz);
      float win = rect(p, vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + wh), aa);
      float frame = rect(p, vec2(-ww * 0.5 - 0.12, sill - 0.1), vec2(ww * 0.5 + 0.12, sill + wh + 0.12), aa) - win;
      col = mix(col, wall * 1.08, frame * detail);
      // Old houses: some windows have painted shutters folded back.
      if (st < 0.5 && hash(vec2(bayIdx, sid + 13.0)) < 0.45) {
        float sh = rect(vec2(abs(bu), fz), vec2(ww * 0.5 + 0.14, sill), vec2(ww + 0.12, sill + wh), aa);
        vec3 shutter = hash(vec2(sid, 2.0)) < 0.5 ? vec3(0.30, 0.38, 0.30) : vec3(0.52, 0.47, 0.40);
        col = mix(col, shutter, sh * detail);
      }
      glass = win;
      // Haussmann: continuous balconies on the 2nd and 5th floors, railings elsewhere.
      if (st > 0.5 && st < 1.5) {
        bool balcony = k == 1.0 || k == 4.0;
        float railTop = sill + 0.95;
        float band = balcony ? rect(vec2(u, fz), vec2(-1.0, sill), vec2(L + 1.0, railTop), aa) : rect(p, vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + 0.85), aa);
        float bars = smoothstep(0.42, 0.5, abs(fract(u / 0.13) - 0.5)) + rect(vec2(u, fz), vec2(-1.0, railTop - 0.07), vec2(L + 1.0, railTop), aa);
        col = mix(col, iron, clamp(band * bars, 0.0, 1.0) * 0.85 * detail);
        if (balcony) col = mix(col, wall * 0.6, rect(vec2(u, fz), vec2(-1.0, sill - 0.12), vec2(L + 1.0, sill), aa) * detail);
        // String course at each floor.
        col = mix(col, wall * 1.1, rect(vec2(u, fz), vec2(-1.0, 0.0), vec2(L + 1.0, 0.12), aa) * detail);
      }
    } else if (z <= groundH) {
      if (st < 0.5 || st > 1.5) {
        // Shopfronts: painted wooden fronts with a fascia, or a house door.
        float h = hash(vec2(bayIdx * 7.1, sid + 31.0));
        if (h < 0.25 || bw < 1.8) {
          float door = rect(vec2(bu, z), vec2(-0.55, 0.0), vec2(0.55, 2.4), aa);
          col = mix(col, vec3(0.28, 0.19, 0.12), door * detail);
        } else {
          vec3 paint = shopColour(hash(vec2(bayIdx, sid + 5.0)));
          float front = rect(vec2(bu, z), vec2(-bw * 0.5 + 0.25, 0.0), vec2(bw * 0.5 - 0.25, groundH - 0.25), aa);
          float pane = rect(vec2(bu, z), vec2(-bw * 0.5 + 0.45, 0.6), vec2(bw * 0.5 - 0.45, groundH - 0.95), aa);
          float doorway = rect(vec2(bu, z), vec2(-0.45, 0.0), vec2(0.45, groundH - 0.95), aa);
          col = mix(col, paint, front * detail);
          glass = max(pane, doorway * 0.8);
        }
      } else {
        // Haussmann ground floor: rusticated stone, tall arched openings.
        float groove = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.5) - 0.5) - 0.45);
        col *= 1.0 - 0.2 * groove * detail;
        float hw = bw * 0.5 - 0.55;
        float spring = groundH - 1.5;
        float arch = rect(vec2(bu, z), vec2(-hw, 0.0), vec2(hw, spring), aa);
        float crown = 1.0 - smoothstep(hw - aa.x, hw + aa.x, length(vec2(bu, (z - spring) * 1.4)));
        glass = max(arch, crown * step(spring, z));
      }
    } else if (z >= eave - 0.4 && z <= eave) {
      // Cornice.
      col *= z > eave - 0.15 ? 1.12 : 0.82;
    }
    // A small attic window in the gable of old houses.
    if (st < 0.5 && z > eave + 0.5) {
      float attic = rect(vec2(u - L * 0.5, z), vec2(-0.35, eave + 0.6), vec2(0.35, eave + 1.5), aa);
      glass = max(glass, attic * step(4.0, L) * step(L, 10.0));
    }
  }

  // Glass: dark, with the sky reflected toward the top of each pane.
  vec3 view = normalize(u_camera - v_world);
  float fres = pow(1.0 - max(dot(normalize(v_normal), view), 0.0), 2.0);
  vec3 pane = mix(vec3(0.10, 0.12, 0.14), vec3(0.50, 0.58, 0.66), 0.25 + 0.5 * fres);
  col = mix(col, pane, glass * detail);
  // Far away, windows blend into a darker average.
  col = mix(col, col * 0.86, (1.0 - detail) * step(flags, 0.5) * step(st, 2.5) * step(1.6, L) * step(3.0, z));

  vec3 n = normalize(v_normal);
  float light = 0.62 + 0.48 * max(dot(n, u_sun), 0.0);
  light *= mix(0.74, 1.0, smoothstep(0.0, 3.0, st > 3.5 ? z + 6.5 : z));
  col *= light;
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- roofs */

export const roofVertex = wallVertex

export const roofFragment = /* glsl */ `
${common}
varying vec4 v_a;
varying vec4 v_b;
varying vec3 v_normal;
varying vec3 v_world;

void main() {
  float u = v_a.x, v = v_a.y, L = v_a.z, slopeLen = v_a.w;
  float mat = v_b.x, kind = v_b.y, st = v_b.z, seed = v_b.w;
  float sid = floor(seed * 997.0 + 0.5);
  vec2 aa = fwidth(vec2(u, v)) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.05, 0.25, max(aa.x, aa.y));
  vec3 col;
  float tone = 0.9 + 0.2 * hash(vec2(sid, 1.0));

  if (mat < 0.5) {
    // Clay tiles in staggered courses, each a little different.
    col = vec3(0.62, 0.34, 0.23) * tone;
    float row = floor(v / 0.27);
    vec2 cell = vec2(floor(u / 0.24 + row * 0.5), row);
    col *= 0.88 + 0.24 * hash(cell + sid * 0.37);
    float edge = smoothstep(0.0, aa.y * 2.0 + 0.01, fract(v / 0.27) - 0.86);
    col *= 1.0 - 0.3 * edge * detail;
    col = mix(col, vec3(0.42, 0.40, 0.30), 0.25 * noise(vec2(u, v) * 0.4 + seed * 9.0));
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
    // Chimney stacks: plaster, a dark band of pots at the top.
    col = vec3(0.80, 0.73, 0.63) * tone;
    if (v > slopeLen - 0.35) col = vec3(0.50, 0.30, 0.22);
  }

  // Mansard dormers, aligned with the windows of the facade below.
  if (kind > 0.5 && kind < 1.5 && L > 1.6) {
    float bw = L / max(1.0, floor(L / bayWidth(st, seed)));
    float bu = mod(u, bw) - bw * 0.5;
    float ww = st < 0.5 ? 0.8 : 1.0;
    float frame = rect(vec2(bu, v), vec2(-ww * 0.5 - 0.18, 0.35), vec2(ww * 0.5 + 0.18, 2.3), aa);
    float win = rect(vec2(bu, v), vec2(-ww * 0.5, 0.5), vec2(ww * 0.5, 2.0), aa);
    col = mix(col, vec3(0.88, 0.85, 0.80), frame * detail);
    col = mix(col, vec3(0.13, 0.15, 0.17), win * detail);
  }

  vec3 n = normalize(v_normal);
  float light = 0.55 + 0.55 * max(dot(n, u_sun), 0.0);
  col *= light;
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
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
varying vec3 v_world;
varying float v_kind;
void main() {
  vec2 p = v_world.xy;
  vec2 aa = fwidth(p) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.03, 0.12, max(aa.x, aa.y));
  // Sandstone setts in staggered rows.
  vec2 size = vec2(0.24, 0.15);
  float row = floor(p.y / size.y);
  vec2 q = vec2(p.x / size.x + row * 0.5, p.y / size.y);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  vec3 stone = mix(vec3(0.56, 0.53, 0.48), vec3(0.47, 0.45, 0.42), hash(cell));
  float joint = 1.0 - rect(f, vec2(0.08), vec2(0.92), aa / size * 1.5);
  vec3 col = mix(stone, vec3(0.30, 0.28, 0.25), joint * 0.8);
  col = mix(vec3(0.51, 0.49, 0.45), col, detail);
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
  vec3 world = vec3(a_tree.xy + away + position.xy * 2.0 * R, 0.08);
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
