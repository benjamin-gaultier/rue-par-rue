/**
 * Facades of landmark buildings, drawn by the wall shader for styles 20 and
 * up (the landmarks module gives buildings these styles in `prepare`).
 */

export const landmarkFacades = /* glsl */ `
// Colour and how much of it is glass, for a landmark wall at position u along it (metres), height z.
vec4 landmarkFacade(float st, float u, float z, float L, float eave, float seed, vec3 world, vec3 normal, vec2 aa) {
  vec3 stone = vec3(0.80, 0.76, 0.67);
  float course = smoothstep(0.0, aa.y * 2.0 + 0.01, abs(fract(z / 0.55) - 0.5) - 0.47);
  return vec4(stone * (1.0 - 0.12 * course), 0.0);
}
`
