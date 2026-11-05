using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;

[DataContract] class Manifest {
 [DataMember] public string source, target, expected, report, marker, log, healthReport, expectedVersion;
 [DataMember] public int parentPid;
 [DataMember] public bool portable, restart;
}
[DataContract] class Result {
 [DataMember] public string status, message, time;
}
[DataContract] class Health {
 [DataMember] public bool passed;
 [DataMember] public string version;
}
class UpdateHelper {
 static Manifest m;
 static T Read<T>(string file) { using(var stream=File.OpenRead(file)) return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream); }
 static void Trace(string message) { File.AppendAllText(m.log, DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine); }
 static void Report(string status,string message) {
  string stage=m.report+".tmp";
  using(var stream=File.Create(stage)) new DataContractJsonSerializer(typeof(Result)).WriteObject(stream,new Result {status=status,message=message,time=DateTime.UtcNow.ToString("o")});
  if(File.Exists(m.report)) File.Delete(m.report);
  File.Move(stage,m.report);
 }
 static string Hash(string file) { using(var hash=SHA256.Create()) using(var stream=File.OpenRead(file)) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
 static Process Start(string file,string args) {
  return Process.Start(new ProcessStartInfo(file,args) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(file)});
 }
 static void Replace(string source,string target,string backup) {
  for(int i=0;;i++) { try {File.Replace(source,target,backup,true);return;} catch(IOException) {if(i>=59)throw;Thread.Sleep(1000);} }
 }
 static int Main(string[] args) {
  bool swapped=false; string stage=null,backup=null; Process health=null;
  try {
   if(args.Length!=1) return 2;
   m=Read<Manifest>(args[0]);
   stage=m.target+".next.exe";backup=m.target+".previous.exe";
   Trace("Helper started");
   Process parent=null;
   try {parent=Process.GetProcessById(m.parentPid);} catch(ArgumentException) {}
   File.WriteAllText(m.marker,"ready");
   if(parent!=null) {using(parent) {if(!parent.WaitForExit(60000))throw new Exception("Application did not exit; update cancelled");}}
   Trace("Verifying checksum");
   if(Hash(m.source)!=m.expected)throw new Exception("SHA-256 mismatch; no files replaced");
   if(m.portable) {
    File.Copy(m.source,stage,true);
    if(Hash(stage)!=m.expected)throw new Exception("Staged file checksum mismatch");
    Replace(stage,m.target,backup);swapped=true;
   } else {
    Trace("Starting installer");
    using(var installer=Start(m.source,"/S /D="+Path.GetDirectoryName(m.target))) {
     if(!installer.WaitForExit(120000))throw new Exception("Installer timeout; check installer window");
     if(installer.ExitCode!=0)throw new Exception("Installer exit code: "+installer.ExitCode);
    }
   }
   Trace("Checking updated application");
   File.Delete(m.healthReport);
   var info=new ProcessStartInfo(m.target,"--update-health") {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(m.target)};
   info.EnvironmentVariables["BITORA_UPDATE_HEALTH_REPORT"]=m.healthReport;
   health=Process.Start(info);
   if(!health.WaitForExit(60000)) {health.Kill();health.WaitForExit(10000);throw new Exception("Updated app startup timed out");}
   if(health.ExitCode!=0 || !File.Exists(m.healthReport) || !Read<Health>(m.healthReport).passed)throw new Exception("Updated app startup failed");
   if(!String.IsNullOrEmpty(m.expectedVersion) && Read<Health>(m.healthReport).version!=m.expectedVersion)throw new Exception("Installed version does not match downloaded release");
   Report("success","Update installed and startup verified");
   if(m.restart)Start(m.target,"");
   return 0;
  } catch(Exception error) {
   if(m==null)return 2;
   string message=error.Message;
   try {
    Trace(message);
    if(swapped) {Replace(backup,m.target,null);Report("rolled-back",message);if(m.restart)Start(m.target,"");}
    else Report("error",message);
   } catch(Exception rollback) {try {Report("error",message+"; "+rollback.Message);} catch {}}
   return 1;
  } finally {
   if(health!=null)health.Dispose();
   try {if(stage!=null)File.Delete(stage);} catch {}
  }
 }
}
