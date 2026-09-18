from http import HTTPStatus


class ApiError(ValueError):
    def __init__(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


class AuthenticationError(PermissionError):
    pass
