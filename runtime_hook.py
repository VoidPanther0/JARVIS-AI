import os
import sys

# Make relative paths (config/, agents/, plugins/, ...) resolve next to the
# frozen executable instead of the caller's current working directory.
base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
try:
    os.chdir(base)
except OSError:
    pass