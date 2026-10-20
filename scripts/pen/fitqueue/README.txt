HarfCanvas fitting worker
=========================

This folder is a job queue. The computer reading the Thuluth studio drops fitting jobs into todo\,
and any computer running the worker picks them up, fits them, and puts the results in done\.
Nothing else in this folder needs touching.

Setting up a computer to do the fitting (once):

  1. Install Python 3.13 from https://www.python.org/downloads/ (tick "Add python.exe to PATH";
     the installer also adds the "py" command these files use).
  2. Double-click install-packages.bat here. It installs numpy, scipy, OpenCV and PyTorch
     (the PyTorch download is about 3 GB; it lets the fitting run on an NVIDIA graphics card).

Running it:

  3. Double-click start-worker.bat here. It uses all but two of the computer's processor threads.
     To choose the number yourself, run it from a command prompt as:  start-worker.bat --jobs 12
  4. Leave the window open. Its first line names the graphics card it uses; then it prints
     a line as each job starts and finishes.
     Close it to stop; anything half done goes back in line for next time.

The fitting code lives in code\ and is updated automatically by the reading side, so there is
nothing to update here by hand.
