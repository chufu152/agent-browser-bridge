@echo off
rem UBA one-click USE: run the demo agent that controls the browser.
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0agent.mjs" %*
pause
