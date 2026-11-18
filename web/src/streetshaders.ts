/**
 * GLSL for the streets through time (streets.ts): the roadway surface by
 * year (also used by the ground shader in cityshaders.ts), raised pavements
 * and kerbs, flat decals on the roadway (gutters, crossings, road markings,
 * tree grates) and instanced street furniture.
 *
 * Everything is drawn procedurally and switches with the u_year uniform, so
 * dragging the year slider costs nothing.
 */

/** Uniforms and helpers shared with the city's shaders (same names as cityshaders.ts). */
const common = /* glsl */ `
uniform float u_year;
uniform vec3 u_camera;
uniform vec3 u_sun;
uniform vec4 u_box;
uniform vec3 u_fog;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
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
`

const lifeVertex = /* glsl */ `
attribute vec4 a_life;
bool alive() {
  return u_year >= a_life.x && u_year < a_life.y && !(u_year >= a_life.z && u_year < a_life.w);
}
`

/**
 * The roadway by year. Needs hash(), noise(), rect() and u_year.
 *
 * - Sandstone setts (grès) everywhere until 1970: in 1907 about 6 of Paris's
 *   10 million m² of roadway were still sandstone; granite setts mix in from 1900.
 * - Main roads (`main` = 1: quays, boulevards, bridges): macadam from 1860, asphalt from 1900.
 * - Asphalt everywhere from 1970, as the setts were tarred over after 1968.
 * The years are approximations; see HISTORY in rpr/sources/streets.py.
 */
export const roadSurface = /* glsl */ `
vec3 settsAt(vec2 p, vec2 size, vec3 c0, vec3 c1, vec3 granite, float graniteShare, vec2 aa, float detail) {
  float row = floor(p.y / size.y);
  vec2 q = vec2(p.x / size.x + row * 0.5, p.y / size.y);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash(cell);
  vec3 stone = mix(c0, c1, h);
  stone = mix(stone, granite * (0.9 + 0.2 * hash(cell + 7.0)), step(1.0 - graniteShare, hash(cell + 3.1)));
  // Worn, rounded tops: a little lighter in the middle of each stone.
  vec2 g = f - 0.5;
  stone *= 1.04 - 0.35 * dot(g, g);
  float joint = 1.0 - rect(f, vec2(0.08), vec2(0.92), aa / size * 1.5);
  vec3 col = mix(stone, vec3(0.28, 0.26, 0.23), joint * 0.8);
  return mix(mix(c0, c1, 0.5) * 0.96, col, detail);
}
vec3 macadamAt(vec2 p, float detail) {
  vec3 col = vec3(0.56, 0.52, 0.45);
  float grit = noise(p * 23.0) * 0.6 + noise(p * 61.0) * 0.4;
  col *= mix(1.0, 0.86 + 0.28 * grit, detail);
  col *= 0.9 + 0.12 * noise(p * 0.35);
  return col;
}
vec3 asphaltAt(vec2 p, float detail) {
  vec3 col = vec3(0.30, 0.30, 0.31);
  float grain = noise(p * 37.0) * 0.5 + noise(p * 97.0) * 0.5;
  col *= mix(1.0, 0.9 + 0.2 * grain, detail);
  // Patches of newer and older surfacing.
  float patchy = noise(p * 0.07 + 3.0);
  col *= 0.92 + 0.14 * smoothstep(0.45, 0.6, patchy);
  col *= 0.95 + 0.08 * noise(p * 0.6);
  return col;
}
vec3 roadSurface(vec2 p, vec2 aa, float detail, float main) {
  bool asphalt = u_year >= 1970.0 || (main > 0.5 && u_year >= 1900.0);
  bool macadam = !asphalt && main > 0.5 && u_year >= 1860.0;
  if (asphalt) return asphaltAt(p, detail);
  if (macadam) return macadamAt(p, detail);
  float granite = u_year >= 1900.0 ? 0.35 : 0.0;
  return settsAt(p, vec2(0.24, 0.16), vec3(0.58, 0.54, 0.47), vec3(0.47, 0.45, 0.41), vec3(0.47, 0.48, 0.50), granite, aa, detail);
}
`

