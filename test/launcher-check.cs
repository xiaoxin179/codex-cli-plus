using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

class LauncherCheck {
    static object Get(object target,string name) {return target.GetType().GetField(name,BindingFlags.NonPublic|BindingFlags.Instance).GetValue(target);}
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        var form=(Form)Activator.CreateInstance(typeof(Launcher),true);
        string root=(string)Get(form,"root");
        long previous=0; var percentages=new HashSet<int>(); bool waiting=false, captured=false;
        string mode=args.Length>0?args[0]:"success";
        form.Show();
        var deadline=DateTime.UtcNow.AddSeconds(20);
        try {
            while(form.Visible && DateTime.UtcNow<deadline) {
                Application.DoEvents();
                long done=(long)Get(form,"written"), total=(long)Get(form,"total");
                if(done<previous || done>total) throw new Exception("Invalid byte progress");
                previous=done;
                if(total>0 && done>0 && done<total) {
                    percentages.Add((int)(done*100/total));
                    if(mode=="cancel") {form.Close();break;}
                    if(!captured && ((Label)Get(form,"status")).Text.Contains("%")) {
                        using(var image=new Bitmap(form.Width,form.Height)) {form.DrawToBitmap(image,new Rectangle(Point.Empty,form.Size));image.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"real-progress.png"));}
                        captured=true;
                    }
                }
                if((int)Get(form,"phase")==2) waiting=true;
                string failure=(string)Get(form,"failure");
                if(failure!=null) throw new Exception(failure);
                Thread.Sleep(10);
            }
            var task=(Task)Get(form,"work");
            if(!task.Wait(3000)) throw new Exception("Worker did not finish");
            if(mode=="cancel") {
                if(Get(form,"child")!=null) throw new Exception("Cancellation launched application");
            } else {
                if((int)Get(form,"phase")!=3 || form.Visible) throw new Exception("Startup never acknowledged");
                if(percentages.Count<2 || !waiting) throw new Exception("No observed intermediate progress / readiness wait");
                if(new FileInfo(Path.Combine(root,"payload.bin")).Length!=268435456) throw new Exception("Wrong extraction size");
                var child=(System.Diagnostics.Process)Get(form,"child"); child.WaitForExit();
            }
            Console.WriteLine("PASS "+mode+": byte-based percentages="+String.Join(",",percentages)+"; readiness wait="+waiting);
            return 0;
        } catch(Exception ex) {Console.Error.WriteLine(ex);return 1;}
        finally {form.Close(); var task=(Task)Get(form,"work"); if(task!=null)task.Wait(3000); if(Directory.Exists(root))Directory.Delete(root,true);form.Dispose();}
    }
}
