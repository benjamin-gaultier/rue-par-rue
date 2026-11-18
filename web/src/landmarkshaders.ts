/**
 * Facades of landmark buildings, drawn by the wall shader for styles 20 and
 * up (the landmarks module gives buildings these styles in `prepare`, and
 * draws its own walls with them), and the shader of the landmarks' props:
 * bronze, gilt, the clock dial, canvas.
 *
 * Styles (the same numbers as LM in landmarkgen.ts and STYLE in
 * rpr/sources/landmarks.py):
 *   20 Sainte-Chapelle, sides and apse    28 place Dauphine, brick and stone
 *   21 Sainte-Chapelle, west front        29 the morgue
 *   22 medieval towers                    30 flower-market pavilions of 1873
 *   23 Conciergerie (gothic)              31 flower-market pavilions of 1924
 *   24 Palais de Justice (classical)      32 plain dressed stone
 *   25 Tribunal de commerce               33 Duc's front on the rue de Harlay
 *   26 Préfecture de police               34 lead openwork of a spire
 *   27 Hôtel-Dieu
 *
 * Runs inside the city's wall fragment shader, so rect(), pointed(),
 * noise() and hash() are in scope. Returns the colour and how much of it is
 * glass (the wall shader mixes reflections into the glass).
 */

export const landmarkFacades = /* glsl */ `
float lmCourse(float z, float h, vec2 aa) {
  return smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / h) - 0.5) - 0.47);
}

// Stained glass seen from outside in daylight: dark, with a hint of its blues and reds.
vec3 lmStained(vec2 p, vec2 aa) {
  vec2 cell = floor(p / vec2(0.34, 0.42));
  float h = hash(cell);
  vec3 c = h < 0.45 ? vec3(0.09, 0.12, 0.30) : h < 0.75 ? vec3(0.30, 0.07, 0.08) : h < 0.9 ? vec3(0.28, 0.22, 0.08) : vec3(0.08, 0.20, 0.13);
  vec2 f = fract(p / vec2(0.34, 0.42));
  float lead = 1.0 - rect(f, vec2(0.06), vec2(0.94), aa / vec2(0.34, 0.42) * 1.5);
  c = mix(c, vec3(0.05), lead * 0.7);
  float far = smoothstep(0.03, 0.12, max(aa.x, aa.y));
  return mix(c, vec3(0.12, 0.11, 0.17), far);
}

// A window of n lights under a pointed arch: 1 on the mullions and the tracery of the head.
float lmTracery(vec2 p, float hw, float zs, float n, vec2 aa) {
  float lw = 2.0 * hw / n;
  float fx = mod(p.x + hw, lw);
  float mull = (1.0 - smoothstep(0.05, 0.05 + aa.x, min(fx, lw - fx))) * step(p.y, zs);
  float r = length(vec2(p.x, p.y - zs - hw * 0.55));
  float ring = 1.0 - smoothstep(0.05, 0.05 + aa.x, abs(r - hw * 0.5));
  float ang = atan(p.y - zs - hw * 0.55, p.x);
  float spokes = (1.0 - smoothstep(0.05, 0.05 + aa.x, r * abs(sin(ang * 3.0)))) * step(r, hw * 0.5);
  // Iron saddle bars every 0.9 m: 1 within a few centimetres of each.
  float bars = 1.0 - smoothstep(0.02, 0.02 + aa.y, 0.45 - abs(fract(p.y / 0.9) - 0.5) * 0.9);
  return clamp(mull + (ring + spokes) * step(zs, p.y) + bars * 0.5 * step(p.y, zs), 0.0, 1.0);
}

// A round-arched opening of half-width hw from z0, springing at zs.
float lmArch(vec2 p, float hw, float z0, float zs, vec2 aa) {
  float sides = rect(p, vec2(-hw, z0), vec2(hw, zs), aa);
  float top = (1.0 - smoothstep(hw - aa.x, hw + aa.x, length(vec2(p.x, p.y - zs)))) * step(zs, p.y);
  return max(sides, top);
}

// A balustrade band h high, dz above its foot: balusters on a dark ground.
// Takes heights within the band, not z and its bounds: callers test z against
// the same bounds, and those repeated tests send Direct3D's shader compiler
// (Chrome and Edge on Windows) into endless recursion, which crashes the GPU process.
vec3 lmBalustrade(vec3 col, float u, float dz, float h, vec2 aa) {
  if (dz < 0.0 || dz > h) return col;
  float t = dz / h;
  if (t < 0.18 || t > 0.82) return col * 1.08;
  float bx = abs(fract(u / 0.32) - 0.5);
  float w = 0.17 + 0.12 * sin(t * 3.14159);
  return mix(col * 0.45, col * 1.05, smoothstep(w + 0.04, w - 0.02, bx));
}

vec4 lmChapel(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.86, 0.82, 0.72) * (0.95 + 0.08 * noise(vec2(u * 0.5, z * 0.3)));
  vec3 col = stone * (1.0 - 0.1 * lmCourse(z, 0.5, aa) * detail);
  float glass = 0.0;
  float x = u - L * 0.5;
  if (z > eave) {
    // Gablet over the window: a trefoil roundel, crockets along the rake.
    float h = z - eave;
    float r = length(vec2(x, h - min(1.3, L * 0.22)));
    float rr = min(0.6, L * 0.12);
    col = mix(col, stone * 0.5, (1.0 - smoothstep(rr - 0.05, rr + aa.x, r)) * step(rr * 0.55, r));
    col *= 0.92 + 0.1 * step(0.5, fract((h + abs(x)) / 0.5));
  } else if (z > eave - 1.2) {
    col = lmBalustrade(col, u, z - (eave - 1.2), 1.1, aa);
    if (z > eave - 0.1) col *= 1.1;
  } else if (z > 9.0) {
    float hw = L * 0.5 - (L > 4.0 ? 0.55 : 0.35);
    float zs = eave - 1.5 - hw * 1.55;
    float frame = pointed(vec2(x, z), hw + 0.22, 9.0, zs, (hw + 0.22) * 1.9, aa);
    float win = pointed(vec2(x, z), hw, 9.3, zs, hw * 1.9, aa);
    col = mix(col, stone * 0.68, (frame - win) * detail);
    float tr = lmTracery(vec2(x, z), hw, zs, L > 4.0 ? 4.0 : 2.0, aa) * detail;
    col = mix(col, lmStained(vec2(u, z), aa), win * (1.0 - tr));
    col = mix(col, stone * 0.8, win * tr);
    glass = win * (1.0 - tr) * 0.2;
  } else if (z > 7.6) {
    col *= z > 8.5 ? 1.08 : 0.88;
  } else {
    // The lower chapel: small pointed windows with a trefoil.
    float hw = min(0.75, L * 0.18);
    float win = pointed(vec2(x, z), hw, 2.6, 5.3, hw * 1.8, aa);
    col = mix(col, stone * 0.62, pointed(vec2(x, z), hw + 0.18, 2.4, 5.3, (hw + 0.18) * 1.8, aa) * detail);
    col = mix(col, lmStained(vec2(u, z), aa) * 0.9, win);
    glass = win * 0.3;
    col *= z < 0.7 ? 0.82 : 1.0;
  }
  return vec4(col, glass);
}

vec4 lmChapelFront(float u, float z, float L, float eave, float porchH, vec2 aa, float detail) {
  vec3 stone = vec3(0.86, 0.82, 0.72) * (0.95 + 0.08 * noise(vec2(u * 0.5, z * 0.3)));
  vec3 col = stone * (1.0 - 0.1 * lmCourse(z, 0.5, aa) * detail);
  vec3 dark = vec3(0.17, 0.15, 0.14);
  float glass = 0.0;
  float x = u - L * 0.5;
  if (z < porchH) {
    if (z < 7.4) {
      // The lower porch: open pointed arches between piers (three across the front).
      float n = L > 8.0 ? 3.0 : 1.0;
      float bw = L / n;
      float bx = mod(u, bw) - bw * 0.5;
      float hw = bw * 0.5 - 0.65;
      col = mix(col, stone * 0.7, pointed(vec2(bx, z), hw + 0.3, 0.0, 4.4, (hw + 0.3) * 1.6, aa) * detail);
      col = mix(col, dark, pointed(vec2(bx, z), hw, 0.0, 4.4, hw * 1.6, aa));
    } else if (z < 8.6) {
      col *= z < 8.0 ? 0.8 : 1.1;
    } else if (z < porchH - 1.3) {
      // The upper porch: a taller arcade of pointed openings.
      float n = L > 8.0 ? 3.0 : 1.0;
      float bw = L / n;
      float bx = mod(u, bw) - bw * 0.5;
      float hw = bw * 0.5 - 0.6;
      float top = porchH - 1.6;
      col = mix(col, dark * 1.4, pointed(vec2(bx, z), hw, 9.0, top - hw * 1.3, hw * 1.7, aa));
      col = mix(col, stone * 0.85, lmTracery(vec2(bx, z), hw, top - hw * 1.3, 2.0, aa) * pointed(vec2(bx, z), hw, 9.0, top - hw * 1.3, hw * 1.7, aa) * detail);
    } else {
      col = lmBalustrade(col, u, z - (porchH - 1.3), 1.3, aa);
    }
  } else if (z < eave) {
    // The rose (flamboyant, late 15th century) in a square frame.
    float zc = (porchH + eave) * 0.5 + 0.4;
    vec2 q = vec2(x, z - zc);
    float R = min(min(4.6, L * 0.36), (eave - porchH) * 0.5 - 0.5);
    float r = length(q);
    col = mix(col, stone * 0.9, rect(q, vec2(-R - 0.7), vec2(R + 0.7), aa));
    col = mix(col, stone * 0.66, (1.0 - smoothstep(R + 0.25, R + 0.3 + aa.x, r)) * step(R, r));
    float inside = 1.0 - smoothstep(R - aa.x, R + aa.x, r);
    float ang = atan(q.y, q.x);
    // Flame-shaped tracery: curved spokes and two rings.
    float flame = abs(sin(ang * 12.0 + r * 1.2));
    float tr = (1.0 - smoothstep(0.05, 0.05 + aa.x, r * flame / 12.0)) * step(R * 0.3, r);
    tr = max(tr, 1.0 - smoothstep(0.06, 0.09 + aa.x, abs(r - R * 0.3)));
    tr = max(tr, 1.0 - smoothstep(0.06, 0.09 + aa.x, abs(r - R * 0.66)));
    tr *= detail;
    col = mix(col, lmStained(q, aa), inside * (1.0 - tr));
    col = mix(col, stone * 0.8, inside * tr);
    glass = inside * (1.0 - tr) * 0.2;
  } else {
    // The gable: a balustrade at its foot, blind tracery above.
    col = lmBalustrade(col, u, z - (eave - 0.2), 1.1, aa);
    if (z > eave + 1.2) {
      float g = pointed(vec2(x, z), L * 0.2, eave + 1.6, eave + 4.5, L * 0.35, aa);
      col = mix(col, stone * 0.74, g * detail);
      col = mix(col, stone * 0.5, (1.0 - smoothstep(0.7, 0.75 + aa.x, length(vec2(x, z - eave - 6.8)))) * step(0.45, length(vec2(x, z - eave - 6.8))) * detail);
    }
  }
  col *= z < 0.6 ? 0.85 : 1.0;
  return vec4(col, glass);
}

vec4 lmTower(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.77, 0.73, 0.65) * (0.92 + 0.12 * noise(vec2(u * 0.3, z * 0.2)));
  float row = floor(z / 0.45);
  float vj = abs(fract(u / 0.9 + row * 0.5) - 0.5);
  vec3 col = stone * (1.0 - 0.13 * lmCourse(z, 0.45, aa) * detail);
  col *= 1.0 - 0.08 * smoothstep(0.46, 0.5, vj) * detail;
  float glass = 0.0;
  if (z > eave + 0.05) {
    // Battlements above the wall walk: merlons, and gaps you see through.
    if (fract(u / 2.1) < 0.4) discard;
    col *= 1.04;
  } else if (z > eave - 2.2) {
    // Machicolations: corbels with dark slots between, under the parapet.
    float c = fract(u / 0.85);
    float corbel = step(0.25, c) * step(c, 0.75);
    if (z < eave - 1.3) col = mix(col * 0.32, col * 0.95, max(corbel, smoothstep(eave - 1.6, eave - 1.3, z)));
    else col *= 1.06;
  } else if (z > 5.0) {
    // Slit windows, staggered from storey to storey.
    float lvl = floor(z / 5.5);
    float zz = z - lvl * 5.5;
    float sp = L / max(1.0, floor(L / 6.5));
    float xi = mod(u + lvl * sp * 0.5, sp) - sp * 0.5;
    float slit = rect(vec2(xi, zz), vec2(-0.3, 1.6), vec2(0.3, 3.4), aa);
    col = mix(col, stone * 0.7, rect(vec2(xi, zz), vec2(-0.45, 1.45), vec2(0.45, 3.65), aa) * detail);
    col = mix(col, vec3(0.1, 0.09, 0.09), slit);
    glass = slit * 0.25;
  }
  col *= z < 1.0 ? 0.84 : 1.0;
  return vec4(col, glass);
}

vec4 lmConciergerie(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.80, 0.76, 0.67) * (0.94 + 0.1 * noise(vec2(u * 0.4, z * 0.2)));
  vec3 col = stone * (1.0 - 0.12 * lmCourse(z, 0.5, aa) * detail);
  float glass = 0.0;
  if (L < 2.0) return vec4(col, 0.0);
  float bw = L / max(1.0, floor(L / 5.2));
  float bx = mod(u, bw) - bw * 0.5;
  // Buttress strips between the bays.
  col *= abs(bx) > bw * 0.5 - 0.45 ? 1.05 : 1.0;
  if (z > eave - 1.4) {
    col *= z > eave - 0.3 ? 1.1 : 0.9 + 0.15 * step(0.5, fract(u / 1.4));
  } else if (z < 8.5) {
    // The great gothic halls at ground level: tall pointed windows.
    float win = pointed(vec2(bx, z), 0.95, 1.6, 6.3, 1.7, aa);
    col = mix(col, stone * 0.66, pointed(vec2(bx, z), 1.2, 1.4, 6.3, 2.1, aa) * detail);
    float mull = (1.0 - smoothstep(0.05, 0.05 + aa.x, abs(bx))) * step(z, 6.3);
    col = mix(col, stone * 0.8, win * mull * detail);
    glass = win * (1.0 - mull * detail);
  } else {
    // Mullioned and transomed windows on the floors above, under hood moulds.
    float fz = mod(z - 8.5, 4.4);
    float win = rect(vec2(bx, fz), vec2(-0.8, 0.9), vec2(0.8, 3.4), aa);
    float cross = max(1.0 - smoothstep(0.05, 0.05 + aa.x, abs(bx)), 1.0 - smoothstep(0.05, 0.05 + aa.y, abs(fz - 2.4)));
    col = mix(col, stone * 1.1, rect(vec2(bx, fz), vec2(-1.0, 3.45), vec2(1.0, 3.7), aa) * detail);
    col = mix(col, stone * 0.85, win * cross * detail);
    glass = win * (1.0 - cross * detail);
    col *= fz < 0.25 ? 0.9 : 1.0;
  }
  return vec4(col, glass);
}

// Classical stone fronts: ground floor, upper floors of height fh, bays of width bw.
vec4 lmClassical(float u, float z, float L, float eave, vec3 stone, float bwWanted, float groundH, float fh, float arched, vec2 aa, float detail) {
  vec3 col = stone * (1.0 - 0.08 * lmCourse(z, 0.55, aa) * detail);
  float glass = 0.0;
  if (L < 2.0) return vec4(col, 0.0);
  float bw = L / max(1.0, floor(L / bwWanted));
  float bx = mod(u, bw) - bw * 0.5;
  if (z > eave - 1.0) {
    // Cornice: a shadow under a lit projecting moulding.
    col *= z < eave - 0.7 ? 0.7 : z < eave - 0.35 ? 1.12 : 0.95;
  } else if (z < groundH) {
    // Rusticated ground floor with arched openings.
    float groove = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.5) - 0.5) - 0.45);
    col *= 1.0 - 0.2 * groove * detail;
    float hw = min(bw * 0.5 - 0.6, 1.1);
    float win = arched > 0.5 ? lmArch(vec2(bx, z), hw, 0.4, groundH - 1.0 - hw, aa) : rect(vec2(bx, z), vec2(-hw, 0.8), vec2(hw, groundH - 1.0), aa);
    glass = win;
  } else if (z < groundH + 0.5) {
    col *= 1.1;
  } else {
    float n = max(1.0, floor((eave - 1.0 - groundH - 0.5) / fh + 0.3));
    float fhE = (eave - 1.0 - groundH - 0.5) / n;
    float k = floor((z - groundH - 0.5) / fhE);
    float fz = z - groundH - 0.5 - k * fhE;
    float ww = min(0.75, bw * 0.25);
    float wh = fhE * (k < 0.5 ? 0.66 : 0.56);
    float sill = fhE * 0.16;
    float win = rect(vec2(bx, fz), vec2(-ww, sill), vec2(ww, sill + wh), aa);
    float frame = rect(vec2(bx, fz), vec2(-ww - 0.18, sill - 0.12), vec2(ww + 0.18, sill + wh + 0.18), aa) - win;
    col = mix(col, stone * 1.08, frame * detail);
    // Pediments over the first-floor windows.
    float ped = rect(vec2(bx, fz), vec2(-ww - 0.3, sill + wh + 0.25), vec2(ww + 0.3, sill + wh + 0.45), aa) * step(k, 0.5);
    col = mix(col, stone * 1.12, ped * detail);
    col = mix(col, stone * 0.8, rect(vec2(bx, fz), vec2(-ww - 0.3, sill + wh + 0.18), vec2(ww + 0.3, sill + wh + 0.25), aa) * step(k, 0.5) * detail);
    glass = win;
    col *= fz < 0.15 ? 1.08 : 1.0;
  }
  return vec4(col, glass);
}

// The Palais's classical wings: flat pilasters between the bays above the ground floor.
vec4 lmPalais(float u, float z, float L, float eave, float seed, vec2 aa, float detail) {
  vec3 stone = vec3(0.85, 0.81, 0.72) * (0.95 + 0.08 * hash(vec2(floor(seed * 997.0), 7.0)));
  vec4 f = lmClassical(u, z, L, eave, stone, 4.4, 5.5, 4.6, 1.0, aa, detail);
  if (L > 2.0 && z > 6.0 && z < eave - 1.0) {
    float bw = L / max(1.0, floor(L / 4.4));
    float cx = abs(mod(u + bw * 0.5, bw) - bw * 0.5);
    float pil = 1.0 - smoothstep(0.32, 0.32 + aa.x, cx);
    f.rgb = mix(f.rgb, stone * (cx > 0.26 ? 0.86 : 1.08), pil * detail);
    f.a *= 1.0 - pil;
  }
  return f;
}

vec4 lmHarlay(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.86, 0.82, 0.73) * (0.96 + 0.06 * noise(vec2(u * 0.3, z * 0.2)));
  vec3 col = stone * (1.0 - 0.08 * lmCourse(z, 0.55, aa) * detail);
  float glass = 0.0;
  if (L < 6.0) return lmClassical(u, z, L, eave, stone, 4.4, 5.5, 4.6, 1.0, aa, detail);
  float bw = L / max(1.0, floor(L / 5.4));
  float bx = mod(u, bw) - bw * 0.5;
  float cx = abs(mod(u + bw * 0.5, bw) - bw * 0.5); // distance to the nearest column axis
  if (z > eave - 3.4) {
    // Entablature: frieze, then the cornice.
    col *= z < eave - 2.6 ? 1.08 : z < eave - 1.0 ? 0.98 : z < eave - 0.7 ? 0.72 : 1.12;
  } else if (z < 6.2) {
    // High basement, rusticated, with small square windows.
    col *= 1.0 - 0.2 * smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.6) - 0.5) - 0.44) * detail;
    glass = rect(vec2(bx, z), vec2(-0.6, 2.4), vec2(0.6, 4.2), aa);
  } else if (z < 7.0) {
    col *= z < 6.5 ? 0.8 : 1.12;
  } else {
    // A colossal order of engaged, fluted columns ("Egyptian Doric"), tall windows between.
    float col1 = 1.0 - smoothstep(0.62, 0.62 + aa.x, cx);
    float flute = 0.9 + 0.1 * step(0.5, fract(cx / 0.16));
    vec3 c2 = stone * (1.05 + 0.08 * (0.62 - cx)) * flute;
    float capital = step(eave - 4.4, z);
    col = mix(col, capital > 0.5 ? stone * 1.12 : c2, col1);
    float hw = bw * 0.5 - 1.25;
    float win = rect(vec2(bx, z), vec2(-hw, 8.4), vec2(hw, eave - 5.6), aa) * (1.0 - col1);
    float mull = max(1.0 - smoothstep(0.08, 0.08 + aa.x, abs(bx)), 1.0 - smoothstep(0.08, 0.08 + aa.y, abs(mod(z - 8.4, 3.2) - 0.0)));
    col = mix(col, stone * 0.9, win * mull * detail);
    glass = win * (1.0 - mull * detail);
  }
  return vec4(col, glass);
}

vec4 lmTribunal(float u, float z, float L, float eave, float seed, vec2 aa, float detail) {
  vec3 stone = vec3(0.85, 0.80, 0.70) * (0.96 + 0.06 * noise(vec2(u * 0.3, z * 0.2)));
  if (seed > 0.95) {
    // The dome's drum and lantern: one round-arched window per face, pilasters at the corners.
    vec3 col = stone * (1.0 - 0.08 * lmCourse(z, 0.55, aa) * detail);
    float x = u - L * 0.5;
    float h = eave - (z - 0.0);
    col *= abs(x) > L * 0.5 - 0.4 ? 1.08 : 1.0;
    float hw = L * 0.22;
    float top = eave - 1.2;
    float bottom = top - min(5.0, L * 1.1);
    float win = lmArch(vec2(x, z), hw, bottom, top - hw, aa);
    col = mix(col, stone * 1.1, (lmArch(vec2(x, z), hw + 0.2, bottom - 0.2, top - hw, aa) - win) * detail);
    col *= h < 0.6 ? 1.1 : 1.0;
    return vec4(col, win);
  }
  vec4 f = lmClassical(u, z, L, eave, stone, 4.6, 5.4, 4.8, 1.0, aa, detail);
  // Engaged columns framing the bays of the main floor.
  if (L > 2.0 && z > 5.9 && z < 5.9 + 6.0 && z < eave - 1.0) {
    float bw = L / max(1.0, floor(L / 4.6));
    float cx = abs(mod(u + bw * 0.5, bw) - bw * 0.5);
    float c = 1.0 - smoothstep(0.3, 0.3 + aa.x, cx);
    f.rgb = mix(f.rgb, stone * (1.1 - 0.15 * cx), c * detail);
    f.a *= 1.0 - c;
  }
  return f;
}

vec4 lmDauphine(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.87, 0.83, 0.74);
  vec3 brick = vec3(0.60, 0.30, 0.22) * (0.9 + 0.2 * hash(floor(vec2(u / 0.22 + floor(z / 0.075) * 0.5, z / 0.075))));
  brick = mix(brick, vec3(0.56, 0.32, 0.25), smoothstep(0.02, 0.08, max(aa.x, aa.y)));
  float mortar = smoothstep(0.0, aa.y * 2.0 + 0.003, abs(fract(z / 0.075) - 0.5) - 0.38);
  brick = mix(brick, vec3(0.72, 0.68, 0.6), mortar * 0.5 * detail);
  float glass = 0.0;
  if (L < 2.0) return vec4(stone, 0.0);
  float bw = L / max(1.0, floor(L / 3.3));
  float bx = mod(u, bw) - bw * 0.5;
  float cx = abs(mod(u + bw * 0.5, bw) - bw * 0.5);
  vec3 col = brick;
  if (z < 4.2) {
    // Stone arcade at ground level, shops behind the arches.
    col = stone * (1.0 - 0.12 * lmCourse(z, 0.5, aa) * detail);
    glass = lmArch(vec2(bx, z), bw * 0.5 - 0.5, 0.0, 4.2 - bw * 0.5 - 0.1, aa);
  } else if (z > eave - 0.6) {
    col = stone * (z > eave - 0.25 ? 1.1 : 0.85);
  } else {
    float fz = mod(z - 4.2, 3.2);
    // Stone quoins between the bays, long and short in turn; stone string courses.
    float quoin = 1.0 - smoothstep(0.32 + 0.18 * step(0.5, fract(z / 0.9)), 0.34 + 0.18 * step(0.5, fract(z / 0.9)) + aa.x, cx);
    col = mix(col, stone, quoin);
    col = mix(col, stone, step(fz, 0.28));
    float win = rect(vec2(bx, fz), vec2(-0.6, 0.75), vec2(0.6, 2.75), aa);
    float frame = rect(vec2(bx, fz), vec2(-0.82, 0.6), vec2(0.82, 2.95), aa) - win;
    col = mix(col, stone, frame);
    float cross = max(1.0 - smoothstep(0.04, 0.04 + aa.x, abs(bx)), 1.0 - smoothstep(0.04, 0.04 + aa.y, abs(fz - 2.1)));
    col = mix(col, vec3(0.85, 0.83, 0.78), win * cross * detail);
    glass = win * (1.0 - cross * detail);
  }
  return vec4(col, glass);
}

vec4 lmMorgue(float u, float z, float L, float eave, vec2 aa, float detail) {
  vec3 stone = vec3(0.82, 0.79, 0.71) * (0.95 + 0.08 * noise(vec2(u * 0.4, z * 0.3)));
  vec3 col = stone * (1.0 - 0.1 * lmCourse(z, 0.5, aa) * detail);
  float glass = 0.0;
  float x = u - L * 0.5;
  if (z > eave - 0.5) return vec4(col * (z > eave - 0.2 ? 1.1 : 0.8), 0.0);
  if (L > 16.0 && abs(x) < 2.2) {
    // The central door under a pediment, with the inscription above.
    float door = rect(vec2(x, z), vec2(-1.1, 0.0), vec2(1.1, 3.4), aa);
    col = mix(col, vec3(0.20, 0.17, 0.14), door);
    float letters = rect(vec2(x, z), vec2(-1.6, 3.9), vec2(1.6, 4.4), aa) * step(0.45, hash(floor(vec2(x / 0.22, z / 0.25))));
    col = mix(col, vec3(0.15), letters * detail);
    col = mix(col, stone * 1.1, rect(vec2(x, z), vec2(-2.0, 3.5), vec2(2.0, 3.75), aa));
  } else {
    float bw = L / max(1.0, floor(L / 3.6));
    float bx = mod(u, bw) - bw * 0.5;
    glass = rect(vec2(bx, z), vec2(-0.55, 2.6), vec2(0.55, eave - 1.3), aa) * 0.7;
    col = mix(col, stone * 1.08, (rect(vec2(bx, z), vec2(-0.7, 2.45), vec2(0.7, eave - 1.15), aa) - glass / 0.7) * detail);
  }
  col *= z < 0.6 ? 0.85 : 1.0;
  return vec4(col, glass);
}

vec4 lmPavilion(float u, float z, float L, float eave, bool old, vec2 aa) {
  vec3 iron = old ? vec3(0.17, 0.24, 0.21) : vec3(0.20, 0.33, 0.25);
  float col0 = abs(mod(u + 1.5, 3.0) - 1.5);
  bool column = col0 < (old ? 0.12 : 0.1);
  float glass = 0.0;
  vec3 col = iron;
  if (old && z < 2.9 && !column) discard; // open sides under the glazing
  if (column) return vec4(iron, 0.0);
  if (z > eave - 0.45) return vec4(iron * (0.9 + 0.3 * step(0.5, fract(u / 0.4))), 0.0);
  if (!old && z < 0.9) return vec4(iron * 0.85, 0.0);
  if (z < 3.1 && old) return vec4(iron, 0.0);
  // Glazing in small panes.
  float pane = rect(vec2(fract(u / 0.6), fract((z - 0.9) / 0.8)), vec2(0.06), vec2(0.94), aa / vec2(0.6, 0.8));
  glass = pane * 0.85;
  return vec4(col, glass);
}

vec4 lmOpenwork(float u, float z, float L, float eave, float seed, vec2 aa) {
  vec3 lead = vec3(0.47, 0.51, 0.55) * (0.95 + 0.08 * noise(vec2(u * 2.0, z * 0.5)));
  float x = u - L * 0.5;
  float h = seed * 20.0; // the stage's height
  float z0 = eave - h;
  if (z > eave) {
    // Gablets: crockets and a small trefoil.
    float r = length(vec2(x, z - eave - 0.7));
    return vec4(mix(lead, lead * 0.4, (1.0 - smoothstep(0.25, 0.3, r)) * step(0.12, r)), 0.0);
  }
  float hw = L * 0.22;
  float open = pointed(vec2(x, z), hw, z0 + h * 0.2, eave - 0.6 - hw * 1.5, hw * 1.8, aa);
  // Openings: the sky and the far side show through the tracery, so not black.
  float tr = (1.0 - smoothstep(0.04, 0.04 + aa.x, abs(x))) * step(z, eave - 0.6 - hw * 1.5);
  vec3 col = mix(lead, mix(vec3(0.22, 0.25, 0.29), lead * 0.9, tr), open);
  col *= abs(x) > L * 0.5 - 0.12 ? 1.15 : 1.0;
  return vec4(col, 0.0);
}

// Colour and how much of it is glass, for a landmark wall at position u along it (metres), height z.
vec4 landmarkFacade(float st, float u, float z, float L, float eave, float seed, vec3 world, vec3 normal, vec2 aa) {
  float detail = 1.0 - smoothstep(0.06, 0.3, max(aa.x, aa.y));
  if (st < 20.5) return lmChapel(u, z, L, eave, aa, detail);
  if (st < 21.5) return lmChapelFront(u, z, L, eave, seed * 100.0, aa, detail);
  if (st < 22.5) return lmTower(u, z, L, eave, aa, detail);
  if (st < 23.5) return lmConciergerie(u, z, L, eave, aa, detail);
  if (st < 24.5) return lmPalais(u, z, L, eave, seed, aa, detail);
  if (st < 25.5) return lmTribunal(u, z, L, eave, seed, aa, detail);
  if (st < 26.5) return lmClassical(u, z, L, eave, vec3(0.83, 0.79, 0.70), 3.6, 5.0, 3.7, 0.0, aa, detail);
  if (st < 27.5) return lmClassical(u, z, L, eave, vec3(0.87, 0.83, 0.75), 3.9, 5.6, 4.1, 1.0, aa, detail);
  if (st < 28.5) return lmDauphine(u, z, L, eave, aa, detail);
  if (st < 29.5) return lmMorgue(u, z, L, eave, aa, detail);
  if (st < 30.5) return lmPavilion(u, z, L, eave, true, aa);
  if (st < 31.5) return lmPavilion(u, z, L, eave, false, aa);
  if (st < 32.5) {
    vec3 stone = vec3(0.83, 0.79, 0.70) * (0.94 + 0.1 * noise(vec2(u * 0.4, z * 0.25)));
    return vec4(stone * (1.0 - 0.12 * lmCourse(z, 0.5, aa) * detail), 0.0);
  }
  if (st < 33.5) return lmHarlay(u, z, L, eave, aa, detail);
  return lmOpenwork(u, z, L, eave, seed, aa);
}
`

