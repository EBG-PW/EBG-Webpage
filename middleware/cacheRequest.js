const { deleteOverwriteCacheKey, addPublicStaticResponse, getPublicStaticResponseSave, addPrivateStaticResponse, getPrivateStaticResponseSave } = require('@lib/cache');
const { CustomError } = require('@lib/errors');

const oHash = require('object-hash');

/**
 * Will only work on send and json
 * @param {Number} duration | In ms
 * @param {Array} objOptions | Array that MUST contain all important req_object keys for this cache
 * @param {String} overwrite | Update the cache if this key exists within the cache
 * @returns 
 */
const plublicStaticCache = (duration, objOptions = [], overwrite = null) => {
    return async (req, res) => {
        try {
            // Save the original methods into a temp variable
            const oldSend = res.send;
            const oldJson = res.json;

            let cachHash; // The hash or the cache key

            if (objOptions.length !== 0) {
                let importantDataObject = {};
                for (let i = 0; objOptions.length > i; i++) {
                    // Check if key exists, the array can have layered strings like "user.id" referring to req.user.id
                    const keySplit = objOptions[i].split(".");

                    const value = keySplit.reduce((prev, curr) => {
                        return prev ? prev[curr] : null;
                    }, req);
                    if (value !== null) {
                        // Use the original key (objOptions[i]) as the key in importantDataObject
                        importantDataObject[objOptions[i]] = value;
                    } else {
                        throw new CustomError(`Could not construct cache key for this request`).withStatus(500)
                    }
                }

                cachHash = oHash(importantDataObject, { algorithm: process.env.INTERNAL_HASH || "sha3-256" })
            } else {
                cachHash = "default"
            }

            res.send = function (data) {
                res.body = data;
                if (!res.bodyType) res.bodyType = 0;
                res.statusCode = res.statusCode || 200;
                oldSend.apply(res, arguments);
            }

            res.json = function (obj) {
                res.bodyType = 1;
                res.statusCode = res.statusCode || 200;
                res.type('application/json')
                oldJson.call(this, obj);
            };

            let override_del_result; // Store if there was a cache key that was deleted
            if (overwrite) {
                overwrite = overwrite.replace(/:(\w+)/g, (match, p1) => {
                    return req.params[p1];
                });
                override_del_result = await deleteOverwriteCacheKey(overwrite);
            }

            // A 0 is returned if no key was delted, so we can serve the cache
            // But if a anything above 0 is returned we wanna overwrite the cache
            if (override_del_result === 0) {
                const cacheResult = await getPublicStaticResponseSave(`${req.route.id}-${cachHash}`, duration);
                // If we get a cache hit we will return the data
                if (cacheResult) {
                    process.log.debug(`Public Static Cache Hit on ${req.route.pattern}`);
                    res.status(cacheResult.statusCode);
                    if (cacheResult.type === 0) return res.send(cacheResult.data);
                    if (cacheResult.type === 1) return res.json(JSON.parse(cacheResult.data));
                };
            } else {
                process.log.debug(`Cache result for ${req.route.pattern} was deleted because of overwrite key ${overwrite}`);
            }

            res.on('finish', () => {
                // Cache the data if the request was successful
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    addPublicStaticResponse(`${req.route.id}-${cachHash}`, res.bodyType, res.body, res.statusCode, duration);
                } else {
                    process.log.debug(`Not caching ${req.route.pattern} because of status code ${res.statusCode}`);
                }
            });
        } catch (error) {
            return (error);
        }
    }
}

/**
 * Will only work on send and json
 * @param {Number} duration | In ms
 * @returns 
 */
const privateStaticCache = (duration) => {
    return async (req, res) => {
        try {
            const oldSend = res.send;
            const oldJson = res.json;

            res.send = function (data) {
                res.body = data;
                if (!res.bodyType) res.bodyType = 0;
                oldSend.apply(res, arguments);
            }

            res.json = function (obj) {
                res.bodyType = 1;
                oldJson.call(this, obj);
            };

            const cacheResult = await getPrivateStaticResponseSave(req.route.id, req.authorization, duration);
            // If we get a cache hit we will return the data
            if (cacheResult) {
                process.log.debug(`Private Static Cache Hit for ${req.user.username} on ${req.route.pattern}`)
                res.status(cacheResult.statusCode);
                if (cacheResult.type === 0) return res.send(cacheResult.data)
                if (cacheResult.type === 1) return res.json(JSON.parse(cacheResult.data))
            };

            res.on('finish', () => {
                // Cache the data if the request was successful
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    addPrivateStaticResponse(req.route.id, req.authorization, res.bodyType, res.body, res.statusCode, duration)
                } else {
                    process.log.debug(`Not caching ${req.route.pattern} because of status code ${res.statusCode}`)
                }
            });
        } catch (error) {
            return (error);
        }
    }
}


module.exports = {
    plublicStaticCache,
    privateStaticCache
};