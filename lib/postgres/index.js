const db = require('pg');
const { SQLError, CustomError } = require('@lib/errors');
const oAuthPermissions = require('@lib/oauth/permissions');
const { default_group } = require('@config/permissions');
const randomstring = require('randomstring');
const { getNextLowerDefaultGroup } = require('@lib/permission');

const pool = new db.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

// Function to log current pool statistics
function logPoolStats() {
  process.log.debug('Pool statistics:');
  process.log.debug(`Total clients: ${pool.totalCount}`);
  process.log.debug(`Idle clients: ${pool.idleCount}`);
  process.log.debug(`Waiting clients: ${pool.waitingCount}`);
}

// Periodically log pool statistics
setInterval(logPoolStats, 5000); // Log every 5 seconds

/* --- --- --- --- --- Querys --- --- --- --- --- */

/* --- --- --- Users --- --- --- */

/**
 * Insert a new User
 * @param {String} username
 * @param {String} email
 * @param {String} password
 * @param {String} language
 * @param {String} design
 * @param {String} user_group
 * @param {String} avatar_url
 * @param {String} first_name
 * @param {String} last_name
 * @param {String} bio
 */
const UsersCreate = (username, email, password, language, design, user_group, avatar_url, first_name, last_name, bio) => {
  let returnVal;
  return new Promise(async (resolve, reject) => {
    const client = await pool.connect() // Start a connection
    try {
      await client.query('BEGIN'); // Start a transaction

      newUserInsertResult = await client.query(`INSERT INTO users (username, email, password, user_group, avatar_url, first_name, last_name, bio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [username, email, password, user_group, avatar_url, first_name, last_name, bio]);
      await client.query(`INSERT INTO users_settings (user_id, language, design) VALUES ($1, $2, $3)`, [newUserInsertResult.rows[0].id, language || process.env.FALLBACKLANG, design]);

      returnVal = newUserInsertResult.rows[0].id;

      await client.query('COMMIT'); // Commit the transaction
    } catch (err) {
      await client.query('ROLLBACK'); // Rollback in case of error
      reject(err); // Rethrow the error after rollback
    } finally {
      client.release();  // Release client in finally block
      resolve(returnVal);
    }
  })
}

/**
 * Create or update a User with GitHub OAuth data
 * @param {String} login - GitHub username
 * @param {String} email - GitHub email
 * @param {String} avatar_url - GitHub avatar URL
 * @param {String} bio - GitHub bio
 * @param {String} name - GitHub full name
 * @param {String} profile_url - GitHub profile URL
 * @returns 
 */
const createUserOrUpdateFromGitHub = async (login, email, avatar_url, bio, name, profile_url) => {
  let returnVal;
  return new Promise(async (resolve, reject) => {
    const client = await pool.connect() // Start a connection
    try {
      await client.query('BEGIN'); // Start a transaction
      let newUserInsertResult;

      // Check if the user exists
      const users = await UsersGetByUseridentifyerWithSettings(email);
      if (users.length === 0) {
        // If user does not exist, create new user
        // Note: Adjust the fields according to your table schema
        newUserInsertResult = await client.query(`INSERT INTO users (username, email, password, user_group, avatar_url, first_name, last_name, bio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [login, email, null, default_group, avatar_url, name, null, bio]);
        await client.query(`INSERT INTO users_settings (user_id, language, design) VALUES ($1, $2, $3)`, [newUserInsertResult.rows[0].id, process.env.FALLBACKLANG, 'white.center']);
      } else {
        // If user exists, update fields that are null
        const user = users[0];
        // Update avatar_url if it's null in the DB
        if (user.avatar_url === null && avatar_url !== null) {
          await client.query('UPDATE users SET avatar_url = $1 WHERE email = $2', [avatar_url, email]);
        }
      }

      // Add this user to users_accounts via user_id
      await client.query('INSERT INTO users_accounts (user_id, app, account_id, profile_url) VALUES ((SELECT id FROM users WHERE email = $1), $2, $3, $4) ON CONFLICT (user_id, app) DO UPDATE SET account_id = $3, profile_url = $4', [email, 'github', login, profile_url]);


      await client.query('COMMIT'); // Commit the transaction
      if (users.length === 0) {
        returnVal = newUserInsertResult.rows[0].id;
      } else {
        returnVal = false;
      }
    } catch (err) {
      await client.query('ROLLBACK'); // Rollback in case of error
      reject(err); // Reject the promise with the error
    } finally {
      client.release();  // Release client in finally block
      resolve(returnVal);
    }
  });
};

