"""One command to check every 3D shader against Direct3D's FXC compiler, as Windows Chrome runs it.

    python -I tools/fxc/check.py

It starts the Vite dev server and a loopback receiver, opens check.html in headless Chrome (ANGLE on
Direct3D 11) to capture the HLSL of every fragment shader, then compiles each one with d3dcompiler_47
on a 1 MB stack and prints the time and the instruction slots. It exits with 1 when a shader fails,
overflows the stack or takes longer than --max-seconds. Windows only. See README.md.
"""
import argparse, glob, os, re, shutil, subprocess, sys, tempfile, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

STACK_OVERFLOW = 0xC00000FD
BROWSERS = [
    r'%ProgramFiles%\Google\Chrome\Application\chrome.exe',
    r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe',
    r'%LocalAppData%\Google\Chrome\Application\chrome.exe',
    r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe',
    r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe',
]
# Captured for comparison only: the wall shader with every family in one program, as it was before PR #10 split it.
# The app never draws it, so the time limit does not apply to it.
REFERENCE = {'walls-all'}
CSC = r'%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe'


def parse_result(returncode, stdout):
    """What one fxcstack run says: {'status': 'ok' | 'fail' | 'overflow' | 'crash', 'seconds', 'slots', 'temps', 'error'}."""
    r = {'status': 'crash', 'seconds': None, 'slots': None, 'temps': None, 'error': ''}
    if returncode is not None and returncode & 0xFFFFFFFF == STACK_OVERFLOW:
        r['status'] = 'overflow'
        r['error'] = 'stack overflow'
        return r
    line = (stdout or '').strip().splitlines()[-1] if (stdout or '').strip() else ''
    m = re.match(r'OK ([\d.]+)(?: (\d+|\?) slots, (\d+|\?) temps)?', line)
    if m and returncode == 0:
        r['status'] = 'ok'
        r['seconds'] = float(m.group(1))
        r['slots'] = int(m.group(2)) if m.group(2) and m.group(2) != '?' else None
        r['temps'] = int(m.group(3)) if m.group(3) and m.group(3) != '?' else None
        return r
    m = re.match(r'FAIL ([\d.]+) ?(.*)', line)
    if m:
        r['status'] = 'fail'
        r['seconds'] = float(m.group(1))
        r['error'] = m.group(2)
        return r
    r['error'] = f'exit code {returncode}' + (f': {line[:200]}' if line else '')
    return r


def verdict(result, max_seconds, label=''):
    """'ok', 'not drawn' for a reference shader, or the reason this shader fails the check."""
    if label in REFERENCE:
        return 'not drawn'
    if result['status'] == 'overflow':
        return 'STACK OVERFLOW'
    if result['status'] != 'ok':
        return 'FAIL ' + result['error'][:200]
    if result['seconds'] > max_seconds:
        return f'SLOW (over {max_seconds:g} s)'
    return 'ok'


def passes(result, max_seconds, label=''):
    return verdict(result, max_seconds, label) in ('ok', 'not drawn')


def table(rows, max_seconds, markdown=False):
    """rows: [(label, hlsl_bytes, result)], as text columns or as a Markdown table."""
    head = ['Shader', 'HLSL kB', 'Compile s', 'Slots', 'Temps', 'Result']
    body = []
    for label, size, r in rows:
        body.append([
            label,
            f'{size / 1000:.0f}',
            '' if r['seconds'] is None else f"{r['seconds']:.2f}",
            '' if r['slots'] is None else str(r['slots']),
            '' if r['temps'] is None else str(r['temps']),
            verdict(r, max_seconds, label),
        ])
    if markdown:
        lines = ['| ' + ' | '.join(head) + ' |', '| --- | ' + ' | '.join(['---:'] * 4) + ' | --- |']
        return '\n'.join(lines + ['| ' + ' | '.join(row) + ' |' for row in body])
    widths = [max(len(row[i]) for row in [head] + body) for i in range(len(head))]
    fmt = lambda row: '  '.join(c.ljust(w) if i in (0, 5) else c.rjust(w) for i, (c, w) in enumerate(zip(row, widths))).rstrip()
    return '\n'.join([fmt(head)] + [fmt(row) for row in body])


def harness_problems(report):
    """Lines of the harness report that say a shader did not build in the browser."""
    return [l for l in report.splitlines() if 'COMPILE ERROR' in l or l.endswith(': no program')]


def find_browser(given):
    for p in ([given] if given else []) + [os.environ.get('CHROME', '')] + [os.path.expandvars(b) for b in BROWSERS]:
        if p and os.path.isfile(p):
            return p
    sys.exit('No Chrome or Edge found. Give one with --chrome <path to chrome.exe>.')


def kill(proc):
    """Stop a process and its children (Chrome and Node both start some)."""
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            pass


def wait_http(url, seconds, proc):
    end = time.time() + seconds
    while time.time() < end:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return True
        except OSError:
            time.sleep(0.3)
    return False


