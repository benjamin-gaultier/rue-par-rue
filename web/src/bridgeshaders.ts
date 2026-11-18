/**
 * The bridge branch of the wall shader (style 4): arches, piers, ironwork,
 * cables, railings and decks of each kind of bridge, by period. The layout
 * functions mirror bridges.ts (pierWidth, openings, archOf): change both.
 *
 * Bridge surfaces carry a = (u, z, L, part) and b = (4, kind, arches,
 * landEnd), except the deck: a = (along, z, across, 3), b = (4, kind,
 * width, length). Parts: 2 side wall, 3 deck, 4 pier or pylon, 5 vault,
 * 6 underside of an open deck. Kinds: 0 stone (16th-18th c.), 1 stone
 * (19th c.), 2 iron arch, 3 suspension, 4 timber, 5 stone with an iron
 * centre, 6 steel lattice, 7 steel girder, 8 wide central arch.
 */

export const bridgeFacades = /* glsl */ `
const float BRIDGE_WATER = -6.6;

bool bridgeIs(float kind, float k) { return abs(kind - k) < 0.5; }

float bridgePier(float kind, float spacing) {
  if (bridgeIs(kind, 0.0)) return clamp(spacing * 0.28, 2.5, 6.0);
  if (bridgeIs(kind, 1.0)) return clamp(spacing * 0.12, 1.6, 4.0);
  if (bridgeIs(kind, 4.0)) return clamp(spacing * 0.06, 0.8, 2.0);
  if (bridgeIs(kind, 3.0)) return 3.0;
  if (bridgeIs(kind, 5.0)) return clamp(spacing * 0.1, 3.0, 5.0);
  if (bridgeIs(kind, 8.0)) return clamp(spacing * 0.06, 2.5, 4.0);
  return clamp(spacing * 0.1, 2.0, 4.0);
}

// The opening at u along a side wall: (offset from its middle, half width,
// 1 for an iron arch). Half width < 0 on piers and on the banks.
vec3 bridgeOpening(float u, float L, float n, float e, float kind) {
  float S = L - 2.0 * e;
  float x = u - e;
  if (x < 0.0 || x > S) return vec3(0.0, -1.0, 0.0);
  float pier = n > 1.5 ? bridgePier(kind, S / n) : 0.0;
  float share = bridgeIs(kind, 5.0) ? 0.62 : bridgeIs(kind, 8.0) ? 0.76 : 0.0;
  if (share > 0.0 && abs(n - 3.0) < 0.5) {
    float centre = share * (S - 2.0 * pier);
    float side = (S - 2.0 * pier - centre) * 0.5;
    if (x < side) return vec3(x - side * 0.5, side * 0.5, 0.0);
    if (x > side + pier && x < side + pier + centre) return vec3(x - side - pier - centre * 0.5, centre * 0.5, bridgeIs(kind, 5.0) ? 1.0 : 0.0);
    if (x > S - side) return vec3(x - (S - side * 0.5), side * 0.5, 0.0);
    return vec3(0.0, -1.0, 0.0);
  }
  float bay = (S - (n - 1.0) * pier) / n;
  float i = min(floor(x / (bay + pier)), n - 1.0);
  float local = x - i * (bay + pier);
  if (local > bay) return vec3(0.0, -1.0, 0.0);
  return vec3(local - bay * 0.5, bay * 0.5, bridgeIs(kind, 2.0) ? 1.0 : 0.0);
}

// Crown and rise of an arch of half width hw.
vec2 bridgeArch(float kind, float hw, bool iron) {
  float crown = iron ? -1.1 : bridgeIs(kind, 0.0) ? -1.7 : bridgeIs(kind, 4.0) ? -1.1 : bridgeIs(kind, 8.0) ? -1.2 : -1.3;
  float k = iron ? 0.3 : bridgeIs(kind, 0.0) ? 1.0 : bridgeIs(kind, 4.0) ? 0.35 : bridgeIs(kind, 8.0) ? 0.3 : 0.5;
  return vec2(crown, max(0.5, min(hw * k, crown - (BRIDGE_WATER + 0.5))));
}

// Ashlar: courses of size (length, height), staggered; returns (joint, block tone).
vec2 bridgeAshlar(vec2 p, vec2 size, vec2 aa) {
  float row = floor(p.y / size.y);
  float x = p.x / size.x + row * 0.5;
  vec2 f = vec2(fract(x), fract(p.y / size.y));
  vec2 w = aa / size * 1.5 + vec2(0.025, 0.04);
  float joint = 1.0 - rect(f, w, 1.0 - w, aa / size);
  return vec2(joint, hash(vec2(floor(x), row)));
}

vec3 bridgeStone(float kind, float u, float z, vec2 aa, float detail) {
  bool old = bridgeIs(kind, 0.0) || bridgeIs(kind, 4.0);
  vec3 stone = old ? vec3(0.73, 0.68, 0.59) : bridgeIs(kind, 8.0) ? vec3(0.78, 0.75, 0.69) : vec3(0.80, 0.76, 0.67);
  vec2 a = bridgeAshlar(vec2(u, z), old ? vec2(0.85, 0.5) : vec2(1.25, 0.45), aa);
  stone *= (old ? 0.86 : 0.93) + (old ? 0.24 : 0.12) * a.y * detail;
  stone *= 1.0 - (old ? 0.22 : 0.15) * a.x * detail;
  stone *= 1.0 - 0.08 * noise(vec2(u * 0.35, z * 0.6) + kind * 3.0);
  // Damp near the water, lichen just above it.
  stone *= mix(0.58, 1.0, smoothstep(-6.4, -4.8, z));
  stone = mix(stone, vec3(0.36, 0.40, 0.30), 0.25 * (1.0 - smoothstep(-6.2, -5.4, z)));
  return stone;
}

// A cast-iron railing on a parapet (z 0 to 1).
bool bridgeRailing(float u, float z, vec2 aa) {
  if (z < 0.12 || z > 0.88) return true;
  float post = (0.5 - abs(fract(u / 2.4) - 0.5)) * 2.4;
  if (post < 0.09) return true;
  if (aa.x > 0.02) return mod(floor(gl_FragCoord.x), 3.0) < 1.0;
  float d = (0.5 - abs(fract(u / 0.16) - 0.5)) * 0.16;
  return d < 0.014 + aa.x * 0.5;
}

// The colour of a bridge surface. What is open (under arches, between
// cables, gaps in railings) is discarded.
vec3 bridgeSurface(float u, float z, float L, float part, float kind, float n, float e, vec3 world, vec3 normal, vec2 aa, float detail) {
  vec3 iron = bridgeIs(kind, 7.0) ? vec3(0.34, 0.41, 0.40) : vec3(0.19, 0.23, 0.22);
  vec3 wood = vec3(0.42, 0.33, 0.24);

  if (part > 2.5 && part < 3.5) {
    // Deck: u along, L across, n = width, e = length.
    float W = n, t = L;
    vec2 ad = fwidth(vec2(u, t)) * 0.8 + 1e-4;
    float dd = 1.0 - smoothstep(0.03, 0.12, max(ad.x, ad.y));
    if (bridgeIs(kind, 3.0) || bridgeIs(kind, 4.0) || bridgeIs(kind, 6.0)) {
      // Planks laid across.
      float joint = smoothstep(0.0, ad.x * 2.0 + 0.01, abs(fract(u / 0.24) - 0.5) - 0.44);
      vec3 c = vec3(0.50, 0.44, 0.36) * (0.85 + 0.25 * hash(vec2(floor(u / 0.24), floor(t / 3.0))));
      return c * (1.0 - 0.35 * joint * dd);
    }
    bool pavements = !bridgeIs(kind, 0.0);
    if (pavements && abs(t) > W * 0.5 - 2.6) {
      vec2 a = bridgeAshlar(vec2(u, t), vec2(1.0, 0.7), ad);
      vec3 c = vec3(0.66, 0.63, 0.58) * (1.0 - 0.18 * a.x * dd);
      return c * (abs(abs(t) - (W * 0.5 - 2.6)) < 0.15 ? 0.8 : 1.0);
    }
    if (bridgeIs(kind, 7.0)) return vec3(0.31, 0.31, 0.32) * (0.9 + 0.15 * noise(vec2(u, t) * 0.7));
    // Setts in staggered rows.
    vec2 size = vec2(0.24, 0.15);
    float row = floor(t / size.y);
    vec2 q = vec2(u / size.x + row * 0.5, t / size.y);
    vec3 stone = mix(vec3(0.57, 0.54, 0.49), vec3(0.48, 0.46, 0.43), hash(floor(q)));
    float joint = 1.0 - rect(fract(q), vec2(0.08), vec2(0.92), ad / size * 1.5);
    vec3 c = mix(stone, vec3(0.30, 0.28, 0.25), joint * 0.8);
    c = mix(vec3(0.52, 0.50, 0.46), c, dd);
    return c * (0.9 + 0.15 * noise(vec2(u, t) * 0.08));
  }

  if (part > 5.5) {
    // Underside of an open deck.
    return (bridgeIs(kind, 3.0) || bridgeIs(kind, 4.0) ? wood : iron) * 0.6;
  }

  if (part > 4.5) {
    // Vault under a masonry arch: courses running across, in shade.
    vec2 a = bridgeAshlar(vec2(L, u), vec2(1.0, 0.45), aa);
    return vec3(0.70, 0.66, 0.58) * (0.85 + 0.15 * a.y) * (1.0 - 0.2 * a.x * detail) * mix(0.6, 1.0, smoothstep(-6.4, -4.8, z));
  }

  if (part > 3.5) {
    // Piers, cutwaters and pylons.
    vec3 c = bridgeStone(kind, u, z, aa, detail);
    if (bridgeIs(kind, 3.0) && z > 7.4) c *= z > 8.3 ? 1.12 : 0.7;
    return c;
  }

  // Side walls.
  float S = L - 2.0 * e;
  float x = u - e;
  if (bridgeIs(kind, 3.0)) {
    // Suspension: deck fascia, a lattice railing, chains sagging between pylons, hangers.
    if (x < 0.0 || x > S) discard;
    float sp = S / n;
    float i = clamp(floor(x / sp), 0.0, n - 1.0);
    float m = (x - (i + 0.5) * sp) / (sp * 0.5);
    float cz = 1.3 + 6.3 * m * m;
    if (z < 0.0) return wood * (0.9 + 0.1 * step(0.5, fract(z / 0.35)));
    if (z < 1.0) {
      float d1 = abs(fract((x + z) / 0.9) - 0.5), d2 = abs(fract((x - z) / 0.9) - 0.5);
      if (z > 0.9 || z < 0.08 || max(d1, d2) > 0.47 - aa.x || aa.x > 0.03) return iron * 0.8;
      discard;
    }
    if (abs(z - cz) < 0.09 + aa.y) return iron * 0.75;
    // Hangers every 1.5 m; far away a sparse stipple instead of a dark veil.
    float hx = (0.5 - abs(fract(x / 1.5) - 0.5)) * 1.5;
    bool hanger = aa.x > 0.04 ? hx < 0.2 && mod(floor(gl_FragCoord.y), 3.0) < 1.0 : hx < 0.025 + aa.x * 0.7;
    if (z < cz && hanger) return iron * 0.75;
    discard;
  }
  if (bridgeIs(kind, 6.0)) {
    // Steel lattice footbridge: chords, posts and diagonals.
    if (x < 0.0 || x > S) discard;
    if (z < -0.3 || z > 3.0) return iron * 1.3;
    float panel = 2.8;
    float px = fract(x / panel);
    float t = (z + 0.3) / 3.3;
    float w = 0.12 / panel + aa.x / panel;
    if (min(px, 1.0 - px) < w || abs(px - t) < w * 1.3 || abs(px - (1.0 - t)) < w * 1.3) return iron * 1.3;
    discard;
  }
  if (bridgeIs(kind, 4.0)) {
    // Timber: a railing of posts and rails, a plank fascia, piles under the piers.
    if (x < 0.0 || x > S) return bridgeStone(kind, u, z, aa, detail);
    vec3 w = wood * (0.88 + 0.2 * noise(vec2(u * 0.3, z * 5.0)));
    if (z > 0.0) {
      float post = (0.5 - abs(fract(u / 2.0) - 0.5)) * 2.0;
      if (post < 0.08 || (z > 0.95) || abs(z - 0.5) < 0.05) return w;
      discard;
    }
    if (z > -1.1) return w * (1.0 - 0.25 * smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / 0.28) - 0.5) - 0.44));
    vec3 o = bridgeOpening(u, L, n, e, kind);
    if (o.y > 0.0) {
      vec2 ar = bridgeArch(kind, o.y, false);
      float spring = ar.x - ar.y;
      float ex = o.x / o.y, ez = (z - spring) / ar.y;
      float ox = o.x / (o.y + 0.45), oz = (z - spring) / (ar.y + 0.45);
      if (z > spring && ex * ex + ez * ez >= 1.0 && ox * ox + oz * oz < 1.0) return w * 0.85;
      discard;
    }
    float pile = (0.5 - abs(fract(u / 0.9) - 0.5)) * 0.9;
    if (pile < 0.2) return w * 0.8 * mix(0.6, 1.0, smoothstep(-6.4, -4.8, z));
    discard;
  }

  // Masonry, iron arches and steel girders between stone abutments.
  bool onSpan = x > 0.0 && x < S;
  if (bridgeIs(kind, 7.0) && onSpan) {
    float m = (x - S * 0.5) / (S * 0.5);
    if (z < -1.0 - 2.4 * m * m) discard;
    if (z > 0.0) {
      if (z > 0.9 || (0.5 - abs(fract(u / 0.13) - 0.5)) * 0.13 < 0.012 + aa.x * 0.5 || aa.x > 0.02) return iron * 1.1;
      discard;
    }
    return iron * (z > -0.25 ? 1.15 : 1.0) * (1.0 - 0.15 * step(0.96, fract(u / 4.0)));
  }
  vec3 o = bridgeOpening(u, L, n, e, kind);
  bool ironArch = o.z > 0.5;
  if (o.y > 0.0) {
    vec2 ar = bridgeArch(kind, o.y, ironArch);
    float rise = ar.y, spring = ar.x - ar.y;
    float ex = o.x / o.y, ez = (z - spring) / rise;
    float e1 = ex * ex + ez * ez;
    if (ironArch) {
      float t = clamp(o.y * 0.05, 0.6, 1.5);
      float ox = o.x / (o.y + t), oz = (z - spring) / (rise + t);
      float e2 = ox * ox + oz * oz;
      if (z > 0.0) {
        if (bridgeRailing(u, z, aa)) return iron;
        discard;
      }
      if (z > -0.95) return iron * (z > -0.2 ? 1.25 : 1.0);
      if (z > spring && e1 >= 1.0 && e2 < 1.0) return iron * (1.0 - 0.25 * step(0.92, fract(o.x / 1.2)));
      if (z > spring && e2 >= 1.0) {
        float d = (0.5 - abs(fract(o.x / 1.4) - 0.5)) * 1.4;
        if (d < 0.1 + aa.x) return iron * 0.9;
      }
      discard;
    }
    if (z < spring || e1 < 1.0) discard;
    // Voussoirs: a ring of wedge stones around the arch.
    float t = bridgeIs(kind, 0.0) ? 0.9 : 0.7;
    float ox = o.x / (o.y + t), oz = (z - spring) / (rise + t);
    if (z > spring && ox * ox + oz * oz < 1.0) {
      float ang = atan(ez, ex);
      float wedge = smoothstep(0.0, 0.08, abs(fract(ang * (o.y + rise) / 1.2) - 0.5) - 0.42);
      return bridgeStone(kind, u, z, aa, detail) * (0.95 - 0.2 * wedge * detail);
    }
  }
  vec3 c = bridgeStone(kind, u, z, aa, detail);
  if (z > 0.0) {
    // Parapet with a coping.
    c *= z > 0.82 ? 1.12 : 1.0;
  } else if (!bridgeIs(kind, 0.0) && z > -0.55) {
    // Cornice along the road (19th-century bridges).
    c *= z > -0.2 ? 1.15 : 0.82;
  }
  return c;
}
`
