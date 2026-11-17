$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$alls=[System.Windows.Forms.Screen]::AllScreens
$i=0
foreach($s in $alls){
  $b=$s.Bounds
  $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
  $bmp.Save(("D:/workBuddySpace/desktop-manager/scripts/shot-m$i.png"))
  $g.Dispose(); $bmp.Dispose(); $i++
}
Write-Output "saved $i"
