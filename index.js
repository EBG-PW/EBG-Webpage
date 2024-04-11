require('dotenv').config();
require('module-alias/register')

const port = process.env.PORT || 80;
//This timeout is used to delay accepting connections until the server is fully loaded. 
//It could come to a crash if a request comes in before the settings cache was fully laoded.

const { log } = require('@lib/logger');

const fs = require('fs');

process.log = {};
process.log = log;

// Render Templates
const path = require('path');
/* Load some config data, thats needed to render the HTML pages on startup */
// Get all translation files from \public\dist\locales and generate a context object ({ [language]: [file key.language] })
const localesDir = path.join(__dirname, 'public', 'dist', 'locales');
let countryConfig = {};
const files = fs.readdirSync(localesDir);

files.forEach(file => {
    if (file.endsWith('.json')) {
        let langCode = file.split('.')[0];
        let filePath = path.join(localesDir, file);
        let fileContents = fs.readFileSync(filePath, 'utf8');
        let jsonData = JSON.parse(fileContents);
        if (jsonData[langCode]) {
            countryConfig[langCode] = jsonData[langCode];
        }
    }
});

process.countryConfig = countryConfig; // Used for language dropdowns
process.linkableapps = require('@config/linkable_apps.js');
process.permissions_config = require('@config/permissions.js');

// renderEJSToPublic(path.join(__dirname, 'views'), path.join(__dirname, 'public'), ["error-xxx.ejs", "landingpage.ejs"]);

(async () => {
    const { createTables } = require('@lib/postgres');
    await createTables();

    setTimeout(() => {
        const app = require('@src/app');

        setTimeout(() => {
            if (process.env.ExtraErrorWebDelay > 0) {
                process.log.system(`Webserver was delayed by ${process.env.ExtraErrorWebDelay || 500}ms beause of a error.`);
            }
            app.listen(port)
                .then((socket) => process.log.system(`Listening on port: ${port}`))
                .catch((error) => process.log.error(`Failed to start webserver on: ${port}\nError: ${error}`));
        }, 1500);
    }, process.env.GlobalWaitTime || 100);
})();