"""Compile an ANGLE-translated fragment shader (from WEBGL_debug_shaders) with the
system d3dcompiler_47.dll, the way ANGLE's D3D11 back end does at link time.

usage: python -I fxc.py <file.hlsl> <config> [timeout]
config: default | skipval | skipopt | avoidflow | preferflow | level3
Prints: config, seconds, ok/fail, instruction count / first error lines.
"""
import ctypes, re, sys, time
from ctypes import wintypes

SKIP_VALIDATION = 1 << 1
SKIP_OPTIMIZATION = 1 << 2
AVOID_FLOW = 1 << 9
PREFER_FLOW = 1 << 10
LEVEL1 = 0
LEVEL3 = 1 << 15
CONFIGS = {
    'default': LEVEL1,
    'skipval': LEVEL1 | SKIP_VALIDATION,
    'skipopt': SKIP_OPTIMIZATION,
    'avoidflow': LEVEL1 | AVOID_FLOW,
    'preferflow': LEVEL1 | PREFER_FLOW,
    'level3': LEVEL3,
}


def varyings(src):
    return re.findall(r'^static\s+(nointerpolation\s+|centroid\s+)?\s*(float[234]?|int[234]?|uint[234]?)\s+(_uv_\w+)\s*=', src, re.M)


def fill_pixel(src):
    vs = varyings(src)
    fields = ['    float4 dx_Position : SV_Position;']
    prologue = []
    for i, (interp, ty, name) in enumerate(vs):
        fields.append(f'    {interp or ""}{ty} {name}_in : TEXCOORD{i};')
        prologue.append(f'{name} = input.{name}_in;')
    if 'GL_USES_FRAG_COORD' in src:
        prologue.append('gl_FragCoord = float4(input.dx_Position.xy, input.dx_Position.z, 1.0);')
    outs = re.findall(r'^static float4 (out_\w+)\s*=', src, re.M)
    out = 'struct PS_INPUT {\n' + '\n'.join(fields) + '\n};\n'
    out += 'struct PS_OUTPUT {\n' + '\n'.join(f'    float4 o{i} : SV_TARGET{i};' for i in range(len(outs))) + '\n};\n'
    out += 'PS_OUTPUT generateOutput() {\n    PS_OUTPUT o;\n' + ''.join(f'    o.o{i} = {n};\n' for i, n in enumerate(outs)) + '    return o;\n}\n'
    src = src.replace('@@ PIXEL OUTPUT @@', out)
    src = src.replace('@@ PIXEL MAIN PARAMETERS @@', 'PS_INPUT input')
    src = src.replace('@@ MAIN PROLOGUE @@', '\n'.join(prologue))
    return src


def compile_hlsl(src, flags, target='ps_5_0'):
    d3d = ctypes.WinDLL('d3dcompiler_47.dll')

    class MACRO(ctypes.Structure):
        _fields_ = [('Name', ctypes.c_char_p), ('Definition', ctypes.c_char_p)]

    macros = (MACRO * 2)(MACRO(b'ANGLE_ENABLE_LOOP_FLATTEN', b'1'), MACRO(None, None))
    code = ctypes.c_void_p()
    errs = ctypes.c_void_p()
    data = src.encode()
    fn = d3d.D3DCompile
    fn.restype = ctypes.c_long
    fn.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_char_p, ctypes.c_char_p, wintypes.UINT, wintypes.UINT,
                   ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    hr = fn(data, len(data), b'shader', ctypes.cast(macros, ctypes.c_void_p), None, b'main', target.encode(), flags, 0,
            ctypes.byref(code), ctypes.byref(errs))

    def blob(p):
        if not p:
            return b''
        vt = ctypes.cast(ctypes.cast(p, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
        get_ptr = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(vt[3])
        get_size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(vt[4])
        return ctypes.string_at(get_ptr(p), get_size(p))

    return hr, blob(code), blob(errs).decode(errors='replace')


def instruction_count(binary):
    d3d = ctypes.WinDLL('d3dcompiler_47.dll')
    out = ctypes.c_void_p()
    fn = d3d.D3DDisassemble
    fn.restype = ctypes.c_long
    fn.argtypes = [ctypes.c_char_p, ctypes.c_size_t, wintypes.UINT, ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    if fn(binary, len(binary), 0, None, ctypes.byref(out)) != 0:
        return '?'
    vt = ctypes.cast(ctypes.cast(out, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
    get_ptr = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(vt[3])
    get_size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(vt[4])
    text = ctypes.string_at(get_ptr(out), get_size(out)).decode(errors='replace')
    m = re.search(r'// Approximately (\d+) instruction slots used', text)
    temps = re.search(r'dcl_temps (\d+)', text)
    return f"{m.group(1) if m else '?'} slots, {temps.group(1) if temps else '?'} temps"


if __name__ == '__main__':
    path, config = sys.argv[1], sys.argv[2]
    src = open(path, encoding='utf-8').read()
    target = 'vs_5_0' if '@@ VERTEX' in src else 'ps_5_0'
    if target == 'ps_5_0':
        src = fill_pixel(src)
    t = time.perf_counter()
    hr, binary, err = compile_hlsl(src, CONFIGS[config], target)
    dt = time.perf_counter() - t
    if hr == 0:
        print(f'{config}: {dt:.2f}s OK {instruction_count(binary)}')
    else:
        lines = [l for l in err.splitlines() if 'error' in l][:6]
        print(f'{config}: {dt:.2f}s FAIL hr=0x{hr & 0xffffffff:08x}')
        for l in lines:
            print('   ', l[:300])
