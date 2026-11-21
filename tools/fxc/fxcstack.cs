// fxcstack <file.hlsl> <stackKB> [flags] [target]: compile a shader with d3dcompiler_47 on a thread
// whose stack RESERVE is stackKB. Prints "OK <sec> <slots> slots, <temps> temps" or "FAIL <sec> <error>";
// a stack overflow kills the process.
using System; using System.IO; using System.Runtime.InteropServices; using System.Threading; using System.Diagnostics;
using System.Text.RegularExpressions;
class P {
  [StructLayout(LayoutKind.Sequential)] struct Macro { public IntPtr Name, Def; }
  [DllImport("d3dcompiler_47.dll", CallingConvention = CallingConvention.StdCall)]
  static extern int D3DCompile(byte[] src, UIntPtr size, string name, Macro[] defs, IntPtr include,
    [MarshalAs(UnmanagedType.LPStr)] string entry, [MarshalAs(UnmanagedType.LPStr)] string target, uint f1, uint f2, out IntPtr code, out IntPtr errs);
  [DllImport("d3dcompiler_47.dll", CallingConvention = CallingConvention.StdCall)]
  static extern int D3DDisassemble(IntPtr src, UIntPtr size, uint flags, IntPtr comments, out IntPtr text);
  delegate IntPtr GetPtr(IntPtr self); delegate UIntPtr GetSize(IntPtr self);
  static IntPtr Ptr(IntPtr b) {
    IntPtr vt = Marshal.ReadIntPtr(b);
    return ((GetPtr)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size), typeof(GetPtr)))(b);
  }
  static UIntPtr Size(IntPtr b) {
    IntPtr vt = Marshal.ReadIntPtr(b);
    return ((GetSize)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, 4 * IntPtr.Size), typeof(GetSize)))(b);
  }
  static string Blob(IntPtr b) {
    return b == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(Ptr(b), (int)Size(b).ToUInt64());
  }
  // "<slots> slots, <temps> temps" from the disassembly, as fxc.py prints it.
  static string Slots(IntPtr code) {
    IntPtr text;
    if (code == IntPtr.Zero || D3DDisassemble(Ptr(code), Size(code), 0, IntPtr.Zero, out text) != 0) return "? slots, ? temps";
    string asm = Blob(text);
    Match m = Regex.Match(asm, @"// Approximately (\d+) instruction slots used"), t = Regex.Match(asm, @"dcl_temps (\d+)");
    return (m.Success ? m.Groups[1].Value : "?") + " slots, " + (t.Success ? t.Groups[1].Value : "?") + " temps";
  }
  static int Main(string[] a) {
    byte[] src = File.ReadAllBytes(a[0]);
    int kb = int.Parse(a[1]);
    uint flags = a.Length > 2 ? uint.Parse(a[2]) : 0u;
    string target = a.Length > 3 ? a[3] : "ps_5_0";
    var defs = new Macro[] { new Macro { Name = Marshal.StringToHGlobalAnsi("ANGLE_ENABLE_LOOP_FLATTEN"), Def = Marshal.StringToHGlobalAnsi("1") }, new Macro() };
    int hr = 0; string err = ""; IntPtr code = IntPtr.Zero; double sec = 0;
    var t = new Thread(() => {
      IntPtr errs; var sw = Stopwatch.StartNew();
      hr = D3DCompile(src, (UIntPtr)src.Length, "shader", defs, IntPtr.Zero, "main", target, flags, 0, out code, out errs);
      sec = sw.Elapsed.TotalSeconds; err = Blob(errs);
    }, kb * 1024);
    t.Start(); t.Join();
    string s = sec.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
    Console.WriteLine(hr == 0 ? "OK " + s + " " + Slots(code) : "FAIL " + s + " " + err.Replace("\n", " | ").Substring(0, Math.Min(400, err.Length)));
    return hr == 0 ? 0 : 2;
  }
}
