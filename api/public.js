const Joi = require('joi');
const { limiter } = require('@middleware/limiter');
const HyperExpress = require('hyper-express');
const { public } = require('@lib/prisma');
const { plublicStaticCache } = require('@middleware/cacheRequest');
const { fetchSolarData, fetchShellyMeterVData } = require('@lib/prometheus');
const router = new HyperExpress.Router();

/* Plugin info*/
const PluginName = 'PublicDataAPI'; //This plugins name
const PluginRequirements = []; //Put your Requirements and version here <Name, not file name>|Version
const PluginVersion = '0.0.1'; //This plugins version

const pageQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
});

const querySchema_team = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    includes: Joi.string().pattern(/^(settings|accounts|links|projectActivities)(,(settings|accounts|links|projectActivities))*$/).optional(),
});

router.get('/events', limiter(), plublicStaticCache(30_000, ["query"], "public_event"), async (req, res) => {
    const value = await pageQuerySchema.validateAsync(req.query);

    const result = await public.getEvents(value.page, value.limit);
    res.type('application/json').json(JSON.parse(result));
});

router.get('/team', limiter(), plublicStaticCache(30_000, ["query"], "public_team"), async (req, res) => {
    const value = await querySchema_team.validateAsync(req.query);

    const result = await public.getTeam(value.page, value.limit, value.includes);
    res.type('application/json').json(JSON.parse(result));
});

router.get('/projects', limiter(), plublicStaticCache(30_000, ["query"], "public_projects"), async (req, res) => {
    const value = await pageQuerySchema.validateAsync(req.query);

    const result = await public.getProjects(value.page, value.limit);
    res.type('application/json').json(JSON.parse(result));
});

router.get('/power', limiter(), plublicStaticCache(30_000, ["query"], "public_power"), async (req, res) => {
    const [solarData, em3Data] = await Promise.all([fetchSolarData(), fetchShellyMeterVData()]);

    res.json({
        power_a: em3Data.power_a,
        power_b: em3Data.power_b,
        power_c: em3Data.power_c,
        solar: solarData,
    });
});

module.exports = {
    router: router,
    PluginName: PluginName,
    PluginRequirements: PluginRequirements,
    PluginVersion: PluginVersion,
};