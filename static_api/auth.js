const Joi = require('joi');
const { user, webtoken } = require('@lib/postgres');
const { addWebtoken } = require('@lib/cache');
const { mergePermissions, checkPermission } = require('@lib/permission');
const randomstring = require('randomstring');
const HyperExpress = require('hyper-express');
const fs = require('fs');
const { PermissionsError, InvalidRouteInput, OAuthError, DBError, InvalidLogin } = require('@lib/errors');
const { parseUserAgent } = require('@lib/useragent');
const router = new HyperExpress.Router();
const auth_config = require('@config/auth');
const { generateUrlPath, getIpOfRequest, getCountryOfIP } = require('@lib/utils');
const { sendMail } = require('@lib/queues');

const OAuthCheck = Joi.object({
    code: Joi.string().required(),
});

const OAuthCheckGoogle = Joi.object({
    code: Joi.string().required(),
    scope: Joi.string().required(),
    authuser: Joi.number().required(),
    prompt: Joi.string().required(),
});

const generateReturnHTML = (message, webtoken_result) => {
    const { token, user_id, puuid, username, avatar_url, user_group, language, design, formated_Permissions } = webtoken_result;
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Redirecting...</title>
    </head>
    <body>
        <p>${message}. Redirecting to <a href="/">home page</a>...</p>
    </body>
    <script>
        localStorage.setItem('user_id', '${user_id}');
        localStorage.setItem('username', '${username}');
        localStorage.setItem('puuid', '${puuid}');
        localStorage.setItem('avatar_url', '${avatar_url}');
        localStorage.setItem('language', '${language}');
        localStorage.setItem('tablerTheme', '${design}');
        localStorage.setItem('user_group', '${user_group}');
        localStorage.setItem('token', '${token}');
        localStorage.setItem('permissions', '${JSON.stringify(formated_Permissions)}');
        if(localStorage.getItem("oauth:client_id")) {
            const oauth_client_id = localStorage.getItem("oauth:client_id");
            const oauth_scope = localStorage.getItem("oauth:scope");
            localStorage.removeItem("oauth:client_id");
            localStorage.removeItem("oauth:scope");
            window.location.href = \`/auth/oauth?client_id=\${oauth_client_id}&scope=\${oauth_scope}\`;
        } else {
            window.location.href = "/dashboard";
        }
    </script>
    </html>
    `;
}

const generateEmailVerificationHTML = (message, http_code) => {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Redirecting...</title>
    </head>
    <body>
        <p>${message}. Redirecting to <a href="/">home page</a>...</p>
    </body>
    <script>
        localStorage.setItem('emailVerifyInfo', ${http_code});
        window.location.href = '/login';
    </script>
    </html>
    `;
}

router.get('/github/callback', async (req, res) => {
    const value = await OAuthCheck.validateAsync(req.query);
    if (!value) throw new InvalidRouteInput('Invalid Route Input');

    // Make request to github to get access token
    const response = await fetch(auth_config.Github.url_auth, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'EBG-Manager',
        },
        body: JSON.stringify({
            client_id: auth_config.Github.clientID,
            client_secret: auth_config.Github.clientSecret,
            code: value.code,
        }),
    });

    const { access_token, token_type, scope } = await response.json();

    // Get User Email, username and language
    const userResponse = await fetch('https://api.github.com/user', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'EBG-Manager',

            'Authorization': `${token_type} ${access_token}`,
        },
    });
    //Check statuscode
    if (userResponse.status !== 200) throw new OAuthError('Invalid Auth Code, try again');

    let oauth2Response = await userResponse.json();

    const emailResponse = await fetch('https://api.github.com/user/emails', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'EBG-Manager',

            'Authorization': `${token_type} ${access_token}`,
        },
    });

    const emailResponseJson = await emailResponse.json();
    if (!emailResponseJson || emailResponseJson.length === 0) throw new OAuthError('No Email found, please make your email public');

    const email_extrace = emailResponseJson.find(email => email.primary === true);
    if (!email_extrace) throw new OAuthError('No Email found, please make your email public');
    oauth2Response.email = email_extrace.email;

    const { login, email, avatar_url, bio, name, url } = oauth2Response
    const userResult = await user.oauth.git(login, email, avatar_url, bio, name, url);

    // If user is new, send email verification
    if (userResult) {
        const urlPath = generateUrlPath();
        await sendMail('user:email_verification', userResult, { urlPath: urlPath, appDomain: process.env.DOMAIN });
        res.status(200);
        res.send(generateEmailVerificationHTML('Please verify your email', 200));
    } else {

        const user_responses = await user.getByUseridentifyerWithSettings(email);
        if (!user_responses || user_responses.length === 0) throw new InvalidLogin('Invalid Login');
        const user_response = user_responses[0];

        if (user_response.email_verified === null) {
            res.status(423);
            res.send(generateEmailVerificationHTML('Please verify your email', 423));
            return;
        }

        const PermissionsResponse = await user.permission.get(user_response.user_id)
        const Formated_Permissions = mergePermissions(PermissionsResponse.rows, user_response.user_group); // Format the permissions to a array

        const allowed = checkPermission(Formated_Permissions, 'app.web.login'); // Check if user has permissions to login
        if (!allowed.result) throw new PermissionsError('NoPermissions', 'app.web.login');

        const source = req.headers['user-agent']
        const UserAgent = parseUserAgent(source)

        const WebToken = randomstring.generate({
            length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
            charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
        });

        const IP = getIpOfRequest(req);

        const WebTokenResponse = await webtoken.create(user_response.user_id, WebToken, UserAgent.browser, getCountryOfIP(IP));
        if (WebTokenResponse.rowCount === 0) throw new DBError('Webtoken.Create', 0, typeof 0, WebTokenResponse.rowCount, typeof WebTokenResponse.rowCount);
        const return_data = await addWebtoken(WebToken, user_response, Formated_Permissions, UserAgent.browser);

        res.status(200);
        res.send(generateReturnHTML('Login successful', return_data));
    }
});

router.get('/google/callback', async (req, res) => {
    const value = await OAuthCheckGoogle.validateAsync(req.query);
    if (!value) throw new InvalidRouteInput('Invalid Route Input');

    // Make request to google to get access token
    const response = await fetch(auth_config.Google.url_auth, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'EBG-Manager',
        },
        body: JSON.stringify({
            client_id: auth_config.Google.clientID,
            client_secret: auth_config.Google.clientSecret,
            code: value.code,
            redirect_uri: auth_config.Google.url_redirect,
            grant_type: 'authorization_code',
        }),
    });

    const { access_token, token_type, scope } = await response.json();

    // Get User Email, username and language
    const userResponse = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${access_token}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'EBG-Manager',

            'Authorization': `${token_type} ${access_token}`,
        },
    });

    //Check statuscode
    if (userResponse.status !== 200) throw new OAuthError('Invalid Auth Code, try again');

    const oauth2Response = await userResponse.json();

    const { name, email, picture, given_name, family_name, locale } = oauth2Response
    const userResult = await user.oauth.google(name, email, picture, given_name, family_name, locale);

    // If user is new, send email verification
    if (userResult) {
        const urlPath = generateUrlPath();
        await sendMail('user:email_verification', userResult, { urlPath: urlPath, appDomain: process.env.DOMAIN });
        res.status(200);
        res.send(generateEmailVerificationHTML('Please verify your email', 200));
    } else {

        const user_responses = await user.getByUseridentifyerWithSettings(email);
        if (!user_responses || user_responses.length === 0) throw new InvalidLogin('Invalid Login');
        const user_response = user_responses[0];

        if (user_response.email_verified === null) {
            res.status(200);
            res.send(generateEmailVerificationHTML('Please verify your email', 423));
            return;
        }

        const PermissionsResponse = await user.permission.get(user_response.user_id)
        const Formated_Permissions = mergePermissions(PermissionsResponse.rows, user_response.user_group); // Format the permissions to a array

        const allowed = checkPermission(Formated_Permissions, 'app.web.login'); // Check if user has permissions to login
        if (!allowed.result) throw new PermissionsError('NoPermissions', 'app.web.login');

        const source = req.headers['user-agent']
        const UserAgent = parseUserAgent(source)

        const WebToken = randomstring.generate({
            length: parseInt(process.env.WEBTOKENLENGTH, 10), //DO NOT CHANCE!!!
            charset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!'
        });

        const IP = getIpOfRequest(req);

        const WebTokenResponse = await webtoken.create(user_response.user_id, WebToken, UserAgent.browser, getCountryOfIP(IP));
        if (WebTokenResponse.rowCount === 0) throw new DBError('Webtoken.Create', 0, typeof 0, WebTokenResponse.rowCount, typeof WebTokenResponse.rowCount);
        const return_data = await addWebtoken(WebToken, user_response, Formated_Permissions, UserAgent.browser);

        res.status(200);
        res.send(generateReturnHTML('Login successful', return_data));
    }
});

module.exports = router;
