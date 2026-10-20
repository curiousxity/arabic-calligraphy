@echo off
rem One-time setup for the HarfCanvas fitting worker: the Python packages it needs.
py -3 -m pip install --upgrade numpy scipy opencv-python-headless
rem PyTorch with CUDA, so the fitting runs on an NVIDIA graphics card (a large download, about 3 GB).
py -3 -m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu126
pause
