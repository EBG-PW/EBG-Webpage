const Joi = require('joi');
const { user, webtoken } = require('@lib/postgres');
const { addWebtoken, logoutWebtoken } = require('@lib/cache');
const { mergePermissions, checkPermission } = require('@lib/permission');
const { verifyRequest } = require('@middleware/verifyRequest');
const { getIpOfRequest, getCountryOfIP } = require('@lib/utils');
const HyperExpress = require('hyper-express');
const { PermissionsError, InvalidRouteInput, InvalidLogin, DBError, RequestBlocked } = require('@lib/errors');
const { parseUserAgent } = require('@lib/useragent');
const bcrypt = require('bcrypt');
const randomstring = require('randomstring');
const router = new HyperExpress.Router();

/* Plugin info*/
const PluginName = 'Login'; //This plugins name
const PluginRequirements = []; //Put your Requirements and version here <Name, not file name>|Version
const PluginVersion = '0.0.1'; //This plugins version

const identifierSchema = Joi.alternatives().try(
    Joi.string().email(), // First, try validating as an email
    Joi.string().alphanum().min(6).max(56) // If not an email, validate as an alphanumeric string
);

const LoginCheck = Joi.object({
    identifier: identifierSchema.required(),
    password: Joi.string().min(6).max(56).required()
});

const Login2FACheck = Joi.object({
    client2fa: Joi.number().required(),
    user_id: Joi.number().required(),
    fa_token: Joi.string().required()
});

router.post('/', async (req, res) => {
    const value = await LoginCheck.validateAsync(await req.json());
    if (!value) throw new InvalidRouteInput('Invalid Route Input');

    // Check if user exists in our database
    const user_responses = await user.getByUseridentifyerWithSettings(value.identifier.toLowerCase());
    if (!user_responses || user_responses.length === 0) throw new InvalidLogin('Invalid Login');
    const user_response = user_responses[0];

    if(user_response.email_verified === null) throw new RequestBlocked('Verify Email');

    // Compare passwort hash with passwort to check if they match
    if(user_response.password === null) throw new InvalidLogin('Invalid Login');
    const bcrypt_response = await bcrypt.compare(value.password, user_response.password);
    if (!bcrypt_response) throw new InvalidLogin('Invalid Login');

    // Ceck if user has 2FA enabled
    if (user_response.twofa_secret !== null) {
        // Generate a random token, so we can check if the user who loged in also entered the 2FA code
        const FA_Token = randomstring.generate({
            length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
            charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
        });

        // Set time of login, so we can know how long the user had enterd the 2FA code. If its too long, we force him to login again
        const twofa_time_response = await user.update.twofa_time(value.username, FA_Token, new Date());
        if (twofa_time_response.rowCount === 1) throw new DBError('User.Update.TwoFATime', 1, typeof 1, twofa_time_response.rowCount, typeof twofa_time_response.rowCount);

        res.status(200)
        res.json({
            message: '2FA required',
            user_id: user_response.id,
            puuid: user_response.puuid,
            username: user_response.username,
            language: user_response.language,
            design: user_response.design,
            FA_Token: FA_Token
        });
    } else {
        const source = req.headers['user-agent']
        const UserAgent = parseUserAgent(source)

        const WebToken = randomstring.generate({
            length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
            charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
        });

        const PermissionsResponse = await user.permission.get(user_response.user_id)
        const Formated_Permissions = mergePermissions(PermissionsResponse.rows, user_response.user_group); // Format the permissions to a array

        const allowed = checkPermission(Formated_Permissions, 'app.web.login'); // Check if user has permissions to login
        if (!allowed.result) throw new PermissionsError('NoPermissions', 'app.web.login');

        const IP = getIpOfRequest(req);

        const WebTokenResponse = await webtoken.create(user_response.user_id, WebToken, UserAgent.browser, getCountryOfIP(IP));
        if (WebTokenResponse.rowCount === 0) throw new DBError('Webtoken.Create', 0, typeof 0, WebTokenResponse.rowCount, typeof WebTokenResponse.rowCount);
        const return_data = await addWebtoken(WebToken, user_response, Formated_Permissions, UserAgent.browser); // Add the webtoken to the cache

        res.status(200)
        res.json({
            message: 'Login successful',
            ...return_data
        });
    }
});