/* ------------------------------------------------------------- props */

const propCommon = /* glsl */ `
uniform float u_year;
uniform vec3 u_camera;
uniform vec3 u_sun;
uniform vec4 u_box;
uniform vec3 u_fog;
float edgeFade(vec2 xy) {
  float d = min(min(xy.x - u_box.x, u_box.z - xy.x), min(xy.y - u_box.y, u_box.w - xy.y));
  return smoothstep(0.0, 70.0, d);
}
vec3 haze(vec3 col, vec3 world) {
  float d = length(world - u_camera);
  return mix(col, u_fog, smoothstep(350.0, 1800.0, d) * 0.85);
}
`

export const propVertex = /* glsl */ `
${propCommon}
attribute vec4 a_a;
attribute vec4 a_b;
attribute vec4 a_life;
varying vec2 v_uv;
varying vec4 v_b;
varying vec3 v_n;
varying vec3 v_world;
void main() {
  bool alive = u_year >= a_life.x && u_year < a_life.y && !(u_year >= a_life.z && u_year < a_life.w);
  v_uv = a_a.xy;
  v_b = a_b;
  v_n = normal;
  v_world = position;
  gl_Position = alive ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

export const propFragment = /* glsl */ `
${propCommon}
varying vec2 v_uv;
varying vec4 v_b;
varying vec3 v_n;
varying vec3 v_world;

