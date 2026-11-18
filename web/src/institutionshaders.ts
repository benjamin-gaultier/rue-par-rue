/**
 * Facades of the great institutions of the old Cité (styles 10 to 19): the
 * Hôtel-Dieu and the archbishop's palace. Drawn by the wall shader.
 */

export const institutionFacades = /* glsl */ `
vec4 institutionFacade(float st, float u, float z, float L, float eave, float seed, vec3 world, vec3 normal, vec2 aa) {
  vec3 stone = vec3(0.82, 0.78, 0.69);
  return vec4(stone, 0.0);
}
`