/* ------------------------------------------------------------- pavements */

// a_d = (part, u, v, extra): see PART in streetgen.ts.
export const pavementVertex = /* glsl */ `
${common}
${lifeVertex}
attribute vec4 a_d;
varying vec4 v_d;
varying vec3 v_world;
varying vec3 v_normal;
void main() {
  v_d = a_d;
  v_world = position;
  v_normal = normal;
  gl_Position = alive() ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

export const pavementFragment = /* glsl */ `
${common}
varying vec4 v_d;
varying vec3 v_world;
varying vec3 v_normal;

// Rectangular slabs in staggered courses.
vec3 slabs(vec2 p, vec2 size, vec3 base, vec2 aa, float detail) {
  float row = floor(p.y / size.y);
  vec2 q = vec2(p.x / size.x + row * 0.37, p.y / size.y);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  vec3 col = base * (0.9 + 0.18 * hash(cell)) * (0.94 + 0.1 * noise(p * 3.0));
  float joint = 1.0 - rect(f, vec2(0.02), vec2(0.98), aa / size * 1.5);
  return mix(base, mix(col, base * 0.6, joint * 0.7), detail);
}

void main() {
  float part = v_d.x;
  vec2 p = v_world.xy;
  vec2 aa = fwidth(p) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.03, 0.12, max(aa.x, aa.y));
  vec3 col;
  if (part < 0.5) {
    // Granite and lava slabs of the first pavements (1845).
    col = slabs(p, vec2(0.95, 0.62), vec3(0.55, 0.55, 0.54), aa, detail);
  } else if (part < 1.5) {
    // Mastic asphalt, the Paris pavement since the 1840s.
    col = vec3(0.42, 0.41, 0.39) * mix(1.0, 0.9 + 0.2 * noise(p * 41.0), detail);
    col *= 0.93 + 0.1 * noise(p * 0.5) - 0.05 * smoothstep(0.55, 0.75, noise(p * 0.11 + 5.0));
  } else if (part < 2.5) {
    // Large squares (the parvis): pale stone slabs.
    col = slabs(p, vec2(1.2, 0.8), vec3(0.70, 0.67, 0.60), aa, detail);
  } else if (part < 3.5 || part < 4.5) {
    // Granite kerb: blocks about a metre long.
    float u = v_d.y;
    vec2 auv = fwidth(vec2(u, v_d.z)) + 1e-4;
    col = vec3(0.63, 0.62, 0.59) * (0.92 + 0.12 * hash(vec2(floor(u / 1.1), 2.0))) * (0.94 + 0.1 * noise(vec2(u, v_d.z) * 6.0));
    float joint = 1.0 - smoothstep(0.0, auv.x * 1.5 + 0.004, abs(fract(u / 1.1) - 0.5) * 1.1 - 0.53);
    col *= 1.0 - 0.35 * (1.0 - joint) * detail;
    if (part > 3.5) col *= mix(0.7, 1.0, smoothstep(0.0, 0.1, v_d.z)); // dirt at the foot of the kerb
    else col *= mix(0.92, 1.04, smoothstep(0.0, 0.25, v_d.z));
  } else {
    col = vec3(0.38, 0.37, 0.35);
  }
  vec3 n = normalize(v_normal);
  float light = n.z > 0.5 ? 0.6 + 0.48 * max(u_sun.z, 0.0) : 0.55 + 0.45 * max(dot(n, u_sun), 0.0);
  col *= light;
  float a = edgeFade(p);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- decals */

export const decalVertex = pavementVertex

