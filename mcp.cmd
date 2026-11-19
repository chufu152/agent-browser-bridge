@echo off
rem UBA MCP Server launcher (stdio). Run manually to test, or point your agent's MCP config here.
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0node_modules\tsx\dist\cli.mjs" "%~dp0packages\mcp-server\src\index.ts"
