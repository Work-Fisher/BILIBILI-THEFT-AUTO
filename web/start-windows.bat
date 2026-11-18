@echo off
cd /d "%~dp0"
python start-game.py
if errorlevel 1 pause
