@echo off
rem UBA one-click install. Resolves node (WorkBuddy path first, then PATH).
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0setup.mjs"
pause
