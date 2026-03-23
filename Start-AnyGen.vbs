Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
BaseDir = Fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & BaseDir & "\Start-AnyGen.bat" & """", 0, False
