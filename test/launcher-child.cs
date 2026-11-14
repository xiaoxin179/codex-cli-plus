using System;
using System.IO;
using System.Threading;
class Child {
    static void Main() {
        Thread.Sleep(400);
        File.WriteAllText(Environment.GetEnvironmentVariable("CODEX_CLI_PLUS_READY_FILE"),"ready");
        Thread.Sleep(200);
    }
}
