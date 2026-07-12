@echo off
set "CORTEX_ROOT=%~dp0.."
if exist "%CORTEX_ROOT%\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%CORTEX_ROOT%\.env") do (
    if /I "%%A"=="CORTEX_INGEST_URL" if not defined CORTEX_INGEST_URL set "CORTEX_INGEST_URL=%%B"
    if /I "%%A"=="CORTEX_INGEST_TOKEN" if not defined CORTEX_INGEST_TOKEN set "CORTEX_INGEST_TOKEN=%%B"
  )
)
set CORTEX_HOOK_NAME=afterFileEdit
node "%~dp0cursor-hook.mjs"
