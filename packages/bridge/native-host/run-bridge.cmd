@echo off
rem Universal Browser Agent - native messaging host launcher.
rem Launched by the browser (Edge/Chrome) via native messaging, so:
rem  1) node is NOT on PATH -> use full path
rem  2) resolve tsx/cli.ts relative to this file (3 levels up = repo root, 1 level up = bridge)
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0..\..\..\node_modules\tsx\dist\cli.mjs" "%~dp0..\src\cli.ts"
