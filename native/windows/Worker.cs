using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;

namespace WebDesk.Native {
  internal sealed class Worker : IDisposable {
    // SendInput also requires DESKTOP_JOURNALPLAYBACK on the bound desktop.
    // Read/write/switch (0x181) alone allows capture but denies input (error 5).
    const uint InputDesktopAccess=0x001|0x020|0x080|0x100;
    readonly IntPtr original=Win32.GetThreadDesktop(Win32.GetCurrentThreadId());
    IntPtr desktop; string desktopName="";
    readonly Dictionary<ushort,uint> keys=new Dictionary<ushort,uint>(); uint buttons;
    readonly ImageCodecInfo jpeg;
    Bitmap rawBitmap;
    internal Worker() { foreach(var c in ImageCodecInfo.GetImageEncoders()) if(c.MimeType=="image/jpeg") jpeg=c; }
    void Bind() {
      IntPtr next=Win32.OpenInputDesktop(0,false,InputDesktopAccess); Win32.Check(next!=IntPtr.Zero);
      var name=new StringBuilder(256); uint needed;
      if(!Win32.GetUserObjectInformation(next,2,name,512,out needed)) { Win32.CloseDesktop(next); throw new System.ComponentModel.Win32Exception(); }
      if(name.ToString()==desktopName && desktop!=IntPtr.Zero) { Win32.CloseDesktop(next); return; }
      if(!Win32.SetThreadDesktop(next)) { Win32.CloseDesktop(next); throw new System.ComponentModel.Win32Exception(); }
      var old=desktop; desktop=next; desktopName=name.ToString(); if(old!=IntPtr.Zero) Win32.CloseDesktop(old);
    }
    byte[] Status() {
      Bind(); using(var stream=new MemoryStream()) using(var writer=new BinaryWriter(stream)) {
        writer.Write(desktopName=="Default"?0:1); writer.Write(Win32.GetSystemMetrics(0)); writer.Write(Win32.GetSystemMetrics(1));
        writer.Write(System.Security.Principal.WindowsIdentity.GetCurrent().IsSystem?1:0);
        IntPtr token; uint access=0,needed;
        if(Win32.OpenProcessToken(Process.GetCurrentProcess().Handle,8,out token)) { try { Win32.GetTokenInformation(token,26,out access,4,out needed); } finally { Win32.CloseHandle(token); } }
        writer.Write(access); return stream.ToArray();
      }
    }
    byte[] Frame(int maxHeight) {
      Bind(); int w=Win32.GetSystemMetrics(0),h=Win32.GetSystemMetrics(1);
      if(w<=0||h<=0||(long)w*h>40000000||maxHeight<360||maxHeight>4320) throw new InvalidDataException("Unsupported screen size");
      int height=Math.Min(h,maxHeight),width=Math.Max(1,(int)((long)w*height/h));
      using(var bitmap=new Bitmap(w,h,PixelFormat.Format24bppRgb)) {
        using(var graphics=Graphics.FromImage(bitmap)) graphics.CopyFromScreen(0,0,0,0,new Size(w,h),CopyPixelOperation.SourceCopy);
        using(var scaled=new Bitmap(width,height,PixelFormat.Format24bppRgb)) {
          using(var graphics=Graphics.FromImage(scaled)) graphics.DrawImage(bitmap,new Rectangle(0,0,width,height));
          using(var bytes=new MemoryStream()) using(var parameters=new EncoderParameters(1)) {
            parameters.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,85L);
            scaled.Save(bytes,jpeg,parameters); return bytes.ToArray();
          }
        }
      }
    }
    void Inject(byte[] body) {
      if((body.Length-1)%20!=0 || body.Length<21 || body.Length>1281) throw new InvalidDataException();
      Bind();
      using(var reader=new BinaryReader(new MemoryStream(body,1,body.Length-1))) {
        while(reader.BaseStream.Position<reader.BaseStream.Length) {
          int kind=reader.ReadInt32(),a=reader.ReadInt32(),b=reader.ReadInt32(),flags=reader.ReadInt32(),data=reader.ReadInt32();
          var input=new Win32.Input();
          if(kind==1) {
            if(a<1||a>255||(flags&~3)!=0) throw new InvalidDataException();
            input.type=1; input.value.key.key=(ushort)a; input.value.key.flags=(uint)flags;
          } else if(kind==0) {
            if((flags&~0xD81F)!=0 || Math.Abs((long)data)>1200000) throw new InvalidDataException();
            input.type=0; input.value.mouse.x=a; input.value.mouse.y=b; input.value.mouse.flags=(uint)flags; input.value.mouse.data=unchecked((uint)data);
          } else throw new InvalidDataException();
          bool ok=false;
          for(int attempt=0;attempt<3;attempt++) {
            if(Win32.SendInput(1,new[]{input},Marshal.SizeOf(typeof(Win32.Input)))==1) {ok=true;break;}
            desktopName=""; Bind();
          }
          if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Windows rejected input");
          if(kind==1) { if((flags&2)!=0) keys.Remove((ushort)a); else keys[(ushort)a]=(uint)(flags&1); }
          else { if((flags&2)!=0) buttons|=2; if((flags&4)!=0) buttons&=~2u; if((flags&8)!=0) buttons|=8; if((flags&16)!=0) buttons&=~8u; }
        }
      }
    }
    void Release() {
      try { Bind(); } catch { return; }
      foreach(var key in keys) { var i=new Win32.Input();i.type=1;i.value.key.key=key.Key;i.value.key.flags=2|key.Value;Win32.SendInput(1,new[]{i},Marshal.SizeOf(typeof(Win32.Input))); }
      keys.Clear();
      if(buttons!=0) { var i=new Win32.Input();i.value.mouse.flags=((buttons&2)!=0?4u:0)|((buttons&8)!=0?16u:0);Win32.SendInput(1,new[]{i},Marshal.SizeOf(typeof(Win32.Input))); buttons=0; }
    }
    // Raw BGRA for native WebRTC. Cached bitmap, no JPEG/canvas round trip.
    byte[] RawFrame(int maxHeight) {
      Bind(); int w=Win32.GetSystemMetrics(0),h=Win32.GetSystemMetrics(1);
      if(w<2||h<2||(long)w*h>40000000||maxHeight<360||maxHeight>4320) throw new InvalidDataException();
      int height=Math.Min(h,maxHeight)&~1,width=Math.Max(2,(int)((long)w*height/h)&~1);
      if(rawBitmap==null||rawBitmap.Width!=width||rawBitmap.Height!=height) {
        if(rawBitmap!=null)rawBitmap.Dispose();rawBitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb);
      }
      using(var graphics=Graphics.FromImage(rawBitmap)) {
        IntPtr destination=graphics.GetHdc(),source=GetDC(IntPtr.Zero);
        try { if(!StretchBlt(destination,0,0,width,height,source,0,0,w,h,0x00CC0020)) throw new System.ComponentModel.Win32Exception(); }
        finally { ReleaseDC(IntPtr.Zero,source);graphics.ReleaseHdc(destination); }
      }
      var locked=rawBitmap.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      try {
        byte[] bytes=new byte[8+width*height*4];
        Buffer.BlockCopy(BitConverter.GetBytes(width),0,bytes,0,4);Buffer.BlockCopy(BitConverter.GetBytes(height),0,bytes,4,4);
        for(int row=0;row<height;row++) Marshal.Copy(IntPtr.Add(locked.Scan0,row*locked.Stride),bytes,8+row*width*4,width*4);
        return bytes;
      } finally {rawBitmap.UnlockBits(locked);}
    }
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll",SetLastError=true)] static extern bool StretchBlt(IntPtr dest,int x,int y,int w,int h,IntPtr src,int sx,int sy,int sw,int sh,uint rop);
    public void Dispose() { Release();if(rawBitmap!=null)rawBitmap.Dispose(); if(desktop!=IntPtr.Zero) {Win32.SetThreadDesktop(original);Win32.CloseDesktop(desktop);desktop=IntPtr.Zero;} }
    internal static void Run(string name,uint expectedPid,int brokerPid) {
      if(!name.StartsWith("WebDesk.Native.Worker.",StringComparison.Ordinal)||name.Length!="WebDesk.Native.Worker.".Length+32) throw new InvalidDataException();
      Win32.SetProcessDPIAware();
      using(var client=Process.GetProcessById((int)expectedPid)) using(var broker=Process.GetProcessById(brokerPid))
      using(var stop=new ManualResetEvent(false)) using(var pipe=Wire.Server(name)) {
        if(!Wire.Connect(pipe,stop,15000)) return;
        uint pid; Win32.Check(Win32.GetNamedPipeClientProcessId(pipe.SafePipeHandle,out pid)); if(pid!=expectedPid) return;
        long last=Environment.TickCount; // Idle workers must not survive a lost renderer indefinitely.
        using(var timer=new Timer(_=> { if(client.HasExited||broker.HasExited||unchecked((uint)(Environment.TickCount-Interlocked.Read(ref last)))>30000) { stop.Set();pipe.Dispose(); } },null,1000,1000))
        using(var worker=new Worker()) {
          while(!stop.WaitOne(0)) {
            byte[] request; try {request=Wire.Read(pipe);} catch(IOException) {break;} catch(ObjectDisposedException) {break;}
            Interlocked.Exchange(ref last,Environment.TickCount);
            try {
              byte[] response;
              switch(request[0]) {
                case 1: if(request.Length!=1) throw new InvalidDataException(); response=worker.Status(); break;
                case 2: worker.Inject(request); response=new byte[0]; break;
                case 3: if(request.Length!=5) throw new InvalidDataException(); response=worker.Frame(BitConverter.ToInt32(request,1)); break;
                case 4: worker.Release(); response=new byte[0]; break;
                case 5: if(request.Length!=5) throw new InvalidDataException(); response=worker.RawFrame(BitConverter.ToInt32(request,1)); break;
                default: throw new InvalidDataException();
              }
              Wire.Reply(pipe,0,response);
            } catch(System.ComponentModel.Win32Exception ex) { Wire.Reply(pipe,(uint)Math.Max(1,ex.NativeErrorCode),new byte[0]); }
              catch(Exception ex) { Wire.Reply(pipe,13,Encoding.ASCII.GetBytes(ex.GetType().Name)); }
          }
        }
      }
    }
  }
}