float segment(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(w, w * 1.6, length(pa - ba * h));
}

// The clock of the Tour de l'Horloge: a gold dial on a blue field of fleurs-de-lis,
// in a carved stone frame with two figures and a pediment (Germain Pilon, 1585).
vec3 clockFace(vec2 uv, out float keep) {
  vec2 p = (uv - vec2(0.5, 0.42)) * vec2(5.0, 6.4);
  vec3 stone = vec3(0.80, 0.76, 0.66);
  vec3 gold = vec3(0.82, 0.65, 0.27);
  keep = 1.0;
  // Pediment: a triangle on top of the frame.
  if (p.y > 2.1) {
    keep = step(p.y - 2.1, 1.3 * (1.0 - abs(p.x) / 2.5));
    return stone * (p.y < 2.35 ? 1.1 : 0.95);
  }
  vec3 col = stone;
  // The figures of Law and Justice on either side.
  if (abs(p.x) > 1.8 && p.y > -2.3 && p.y < 1.5) col = stone * (0.72 + 0.18 * sin(p.y * 5.0 + abs(p.x) * 7.0));
  if (abs(p.x) < 1.7 && abs(p.y) < 1.7) {
    col = vec3(0.09, 0.15, 0.40);
    vec2 g = fract(p * 1.5 + 0.5) - 0.5;
    col = mix(col, gold, (1.0 - smoothstep(0.07, 0.11, length(g))) * 0.9);
    float r = length(p);
    if (r < 1.25) col = vec3(0.11, 0.19, 0.46);
    float ring = max(1.0 - smoothstep(0.03, 0.07, abs(r - 1.22)), 1.0 - smoothstep(0.02, 0.05, abs(r - 0.98)));
    col = mix(col, gold, ring);
    float ang = atan(p.x, p.y);
    float marks = step(1.0, r) * step(r, 1.2) * smoothstep(0.96, 0.99, cos(ang * 12.0));
    col = mix(col, gold, marks);
    // Hands at ten past ten.
    float hands = max(segment(p, vec2(0.0), vec2(-0.55, 0.32), 0.05), segment(p, vec2(0.0), vec2(0.62, 0.62), 0.035));
    col = mix(col, gold, max(hands, 1.0 - smoothstep(0.1, 0.13, r)));
  }
  col *= abs(p.x) > 2.38 || p.y < -3.1 ? 0.85 : 1.0;
  return col;
}

