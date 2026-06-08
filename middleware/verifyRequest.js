const { checkPermission } = require('@lib/permission');
const { checkWebToken } = require('@lib/token');
const { getIpOfRequest } = require('@lib/utils');
const { delWebtoken, IPLimit, IPCheck } = require('@lib/cache');
const { InvalidToken, TooManyRequests, PermissionsError } = require('@lib/errors');
const Joi = require('joi');
const { webtoken } = require('@lib/postgres');
const { parseUserAgent } = require('@lib/useragent');

/**
 * Async function to verify the request based on the given permission. User data will be added to the request. (req.user)
 * @param {String} permission 
 * @returns 
 */
const verifyRequest = (permission) => {
    return async (req, res, next) => {
        try {
            let UserToken;
            const IP = getIpOfRequest(req);
            const source = req.headers['user-agent']
            const UserAgent = parseUserAgent(source)

            const isBlocked = await IPCheck(IP);
            if(isBlocked.result) throw new TooManyRequests('Too Many Requests', isBlocked.retryIn)

            // Get the token from the header
            if (req.headers['authorization'] != undefined) {
                UserToken = req.headers['authorization'].replace('Bearer ', '');
            } else {
                throw new InvalidToken('No Token Provided').withBackUrl("none");
            }

            // Validate the token with joi, code below is how to generate a token
            const TokenSchema = Joi.string().min(parseInt(process.env.WEBTOKENLENGTH, 10)).max(parseInt(process.env.WEBTOKENLENGTH, 10)).pattern(/^[a-zA-Z0-9!]*$/).required();
            await TokenSchema.validateAsync(UserToken);
            /*
            const FA_Token = randomstring.generate({
                length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
                charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
            });
            */

            // Check if the token is valid
            const WebTokenResponse = await checkWebToken(UserToken, UserAgent.browser);
            if (!WebTokenResponse.State) {
                if (WebTokenResponse.DidExist) {
                    // The token existed, but was invalid for this request. Delete it from the database and cache
                    process.log.debug(`Deleting Token ${UserToken} from database`);
                    // await webtoken.delete(UserToken)
                    delWebtoken(UserToken);
                } else {
                    // The token did not exist, lets add the reuqest IP to the cache to stop brute force attacks and reduce DB stress
                    const IPLimiter = await IPLimit(IP, 20);

                    // If ture, then the IP has been in rate limit
                    if (IPLimiter.result) throw new TooManyRequests('Too Many Requests', isBlocked.retryIn)
                }
                throw new InvalidToken('Invalid Token');
            }

            // Check if the user has the permission for the request
            const allowed = checkPermission(WebTokenResponse.Data.permissions, permission);
            if (!allowed.result) throw new PermissionsError('NoPermissions', permission);
            process.log.debug(`Permission Granted for ${WebTokenResponse.Data.username} to ${permission}`);

            // Add the user data to the request
            req.user = WebTokenResponse.Data;
            req.authorization = UserToken;

        } catch (error) {
            if(error.name === "ValidationError") next(new InvalidToken('Invalid Token'));
            next(error); // This will trigger global error handler as we are returning an Error
        }
    };
};

module.exports = {
    verifyRequest
};
