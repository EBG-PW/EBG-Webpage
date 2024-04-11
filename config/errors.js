/*
    Define which errors should be logged to the console.
    Note, all errors will always be returned to the client.
*/
module.exports = {
    "log_errors": {
        "RenderError": true,
        "TooManyRequests": true,
        "InvalidToken": true,
        "Invalid2FA": false,
        "InvalidLogin": true,
        "InvalidRouteInput": true,
        "PermissionsError": true,
        "SQLError": true,
        "DBError": true
    }
}