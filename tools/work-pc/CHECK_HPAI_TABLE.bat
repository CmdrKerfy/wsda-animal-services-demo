@echo off
setlocal
REM ===========================================================================
REM  HPAI table check: the shape and the counts of an HPAI positives table.
REM
REM  Double-click this file. A file window asks for the table (a .csv); R reads
REM  it with check_hpai_table.R beside this file (base R only, no packages) and
REM  shows a report, saved beside this file as hpai_table_check_YYYY-MM-DD.txt.
REM
REM  THE TABLE IS ONLY READ: never changed, never copied. Nothing else is
REM  opened, nothing is installed and nothing is sent anywhere. The report
REM  holds only counts: never a Case ID, a name, an address, a coordinate, a
REM  county's name or a full date from the table. Read it before sending it.
REM
REM  Rscript is found as the CVI tools find it (launch_CVI.bat): CVI_RSCRIPT,
REM  R_HOME, the PATH, the usual install folders, the registry, then an
REM  R-Portable folder nearby. No user or system settings are changed.
REM ===========================================================================

set "HERE=%~dp0"
REM %~dp0 ends with a backslash; strip it for anything passed to R.
set "HERE_NOSLASH=%HERE:~0,-1%"

title HPAI Table Check
echo.
echo  ===================================================================
echo   HPAI TABLE CHECK (counts only)
echo  ===================================================================
echo.
echo   The table is only read: never changed, never copied.
echo   The report holds counts only: no Case ID, name, address,
echo   coordinate, county name or full date.
echo.