/**
 * Create or update a User with Google OAuth data
 * @param {String} name - Google full name
 * @param {String} email - Google email
 * @param {String} picture - Google profile picture URL
 * @param {String} given_name - Google given name
 * @param {String} family_name - Google family name
 * @param {String} locale - Google locale
 * @returns 
 */
const createUserOrUpdateFromGoogle = async (name, email, picture, given_name, family_name, locale) => {
  let returnVal;
  return new Promise(async (resolve, reject) => {
    const client = await pool.connect() // Start a connection
    try {
      await client.query('BEGIN'); // Start a transaction
      let newUserInsertResult;

      // Check if the user exists
      const users = await UsersGetByUseridentifyerWithSettings(email);
      if (users.length === 0) {
        // If user does not exist, create new user
        newUserInsertResult = await client.query(`INSERT INTO users (username, email, password, user_group, avatar_url, first_name, last_name, bio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [name, email, null, default_group, picture, given_name, family_name, null]);
        await client.query(`INSERT INTO users_settings (user_id, language, design) VALUES ($1, $2, $3)`, [newUserInsertResult.rows[0].id, locale || process.env.FALLBACKLANG, 'white.center']);
      } else {
        // If user exists, update fields that are null
        const user = users[0];

        // Update avatar_url if it's null in the DB
        if (user.avatar_url === null && picture !== null) {
          await client.query('UPDATE users SET avatar_url = $1 WHERE email = $2', [picture, email]);
        }
        // Update first_name and last_name if they are null in the DB
        if (user.first_name === null && given_name !== null) {
          await client.query('UPDATE users SET first_name = $1 WHERE email = $2', [given_name, email]);
        }
        if (user.last_name === null && family_name !== null) {
          await client.query('UPDATE users SET last_name = $1 WHERE email = $2', [family_name, email]);
        }
        // Add others
      }

      await client.query('COMMIT'); // Commit the transaction
      if (users.length === 0) {
        returnVal = newUserInsertResult.rows[0].id;
      } else {
        returnVal = false
      }
    } catch (err) {
      await client.query('ROLLBACK'); // Rollback in case of error
      reject(err); // Reject the promise with the error
    } finally {
      client.release();  // Release client in finally block
      resolve(returnVal);
    }
  });
};

/**
 * Update the User Email Verification Timestamp
 * @param {Number} user_id 
 * @returns 
 */
const updateUserEmailVerification = (user_id) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET email_verified = CURRENT_TIMESTAMP WHERE id = $1`, [user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Get User Data
 * @param {Number} user_id 
 * @returns {Promise<Array>}
 */
const UsersGet = (user_id) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT * FROM users WHERE id = $1`, [user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Get User Data by identifier
 * @param {String} identifier  
 * @returns {Promise<Array>}
 */
const UsersGetByUseridentifyer = (identifier) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT * FROM users WHERE username = $1 OR email = $1`, [identifier], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Get USer Data by identifier with settings
 * @param {String} identifier 
 * @returns {Promise<Array>}
 */
const UsersGetByUseridentifyerWithSettings = (identifier) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT * FROM users INNER JOIN users_settings ON users.id = users_settings.user_id WHERE username = $1 OR email = $1`, [identifier], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * twofa_time is used to check if the user had a recent login
 * @param {Number} user_id 
 * @param {String} twofa_token
 * @param {Number} time 
 * @returns {Promise<Array>}
 */
const Updatetwofa_time = (user_id, twofa_token, time = null) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET twofa_time = $1, twofa_token = $2 WHERE id = $3`, [time, twofa_token, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Password
 * @param {Number} user_id
 * @param {String} password
 * @returns {Promise<Array>}
 */
const UpdatePassword = (user_id, password) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [password, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Username
 * @param {Number} user_id 
 * @param {String} username 
 * @returns {Promise<Array>}
 */
const UpdateUserName = (user_id, username) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [username, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Email
 * @param {Number} user_id
 * @param {String} email
 * @returns {Promise<Array>}
 */
const UpdateUserEmail = (user_id, email) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User First Name
 * @param {Number} user_id 
 * @param {String} last_name 
 * @returns 
 */
const UpdateUserFirstName = (user_id, first_name) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET first_name = $1 WHERE id = $2`, [first_name, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Last Name
 * @param {Number} user_id 
 * @param {String} last_name 
 * @returns 
 */
const UpdateUserLastName = (user_id, last_name) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET last_name = $1 WHERE id = $2`, [last_name, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Avatar
 * @param {Number} user_id 
 * @param {String} avatar_url 
 * @returns 
 */
const UpdateUserAvatar = (user_id, avatar_url) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [avatar_url, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Bio
 * @param {Number} user_id
 * @param {String} bio
 * @returns {Promise<Array>}
 */
const UpdateUserBio = (user_id, bio) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET bio = $1 WHERE id = $2`, [bio, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Public
 * @param {Number} user_id
 * @param {Boolean} public
 * @returns {Promise<Array>}
 */
const UpdateUserPublic = (user_id, public) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users SET public = $1 WHERE id = $2`, [public, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Get all linked accounts of a user
 * @param {Number} user_id
 */
const GetUserLinkedAccounts = (user_id) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT * FROM users_links WHERE user_id = $1`, [user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Insert or update a users linked application
 * @param {Number} user_id
 * @param {String} platform
 * @param {String} data_val
 */
const UpdateUserLink = (user_id, platform, data_val) => {
  return new Promise((resolve, reject) => {
    pool.query(`INSERT INTO users_links (user_id, platform, data_val) VALUES ($1, $2, $3) ON CONFLICT (user_id, platform) DO UPDATE SET data_val = $3`, [user_id, platform, data_val], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Delete a users linked application
 * @param {Number} user_id
 * @param {String} platform
 */
const DeleteUserLink = (user_id, platform) => {
  return new Promise((resolve, reject) => {
    pool.query(`DELETE FROM users_links WHERE user_id = $1 AND platform = $2`, [user_id, platform], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/* --- --- --- Users Settings --- --- --- */

/**
 * Update the User Design
 * @param {Number} user_id 
 * @param {String} design 
 * @returns {Promise<Array>}
 */
const setUserDesign = (user_id, design) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users_settings SET design = $1 WHERE user_id = $2`, [design, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Update the User Language
 * @param {Number} user_id 
 * @param {String} language 
 * @returns 
 */
const setUserLang = (user_id, language) => {
  return new Promise((resolve, reject) => {
    pool.query(`UPDATE users_settings SET language = $1 WHERE user_id = $2`, [language, user_id], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/* --- --- --- User Permissions --- --- --- */

/**
 * Insert or Update User Permissions
 * @param {Number} user_id 
 * @param {String} permission 
 * @param {Boolean} read 
 * @param {Boolean} write 
 * @returns 
 */
const AddPermissionToUser = (user_id, permission, read, write) => {
  return new Promise((resolve, reject) => {
    pool.query(`INSERT INTO users_permissions (user_id, permission, read, write) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, permission) DO UPDATE SET read = $3, write = $4`, [user_id, permission, read, write], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * This function is used to get a list of permissions of a user
 * @param {Number} user_id
 * @returns {Promise}
 */
const GetPermissionFromUser = function (user_id) {
  return new Promise(function (resolve, reject) {
    pool.query(`SELECT permission, read, write FROM users_permissions WHERE user_id = $1`, [
      user_id
    ], (err, result) => {
      if (err) { reject(err) }
      resolve(result);
    });
  });
}

/**
 * This function is used to remove a permission from a user
 * @param {String} user_id
 * @param {String} permission
 * @returns {Promise}
 */
const DelPermissionFromUser = function (user_id, permission) {
  return new Promise(function (resolve, reject) {
    pool.query(`DELETE FROM users_permissions WHERE user_id = $1 AND permission = $2`, [
      user_id, permission
    ], (err, result) => {
      if (err) { reject(err) }
      resolve(result);
    });
  });
}

/**
 * This function is used to update r/w of a permission of a user
 * @param {String} user_id
 * @param {String} permission
 * @param {boolean} read
 * @param {boolean} write
 * @returns {Promise}
 */
const UpdatePermissionFromUser = function (user_id, permission, read, write) {
  return new Promise(function (resolve, reject) {
    pool.query(`UPDATE users_permissions SET read = $3, write = $4 WHERE user_id = $1 AND permission = $2`, [
      user_id, permission, read, write
    ], (err, result) => {
      if (err) { reject(err) }
      resolve(result);
    });
  });
}

/* --- --- --- Events --- --- --- */
/**
 * Create a new Event
 * @param {String} name 
 * @param {String} description 
 * @param {String} avatar_url 
 * @param {String} color 
 * @param {String} location_address 
 * @param {String} date_start 
 * @param {String} date_end 
 * @param {String} date_apply 
 * @param {String} min_group 
 * @param {Number} visibility 
 * @param {Number} state 
 * @param {Number} creator_user_id 
 * @returns {String} puuid
 */
const CreateNewEvent = (name, description, avatar_url, color, location_address, date_start, date_end, date_apply, min_group, visibility, state, creator_user_id) => {
  return new Promise(async (resolve, reject) => {
    const client = await pool.connect() // Start a connection
    try {
      await client.query('BEGIN'); // Start a transaction

      const projectactivities_result = await client.query(`INSERT INTO projectactivities (type, name, description, avatar_url, color, location_address, date_start, date_end, date_apply, min_group, visibility, state, creator_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10 , $11, $12, $13) RETURNING id, puuid`, [1, name, description, avatar_url, color, location_address, date_start, date_end, date_apply, min_group, visibility, state, creator_user_id]);

      await client.query(`INSERT INTO projectactivity_users (activity_id, user_id, activity_group) VALUES ($1, $2, $3)`, [projectactivities_result.rows[0].id, creator_user_id, 'creator']);
      await client.query(`INSERT INTO projectactivity_timeline (activity_id, content) VALUES ($1, $2)`, [projectactivities_result.rows[0].id, JSON.stringify({ type: 'Create', user_id: creator_user_id })]);

      await client.query('COMMIT'); // Commit the transaction
      resolve(projectactivities_result.rows[0].puuid);
    } catch (err) {
      await client.query('ROLLBACK'); // Rollback in case of error
      throw new SQLError(err); // Rethrow the error after rollback
    } finally {
      client.release();  // Release client in finally block
    }
  });
}

/**
 * Gets the count of 
 * @param {String} search
 * @param {Date} date_end
 * @returns {Promise<Number>}
 */
const GetCountAllEvents = (search, date_end) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT COUNT(*) FROM projectactivities WHERE type = 1 AND (name ILIKE $1) AND date_end > $2`, ['%' + search + '%', date_end], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows[0].count)
    })
  })
}

/**
 * Get all events by page
 * @param {number} page 
 * @param {number} size 
 * @param {number} user_id 
 * @param {string} search
 * @param {number} date_end
 * @returns 
 */
const GetAllEventByPage = (page, size, user_id, search, date_end) => {
  const offset = page * size;
  return new Promise((resolve, reject) => {
    pool.query(`SELECT projectactivities.*, CASE WHEN projectactivity_users.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS user_participates
      FROM 
        projectactivities
      LEFT JOIN 
        projectactivity_users 
      ON 
        projectactivities.id = projectactivity_users.activity_id 
        AND projectactivity_users.user_id = $3
      WHERE 
        type = 1
        AND (name ILIKE $5)
        AND date_end > $4
      LIMIT 
      $1 OFFSET $2`, [size, offset, user_id, date_end, '%' + search + '%'], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Join a event by ID, checks if the user is allowed to join or not
 * @param {String} activity_puuid 
 * @param {Number} user_id 
 * @param {String} user_group 
 * @returns 
 */
const JoinEventByID = async (activity_puuid, user_id, user_group) => {
  const client = await pool.connect();
  let returnVal;
  try {
    await client.query('BEGIN');

    // Check if the user is already in the event
    const checkUserQuery = 'SELECT * FROM projectactivity_users WHERE activity_id = (SELECT id FROM projectactivities WHERE puuid = $1) AND user_id = $2';
    const userResult = await client.query(checkUserQuery, [activity_puuid, user_id]);
    if (userResult.rows.length > 0) {
      throw new CustomError('User is already in the event').withStatus(400);
    }

    // Check if the user has the correct group to join the event
    const checkGroupQuery = 'SELECT id, min_group FROM projectactivities WHERE puuid = $1';
    const groupResult = await client.query(checkGroupQuery, [activity_puuid]);
    const minGroup = groupResult.rows[0].min_group;
    const activity_id = groupResult.rows[0].id;
    const minDefaultGroup = getNextLowerDefaultGroup(user_group);
    if (user_group === default_group && minGroup !== minDefaultGroup) {
      throw new CustomError('InvalidMinGroupForDefaultGroup').withInfo("User does not have the right group to join the event").withStatus(403);
    }

    // Insert the user into the activity:users list
    const insertUserQuery = 'INSERT INTO projectactivity_users (activity_id, user_id, activity_group, notification) VALUES ($1, $2, $3, $4)';
    returnVal = await client.query(insertUserQuery, [activity_id, user_id, 'participant', true]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    returnVal = err;
  } finally {
    client.release();
    return returnVal;
  }
}

/**
 * Leave a event by ID (If user isn´t the creator of the event)
 * @param {String} activity_puuid 
 * @param {Number} user_id 
 */
const LeaveEventByID = async (activity_puuid, user_id) => {
  const client = await pool.connect();
  let returnVal;
  try {
    await client.query('BEGIN');

    // Check if the user is the creator of the event
    const checkUserQuery = 'SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2';
    const userResult = await client.query(checkUserQuery, [activity_puuid, user_id]);
    if (userResult.rows.length > 0) {
      throw new CustomError('User is the creator of the event').withStatus(400);
    }

    // Remove the user from the activity:users list
    const deleteQuery = 'DELETE FROM projectactivity_users WHERE activity_id = (SELECT id FROM projectactivities WHERE puuid = $1) AND user_id = $2';
    returnVal = await client.query(deleteQuery, [activity_puuid, user_id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    returnVal = err;
  } finally {
    client.release();
    return returnVal;
  }
}

/**
 * Get the event by UUID
 * @param {String} puuid 
 * @returns 
 */
const GetProjectActivityByUUID = (puuid) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT * FROM projectactivities WHERE puuid = $1`, [puuid], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Get the event by ID with user_participates, amount of total participants and amount of participants that have logged in
 * @param {String} puuid 
 * @param {Number} user_id
 */
const GetEventByUUID_Details = (puuid, user_id) => {
  return new Promise((resolve, reject) => {
    pool.query(`SELECT 
        projectactivities.*,
        BOOL_OR(projectactivity_users.user_id = $2) AS user_participates,
        COUNT(projectactivity_users.user_id) AS participants,
        COUNT(CASE WHEN projectactivity_users.has_logged_in = TRUE THEN 1 END) AS participants_logged_in
    FROM 
        projectactivities
    LEFT JOIN 
        projectactivity_users 
    ON 
        projectactivities.id = projectactivity_users.activity_id 
    WHERE 
        projectactivities.puuid = $1
    GROUP BY 
        projectactivities.id`, [puuid, user_id], (err, result) => {
      if (err) { reject(err); return; }
      resolve(result.rows)
    })
  })
}


/* --- --- --- Project Activity --- --- --- */

/**
 * Check if the user is the creator of the event and if so then update the even name
 * @param {String} puuid 
 * @param {String} name 
 * @param {Number} creator_user_id
 * @returns 
 */
const EventUpdateName = async (puuid, name, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET name = $1 WHERE puuid = $2`, [name, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the color of the event
 * @param {String} puuid
 * @param {String} color
 * @param {Number} creator_user_id
 * @returns
 */
const EventUpdateColor = async (puuid, color, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET color = $1 WHERE puuid = $2`, [color, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the min_group of the event
 * @param {String} puuid 
 * @param {String} min_group 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateMinGroup = async (puuid, min_group, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET min_group = $1 WHERE puuid = $2`, [min_group, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the Visability of the event
 * @param {String} puuid
 * @param {String} description
 * @param {Number} creator_user_id
 */
const EventUpdateVisibility = async (puuid, visibility, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET visibility = $1 WHERE puuid = $2`, [visibility, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the apply date but only if the date is before the start date
 * @param {String} puuid 
 * @param {Number} date_apply 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateDateApply = async (puuid, date_apply, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET date_apply = $1 WHERE puuid = $2 AND $1 < date_start`, [date_apply, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the start date of the event but only if the date is before the end date
 * @param {String} puuid 
 * @param {Number} date_start 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateDateStart = async (puuid, date_start, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET date_start = $1 WHERE puuid = $2 AND $1 < date_end`, [date_start, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the date_end of the event but only if the date_end is after the date_start
 * @param {String} puuid 
 * @param {Number} date_end 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateDateEnd = async (puuid, date_end, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET date_end = $1 WHERE puuid = $2 AND $1 > date_start`, [date_end, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the location address of the event
 * @param {String} puuid 
 * @param {String} location_address 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateLocationAddress = async (puuid, location_address, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET location_address = $1 WHERE puuid = $2`, [location_address, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/**
 * Check if the user is the creator of the event and if so then update the description of the event
 * @param {String} puuid 
 * @param {String} description 
 * @param {Number} creator_user_id 
 * @returns 
 */
const EventUpdateDescription = async (puuid, description, creator_user_id) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await client.query(`SELECT * FROM projectactivities WHERE puuid = $1 AND creator_user_id = $2`, [puuid, creator_user_id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new CustomError('User is not the creator of the event').setSQLTable('projectactivities').setSQLColumn('creator_user_id');
    } else {
      const result = await client.query(`UPDATE projectactivities SET description = $1 WHERE puuid = $2`, [description, puuid]);
      await client.query('COMMIT');
      return result
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw new SQLError(err);
  } finally {
    client.release();  // Release client in finally block
  }
}

/* --- --- --- oAuth --- --- --- */

/**
 * Get the OAuth Client Application
 * @param {String} client_id 
 * @param {Number} scope 
 * @param {Number} user_id 
 * @returns 
 */
const getOAuthClientApplicaiton = async (client_id, scope, user_id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if client_id exists and scope matches
    const appQuery = `SELECT id, name, avatar_url, scope, client_id, secret, redirect_url FROM oauth_apps WHERE client_id = $1`;
    const appResult = await client.query(appQuery, [client_id]);

    if (appResult.rowCount === 0) {
      throw new CustomError('OAuth Client ID does not exist.').withStatus(404);
    }

    const appData = appResult.rows[0];

    if (Number(appData.scope) !== Number(scope)) {
      throw new CustomError('Scope does not match.').withStatus(403);
    }

    // Check if user participates in the event associated with the client_id
    const activityQuery = `
      SELECT pa.id
      FROM projectactivities pa
      JOIN oauth_apps oa ON oa.id = pa.id
      JOIN projectactivity_users pau ON pau.activity_id = pa.id
      WHERE oa.client_id = $1 AND pau.user_id = $2
    `;
    const activityResult = await client.query(activityQuery, [client_id, user_id]);

    if (activityResult.rowCount === 0) {
      throw new CustomError('User does not participate in the event.').withStatus(401);
    }

    await client.query('COMMIT');
    return appData;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if a user has already authorized the OAuth Client Application within the OAUTH_TOKEN_VALIDTIME_M time
 * @param {String} client_id 
 * @param {Number} user_id 
 * @returns 
 */
const checkoAuthUserHasAlreadyAuthorized = async (client_id, user_id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if user has already authorized the client_id
    const tokenQuery = `SELECT * FROM oauth_tokens WHERE app_id = (SELECT id FROM oauth_apps WHERE client_id = $1) AND user_id = $2`;
    const tokenResult = await client.query(tokenQuery, [client_id, user_id]);

    if (tokenResult.rowCount > 0) {
      const tokenData = tokenResult.rows[0];
      const tokenValidUntil = new Date(tokenData.time_access_token).getTime() + (parseInt(process.env.OAUTH_TOKEN_VALIDTIME_M, 10) * 60 * 1000);
      if (tokenValidUntil > Date.now()) {
        await client.query('COMMIT');
        return true;
      }
    }

    await client.query('COMMIT');
    return false;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get or create a new OAuth Token
 * @param {Number} oAuthApp_id 
 * @param {Number} user_id 
 * @returns 
 */
const getorcreateoauth_token = async (oAuthApp_id, user_id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if token already exists
    const tokenQuery = `SELECT * FROM oauth_tokens WHERE app_id = $1 AND user_id = $2`;
    const tokenResult = await client.query(tokenQuery, [oAuthApp_id, user_id]);

    if (tokenResult.rowCount > 0) {
      // Check if token is expired
      const tokenData = tokenResult.rows[0];
      const tokenValidUntil = new Date(tokenData.time_access_token).getTime() + (parseInt(process.env.OAUTH_TOKEN_VALIDTIME_M, 10) * 60 * 1000);
      if (tokenValidUntil > Date.now()) {
        await client.query('COMMIT');
        return { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token };
      } else {
        // Update token
        const newAccessToken = randomstring.generate(64);
        const accessTokenUpdateQuery = `UPDATE oauth_tokens SET access_token = $1, time_access_token = $2 WHERE app_id = $3 AND user_id = $4`;
        await client.query(accessTokenUpdateQuery, [newAccessToken, new Date().toISOString(), oAuthApp_id, user_id]);
        await client.query('COMMIT');
        return { access_token: newAccessToken, refresh_token: tokenData.refresh_token };
      }
    }

    // Create new token
    const newAccessToken = randomstring.generate(64);
    const newRefreshToken = randomstring.generate(128);

    const tokenInsertQuery = `INSERT INTO oauth_tokens (app_id, user_id, access_token, time_access_token, refresh_token, time_refresh_token) VALUES ($1, $2, $3, $4, $5, $6)`;
    await client.query(tokenInsertQuery, [oAuthApp_id, user_id, newAccessToken, new Date(), newRefreshToken, new Date()]);
    await client.query('COMMIT');
    return { access_token: newAccessToken, refresh_token: newRefreshToken };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get the OAuth Token Data based on the access token and its scope and make sure the secret is correct
 * @param {String} accessToken
 * @param {String} secret
 */
const getAuthorizedOauthData = async (accessToken, secret) => {
  const client = await pool.connect();
  try {
    const scopeQuery = `
      SELECT oa.scope, ot.user_id
      FROM oauth_tokens ot
      JOIN oauth_apps oa ON ot.app_id = oa.id
      WHERE ot.access_token = $1 AND oa.secret = $2
    `;
    const scopeResult = await client.query(scopeQuery, [accessToken, secret]);

    if (scopeResult.rows.length === 0) {
      throw new Error('Access token not found or invalid.');
    }

    const { scope, user_id: userId } = scopeResult.rows[0];

    const sqlFields = oAuthPermissions.getSQLFields(scope);

    let fields = new Set();
    let joins = new Set();
    sqlFields.forEach(permission => {
      fields.add(permission); // Add the permission to the fields
      // Add the join to the joins if required
      if (permission.startsWith('users_settings')) {
        joins.add('LEFT JOIN users_settings ON users.id = users_settings.user_id');
      } else if (permission.startsWith('users_addresses')) {
        joins.add('LEFT JOIN users_addresses ON users.id = users_addresses.user_id');
      }
    });

    if (fields.size === 0) {
      throw new Error('No readable fields for the given permissions.');
    }

    fields = Array.from(fields).join(', ');
    joins = Array.from(joins).join(' ');

    const dataQuery = `
      SELECT ${fields}
      FROM users
      ${joins}
      WHERE users.id = $1
    `;
    const dataResult = await client.query(dataQuery, [userId]);

    // Get integrations
    const integrationCheck = oAuthPermissions.hasIntegrations(scope)
    if (integrationCheck) {
      const integrationsQuery = `
        SELECT *
        FROM users_integrations
        WHERE user_id = $1
      `;
      const integrationsResult = await client.query(integrationsQuery, [userId]);

      for (let i = 0; i < integrationsResult.rows.length; i++) {
        dataResult.rows[0][`integration_${integrationsResult.rows[i].platform}`] = integrationsResult.rows[i].unique_remote_id;
      }
    }

    // Get project activities
    const activityCheck = oAuthPermissions.hasActivities(scope)
    if (activityCheck && activityCheck.length > 0) {
      const activitiesQuery = `
        SELECT pa.*
        FROM projectactivities pa
        JOIN projectactivity_users pau ON pa.id = pau.activity_id
        WHERE pau.user_id = $1
          AND pa.type = ANY($2::int[])
      `;
      activitiesResult = await client.query(activitiesQuery, [userId, activityCheck]);

      dataResult.rows[0].activities = activitiesResult.rows;
    }

    return dataResult.rows[0];
  } catch (error) {
    console.error('Error fetching authorized data:', error);
    throw error;
  } finally {
    client.release();
  }
}

/* --- --- --- Integrations --- --- --- */

/**
 * Add or update a integration for a user
 * @param {Number} user_id 
 * @param {String} platform 
 * @param {String} unique_remote_id 
 */
const addorUpdateIntegration = async (user_id, platform, unique_remote_id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkQuery = `INSERT INTO users_integrations (user_id, platform, unique_remote_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, platform) DO UPDATE SET unique_remote_id = $3`;
    await client.query(checkQuery, [user_id, platform, unique_remote_id]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get all integrations for a user
 * @param {Number} user_id 
 * @returns 
 */
const getIntegrationsByUser = async (user_id) => {
  const client = await pool.connect();
  try {
    const query = `SELECT * FROM users_integrations WHERE user_id = $1`;
    const result = await client.query(query, [user_id]);
    return result.rows;
  }
  catch (error) {
    throw error;
  }
  finally {
    client.release();
  }
}

/* --- --- --- Webtokens --- --- --- */

/**
 * Insert a new Webtoken
 * @param {Number} user_id
 * @param {String} token
 * @param {String} browser
 * @returns 
 */
const WebtokensCreate = (user_id, token, browser) => {
  return new Promise((resolve, reject) => {
    pool.query(`INSERT INTO webtokens (user_id, token, browser) VALUES ($1, $2, $3)`, [user_id, token, browser], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/**
 * Get data from a Webtoken
 * @param {String} token 
 * @returns 
 */
const WebtokensGet = (token) => {
  return new Promise((resolve, reject) => {
    // Join the users, userssettings table with the webtokens table
    pool.query(`SELECT webtokens.user_id, webtokens.token, webtokens.browser, webtokens.time, users_settings.design, users_settings.language, users.puuid, users.username, users.user_group, users.avatar_url FROM webtokens INNER JOIN users ON webtokens.user_id = users.id INNER JOIN users_settings ON webtokens.user_id = users_settings.user_id WHERE token = $1`, [token], (err, result) => {
      if (err) { reject(err) }
      resolve(result.rows)
    })
  })
}

/**
 * Remove a Webtoken from the database
 * @param {String} token 
 * @returns 
 */
const WebtokensDelete = (token) => {
  return new Promise((resolve, reject) => {
    pool.query(`DELETE FROM webtokens WHERE token = $1`, [token], (err, result) => {
      if (err) { reject(err) }
      resolve(result)
    })
  })
}

/* --- --- --- Exports --- --- --- */

const user = {
  create: UsersCreate,
  oauth: {
    git: createUserOrUpdateFromGitHub,
    google: createUserOrUpdateFromGoogle
  },
  get: UsersGet,
  getlinks: GetUserLinkedAccounts,
  getByUseridentifyer: UsersGetByUseridentifyer,
  getByUseridentifyerWithSettings: UsersGetByUseridentifyerWithSettings,
  settings: {
    updateDesign: setUserDesign,
    updateLanguage: setUserLang
  },
  update: {
    twofa_time: Updatetwofa_time,
    password: UpdatePassword,
    username: UpdateUserName,
    first_name: UpdateUserFirstName,
    last_name: UpdateUserLastName,
    email: UpdateUserEmail,
    verifyEmail: updateUserEmailVerification,
    avatar: UpdateUserAvatar,
    bio: UpdateUserBio,
    public: UpdateUserPublic,
    link: UpdateUserLink
  },
  delete: {
    link: DeleteUserLink
  },
  permission: {
    add: AddPermissionToUser,
    get: GetPermissionFromUser,
    del: DelPermissionFromUser,
    update: UpdatePermissionFromUser
  }
}

const projectactivities = {
  GetByUUID: GetProjectActivityByUUID,
  event: {
    create: CreateNewEvent,
    GetCount: GetCountAllEvents,
    GetByPage: GetAllEventByPage,
    getDetails: GetEventByUUID_Details,
    join: JoinEventByID,
    leave: LeaveEventByID
  },
  event_update: {
    name: EventUpdateName,
    color: EventUpdateColor,
    min_group: EventUpdateMinGroup,
    visibility: EventUpdateVisibility,
    date_apply: EventUpdateDateApply,
    date_start: EventUpdateDateStart,
    date_end: EventUpdateDateEnd,
    location_address: EventUpdateLocationAddress,
    description: EventUpdateDescription
  }
}

const oAuth = {
  get_client: getOAuthClientApplicaiton,
  has_authorized: checkoAuthUserHasAlreadyAuthorized,
  o_authTokens: getorcreateoauth_token,
  get_authorized_data: getAuthorizedOauthData
}

const integration = {
  add: addorUpdateIntegration,
  get: getIntegrationsByUser
}

const webtoken = {
  create: WebtokensCreate,
  get: WebtokensGet,
  delete: WebtokensDelete
}


module.exports = {
  user,
  projectactivities,
  oAuth,
  integration,
  webtoken
}
