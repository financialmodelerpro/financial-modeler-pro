# excel-recalc.ps1 (2026-09-27)
#
# Opens a workbook in REAL Excel, forces a full recalculation, and writes every
# numeric and error cell of every sheet to a TSV file, so the formula-linked
# export can be compared against what the platform computes. Excel, not a
# formula library, is the judge: a library that evaluates a formula differently
# from Excel would prove nothing about what a user sees.
#
# Optionally sets input cells first (-Sets "Sheet!A1=123;Sheet!B2=4"), which is
# how a change to an input is tested: set, recalculate, read back.
#
# Output: <OutPath>, lines of  sheet<TAB>row<TAB>col<TAB>kind<TAB>value
#   kind = n (number), s (text, tabs and line breaks as spaces) or e (error code); plus a header line of calc settings and
#   one "#formulas" line per sheet.
# Read-only: the workbook is never saved.
#
# No em dashes in this file.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$Sets = ''
)
$ErrorActionPreference = 'Stop'
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false; $x.AskToUpdateLinks = $false; $x.EnableEvents = $false
$wb = $null
try {
  $wb = $x.Workbooks.Open($Path, 0, $true)
  $out = New-Object System.Collections.Generic.List[string]
  $out.Add("#calc`titeration=$($x.Iteration)`tmaxIterations=$($x.MaxIterations)`tmaxChange=$($x.MaxChange)")
  if ($Sets -ne '') {
    foreach ($s in $Sets.Split(';')) {
      if ($s.Trim() -eq '') { continue }
      $eq = $s.LastIndexOf('=')
      $ref = $s.Substring(0, $eq); $val = [double]::Parse($s.Substring($eq + 1), [System.Globalization.CultureInfo]::InvariantCulture)
      $bang = $ref.LastIndexOf('!')
      $sheet = $ref.Substring(0, $bang).Trim("'"); $addr = $ref.Substring($bang + 1)
      $wb.Worksheets.Item($sheet).Range($addr).Value2 = $val
    }
  }
  $x.CalculateFullRebuild()
  foreach ($ws in $wb.Worksheets) {
    $name = $ws.Name
    $nf = 0
    try { $nf = $ws.UsedRange.SpecialCells(-4123).Count } catch { $nf = 0 }
    $out.Add("#formulas`t$name`t$nf")
    $ur = $ws.UsedRange
    $r0 = $ur.Row; $c0 = $ur.Column
    $vals = $ur.Value2
    # $null first: "$vals -eq $null" FILTERS an array for nulls (truthy whenever a cell is blank), it does not test it.
    if ($null -eq $vals) { continue }
    if (-not ($vals -is [System.Array])) { $vals = New-Object 'object[,]' 1,1; $vals[1,1] = $ur.Value2 }
    $nr = $vals.GetUpperBound(0); $nc = $vals.GetUpperBound(1)
    for ($i = 1; $i -le $nr; $i++) {
      for ($j = 1; $j -le $nc; $j++) {
        $v = $vals[$i, $j]
        if ($v -is [double]) { $out.Add("$name`t$($r0 + $i - 1)`t$($c0 + $j - 1)`tn`t" + $v.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)) }
        elseif ($v -is [string]) { if ($v -ne '') { $out.Add("$name`t$($r0 + $i - 1)`t$($c0 + $j - 1)`ts`t" + ($v -replace "[`t`r`n]", ' ')) } }
        elseif ($v -is [int]) { $out.Add("$name`t$($r0 + $i - 1)`t$($c0 + $j - 1)`te`t$v") }
      }
    }
  }
  [System.IO.File]::WriteAllLines($OutPath, $out)
} finally {
  if ($null -ne $wb) { $wb.Close($false) }
  $x.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($x)
}
