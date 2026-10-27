#!/bin/bash
# One-time setup for the HarfCanvas fitting worker on a Mac: a Python environment of its own, in the folder
# harf-worker in your home folder, with the packages it needs. PyTorch on a Mac uses the Mac's own GPU.
cd "$(dirname "$0")" || exit 1
done_() { read -r -p "Press Return to close. "; exit "$1"; }

PY=""
for p in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
        PY="$(command -v "$p")"; break
    fi
done
if [ -z "$PY" ]; then
    echo "No Python 3.10 or newer here. Install Python 3.13 from https://www.python.org/downloads/ and run this again."
    done_ 1
fi
echo "Using $("$PY" --version) at $PY on $(uname -m)"

VENV="$HOME/harf-worker"
"$PY" -m venv "$VENV" || { echo "Could not make $VENV"; done_ 1; }
"$VENV/bin/python" -m pip install --upgrade pip
if [ "$(uname -m)" = "x86_64" ]; then
    # an Intel Mac: the last PyTorch for it (2.2) needs Python 3.12 or older and numpy 1
    "$VENV/bin/python" -m pip install --upgrade "numpy<2" scipy opencv-python-headless torch
else
    "$VENV/bin/python" -m pip install --upgrade numpy scipy opencv-python-headless torch
fi
if ! "$VENV/bin/python" -c 'import numpy, scipy, cv2, torch' 2>/dev/null; then
    echo
    echo "Something did not install (see above). On an Intel Mac, PyTorch needs Python 3.12 or older:"
    echo "install Python 3.12 from https://www.python.org/downloads/, delete the folder $VENV, and run this again."
    done_ 1
fi
"$VENV/bin/python" -c 'import torch; print("PyTorch", torch.__version__, "- the Mac GPU:", "yes" if torch.backends.mps.is_available() else "no (the fits will use the processor)")'
chmod +x ./*.command 2>/dev/null  # so a double-click opens them from now on, where the NAS keeps the setting
echo
echo "Done. Now double-click start-worker-mac.command."
done_ 0