if not exist "%HERE%check_hpai_table.R" (
  echo  ERROR: check_hpai_table.R is missing from this folder.
  echo  Unzip the whole ZIP into one folder and try again.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM  Resolve Rscript.exe (R itself, not RStudio.exe)
REM ---------------------------------------------------------------------------
set "R_EXE="
if defined CVI_RSCRIPT if exist "%CVI_RSCRIPT%" set "R_EXE=%CVI_RSCRIPT%"
if not exist "%R_EXE%" if defined R_HOME if exist "%R_HOME%\bin\Rscript.exe" set "R_EXE=%R_HOME%\bin\Rscript.exe"
if not exist "%R_EXE%" for /f "usebackq delims=" %%A in (`where Rscript.exe 2^>nul`) do (set "R_EXE=%%A" & goto after_where)
:after_where
if not exist "%R_EXE%" for /d %%G in ("%ProgramFiles%\R\R-*") do if exist "%%G\bin\Rscript.exe" (set "R_EXE=%%G\bin\Rscript.exe" & goto have_r)
if not exist "%R_EXE%" for /d %%G in ("%ProgramFiles(x86)%\R\R-*") do if exist "%%G\bin\Rscript.exe" (set "R_EXE=%%G\bin\Rscript.exe" & goto have_r)
if not exist "%R_EXE%" for /d %%G in ("%LocalAppData%\Programs\R\R-*") do if exist "%%G\bin\Rscript.exe" (set "R_EXE=%%G\bin\Rscript.exe" & goto have_r)
if not exist "%R_EXE%" for /d %%G in ("%USERPROFILE%\AppData\Local\Programs\R\R-*") do if exist "%%G\bin\Rscript.exe" (set "R_EXE=%%G\bin\Rscript.exe" & goto have_r)
if not exist "%R_EXE%" call :FindRInRegistry
if not exist "%R_EXE%" set "R_EXE=%HERE%R-Portable\bin\Rscript.exe"
if not exist "%R_EXE%" set "R_EXE=%HERE%..\R-Portable\bin\Rscript.exe"
if not exist "%R_EXE%" set "R_EXE=%HERE%..\..\R-Portable\bin\Rscript.exe"
if not exist "%R_EXE%" set "R_EXE=%HERE%..\..\..\R-Portable\bin\Rscript.exe"
:have_r

if not exist "%R_EXE%" (
  echo  ERROR: could not find Rscript.exe on this computer.
  echo.
  echo  R and RStudio are different programs; RStudio does not contain
  echo  Rscript. Nothing was read. Tell whoever sent you this file that
  echo  Rscript was not found.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM  Pick the table with a normal Windows file window. Nothing is typed.
REM ---------------------------------------------------------------------------
set "PICKED="
set "PICK_TMP=%TEMP%\hpai_pick_%RANDOM%.txt"
echo  A file window will open. Choose the HPAI table (a .csv file).
echo  ^(If it opens behind this window, check your taskbar.^)
echo.
REM The chosen path goes back through a temp file named in $env:PICK_TMP (so an
REM apostrophe in the user folder cannot break the command), written in the
REM console's code page with no byte-order mark, as set /p reads it. A path
REM with letters outside that code page is passed in its short form when
REM Windows has one.
powershell -NoProfile -NoLogo -STA -Command "$ErrorActionPreference='SilentlyContinue'; Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select the HPAI table (it will NOT be changed)'; $d.Filter='CSV files (*.csv)|*.csv|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){ $p = $d.FileName; $e = [Console]::OutputEncoding; if($e.GetString($e.GetBytes($p)) -ne $p){ try { $s = (New-Object -ComObject Scripting.FileSystemObject).GetFile($p).ShortPath; if($s -and $e.GetString($e.GetBytes($s)) -eq $s){ $p = $s } } catch {} }; [System.IO.File]::WriteAllBytes($env:PICK_TMP, $e.GetBytes($p)) }" 1>nul 2>nul

if exist "%PICK_TMP%" set /p PICKED=<"%PICK_TMP%"
if exist "%PICK_TMP%" del "%PICK_TMP%" 1>nul 2>nul

if not defined PICKED (
  echo  No file was chosen, so nothing was done.
  echo.
  pause
  exit /b 0
)
if not exist "%PICKED%" (
  echo  That file could not be opened.
  echo.
  pause
  exit /b 1
)

REM The report's name carries today's date, written the same way on every computer.
set "TODAY="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -NoLogo -Command "Get-Date -Format yyyy-MM-dd"`) do set "TODAY=%%D"
if not defined TODAY set "TODAY=today"
set "REPORT=%HERE%hpai_table_check_%TODAY%.txt"

for %%F in ("%PICKED%") do set "PICKED_NAME=%%~nxF"
echo  Checking: "%PICKED_NAME%"
echo.

REM --vanilla: no profile or saved workspace is read; base R needs nothing else.
"%R_EXE%" --vanilla "%HERE_NOSLASH%\check_hpai_table.R" "%PICKED%" "%REPORT%"
set "RC=%ERRORLEVEL%"

echo.
echo  ===================================================================
echo   FINISHED. The table was NOT changed.
echo.
if exist "%REPORT%" (
  echo   The report was saved IN THIS FOLDER as:
  echo     hpai_table_check_%TODAY%.txt
  echo.
  echo   Read it before sending it. Opening the folder for you now...
  explorer /select,"%REPORT%"
) else (
  echo   The report file was not created. If there is a message above,
  echo   copy it and send it back: right-click the title bar, then
  echo   Edit, Select All, then Edit, Copy.
)
echo  ===================================================================
echo.
pause
exit /b %RC%

REM ---------------------------------------------------------------------------
:FindRInRegistry
REM Registry lookup for R, inline PowerShell only: no .ps1 file is written,
REM because script files are often blocked by policy.
set "REG_TMP=%TEMP%\hpai_r_reg_%RANDOM%.txt"
powershell -NoProfile -NoLogo -Command "$ErrorActionPreference='SilentlyContinue'; foreach($b in 'HKLM:\SOFTWARE\R-core\R64','HKCU:\SOFTWARE\R-core\R64'){ if(Test-Path -LiteralPath $b){ Get-ChildItem -LiteralPath $b | ForEach-Object { $d = (Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue).InstallPath; if($d -and (Test-Path -LiteralPath (Join-Path -Path $d -ChildPath 'bin\Rscript.exe'))){ [Console]::Out.Write((Join-Path -Path $d -ChildPath 'bin\Rscript.exe')); exit 0 } } } }" 1>"%REG_TMP%" 2>nul
if exist "%REG_TMP%" set /p R_EXE=<"%REG_TMP%"
if exist "%REG_TMP%" del "%REG_TMP%" 1>nul 2>nul
goto :eof
