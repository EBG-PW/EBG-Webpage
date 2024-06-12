const { PrismaClient } = require('@prisma/client');
const { bigIntReplacer } = require('@lib/utils');
const { groups } = require("@config/permissions.js");
const prisma = new PrismaClient();

/**
 * Generates an array of all team groups
 * @param {Object} groups_data 
 * @returns 
 */
const generateTeamArray = (groups_data) => {
    const teamArray = [];
    for (const groupName in groups_data) {
        if (groups_data[groupName].is_team) {
            teamArray.push(groupName);
        }
    }
    return teamArray;
}

const teamGroups = generateTeamArray(groups);

const getPublicEventsQuery = async (page, limit) => {
    const offset = (page - 1) * limit;

    try {
        const events = await prisma.projectActivity.findMany({
            skip: offset,
            take: limit,
            where: {
                visibility: 1,
                type: 1,
                date_end: {
                    gte: new Date()
                }
            }
        });

        return JSON.stringify(events, bigIntReplacer);
    }
    catch (error) {
        console.log(error);
    }
}

/**
 * REsolves all TeamUsers and returns them as JSON
 * @param {Number} page 
 * @param {Number} limit 
 * @param {Array<String>} includes 
 * @returns 
 */
const getPublicTeamQuery = async (page, limit, includes) => {
    const offset = (page - 1) * limit;

    // Parse includes parameter
    const includeFields = includes ? includes.split(',') : [];

    // Determine fields to include for private users
    const privateUserSelect = {
        puuid: true,
        username: true,
        user_group: true,
    };

    // Determine fields to include
    const userSelect = {
        puuid: true,
        username: true,
        user_group: true,
        bio: true,
        avatar_url: true,
    };

    // Include Settings related to the user
    if (includeFields.includes('settings')) {
        userSelect.settings = {
            select: {
                design: true,
                language: true,
            }
        };
    }

    // Include Accounts related to the user
    if (includeFields.includes('accounts')) {
        userSelect.accounts = {
            select: {
                app: true,
                account_id: true,
                profile_url: true,
            }
        };
    }

    // Include Links related to the user
    if (includeFields.includes('links')) {
        userSelect.links = {
            select: {
                platform: true,
                data_val: true,
            }
        };
    }

    // Include Project Activities related to the user
    if (includeFields.includes('projectActivities')) {
        userSelect.projectActivities = {
            select: {
                activity: {
                    select: {
                        id: true,
                        puuid: true,
                        type: true,
                        name: true,
                        description: true,
                        avatar_url: true,
                        color: true,
                        location_address: true,
                        date_start: true,
                        date_end: true,
                        date_created: true,
                        date_apply: true,
                        min_group: true,
                        visibility: true,
                        state: true
                    }
                },
            },
            where: {
                activity: {
                    visibility: 1,
                    date_end: {
                        gte: new Date()
                    }
                }
            },
            take: 5,
        }
    }

    try {
        const users = await prisma.user.findMany({
            skip: offset,
            take: limit,
            select: userSelect,
            where: {
                public: true,
                user_group: {
                    in: teamGroups
                }
            },
        });
        
        const privateUsers = await prisma.user.findMany({
            skip: offset,
            take: limit,
            select: privateUserSelect,
            where: {
                public: false,
                user_group: {
                    in: teamGroups
                }
            },
        });

        const result = JSON.stringify([...users, ...privateUsers], bigIntReplacer);
        return result;
    }
    catch (error) {
        console.log(error);
    }
}

const getPublicProjectsQuery = async (page, limit) => {
    const offset = (page - 1) * limit;

    try {
        const projects = await prisma.projectActivity.findMany({
            skip: offset,
            take: limit,
            where: {
                visibility: 1,
                type: 2,
                date_end: {
                    gte: new Date()
                }
            }
        });

        return JSON.stringify(projects, bigIntReplacer);
    }
    catch (error) {
        console.log(error);
    }
}

const public = {
    getTeam: getPublicTeamQuery,
    getEvents: getPublicEventsQuery,
    getProjects: getPublicProjectsQuery,
}

module.exports = {
    prisma: prisma,
    public: public,
};