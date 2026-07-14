Option Explicit

If WScript.Arguments.Count <> 2 Then WScript.Quit 87

Dim shell, fileSystem, scriptDirectory, powerShellPath, launcherPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcherPath = scriptDirectory & "\start-wsl-runtime-keepalive.ps1"

If Not fileSystem.FileExists(powerShellPath) Or Not fileSystem.FileExists(launcherPath) Then WScript.Quit 2

Function Quote(value)
  Quote = Chr(34) & CStr(value) & Chr(34)
End Function

command = Quote(powerShellPath) & " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & _
  Quote(launcherPath) & " -Distro " & Quote(WScript.Arguments(0)) & " -StateDirectory " & Quote(WScript.Arguments(1))

' Window style 0 starts the PowerShell helper without a ConsoleHost window.
WScript.Quit shell.Run(command, 0, True)