export const decalFragment = /* glsl */ `
${common}
${roadSurface}
varying vec4 v_d;
varying vec3 v_world;
varying vec3 v_normal;

// Setts laid lengthwise along a strip: u along, w across (metres).
vec3 stripSetts(float u, float w, float rows, vec3 c0, vec3 c1, vec2 aa) {
  vec2 q = vec2(u / 0.22 + floor(w / 0.16) * 0.5, w / 0.16);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  vec3 stone = mix(c0, c1, hash(cell + rows));
  float joint = 1.0 - rect(f, vec2(0.08), vec2(0.92), aa / vec2(0.22, 0.16) * 1.5);
  return mix(stone, vec3(0.24, 0.22, 0.20), joint * 0.75);
}

void main() {
  float part = v_d.x;
  vec2 p = v_world.xy;
  vec2 aa = fwidth(p) * 0.8 + 1e-4;
  float detail = 1.0 - smoothstep(0.03, 0.12, max(aa.x, aa.y));
  vec3 view = normalize(u_camera - v_world);
  vec3 col;
  float alpha = 1.0;
  if (part < 10.5) {
    // Gutter along the kerb: setts laid lengthwise, wet near the kerb.
    float w = v_d.z * 0.38;
    vec2 a2 = fwidth(vec2(v_d.y, w)) * 0.8 + 1e-4;
    bool old = u_year < 1900.0;
    vec3 c0 = old ? vec3(0.52, 0.49, 0.43) : vec3(0.50, 0.50, 0.51);
    vec3 c1 = old ? vec3(0.43, 0.41, 0.37) : vec3(0.41, 0.42, 0.43);
    col = mix((c0 + c1) * 0.5, stripSetts(v_d.y, w, 1.0, c0, c1, a2), detail);
    float wet = 1.0 - smoothstep(0.05, 0.2, w);
    col *= 1.0 - 0.3 * wet;
    col += vec3(0.5, 0.55, 0.6) * wet * 0.25 * pow(1.0 - max(view.z, 0.0), 3.0);
    alpha = smoothstep(1.0, 0.85, v_d.z);
  } else if (part < 11.5) {
    // Central gutter of the old streets: a shallow stone channel with a trickle in it.
    float v = v_d.z;
    float w = (v + 1.0) * 0.45;
    vec2 a2 = fwidth(vec2(v_d.y, w)) * 0.8 + 1e-4;
    col = mix(vec3(0.46, 0.44, 0.40), stripSetts(v_d.y, w, 2.0, vec3(0.52, 0.49, 0.43), vec3(0.40, 0.38, 0.34), a2), detail);
    col *= 0.88 + 0.12 * v; // one slope toward the sun, the other away
    col *= 0.8 + 0.2 * smoothstep(0.0, 0.6, abs(v));
    float wet = 1.0 - smoothstep(0.08, 0.3, abs(v + 0.1 * sin(v_d.y * 0.7)));
    col = mix(col, vec3(0.20, 0.21, 0.19), wet * 0.6);
    col += vec3(0.55, 0.6, 0.62) * wet * 0.35 * pow(1.0 - max(view.z, 0.0), 3.0);
    alpha = 1.0 - smoothstep(0.75, 1.0, abs(v));
  } else if (part < 12.5) {
    // Pedestrian crossing: studs on its two sides until 1963, white bars after.
    float u = v_d.y, v = v_d.z, width = v_d.w;
    if (u_year < 1963.0) {
      float side = min(u, width - u);
      vec2 s = vec2(side - 0.25, mod(v, 0.55) - 0.275);
      float stud = 1.0 - smoothstep(0.065, 0.075 + aa.x, length(s));
      if (stud < 0.05) discard;
      col = vec3(0.78, 0.77, 0.73) * (0.85 + 0.3 * noise(p * 9.0));
      alpha = stud;
    } else {
      float bar = rect(vec2(fract(v / 1.1), u), vec2(0.0, 0.15), vec2(0.5, width - 0.15), vec2(fwidth(v) / 1.1, aa.x) * 1.5);
      float worn = smoothstep(0.25, 0.55, noise(p * 3.1)) * 0.5 + 0.5;
      if (bar < 0.05) discard;
      col = vec3(0.86, 0.86, 0.82) * (0.9 + 0.1 * noise(p * 20.0));
      alpha = bar * worn;
    }
  } else if (part < 13.5) {
    col = roadSurface(p, aa, detail, 1.0);
    col *= 0.88 + 0.2 * noise(p * 0.08) - 0.06 * noise(p * 0.9);
  } else if (part < 14.5) {
    // Dashed centre line: 3 m dashes, 10 m gaps.
    float dash = step(fract(v_d.y / 13.0), 3.0 / 13.0);
    if (dash < 0.5) discard;
    col = vec3(0.85, 0.85, 0.80);
    alpha = (1.0 - smoothstep(0.7, 1.0, abs(v_d.z))) * (0.75 + 0.25 * noise(p * 4.0));
  } else {
    // Round cast-iron grate around a tree: rings and spokes over dark soil.
    vec2 q = v_d.yz;
    float r = length(q) / v_d.w;
    float ang = atan(q.y, q.x);
    float ring = smoothstep(0.35, 0.45, abs(fract(r * 6.0) - 0.5) * 2.0);
    float spoke = smoothstep(0.7, 0.85, abs(fract(ang / 6.2831853 * 24.0) - 0.5) * 2.0);
    float iron = max(ring, spoke) * step(0.28, r);
    col = mix(vec3(0.16, 0.13, 0.10), vec3(0.13, 0.14, 0.13), iron);
    col = mix(vec3(0.15, 0.14, 0.12), col, detail);
    alpha = 1.0 - smoothstep(0.92, 1.0, r);
  }
  col *= 0.6 + 0.48 * max(u_sun.z, 0.0);
  float a = edgeFade(p) * alpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`