/*
router.post('/2fa', async (req, res) => {
    const value = await Login2FACheck.validateAsync(await req.json());
    if (!value) throw new InvalidRouteInput('Invalid Route Input');

    // Check if user exists in our database
    const user_responses = await user.get(value.id);
    if (!user_responses || user_responses.length === 0) throw new InvalidLogin('Invalid Login');
    const user_response = user_responses[0];
    if (user_responses.twofa_token !== value.fa_token) throw new Invalid2FA('Token is invalid');

    // Check if 2FA code is not expired
    if (new Date(user_response.twofa_time).getTime() + (process.env.Web2FAValidForMin * 1000 * 60) < Date.now()) new Invalid2FA('Token is invalid');

    // Check if 2FA code is valid
    const twofa_response = twofactor.verifyToken(user_response.twofa_secret, `${value.client2fa}`);
    if (!twofa_response) throw new Invalid2FA('Failed with calculation');
    if (twofa_response.delta !== 0) throw new Invalid2FA('Invalid user input');

    // Remove 2FA token from DB so nobody can use it again
    const twofa_time_response = await user.update.twofa_time(value.id, null);
    if (twofa_time_response.rowCount === 1) throw new DBError('Webtoken.Create', 1, typeof 1, twofa_time_response.rowCount, typeof twofa_time_response.rowCount);

    const source = req.headers['user-agent']
    const UserAgent = parseUserAgent(source)

    const WebToken = randomstring.generate({
        length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
        charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
    });

    const PermissionsResponse = await user.permission.get(user_response.user_id)

    const Formated_Permissions = mergePermissions(PermissionsResponse.rows, user_response.user_group); // Format the permissions to a array
    const allowed = checkPermission(Formated_Permissions, 'app.web.login'); // Check if user has permissions to login
    if (!allowed.result) throw new PermissionsError('NoPermissions', 'app.web.login');

    const IP = getIpOfRequest(req);

        const WebTokenResponse = await webtoken.create(user_response.user_id, WebToken, UserAgent.browser, getCountryOfIP(IP));
    if (WebTokenResponse.rowCount === 0) throw new DBError('Webtoken.Create', 0, typeof 0, twofa_time_response.rowCount, typeof twofa_time_response.rowCount);
    await addWebtoken(WebToken, user_response.user_id, user_response.user_response.puuid, user_response.username, user_response.avatar_url, Formated_Permissions, UserAgent.browser, user_response.language, user_response.design, new Date().getTime()); // Add the webtoken to the cache

    res.status(200)
    res.json({
        message: 'Login successful',
        user_id: user_response.id,
        puuid: user_response.puuid,
        username: user_response.username,
        avatar_url: user_response.avatar_url,
        user_group: user_response.user_group,
        language: user_response.language,
        design: user_response.design,
        token: WebToken,
        permissions: Formated_Permissions
    });
});
*/

router.post('/check', verifyRequest('app.web.login'), async (req, res) => {
    res.status(200)
    res.json({
        message: 'Valid Token',
        user_id: req.user.user_id,
        puuid: req.user.puuid,
        username: req.user.username,
        avatar_url: req.user.avatar_url,
        user_group: req.user.user_group,
        language: req.user.language,
        design: req.user.design,
        token: req.authorization,
        permissions: req.user.permissions
    });
});     

router.post('/logout', verifyRequest('app.web.logout'), async (req, res) => {
    const WebTokenResponse = await webtoken.delete(req.authorization); // Delete the webtoken from the database
    if (WebTokenResponse.rowCount === 0) new DBError('Webtoken.Delete', 0, typeof 0, WebTokenResponse.rowCount, typeof WebTokenResponse.rowCount);
    logoutWebtoken(req.authorization); // Remove the webtoken from the cache
    res.status(200)
    res.json({
        message: 'Logout successful'
    });
});



module.exports = {
    router: router,
    PluginName: PluginName,
    PluginRequirements: PluginRequirements,
    PluginVersion: PluginVersion,
};
