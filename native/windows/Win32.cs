using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace WebDesk.Native {
  internal static class Win32 {
    [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int size; internal IntPtr descriptor; internal int inherit; }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
    [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern SafePipeHandle CreateNamedPipe(string name,uint mode,uint pipeMode,uint max,uint output,uint input,uint timeout,ref SecurityAttributes attrs);
    // TOKEN_PRIVILEGES contains a DWORD-aligned LUID, even in a 64-bit process.
    [StructLayout(LayoutKind.Sequential, Pack=4)] internal struct Privilege { internal uint count; internal long luid; internal uint attributes; }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool LookupPrivilegeValue(string system,string name,out long luid);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool AdjustTokenPrivileges(IntPtr token,bool disable,ref Privilege value,uint length,IntPtr previous,IntPtr needed);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attrs, int level, int type, out IntPtr copy);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool SetTokenInformation(IntPtr token, int kind, ref uint value, int length);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool GetTokenInformation(IntPtr token, int kind, out uint value, int length, out uint needed);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup startup, out ProcessInfo info);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] internal struct Startup {
      internal uint cb; internal string reserved, desktop, title;
      internal uint x,y,xSize,ySize,xChars,yChars,fill,flags;
      internal ushort show,reserved2; internal IntPtr reservedPtr,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { internal IntPtr process,thread; internal uint pid,tid; }
    [DllImport("user32.dll", SetLastError=true)] internal static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError=true)] internal static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll")] internal static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] internal static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern bool GetUserObjectInformation(IntPtr obj,int index,StringBuilder text,uint size,out uint needed);
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", SetLastError=true)] internal static extern uint SendInput(uint count, Input[] input, int size);
    [StructLayout(LayoutKind.Sequential)] internal struct Mouse { internal int x,y; internal uint data,flags,time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { internal ushort key,scan; internal uint flags,time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] internal struct Union { [FieldOffset(0)] internal Mouse mouse; [FieldOffset(0)] internal Keyboard key; }
    [StructLayout(LayoutKind.Sequential)] internal struct Input { internal uint type; internal Union value; }
    internal static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    internal static string Image(uint pid) {
      var handle=OpenProcess(0x1000,false,pid); Check(handle!=IntPtr.Zero);
      try { var text=new StringBuilder(32768); uint length=32768; Check(QueryFullProcessImageName(handle,0,text,ref length)); return text.ToString(); }
      finally { CloseHandle(handle); }
    }
  }
}
