using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;

namespace WebDesk.Native {
  // Local elevated clients only. No network endpoint, shell, file or token commands.
  internal static class Wire {
    internal const string Broker = "WebDesk.Native.v1";
    internal static NamedPipeServerStream Server(string name) {
      IntPtr descriptor; uint size;
      Win32.Check(Win32.ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GA;;;BA)",1,out descriptor,out size));
      try {
        var attrs=new Win32.SecurityAttributes(); attrs.size=System.Runtime.InteropServices.Marshal.SizeOf(attrs);attrs.descriptor=descriptor;
        // FIRST_PIPE_INSTANCE prevents silently joining a pre-created pipe;
        // PIPE_REJECT_REMOTE_CLIENTS restricts the endpoint to this machine.
        var handle=Win32.CreateNamedPipe("\\\\.\\pipe\\"+name,0x40080003,8,1,65536,65536,0,ref attrs);
        Win32.Check(!handle.IsInvalid);
        return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);
      } finally { Win32.LocalFree(descriptor); }
    }
    internal static byte[] Read(Stream stream) {
      byte[] header=Exact(stream,4); int length=BitConverter.ToInt32(header,0);
      if(length<1||length>4096) throw new InvalidDataException("Invalid request size");
      return Exact(stream,length);
    }
    internal static byte[] Exact(Stream stream,int length) {
      byte[] data=new byte[length]; int used=0;
      while(used<length) { int count=stream.Read(data,used,length-used); if(count==0) throw new EndOfStreamException(); used+=count; }
      return data;
    }
    internal static void Reply(Stream stream,uint error,byte[] data) {
      var writer=new BinaryWriter(stream); writer.Write(error); writer.Write(data.Length); writer.Write(data); writer.Flush();
    }
    internal static bool Connect(NamedPipeServerStream pipe,WaitHandle stop,int timeout) {
      var pending=pipe.BeginWaitForConnection(null,null);
      try { if(WaitHandle.WaitAny(new[]{pending.AsyncWaitHandle,stop},timeout)!=0) return false; pipe.EndWaitForConnection(pending); return true; }
      finally { pending.AsyncWaitHandle.Close(); }
    }
  }
}
