@echo off
rem tiny-trellis launcher for a fresh checkout: runs tt.py next to this file with the
rem first Python 3.9+ it finds, in the same order the hooks use. Run `tt install`
rem once to put tt on PATH.
setlocal
set "TT_PROBE=import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"
python3 -c "%TT_PROBE%" >nul 2>nul && goto python3
python -c "%TT_PROBE%" >nul 2>nul && goto python
py -3 -c "%TT_PROBE%" >nul 2>nul && goto py
echo tiny-trellis needs Python 3.9 or later, and none was found (tried python3, python, py -3). 1>&2
echo Install Python 3 from https://www.python.org/downloads/ or with winget, then run this again. 1>&2
exit /b 1
:python3
python3 "%~dp0tt.py" %*
exit /b %errorlevel%
:python
python "%~dp0tt.py" %*
exit /b %errorlevel%
:py
py -3 "%~dp0tt.py" %*
exit /b %errorlevel%