/* ------------------------------------------------------------- furniture */

/**
 * Model variants. Each vertex of a furniture model carries a_part =
 * variant * 16 + material; an instance draws the parts of the variant its type
 * has in the year shown (variantOf), so a lantern turns from oil to gas as the
 * slider moves. Variant numbers match VARIANT in streets.ts.
 */
const furnitureCommon = /* glsl */ `
float variantOf(float t) {
  if (t < 0.5) return u_year < 1850.0 ? 0.0 : 1.0;   // old-street lantern: oil on a rope, then gas on a bracket
  if (t < 1.5) return 2.0;                           // oil lantern on a post and arm
  if (t < 2.5) return 3.0;                           // candelabra
  if (t < 3.5) return 4.0;                           // functional pole
  if (t < 4.5) return u_year < 1960.0 ? 5.0 : 6.0;   // wall lamp
  if (t < 5.5) return 7.0;                           // kerb stone
  if (t < 6.5) return 8.0;                           // bollard
  if (t < 7.5) return u_year < 1847.0 ? 9.0 : 10.0;  // street plaque: engraved stone, then blue enamel
  if (t < 8.5) return u_year < 1868.0 ? 11.0 : 12.0; // Rambuteau column, then Morris column
  if (t < 9.5) return 13.0;                          // vespasienne
  if (t < 10.5) return 14.0;                         // Wallace fountain
  if (t < 11.5) return 15.0;                         // kiosk
  return 16.0;                                       // bench
}
`

export const furnitureVertex = /* glsl */ `
${common}
${furnitureCommon}
attribute float a_part;
attribute vec4 a_inst;   // x, y, angle (radians), parameter
attribute vec4 a_ilife;
attribute float a_type;
varying vec3 v_world;
varying vec3 v_normal;
varying vec3 v_local;
varying float v_mat;
void main() {
  float variant = floor(a_part / 16.0 + 0.01);
  float mat = a_part - variant * 16.0;
  bool alive = u_year >= a_ilife.x && u_year < a_ilife.y && !(u_year >= a_ilife.z && u_year < a_ilife.w);
  if (!alive || abs(variant - variantOf(a_type)) > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 p = position;
  float k = a_inst.w;
  if (abs(mat - 6.0) < 0.5) p.x *= k;                               // rope across the street
  if (abs(variant - 1.0) < 0.5) p.x += k;                           // bracket on the facade
  if (abs(variant - 3.0) < 0.5) p *= k / 4.0;                       // candelabra height
  if (abs(variant - 4.0) < 0.5) p.z *= k / 8.0;                     // pole height
  if (variant > 4.5 && variant < 6.5) p.z += k - 4.6;              // wall lamp height
  v_local = p;
  float c = cos(a_inst.z), s = sin(a_inst.z);
  vec3 w = vec3(a_inst.x + c * p.x - s * p.y, a_inst.y + s * p.x + c * p.y, p.z);
  v_world = w;
  v_normal = vec3(c * normal.x - s * normal.y, s * normal.x + c * normal.y, normal.z);
  v_mat = mat;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`