void main() {
  vec3 col = v_b.rgb;
  float kind = v_b.w;
  vec3 n = normalize(v_n);
  vec3 view = normalize(u_camera - v_world);
  if (dot(n, view) < 0.0) n = -n;
  float diff = max(dot(n, u_sun), 0.0);
  float light = 0.55 + 0.55 * diff;
  float spec = pow(max(dot(reflect(-u_sun, n), view), 0.0), 16.0);
  if (kind > 0.5 && kind < 1.5) {
    // Bronze with its green-brown patina: a soft sheen.
    col = col * light + vec3(0.32, 0.30, 0.22) * spec * 0.7;
  } else if (kind > 1.5 && kind < 2.5) {
    float keep;
    col = clockFace(v_uv, keep) * light;
    if (keep < 0.5) discard;
  } else if (kind > 2.5 && kind < 3.5) {
    col = col * (0.6 + 0.5 * diff) + vec3(1.0, 0.9, 0.6) * spec * 0.9;
  } else if (kind > 3.5) {
    // Canvas: stripes in the cloth.
    col *= (0.86 + 0.14 * step(0.5, fract(v_uv.x * 16.0))) * light;
  } else {
    col *= light;
  }
  float a = edgeFade(v_world.xy);
  if (a < 0.02) discard;
  gl_FragColor = vec4(haze(col, v_world), a);
}
`