def capture(work, cap, args):
    """Fill `cap` with check__<shader>.fs.hlsl for every 3D shader. Returns the harness report."""
    import recv
    server = recv.make_server(cap, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    vite_url = f'http://127.0.0.1:{args.vite_port}'
    vite = chrome = None
    try:
        vite_js = os.path.join(ROOT, 'web', 'node_modules', 'vite', 'bin', 'vite.js')
        if not os.path.isfile(vite_js):
            sys.exit('web/node_modules is missing: run "npm ci" in web/ first.')
        vite = subprocess.Popen(['node', vite_js, '--host', '127.0.0.1', '--port', str(args.vite_port), '--strictPort'],
                                cwd=os.path.join(ROOT, 'web'), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if not wait_http(vite_url + '/src/cityshaders.ts', 60, vite):
            err = vite.stderr.read().decode(errors='replace')[-600:] if vite.poll() is not None else ''
            sys.exit(f'The Vite dev server did not start on port {args.vite_port} (in use? try --vite-port).\n{err}')
        page = f'http://127.0.0.1:{server.server_address[1]}/check.html?vite={vite_url}'
        chrome = subprocess.Popen([find_browser(args.chrome), '--headless=new', '--use-angle=d3d11', '--ignore-gpu-blocklist',
                                   '--no-first-run', '--no-default-browser-check', '--disable-extensions',
                                   '--user-data-dir=' + os.path.join(work, 'profile'), page],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + args.capture_seconds
        while time.time() < end:
            for name in ('error', 'done'):
                path = os.path.join(cap, name)
                if os.path.isfile(path):
                    with open(path, encoding='utf-8') as f:
                        text = f.read()
                    if name == 'error':
                        sys.exit('The capture page failed:\n' + text)
                    return text
            time.sleep(0.2)
        sys.exit(f'The capture page did not finish in {args.capture_seconds} s.')
    finally:
        kill(chrome)
        kill(vite)
        server.shutdown()


def build_fxcstack(work):
    exe = os.path.join(work, 'fxcstack.exe')
    csc = os.path.expandvars(CSC)
    if not os.path.isfile(csc):
        sys.exit(f'The .NET Framework compiler is missing: {csc}')
    p = subprocess.run([csc, '/nologo', '/out:' + exe, os.path.join(HERE, 'fxcstack.cs')], capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit('fxcstack.cs did not build:\n' + p.stdout + p.stderr)
    return exe


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--max-seconds', type=float, default=5.0, help='fail when one shader compiles for longer (default 5)')
    ap.add_argument('--stack-kb', type=int, default=1024, help='stack of the compile thread; Chrome\'s GPU process has 1024')
    ap.add_argument('--keep', metavar='DIR', help='keep the captured and filled HLSL in DIR, to study a shader with fxc.py')
    ap.add_argument('--vite-port', type=int, default=5177)
    ap.add_argument('--chrome', help='path to chrome.exe or msedge.exe')
    ap.add_argument('--capture-seconds', type=int, default=180, help='how long the browser may take to capture the shaders')
    ap.add_argument('--markdown', action='store_true', help='print the table as Markdown, for the README')
    args = ap.parse_args()
    if sys.platform != 'win32':
        sys.exit('This check needs Windows: it runs d3dcompiler_47.dll.')
    import fxc

    work = os.path.abspath(args.keep) if args.keep else tempfile.mkdtemp(prefix='rpr-fxc-')
    cap, filled = os.path.join(work, 'cap'), os.path.join(work, 'filled')
    for d in (cap, filled):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    try:
        exe = build_fxcstack(work)
        report = capture(work, cap, args)
        problems = harness_problems(report)
        rows = []
        for path in sorted(glob.glob(os.path.join(cap, 'check__*.fs.hlsl'))):
            label = os.path.basename(path)[len('check__'):-len('.fs.hlsl')]
            with open(path, encoding='utf-8') as f:
                src = f.read()
            if '@@ PIXEL' not in src:
                sys.exit(f'{label}: the browser did not give Direct3D HLSL. It must run ANGLE on Direct3D 11 '
                         '(a real GPU or WARP); check chrome://gpu.')
            out = os.path.join(filled, os.path.basename(path))
            with open(out, 'w', encoding='utf-8') as f:
                f.write(fxc.fill_pixel(src))
            try:
                p = subprocess.run([exe, out, str(args.stack_kb)], capture_output=True, text=True, timeout=300)
                result = parse_result(p.returncode, p.stdout)
            except subprocess.TimeoutExpired:
                result = {'status': 'fail', 'seconds': 300.0, 'slots': None, 'temps': None, 'error': 'no result after 300 s'}
            rows.append((label, len(src.encode()), result))
        if not rows:
            sys.exit('No shader was captured.\n' + report)
        print(table(rows, args.max_seconds, args.markdown))
        bad = [label for label, _, r in rows if not passes(r, args.max_seconds, label)]
        drawn = [row for row in rows if row[0] not in REFERENCE] or rows
        total = sum(r['seconds'] or 0 for _, _, r in drawn)
        slowest = max(drawn, key=lambda row: row[2]['seconds'] or 0)
        print(f"\n{len(drawn)} shaders drawn by the app, {total:.1f} s in all, slowest {slowest[0]} {slowest[2]['seconds'] or 0:.2f} s, "
              f'stack {args.stack_kb} kB, limit {args.max_seconds:g} s')
        for l in problems:
            print('Did not build in the browser:', l)
        if bad or problems:
            print('FAILED: ' + ', '.join(bad + [l.split(':')[0] for l in problems]))
            return 1
        print('All shaders pass.')
        return 0
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
