require('dotenv').config();
require('module-alias/register')

const port = process.env.PORT || 80;
//This timeout is used to delay accepting connections until the server is fully loaded. 
//It could come to a crash if a request comes in before the settings cache was fully laoded.

const { log } = require('@lib/logger');

const path = require('path');
const fs = require('fs');

process.log = {};
process.log = log;

const { Worker } = require('bullmq');
const nodemailer = require("nodemailer");
const ejs = require('ejs');
const { WriteConfirmationToken, GetUserData } = require('@lib/postgres');
const { generateOneTimePassword, generateUrlPath } = require('@lib/util');
const { addConfirmationToken, addResetPasswordToken } = require('@lib/redis');
const { convertPngFilesToBase64 } = require('@lib/template');

const emailTemplateFolder = path.join(__dirname, 'templates');

const mailTemplateStore = {
  base64images: {},
  email_tumbler_css: fs.readFileSync(path.join(emailTemplateFolder, 'assets', 'theme.css'), 'utf8'),
  email_verification_light: fs.readFileSync(path.join(emailTemplateFolder, 'email_verification_light.ejs'), 'utf8'),
  email_passwordReset_light: fs.readFileSync(path.join(emailTemplateFolder, 'email_passwordReset_light.ejs'), 'utf8'),
  email_otpCode_light: fs.readFileSync(path.join(emailTemplateFolder, 'email_otpCode_light.ejs'), 'utf8'),
};

const translationStore = {
  de: require(path.join(emailTemplateFolder, 'lang', 'de.json')),
};

const connection = {
  port: parseInt(process.env.Redis_Port) || 6379,
  host: process.env.Redis_Host || "127.0.0.1",
  username: process.env.Redis_User || "default",
  password: process.env.Redis_Password || "default",
  db: parseInt(process.env.Redis_DB) + 1 || 1,
};

const emailtransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

(async () => {
  // Load email template images
  mailTemplateStore.base64images = await convertPngFilesToBase64(path.join(emailTemplateFolder, 'assets'));

  const emailWorker = new Worker('q:mail', async (job) => {
    try {
      const userData = await GetUserData(job.data.userId);
      let renderdEmail;

      process.log.debug(`Sending email to ${userData.email} with type: ${job.name}`);

      switch (job.name) {
        case 'user:email_verification':
          // const oneTimePassword = generateOneTimePassword();

          renderdEmail = await ejs.render(mailTemplateStore.email_verification_light, {
            css: mailTemplateStore.email_tumbler_css,
            images: mailTemplateStore.base64images,
            username: userData.username,
            lang: translationStore[userData.language] || translationStore[process.env.FALLBACKLANG],
            regUrl: `${job.data.appDomain}/api/v1/register/${job.data.urlPath}`,
          });

          // Send email verification
          await emailtransporter.sendMail({
            from: `EBG - Webpanel <${process.env.SMTP_USER}>`,
            to: userData.email,
            subject: translationStore[userData.language].subject.registerMail || translationStore[process.env.FALLBACKLANG].subject.registerMail,
            html: renderdEmail,
          });

          // Add confirmation token to Redis
          await addConfirmationToken(job.data.urlPath, job.data.userId);
          break;
        case 'user:login':
          // Send login email
          break;
        case 'user:reset_password':
          // const oneTimePassword = generateOneTimePassword();
          renderdEmail = await ejs.render(mailTemplateStore.email_passwordReset_light, {
            css: mailTemplateStore.email_tumbler_css,
            images: mailTemplateStore.base64images,
            username: userData.username,
            lang: translationStore[userData.language] || translationStore[process.env.FALLBACKLANG],
            regUrl: `${job.data.appDomain}/api/v1/resetpassword/${job.data.urlPath}`,
          });

          // Send email verification
          await emailtransporter.sendMail({
            from: `EBG - Webpanel <${process.env.SMTP_USER}>`,
            to: userData.email,
            subject: translationStore[userData.language].subject.passwordReset,
            html: renderdEmail,
          });

          // Add password reset token to Redis
          await addResetPasswordToken(job.data.urlPath, job.data.userId);
          break;
        default:
          throw new Error(`Invalid email type: ${job.name}`);
      }

    } catch (error) {
      process.log.error(error);
      process.log.error(JSON.stringify(job.data));
      throw error;
    }

    return;
  }, {
    connection: connection,
    removeOnComplete: { count: 1 },
    removeOnFail: { count: 50 },
  });
})();