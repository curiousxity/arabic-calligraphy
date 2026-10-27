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

On a Mac (it works alongside the Geekmini, taking jobs from the same list):

  1. Connect to the NAS in Finder (Go > Connect to Server, smb://monas/homes) and open this folder.
  2. Install Python 3.13 from https://www.python.org/downloads/ (on an older Intel Mac, Python 3.12).
  3. Double-click install-packages-mac.command here. It makes a Python environment of its own in the
     folder harf-worker in your home folder, with numpy, scipy, OpenCV and PyTorch (PyTorch on a Mac
     uses the Mac's own graphics, no extra download).
  4. Double-click start-worker-mac.command here. It runs three jobs at once and keeps the Mac awake
     while it works. Its first lines check the Mac's graphics against the processor; if they disagree,
     it fits on the processor instead, so a result is never wrong, only slower.
  5. Leave the Terminal window open. Close it to stop; anything half done goes back in line.

  If a double-click says the file cannot be opened or has no permission: open Terminal, type
  bash and a space, drag the .command file into the window, and press Return.
  Keep the Mac on its charger: it fits much faster plugged in, and the lid can stay open with the
  screen off.

The fitting code lives in code\ and is updated automatically by the reading side, so there is
nothing to update here by hand.
