"""scanjob.py's runner: the script named first runs as __main__ with the rest as its arguments, and a stand-in for
PIL where the worker has none (sheet.py imports it for the labels it draws; a scan draws none)."""
import runpy, sys, types

try:
    import PIL  # noqa: F401
except ImportError:
    pil = types.ModuleType("PIL")
    for n in ("Image", "ImageDraw", "ImageFont"):
        m = types.ModuleType("PIL." + n)
        setattr(pil, n, m)
        sys.modules["PIL." + n] = m
    sys.modules["PIL"] = pil
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
