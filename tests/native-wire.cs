using System;
using System.IO;
namespace WebDesk.Native {
  class FragmentedStream : MemoryStream {
    internal int LargestRead;
    internal FragmentedStream(byte[] bytes) : base(bytes) {}
    public override int Read(byte[] bytes,int offset,int count) {
      LargestRead=Math.Max(LargestRead,count);
      return base.Read(bytes,offset,Math.Min(count,173));
    }
  }
  class WireTest {
    static void Check(bool condition) { if(!condition) throw new Exception("Assertion failed"); }
    static byte[] Packet(uint error,byte[] body) {
      using(var stream=new MemoryStream()) { Wire.Reply(stream,error,body);return stream.ToArray(); }
    }
    static void Main() {
      foreach(int size in new[]{0,7,65536,1024*1024+13}) {
        var body=new byte[size];for(int i=0;i<size;i++)body[i]=(byte)(i%251);
        var bytes=Packet(5,body);
        using(var source=new FragmentedStream(bytes)) using(var output=new MemoryStream()) {
          uint error;Check(Wire.ForwardReply(source,output,2000000,new byte[65536],out error)==size);
          Check(error==5&&source.LargestRead<=65536);
          var actual=output.ToArray();Check(actual.Length==bytes.Length);
          for(int i=0;i<actual.Length;i++)Check(actual[i]==bytes[i]);
        }
      }
      using(var source=new MemoryStream(Packet(0,new byte[10]))) using(var output=new MemoryStream()) {
        uint error;bool rejected=false;
        try { Wire.ForwardReply(source,output,9,new byte[3],out error); } catch(InvalidDataException) { rejected=true; }
        Check(rejected&&output.Length==0);
      }
      var truncated=Packet(0,new byte[10]);Array.Resize(ref truncated,truncated.Length-1);
      using(var source=new MemoryStream(truncated)) using(var output=new MemoryStream()) {
        uint error;bool rejected=false;
        try { Wire.ForwardReply(source,output,10,new byte[3],out error); } catch(EndOfStreamException) { rejected=true; }
        Check(rejected);
      }
      Console.WriteLine("Bounded relay: fragmented, empty, oversized and truncated responses passed");
    }
  }
}
