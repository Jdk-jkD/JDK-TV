Option Explicit

Dim shell, files, root, powershell, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Quote(powershell) & " -NoProfile -ExecutionPolicy Bypass -File " & Quote(files.BuildPath(root, "Start-JDKTV.ps1"))

exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
    MsgBox "Could not start the app. Check the logs in:" & vbCrLf & files.BuildPath(root, "logs"), vbExclamation, "JDK TV"
End If
WScript.Quit exitCode

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
