@echo off
rem HarfCanvas fitting worker: fits every job that lands in this folder, several at once.
rem Leave the window open while it works; close it (or press Ctrl+C) to stop. Unfinished jobs go back in line.
set Q=%~dp0
py -3 "%Q%code\fitqueue.py" work "%Q%." %*
pause
