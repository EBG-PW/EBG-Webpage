const { getUUIDRouteOwner } = require('@lib/cache');
const { PermissionsError } = require('@lib/errors');
const Joi = require('joi');

/**
 * Async function to verify if the user who made a request also ownes the resource he acceses.
 * The permissions only grand global power, if a user has events.edit.username, without this middlware, he could edit the event of a others users event
 * @param {String} param_uuid_key 
 * @param {String} owner_mode
 * @returns 
 */
const verifyOwner = (param_uuid_key, owner_mode) => {
    return async (req, res, next) => {
        try {
            const ValidateUUID = Joi.string().uuid().required();
            const uuid = await ValidateUUID.validateAsync(req.params[param_uuid_key]);

            const owner_result = await getUUIDRouteOwner(uuid, owner_mode);

            // Check if object has key "uuid_response"
            if (!owner_result.hasOwnProperty("uuid_response")) {
                throw new Error('No UUID Response');
            }

            if (req.user.user_id !== owner_result.uuid_response) {
                throw new PermissionsError('Does not own this object');
            }

            req[owner_mode] = owner_result;
        } catch (error) {
            next(error); // This will trigger global error handler as we are returning an Error
        }
    };
};

module.exports = {
    verifyOwner
};
