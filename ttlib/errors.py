"""Errors that tiny-trellis reports to the user as a message instead of a traceback."""


class TinyError(Exception):
    """A failure caused by the project's state or by the user's input."""
