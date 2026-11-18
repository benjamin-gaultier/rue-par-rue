/**
 * GLSL for period vehicles and boats (vehicles.ts): one instanced draw call
 * per type, the year checked per instance and per part, horses' legs
 * swinging while they move, spoked wheels cut out of a disc, and a soft
 * shadow under each street vehicle.
 *
 * The shared city uniforms (u_year, u_camera, u_sun, u_box, u_fog) come
 * from city3d.ts; hash(), noise(), edgeFade() and haze() are the same as in
 * cityshaders.ts, so vehicles fade out and haze over like the buildings.
 */

const common = /* glsl */ `
uniform float u_year;
uniform vec3 u_camera;
uniform vec3 u_sun;
uniform vec4 u_box;
uniform vec3 u_fog;
uniform float u_time;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float edgeFade(vec2 xy) {
  float d = min(min(xy.x - u_box.x, u_box.z - xy.x), min(xy.y - u_box.y, u_box.w - xy.y));
  return smoothstep(0.0, 70.0, d);
}
vec3 haze(vec3 col, vec3 world) {
  float d = length(world - u_camera);
  return mix(col, u_fog, smoothstep(350.0, 1800.0, d) * 0.85);
}
`

// Per instance: a_inst = (x, y, z, heading in radians), a_info = (from, until, seed, flags).
// Flags: 1 unhitched (no horse, no driver, the cart tipped onto its shafts), 2 moving.
const instance = /* glsl */ `
attribute vec4 a_inst;
attribute vec4 a_info;
bool shown() {
  return u_year >= a_info.x && u_year < a_info.y && a_inst.x < 1.0e6;
}
bool flag(float bit) { return mod(floor(a_info.w / bit), 2.0) > 0.5; }
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`

export const vehicleVertex = /* glsl */ `
${common}
${instance}
// Per vertex: colour, part (kind, a, b, c), years of the part.
attribute vec3 a_col;
attribute vec4 a_part;
attribute vec2 a_plife;
// Unhitched carts tip about their axle: (x, height, angle).
uniform vec3 u_tip;
uniform vec3 u_pal[8];
uniform vec3 u_pal2[8];
uniform vec2 u_palN;
varying vec3 v_world;
varying vec3 v_n;
varying vec3 v_col;
varying float v_kind;
varying vec2 v_uv;
float g_kind;
bool is(float k) { return abs(g_kind - k) < 0.5; }

// Horse coats: bay, dark bay, chestnut, grey, black, dun.
vec3 coat(float h) {
  if (h < 0.3) return vec3(0.36, 0.22, 0.13);
  if (h < 0.5) return vec3(0.22, 0.14, 0.09);
  if (h < 0.65) return vec3(0.5, 0.28, 0.14);
  if (h < 0.85) return vec3(0.66, 0.64, 0.6);
  if (h < 0.93) return vec3(0.1, 0.09, 0.08);
  return vec3(0.6, 0.48, 0.32);
}
// Drivers' clothes: the carter's blue smock, black, brown, grey.
vec3 clothes(float h) {
  if (h < 0.35) return vec3(0.18, 0.24, 0.42);
  if (h < 0.6) return vec3(0.09, 0.09, 0.1);
  if (h < 0.8) return vec3(0.3, 0.24, 0.18);
  return vec3(0.36, 0.36, 0.38);
}

void main() {
  g_kind = a_part.x;
  v_kind = a_part.x;
  bool unhitched = flag(1.0);
  bool moving = flag(2.0);
  bool horseOrDriver = is(3.0) || is(4.0) || is(7.0);
  if (!shown() || u_year < a_plife.x || u_year >= a_plife.y || (unhitched && horseOrDriver)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 p = position;
  vec3 n = normal;
  float seed = a_info.z;
  if (is(4.0) && moving) {
    // A walk: each leg swings about its top, front and hind pairs in opposite phase.
    float a = 0.42 * sin(u_time * 6.5 + (a_part.y + seed) * 6.2832);
    vec2 q = turn(vec2(p.x - a_part.w, p.z - a_part.z), a);
    p.x = a_part.w + q.x;
    p.z = a_part.z + q.y;
    n.xz = turn(n.xz, a);
  }
  if (unhitched) {
    // Shafts down on the cobbles.
    vec2 q = turn(vec2(p.x - u_tip.x, p.z - u_tip.y), -u_tip.z);
    p.x = u_tip.x + q.x;
    p.z = u_tip.y + q.y;
    n.xz = turn(n.xz, -u_tip.z);
  }
  float z = a_inst.z;
  if (z < -1.0) z += 0.05 * sin(u_time * 1.1 + seed * 40.0); // boats ride the swell
  vec2 xy = a_inst.xy + turn(p.xy, a_inst.w);
  vec3 world = vec3(xy, z + p.z);
  v_world = world;
  v_n = vec3(turn(n.xy, a_inst.w), n.z);
  v_uv = a_part.yz;
  vec3 col = a_col;
  if (is(1.0)) col *= u_pal[int(min(floor(fract(seed * 7.31) * u_palN.x), u_palN.x - 1.0))];
  else if (is(2.0)) col *= u_pal2[int(min(floor(fract(seed * 3.77 + 0.13) * u_palN.y), u_palN.y - 1.0))];
  else if (is(3.0) || is(4.0)) col *= coat(fract(seed * 13.7 + floor(a_part.y / 10.0) * 0.37));
  else if (is(7.0)) col *= clothes(fract(seed * 5.3 + 0.41));
  // The spoked wheels of a horse vehicle share its second colour when it has one.
  else if (is(5.0) && u_palN.y > 0.5 && a_col.r > 0.99) col = u_pal2[int(min(floor(fract(seed * 3.77 + 0.13) * u_palN.y), u_palN.y - 1.0))];
  v_col = col;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

export const vehicleFragment = /* glsl */ `
${common}
varying vec3 v_world;
varying vec3 v_n;
varying vec3 v_col;
varying float v_kind;
varying vec2 v_uv;
bool is(float k) { return abs(v_kind - k) < 0.5; }

