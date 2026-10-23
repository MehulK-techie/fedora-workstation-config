"""python3 -m mkworkstation apply-shortcuts | brand"""
import sys

import mkworkstation

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "apply-shortcuts":
        mkworkstation.apply_all(verbose=True)
    elif command == "brand":
        print("\t".join(mkworkstation.brand()))
    else:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