export const furnitureFragment = /* glsl */ `
${common}
varying vec3 v_world;
varying vec3 v_normal;
varying vec3 v_local;
varying float v_mat;
void main() {
  float m = v_mat;
  vec3 col;
  vec3 q = v_local;
  vec3 n = normalize(v_normal);
  if (m < 0.5) col = vec3(0.11, 0.19, 0.14);                       // Paris green cast iron
  else if (m < 1.5) {                                              // lantern glass
    vec3 view = normalize(u_camera - v_world);
    float fres = pow(1.0 - abs(dot(n, view)), 2.0);
    col = mix(vec3(0.62, 0.62, 0.55), vec3(0.85, 0.88, 0.9), fres);
  }
  else if (m < 2.5) col = vec3(0.70, 0.67, 0.60) * (0.9 + 0.15 * noise(q.xz * 9.0 + q.y * 3.0)); // stone
  else if (m < 3.5) {                                              // bench slats
    col = vec3(0.20, 0.31, 0.21) * (0.85 + 0.2 * step(0.5, fract(q.y * 1.0 + q.z * 12.0)));
  }
  else if (m < 4.5) col = vec3(0.47, 0.49, 0.52);                   // galvanised steel
  else if (m < 5.5) col = vec3(0.07, 0.07, 0.07);                   // dark openings
  else if (m < 6.5) col = vec3(0.24, 0.20, 0.15);                   // rope
  else if (m < 7.5) col = vec3(0.24, 0.21, 0.18);                   // bollard iron
  else if (m < 8.5) {                                              // engraved stone plaque
    col = vec3(0.80, 0.76, 0.67);
    vec2 t = vec2(q.y, q.z - 3.52);
    float letters = step(0.5, hash(floor(vec2(t.x / 0.07, 0.0)))) * step(abs(t.y), 0.05) * step(abs(t.x), 0.36);
    col = mix(col, vec3(0.18, 0.16, 0.14), letters * 0.85);
  } else if (m < 9.5) {                                            // blue enamel plaque, green frame
    vec2 t = vec2(q.y, q.z - 3.525);
    float frame = step(0.27, abs(t.x)) + step(0.105, abs(t.y));
    float border = step(0.255, abs(t.x)) + step(0.09, abs(t.y));
    col = vec3(0.07, 0.16, 0.42);
    col = mix(col, vec3(0.90, 0.90, 0.88), clamp(border, 0.0, 1.0));
    col = mix(col, vec3(0.12, 0.30, 0.20), clamp(frame, 0.0, 1.0));
    float letters = step(0.45, hash(floor(vec2(t.x / 0.045, 1.0)))) * step(abs(t.y), 0.035) * step(abs(t.x), 0.22);
    col = mix(col, vec3(0.92, 0.92, 0.9), letters);
  } else if (m < 10.5) {                                           // posters on a column or kiosk
    float ang = atan(q.y, q.x);
    vec2 cell = floor(vec2(ang * 2.2, q.z * 1.6));
    float h = hash(cell);
    col = h < 0.25 ? vec3(0.78, 0.66, 0.36) : h < 0.5 ? vec3(0.72, 0.30, 0.22) : h < 0.75 ? vec3(0.85, 0.82, 0.74) : vec3(0.25, 0.35, 0.50);
    col *= 0.85 + 0.2 * noise(vec2(ang * 30.0, q.z * 20.0));
  } else if (m < 11.5) col = vec3(0.80, 0.80, 0.78);                // lamp head
  else col = vec3(0.08, 0.08, 0.09);                                // black iron
  float light = 0.55 + 0.5 * max(dot(n, u_sun), 0.0);
  col *= light;
  if (edgeFade(v_world.xy) < 0.5) discard;
  gl_FragColor = vec4(haze(col, v_world), 1.0);
}
`
