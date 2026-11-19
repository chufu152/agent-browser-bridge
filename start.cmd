@echo off
rem UBA one-click enable: register native messaging host.
rem Resolve node without relying on PATH (node may only exist in WorkBuddy session).
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0start.mjs" %*
pause
