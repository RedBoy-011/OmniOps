"""Dedicated TLS entry point so the existing HTTP updater sees one legacy gateway."""

from .server import main


if __name__ == "__main__":
    main()
