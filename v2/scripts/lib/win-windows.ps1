# Lists the Chrome / Edge windows whose title contains -Marker (a test marker), with their state.
# Other windows are never reported. No screenshots.
# Output: one JSON array — title, process, iconic (minimized), topmost, foreground.
param([Parameter(Mandatory = $true)][string]$Marker)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DvWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$fg = [DvWin]::GetForegroundWindow()
$out = New-Object System.Collections.ArrayList
$cb = [DvWin+EnumProc]{
  param($h, $p)
  if (-not [DvWin]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][DvWin]::GetWindowText($h, $sb, 512)
  $title = $sb.ToString()
  if ($title -eq '' -or -not $title.Contains($Marker)) { return $true }
  $procId = 0
  [void][DvWin]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  if ($name -notin @('chrome', 'msedge')) { return $true }
  $ex = [DvWin]::GetWindowLong($h, -20)
  [void]$out.Add([pscustomobject]@{ title = $title; process = $name; iconic = [DvWin]::IsIconic($h); topmost = (($ex -band 0x8) -ne 0); foreground = ($h -eq $fg) })
  return $true
}
[void][DvWin]::EnumWindows($cb, [IntPtr]::Zero)
$out | ConvertTo-Json -Compress
