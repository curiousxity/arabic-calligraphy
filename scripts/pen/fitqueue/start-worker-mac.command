#!/bin/bash
# HarfCanvas fitting worker on a Mac: fits the jobs in this folder alongside the Geekmini, on the Mac's own GPU.
# Leave the window open while it works; close it (or press Ctrl+C) to stop. Unfinished jobs go back in line.
Q="$(cd "$(dirname "$0")" && pwd)"
PY="$HOME/harf-worker/bin/python"
if [ ! -x "$PY" ]; then
    echo "Run install-packages-mac.command first."
    read -r -p "Press Return to close. "; exit 1
fi
# one name for this worker whatever network the Mac is on (fitqueue.py)
export HARF_WORKER=MacBookPro
# three jobs at once to start with; the reading side changes it with a workers-MacBookPro-<n> file
if [ $# -eq 0 ]; then set -- --jobs 3; fi
# caffeinate -i keeps the Mac awake while the worker runs (the screen may still turn off)
caffeinate -i "$PY" "$Q/code/fitqueue.py" work "$Q" "$@"
read -r -p "The worker stopped. Press Return to close. "
