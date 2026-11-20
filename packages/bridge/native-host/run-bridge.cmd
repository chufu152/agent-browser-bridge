@echo off
rem Universal Browser Agent - bridge launcher (CDP edition).
rem Historically launched by the browser via native messaging; now also a resilient
rem auto-start path for the CDP bridge. Singleton guard in cli.ts prevents duplicates.
setlocal
echo [%date% %time%] launched >> "%~dp0bridge-launch.log"
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
set "UBA_ENGINE_FILE=%~dp0..\..\..\dist\bin\page-engine.js"
"%NODE%" "%~dp0..\..\..\dist\bin\bridge.cjs" 2>> "%~dp0bridge-error.log"