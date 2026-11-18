/**
 * Facades of the great institutions of the old Cité (styles 10 to 19),
 * drawn by the wall shader: 10 the Hôtel-Dieu, 11 the Enfants-Trouvés,
 * 12 the archbishop's palace, 13 the palace after the sack of 1831.
 * Classical stone fronts: rusticated ground floor with arched openings,
 * tall windows in regular bays with stone surrounds, string courses,
 * quoins and a cornice. The palace's piano nobile is taller.
 */

export const institutionFacades = /* glsl */ `
vec4 institutionFacade(float st, float u, float z, float L, float eave, float seed, vec3 world, vec3 normal, vec2 aa) {
  bool ruin = st > 12.5;
  bool palace = st > 11.5;
  bool foundling = st > 10.5 && st < 11.5;
  vec3 stone = palace ? vec3(0.85, 0.81, 0.72) : foundling ? vec3(0.83, 0.79, 0.70) : vec3(0.79, 0.76, 0.69);
  stone *= 0.94 + 0.08 * noise(world.xy * 0.3 + world.z * 0.1);
  vec3 col = stone;
  float course = smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / 0.5) - 0.5) - 0.47);
  col *= 1.0 - 0.07 * course;
  float glass = 0.0;
  float soot = 0.0;
  if (L > 2.0) {
    float bayW = palace ? 4.2 : foundling ? 3.8 : 3.4;
    float bw = L / max(1.0, floor(L / bayW));
    float bu = mod(u, bw) - bw * 0.5;
    float groundH = palace ? 5.0 : foundling ? 4.6 : 4.2;
    float upper = max(eave - groundH - 0.6, 1.0);
    float nf = palace ? max(1.0, floor(upper / 5.4 + 0.3)) : max(1.0, floor(upper / 3.9 + 0.3));
    float fh = upper / nf;
    // Quoins: alternate long and short blocks at the corners.
    float edge = min(u, L - u);
    if (edge < 0.9 + 0.4 * step(0.5, fract(z / 0.6))) col = stone * 1.07;
    if (z < groundH) {
      float groove = smoothstep(0.0, aa.y * 2.0 + 0.02, abs(fract(z / 0.45) - 0.5) - 0.44);
      col *= 1.0 - 0.18 * groove;
      float hw = palace ? 0.95 : 0.8;
      float top = groundH - 1.3;
      float arch = rect(vec2(bu, z), vec2(-hw, 0.5), vec2(hw, top), aa)
                 + (1.0 - smoothstep(hw - aa.x, hw + aa.x, length(vec2(bu, z - top)))) * step(top, z);
      glass = clamp(arch, 0.0, 1.0);
    } else if (z < eave - 0.6) {
      float k = floor((z - groundH) / fh);
      float fz = z - groundH - k * fh;
      float ww = palace ? 1.45 : 1.15;
      float sill = fh * 0.17;
      float wh = (palace && k < 0.5) ? fh * 0.68 : fh * 0.58;
      vec2 p = vec2(bu, fz);
      float win = rect(p, vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + wh), aa);
      float head = 0.0;
      if (palace || foundling) {
        // Segmental heads over the windows.
        head = (1.0 - smoothstep(ww * 0.5 - aa.x, ww * 0.5 + aa.x, length(vec2(bu, (fz - sill - wh) * 2.4)))) * step(sill + wh, fz);
      }
      float opening = clamp(win + head, 0.0, 1.0);
      float frame = rect(p, vec2(-ww * 0.5 - 0.22, sill - 0.16), vec2(ww * 0.5 + 0.22, sill + wh + 0.32), aa) - opening;
      col = mix(col, stone * 1.1, clamp(frame, 0.0, 1.0));
      glass = opening;
      col = mix(col, stone * 1.12, rect(vec2(u, fz), vec2(-1.0, 0.0), vec2(L + 1.0, 0.18), aa));
      soot = rect(p, vec2(-ww * 0.55, sill + wh), vec2(ww * 0.55, sill + wh + 1.8), aa) * (1.0 - clamp((fz - sill - wh) / 1.8, 0.0, 1.0));
    } else {
      col *= z > eave - 0.25 ? 1.14 : 0.8;
    }
  }
  if (ruin) {
    // February 1831: the mob sacked and burned the palace. Gaping, blackened openings.
    col *= 0.8 + 0.12 * noise(world.xy * 0.5 + world.z * 0.3);
    col = mix(col, vec3(0.16, 0.14, 0.13), soot * 0.75);
    return vec4(mix(col, vec3(0.04, 0.04, 0.04), glass), 0.0);
  }
  return vec4(col, glass);
}
`
