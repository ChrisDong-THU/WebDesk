using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace WebDesk.Native {
  internal static class Relay {
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe,out uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot,ref Entry entry);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot,ref Entry entry);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry {
      internal uint size,usage,pid;internal UIntPtr heap;internal uint module,threads,parent;internal int priority;internal uint flags;
      [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] internal string name;
    }
    internal static uint Parent(uint pid) {
      IntPtr snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1)) throw new IOException("Process snapshot failed");
      try { var entry=new Entry();entry.size=(uint)Marshal.SizeOf(entry);if(Process32First(snapshot,ref entry)) do {if(entry.pid==pid)return entry.parent;} while(Process32Next(snapshot,ref entry)); }
      finally {Win32.CloseHandle(snapshot);} throw new IOException("Client process not found");
    }
    static void Verify(NamedPipeClientStream pipe) {
      uint pid;Win32.Check(GetNamedPipeServerProcessId(pipe.SafePipeHandle,out pid));
      string expected=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WebDesk Native","WebDeskNative.exe");
      if(!String.Equals(Win32.Image(pid),expected,StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Unexpected pipe server");
      using(var process=Process.GetProcessById((int)pid)) {
        IntPtr token;Win32.Check(Win32.OpenProcessToken(process.Handle,8,out token));
        try {using(var identity=new WindowsIdentity(token)) if(!identity.IsSystem) throw new UnauthorizedAccessException("Pipe server is not SYSTEM");}
        finally {Win32.CloseHandle(token);}
      }
    }
    static byte[] Response(Stream pipe,int limit,out uint error) {
      var header=Wire.Exact(pipe,8);error=BitConverter.ToUInt32(header,0);int size=BitConverter.ToInt32(header,4);
      if(size<0||size>limit) throw new InvalidDataException("Invalid server response");return Wire.Exact(pipe,size);
    }
    internal static void Run() {
      bool diagnostic=Environment.GetEnvironmentVariable("WEBDESK_NATIVE_DIAGNOSTICS")=="1";
      string name;uint error;
      using(var broker=new NamedPipeClientStream(".",Wire.Broker,PipeDirection.InOut,PipeOptions.None)) {
        broker.Connect(5000);Verify(broker);name=Encoding.UTF8.GetString(Response(broker,512,out error));
        Guid id;if(error!=0||!name.StartsWith("WebDesk.Native.Worker.",StringComparison.Ordinal)||!Guid.TryParseExact(name.Substring("WebDesk.Native.Worker.".Length),"N",out id))throw new IOException("Invalid worker handshake");
      }
      using(var worker=new NamedPipeClientStream(".",name,PipeDirection.InOut,PipeOptions.None)) {
        worker.Connect(10000);Verify(worker);
        // ConsoleStream's Windows input handling can stall after the first
        // binary request on Dart's redirected named pipe. Read the inherited
        // handle as a file stream; verified with consecutive fragmented requests.
        using(var input=new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(GetStdHandle(-10),false),FileAccess.Read,4096,false))
        using(var output=Console.OpenStandardOutput()) {
          // Forward in bounded chunks instead of retaining a second full frame.
          var buffer=new byte[65536];
          while(true) {
            byte[] request;try {request=Wire.Read(input);} catch(EndOfStreamException) {break;}
            if(diagnostic) Console.Error.WriteLine("relay request op="+request[0]);
            var writer=new BinaryWriter(worker);writer.Write(request.Length);writer.Write(request);writer.Flush();
            if(diagnostic) Console.Error.WriteLine("relay worker flushed");
            int size=Wire.ForwardReply(worker,output,request[0]==5?160000008:32*1024*1024,buffer,out error);
            if(diagnostic) Console.Error.WriteLine("relay reply error="+error+" bytes="+size);
          }
        }
      }
    }
  }
}
