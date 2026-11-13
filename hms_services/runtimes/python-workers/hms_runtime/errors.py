import re

_CODE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")  # the error-code format Go accepts


class CapabilityError(Exception):
    """A refusal the caller may see: a short snake_case code and a fixed message. Never put input values in the
    message: the input may hold patient data, and Go logs the message."""

    def __init__(self, code, message):
        if not isinstance(code, str) or not _CODE.match(code):
            raise ValueError("error code must match ^[a-z][a-z0-9_]{0,39}$")
        super().__init__(code)
        self.code = code
        self.message = message
