"""tiny-trellis command line. Run `tt.py --help` for the commands."""
import sys

if sys.version_info < (3, 9):
    sys.exit("tiny-trellis needs Python 3.9 or later")

from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ttlib.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