void main() {
  if (edgeFade(v_world.xy) < 0.5) discard;
  vec3 col = v_col;
  vec3 n = normalize(v_n);
  vec3 view = normalize(u_camera - v_world);
  float shine = 0.0;
  if (is(5.0) || is(8.0)) {
    // Wheels: the disc coordinates run from the hub (0) to the rim (1).
    float r = length(v_uv);
    if (r > 0.97) discard;
    float px = length(fwidth(v_uv));
    if (is(5.0)) {
      float a = atan(v_uv.y, v_uv.x) / 6.2832 * 12.0;
      float spoke = abs(fract(a) - 0.5) * 2.0; // 1 on a spoke, 0 between two
      float lin = (1.0 - spoke) * 0.2618 * r; // distance to the nearest spoke, in wheel radii
      bool solid = r > 0.8 || r < 0.19 || lin < 0.05 + px;
      // Far away the spokes would shimmer: the disc turns into a dark blur instead.
      if (!solid && px < 0.25) discard;
      if (!solid) col *= 0.45;
      if (r > 0.9) col = vec3(0.15, 0.15, 0.16); // iron tyre
      else if (r < 0.19) col *= 0.75;
    } else {
      if (r > 0.64) col = vec3(0.08, 0.08, 0.09); // rubber
      else if (r < 0.22) col *= 0.7;
      else shine = 0.3;
    }
  } else if (is(6.0)) {
    // Glass: dark, with the sky in it at grazing angles.
    float f = pow(1.0 - abs(dot(n, view)), 3.0);
    col = mix(col, vec3(0.68, 0.74, 0.8), 0.15 + 0.6 * f);
    shine = 0.8;
  } else if (is(1.0) || is(2.0)) {
    shine = 0.35;
  }
  if (is(9.0)) {
    gl_FragColor = vec4(haze(col, v_world), 1.0);
    return;
  }
  float diffuse = max(dot(n, u_sun), 0.0);
  float sky = 0.5 + 0.2 * n.z;
  col *= sky + 0.6 * diffuse;
  float spec = pow(max(dot(reflect(-u_sun, n), view), 0.0), 24.0);
  col += vec3(1.0, 0.97, 0.9) * spec * shine * 0.35;
  gl_FragColor = vec4(haze(col, v_world), 1.0);
}
`

// A soft shadow on the street under each vehicle, a little away from the sun.
// a_dim = (length, width).
export const shadowVertex = /* glsl */ `
${common}
${instance}
attribute vec2 a_dim;
varying vec2 v_p;
varying vec3 v_world;
void main() {
  if (!shown()) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  v_p = position.xy;
  vec2 size = a_dim + vec2(0.9, 0.7);
  vec2 xy = a_inst.xy + turn(position.xy * size, a_inst.w) - normalize(u_sun.xy) * 0.5;
  vec3 world = vec3(xy, 0.07);
  v_world = world;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

export const shadowFragment = /* glsl */ `
${common}
varying vec2 v_p;
varying vec3 v_world;
void main() {
  vec2 d = abs(v_p);
  float a = (1.0 - smoothstep(0.25, 0.5, d.x)) * (1.0 - smoothstep(0.2, 0.5, d.y)) * 0.42 * edgeFade(v_world.xy);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.04, 0.04, 0.035, a);
}
`
