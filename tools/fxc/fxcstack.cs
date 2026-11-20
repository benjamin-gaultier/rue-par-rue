// fxcstack <file.hlsl> <stackKB> [flags]: compile a pixel shader with d3dcompiler_47 on a thread
// whose stack RESERVE is stackKB. Prints "OK <sec>" or "FAIL <sec> <error>"; a stack overflow kills the process.
using System; using System.IO; using System.Runtime.InteropServices; using System.Threading; using System.Diagnostics;
class P {
  [StructLayout(LayoutKind.Sequential)] struct Macro { public IntPtr Name, Def; }
  [DllImport("d3dcompiler_47.dll", CallingConvention = CallingConvention.StdCall)]
  static extern int D3DCompile(byte[] src, UIntPtr size, string name, Macro[] defs, IntPtr include,
    [MarshalAs(UnmanagedType.LPStr)] string entry, [MarshalAs(UnmanagedType.LPStr)] string target, uint f1, uint f2, out IntPtr code, out IntPtr errs);
  delegate IntPtr GetPtr(IntPtr self); delegate UIntPtr GetSize(IntPtr self);
  static string Blob(IntPtr b) {
    if (b == IntPtr.Zero) return "";
    IntPtr vt = Marshal.ReadIntPtr(b);
    var gp = (GetPtr)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size), typeof(GetPtr));
    var gs = (GetSize)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, 4 * IntPtr.Size), typeof(GetSize));
    return Marshal.PtrToStringAnsi(gp(b), (int)gs(b).ToUInt64());
  }
  static int Main(string[] a) {
    byte[] src = File.ReadAllBytes(a[0]);
    int kb = int.Parse(a[1]);
    uint flags = a.Length > 2 ? uint.Parse(a[2]) : 0u;
    string target = a.Length > 3 ? a[3] : "ps_5_0";
    var defs = new Macro[] { new Macro { Name = Marshal.StringToHGlobalAnsi("ANGLE_ENABLE_LOOP_FLATTEN"), Def = Marshal.StringToHGlobalAnsi("1") }, new Macro() };
    int hr = 0; string err = ""; var sw = Stopwatch.StartNew();
    var t = new Thread(() => { IntPtr code, errs; hr = D3DCompile(src, (UIntPtr)src.Length, "shader", defs, IntPtr.Zero, "main", target, flags, 0, out code, out errs); err = Blob(errs); }, kb * 1024);
    t.Start(); t.Join();
    Console.WriteLine(hr == 0 ? "OK " + sw.Elapsed.TotalSeconds.ToString("0.00") : "FAIL " + sw.Elapsed.TotalSeconds.ToString("0.00") + " " + err.Replace("\n", " | ").Substring(0, Math.Min(400, err.Length)));
    return hr == 0 ? 0 : 2;
  }
}
