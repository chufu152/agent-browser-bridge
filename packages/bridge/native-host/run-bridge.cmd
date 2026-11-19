@echo off
rem Universal Browser Agent - native messaging host launcher (ASCII paths only)
rem 用 tsx 直接运行 bridge 源码；生产部署可改为编译后的 dist 入口。
node "%~dp0..\..\node_modules\tsx\dist\cli.mjs" "%~dp0..\..\src\cli.ts"
