using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// The progress numerator is bytes actually written, never elapsed time.
internal sealed class Launcher : Form {
    long written, total;
    volatile int phase; // 0: reading archive, 1: extracting, 2: opening app, 3: ready
    volatile bool cancel;
    volatile string failure;
    Process child;
    Task work;
    readonly string root = Path.Combine(Path.GetTempPath(), "codex-cli-plus-" + Guid.NewGuid().ToString("N"));
    readonly Label status = new Label(), detail = new Label();
    readonly Panel track = new Panel();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    double ratio;

    [STAThread] static int Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var form = new Launcher()) {
            Application.Run(form);
            if (form.work != null) { try { form.work.Wait(); } catch {} }
            // Keep the extracted application alive for the whole desktop session.
            if (form.child != null) { try { form.child.WaitForExit(); } catch {} }
            try { if (Directory.Exists(form.root)) Directory.Delete(form.root, true); } catch {}
            return form.failure == null ? 0 : 1;
        }
    }
    Launcher() {
        Text = "正在启动 · Codex CLI Plus";
        ClientSize = new Size(440, 280);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(23,29,39);
        ForeColor = Color.FromArgb(237,241,248);
        Font = new Font("Microsoft YaHei UI", 10);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        var picture = new PictureBox {Image=Icon.ToBitmap(),SizeMode=PictureBoxSizeMode.Zoom,Bounds=new Rectangle(188,24,64,64)};
        Controls.Add(picture);
        var title = new Label {Text="Codex CLI Plus",Font=new Font("Segoe UI",18,FontStyle.Bold),TextAlign=ContentAlignment.MiddleCenter,Bounds=new Rectangle(20,100,400,36)};
        Controls.Add(title);
        status.Text = "正在读取程序文件…";
        status.TextAlign = ContentAlignment.MiddleCenter;
        status.SetBounds(20,144,400,28); Controls.Add(status);
        track.SetBounds(52,188,336,8); track.BackColor=Color.FromArgb(48,56,70);
        track.Paint += (s,e) => { using(var brush=new SolidBrush(Color.FromArgb(164,238,211))) e.Graphics.FillRectangle(brush,0,0,(int)(track.Width*ratio),track.Height); };
        Controls.Add(track);
        detail.TextAlign=ContentAlignment.MiddleCenter; detail.ForeColor=Color.FromArgb(161,175,194);
        detail.SetBounds(18,208,404,52); Controls.Add(detail);
        timer.Interval=50; timer.Tick += UpdateProgress;
        Shown += (s,e) => { timer.Start(); work=Task.Run((Action)ExtractAndStart); };
        FormClosing += (s,e) => { cancel=true; timer.Stop(); };
    }
    void UpdateProgress(object sender, EventArgs args) {
        long size=Interlocked.Read(ref total), done=Interlocked.Read(ref written);
        ratio=size>0 ? Math.Min(1,(double)done/size) : 0;
        track.Invalidate();
        if (failure!=null) { status.Text="启动失败"; detail.Text=failure; timer.Stop(); return; }
        if (phase==3) { Close(); return; }
        if (phase==2) { status.Text="文件已就绪，正在打开工作台…"; detail.Text="解压完成 100% · 等待首页就绪"; }
        else if(phase==1) {
            status.Text="正在解压程序文件 · " + Math.Floor(ratio*100) + "%";
            detail.Text=String.Format("{0:F1} MB / {1:F1} MB",done/1048576.0,size/1048576.0);
        }
    }
    void ExtractAndStart() {
        try {
            Directory.CreateDirectory(root);
            using(var file=new FileStream(Application.ExecutablePath,FileMode.Open,FileAccess.Read,FileShare.Read)) {
                if(file.Length<16) throw new InvalidDataException("启动文件不完整，请重新下载。");
                file.Position=file.Length-16;
                var footer=new byte[16]; ReadFully(file,footer);
                if(Encoding.ASCII.GetString(footer,8,8)!="CCPLUS01") throw new InvalidDataException("启动文件格式无效。");
                long length=BitConverter.ToInt64(footer,0), start=file.Length-16-length;
                if(length<=0 || start<=0) throw new InvalidDataException("程序文件长度无效。");
                using(var payload=new SliceStream(file,start,length))
                using(var zip=new ZipArchive(payload,ZipArchiveMode.Read)) {
                    Interlocked.Exchange(ref total,zip.Entries.Sum(entry=>entry.Length));
                    phase=1;
                    var buffer=new byte[128*1024];
                    foreach(var entry in zip.Entries) {
                        if(cancel) return;
                        string target=Path.GetFullPath(Path.Combine(root,entry.FullName));
                        if(!target.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("程序包包含无效路径。");
                        if(entry.Name.Length==0) {Directory.CreateDirectory(target);continue;}
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using(var input=entry.Open())
                        using(var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                            int n;
                            while((n=input.Read(buffer,0,buffer.Length))>0) {
                                if(cancel) return;
                                output.Write(buffer,0,n);
                                Interlocked.Add(ref written,n);
                            }
                        }
                    }
                }
            }
            if(cancel) return;
            phase=2;
            string ready=Path.Combine(root,"startup.ready");
            var info=new ProcessStartInfo(Path.Combine(root,"Codex CLI Plus.exe")) {UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(Application.ExecutablePath)};
            info.Arguments=String.Join(" ",Environment.GetCommandLineArgs().Skip(1).Select(Quote));
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"]=Path.GetDirectoryName(Application.ExecutablePath);
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_FILE"]=Application.ExecutablePath;
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_APP_FILENAME"]="Codex CLI Plus";
            info.EnvironmentVariables["CODEX_CLI_PLUS_READY_FILE"]=ready;
            child=Process.Start(info);
            var clock=Stopwatch.StartNew();
            while(!cancel && clock.ElapsedMilliseconds<30000) {
                if(File.Exists(ready)) {
                    string result;
                    try {result=File.ReadAllText(ready);} catch(IOException) {Thread.Sleep(50);continue;}
                    if(result=="ready") {phase=3;return;}
                    if(result=="error") throw new InvalidOperationException("工作台加载失败，请查看应用错误提示。");
                }
                if(child.HasExited && child.ExitCode!=0) throw new InvalidOperationException("应用未能启动，请关闭此窗口后重试。");
                Thread.Sleep(50);
            }
            if(!cancel) failure="工作台尚未就绪。可关闭此提示，检查应用窗口。";
        } catch(Exception ex) {failure=ex.Message;}
    }
    static string Quote(string value) {
        var result=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) {
            if(c=='\\') {slashes++;continue;}
            if(c=='\"') {result.Append('\\',slashes*2+1).Append(c);slashes=0;continue;}
            result.Append('\\',slashes).Append(c); slashes=0;
        }
        return result.Append('\\',slashes*2).Append('"').ToString();
    }
    static void ReadFully(Stream stream,byte[] buffer) {
        int offset=0;
        while(offset<buffer.Length) {int n=stream.Read(buffer,offset,buffer.Length-offset);if(n==0)throw new EndOfStreamException();offset+=n;}
    }
    sealed class SliceStream : Stream {
        readonly Stream source; readonly long start,length; long position;
        public SliceStream(Stream stream,long offset,long size) {source=stream;start=offset;length=size;}
        public override bool CanRead {get{return true;}} public override bool CanSeek {get{return true;}} public override bool CanWrite {get{return false;}}
        public override long Length {get{return length;}} public override long Position {get{return position;}set{Seek(value,SeekOrigin.Begin);}}
        public override int Read(byte[] buffer,int offset,int count) {source.Position=start+position;int n=source.Read(buffer,offset,(int)Math.Min(count,length-position));position+=n;return n;}
        public override long Seek(long offset,SeekOrigin origin) {long next=origin==SeekOrigin.Begin?offset:origin==SeekOrigin.Current?position+offset:length+offset;if(next<0||next>length)throw new IOException("Invalid payload offset");return position=next;}
        public override void Flush() {} public override void SetLength(long value) {throw new NotSupportedException();} public override void Write(byte[] b,int o,int c) {throw new NotSupportedException();}
    }
}
