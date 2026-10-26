Option Explicit
Dim uri, fs, root, node, launcher, shell
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
uri = LCase(WScript.Arguments(0))
If uri <> "moadrop://open" And uri <> "moadrop://open/" Then WScript.Quit 2
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
node = fs.BuildPath(root, "runtime\node.exe")
launcher = fs.BuildPath(root, "scripts\local-start.mjs")
If Not fs.FileExists(node) Or Not fs.FileExists(launcher) Then WScript.Quit 3
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
' Never forward the URI, URL, or other web input to a command interpreter.
shell.Run Chr(34) & node & Chr(34) & " " & Chr(34) & launcher & Chr(34) & " --no-open", 0, False
