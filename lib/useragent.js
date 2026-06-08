const expressUseragent = require('express-useragent');

const parseUserAgent = (source) => {
    const userAgentSource = source || 'unknown';

    if (typeof expressUseragent.parse === 'function') {
        return expressUseragent.parse(userAgentSource);
    }

    if (typeof expressUseragent.UserAgent === 'function') {
        return new expressUseragent.UserAgent().parse(userAgentSource);
    }

    return {
        source: userAgentSource,
        browser: 'unknown'
    };
};

module.exports = {
    parseUserAgent
};
