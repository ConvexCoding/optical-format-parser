"""Command-line file-to-JSON entry point."""
import argparse
from pathlib import Path
import sys

from . import dumps, parse_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse Zemax/OSLO prescriptions to normalized JSON")
    parser.add_argument("file")
    parser.add_argument("--format", choices=("zemax", "oslo"))
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("-o", "--output")
    args = parser.parse_args()
    try:
        output = dumps(parse_file(args.file, format=args.format, strict=args.strict))
        if args.output:
            Path(args.output).write_text(output, encoding="utf-8")
        else:
            sys.stdout.write(output)
        return 0
    except (OSError, ValueError, TypeError) as exc:
        print(f"optical-import: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
