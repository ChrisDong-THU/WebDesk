using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Collections.Generic;

namespace WebDesk.Native {
  internal sealed class BrokerService : ServiceBase {
    const string ServiceId="WebDeskNative";
    readonly string clientImage;
    readonly ManualResetEvent stop=new ManualResetEvent(false);
    readonly List<Process> workers=new List<Process>();
    Thread listener; NamedPipeServerStream pipe;
    internal BrokerService(string client) { ServiceName=ServiceId; clientImage=Path.GetFullPath(client); CanStop=true; }
    protected override void OnStart(string[] args) { listener=new Thread(Listen); listener.IsBackground=true; listener.Start(); }
    protected override void OnStop() {
      stop.Set(); if(pipe!=null) pipe.Dispose();
      if(listener!=null) listener.Join(3000);
      // Workers monitor their service parent; losing it closes the pipe and releases input.
      lock(workers) foreach(var worker in workers) worker.Dispose();
    }
    void Listen() {
      while(!stop.WaitOne(0)) {
        try {
          using(var current=Wire.Server(Wire.Broker)) {
            pipe=current;
            if(!Wire.Connect(current,stop,Timeout.Infinite)) break;
            uint pid; Win32.Check(Win32.GetNamedPipeClientProcessId(current.SafePipeHandle,out pid));
            if(!String.Equals(Win32.Image(pid),Process.GetCurrentProcess().MainModule.FileName,StringComparison.OrdinalIgnoreCase)) continue;
            if(!String.Equals(Win32.Image(Relay.Parent(pid)),clientImage,StringComparison.OrdinalIgnoreCase)) continue;
            uint session; Win32.Check(Win32.ProcessIdToSessionId(pid,out session)); if(session==0) continue;
            // Holding the original process prevents PID reuse while its worker is being started.
            using(var client=Process.GetProcessById((int)pid)) {
              if(client.HasExited) continue;
              lock(workers) {
                workers.RemoveAll(p=>{ try { if(p.HasExited) {p.Dispose();return true;} } catch(InvalidOperationException) {return true;} return false; });
                if(workers.Count>=8) { Wire.Reply(current,8,new byte[0]); continue; }
                string name="WebDesk.Native.Worker."+Guid.NewGuid().ToString("N");
                var child=Launch(session,pid,name); workers.Add(child);
                Wire.Reply(current,0,Encoding.UTF8.GetBytes(name));
              }
            }
          }
        } catch(Exception) { if(!stop.WaitOne(500)) continue; }
      }
    }
    static Process Launch(uint session,uint client,string pipeName) {
      IntPtr token=IntPtr.Zero,copy=IntPtr.Zero;
      try {
        Win32.Check(Win32.OpenProcessToken(Process.GetCurrentProcess().Handle,0x2B,out token));
        foreach(var privilege in new[]{"SeTcbPrivilege","SeAssignPrimaryTokenPrivilege","SeIncreaseQuotaPrivilege"}) {
          var value=new Win32.Privilege();value.count=1;value.attributes=2;
          Win32.Check(Win32.LookupPrivilegeValue(null,privilege,out value.luid));
          Win32.Check(Win32.AdjustTokenPrivileges(token,false,ref value,0,IntPtr.Zero,IntPtr.Zero));
          int error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();
          if(error!=0) throw new System.ComponentModel.Win32Exception(error);
        }
        Win32.Check(Win32.DuplicateTokenEx(token,0xF01FF,IntPtr.Zero,2,1,out copy));
        Win32.Check(Win32.SetTokenInformation(copy,12,ref session,4)); uint enabled=1;
        Win32.Check(Win32.SetTokenInformation(copy,26,ref enabled,4));
        var startup=new Win32.Startup(); startup.cb=(uint)System.Runtime.InteropServices.Marshal.SizeOf(startup); startup.desktop="winsta0\\default";
        string exe=Process.GetCurrentProcess().MainModule.FileName;
        var command=new StringBuilder("\""+exe+"\" --worker "+pipeName+" "+client+" "+Process.GetCurrentProcess().Id);
        Win32.ProcessInfo info;
        Win32.Check(Win32.CreateProcessAsUser(copy,exe,command,IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,Path.GetDirectoryName(exe),ref startup,out info));
        try { return Process.GetProcessById((int)info.pid); } finally { Win32.CloseHandle(info.thread); Win32.CloseHandle(info.process); }
      } finally { if(copy!=IntPtr.Zero) Win32.CloseHandle(copy); if(token!=IntPtr.Zero) Win32.CloseHandle(token); }
    }
    static int Sc(string args) {
      var start=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"sc.exe"),args);
      start.UseShellExecute=false; start.CreateNoWindow=true; start.RedirectStandardOutput=true; start.RedirectStandardError=true;
      using(var p=Process.Start(start)) { p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd(); p.WaitForExit(); return p.ExitCode; }
    }
    internal static void Install(string client) {
      if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new UnauthorizedAccessException();
      string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WebDesk Native");
      Directory.CreateDirectory(dir);
      var acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
      foreach(var sid in new[]{WellKnownSidType.LocalSystemSid,WellKnownSidType.BuiltinAdministratorsSid})
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid,null),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid,null),FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      Directory.SetAccessControl(dir,acl);
      try { using(var svc=new ServiceController(ServiceId)) { if(svc.Status!=ServiceControllerStatus.Stopped) {svc.Stop();svc.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(15));} } } catch(InvalidOperationException) {}
      string target=Path.Combine(dir,"WebDeskNative.exe");
      for(int attempt=0;;attempt++) {
        try { File.Copy(Process.GetCurrentProcess().MainModule.FileName,target,true); break; }
        catch(IOException) { if(attempt>=20) throw; Thread.Sleep(250); }
      }
      string encoded=Convert.ToBase64String(Encoding.Unicode.GetBytes(Path.GetFullPath(client)));
      string config="binPath= \"\\\""+target+"\\\" --service "+encoded+"\" start= demand obj= LocalSystem";
      int result=Sc("create "+ServiceId+" "+config);
      if(result==1073) result=Sc("config "+ServiceId+" "+config);
      if(result!=0) throw new System.ComponentModel.Win32Exception(result);
      Ensure();
    }
    internal static void Ensure() {
      using(var svc=new ServiceController(ServiceId)) {
        if(svc.Status==ServiceControllerStatus.Stopped) svc.Start();
        svc.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(15));
      }
    }
    internal static void Uninstall() {
      try { using(var svc=new ServiceController(ServiceId)) { if(svc.Status!=ServiceControllerStatus.Stopped) {svc.Stop();svc.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(15));} } } catch(InvalidOperationException) {}
      int result=Sc("delete "+ServiceId); if(result!=0 && result!=1060) throw new System.ComponentModel.Win32Exception(result);
    }
    static int Main(string[] args) {
      try {
        if(args.Length==2 && args[0]=="--install") Install(args[1]);
        else if(args.Length==1 && args[0]=="--uninstall") Uninstall();
        else if(args.Length==1 && args[0]=="--ensure") Ensure();
        else if(args.Length==1 && args[0]=="--bridge") Relay.Run();
        else if(args.Length==2 && args[0]=="--service") ServiceBase.Run(new BrokerService(Encoding.Unicode.GetString(Convert.FromBase64String(args[1]))));
        else if(args.Length==4 && args[0]=="--worker") Worker.Run(args[1],UInt32.Parse(args[2]),Int32.Parse(args[3]));
        else return 2;
        return 0;
      } catch(Exception ex) { Console.Error.WriteLine(ex.GetType().Name+": "+ex.Message); return 1; }
    }
  }
}
