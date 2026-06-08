const { checkPermission } = require('@lib/permission');
const { checkWebToken } = require('@lib/token');
const { delWebtoken } = require('@lib/cache');
const { InvalidToken, PermissionsError } = require('@lib/errors');
const { webtoken } = require('@lib/postgres');
const { parseUserAgent } = require('@lib/useragent');

/**
 * Async function to verify if a user
 * @param {String} token
 * @param {Object} req
 * @param {String} permission 
 * @returns 
 */
const verifyWSPermission = async (token, req, permission) => {
    try {
        const source = req.headers['user-agent']
        const UserAgent = parseUserAgent(source)

        // Get the token from the header
        if (!token) {
            throw new InvalidToken('No Token Provided');
        }

        // Check if the token is valid
        const WebTokenResponse = await checkWebToken(token, UserAgent.browser);
        if (!WebTokenResponse.State) {
            // The token existed, but was invalid for this request. Delete it from the database and cache
            process.log.debug(`Deleting Token ${token} from database`);
            await webtoken.delete(token)
            delWebtoken(token);
            throw new InvalidToken('Invalid Token');
        }

        // Check if the user has the permission for the request
        const allowed = checkPermission(WebTokenResponse.Data.permissions, permission);
        if (!allowed.result) throw new PermissionsError('NoPermissions', permission);
        process.log.debug(`Permission Granted for ${WebTokenResponse.Data.username} to ${permission}`);

        return {user: WebTokenResponse.Data, passed: true}

    } catch (error) {
        return error; // This will trigger global error handler as we are returning an Error
    }
};

module.exports = {
    verifyWSPermission
};
