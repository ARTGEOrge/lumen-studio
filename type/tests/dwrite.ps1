# Loads exported fonts with Windows' own font stack (WPF GlyphTypeface → DirectWrite) without installing them,
# checks names / cmap / advances and renders a line of text to count inked pixels.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File type/tests/dwrite.ps1 <folder>
param([string]$Folder)
Add-Type -AssemblyName PresentationCore, WindowsBase
$fails = 0
Get-ChildItem $Folder -Include *.ttf, *.otf -Recurse | ForEach-Object {
  try {
    $gt = New-Object System.Windows.Media.GlyphTypeface([Uri]$_.FullName)
    $fam = $gt.FamilyNames[[Globalization.CultureInfo]::GetCultureInfo('en-US')]
    $text = 'AVATAR Hamburg'
    if (-not $gt.CharacterToGlyphMap.ContainsKey([int][char]'H')) { $text = 'AVATA VOTO ' + [char]0xC1 + [char]0xD8 }
    $ids = New-Object 'System.Collections.Generic.List[UInt16]'; $adv = New-Object 'System.Collections.Generic.List[Double]'
    $missing = 0
    foreach ($ch in $text.ToCharArray()) { $g = 0; if (-not $gt.CharacterToGlyphMap.TryGetValue([int]$ch, [ref]$g)) { $missing++ }; $ids.Add($g); $adv.Add($gt.AdvanceWidths[$g] * 48) }
    $run = New-Object System.Windows.Media.GlyphRun($gt, 0, $false, 48, $ids, (New-Object System.Windows.Point(10, 60)), $adv, $null, $null, $null, $null, $null, $null)
    $dv = New-Object System.Windows.Media.DrawingVisual; $dc = $dv.RenderOpen()
    $dc.DrawRectangle([System.Windows.Media.Brushes]::White, $null, (New-Object System.Windows.Rect(0, 0, 520, 90)))
    $dc.DrawGlyphRun([System.Windows.Media.Brushes]::Black, $run); $dc.Close()
    $bmp = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(520, 90, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32); $bmp.Render($dv)
    $px = New-Object byte[] (520 * 90 * 4); $bmp.CopyPixels($px, 520 * 4, 0)
    $ink = 0; for ($i = 0; $i -lt $px.Length; $i += 4) { if ($px[$i] -lt 128) { $ink++ } }
    $okk = ($missing -eq 0) -and ($ink -gt 500) -and $fam
    if (-not $okk) { $script:fails++ }
    "{0}: family '{1}', {2} glyphs, missing {3}, inked pixels {4} -> {5}" -f $_.Name, $fam, $gt.GlyphCount, $missing, $ink, $(if ($okk) { 'OK' } else { 'FAIL' })
  } catch { $script:fails++; "{0}: FAIL {1}" -f $_.Name, $_.Exception.Message }
}
"DirectWrite/WPF check: $fails failed"
exit $fails
