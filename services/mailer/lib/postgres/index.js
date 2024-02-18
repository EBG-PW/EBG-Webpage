const db = require('pg');

const pool = new db.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

const WriteConfirmationToken = (userId, type, token, data) => {
  return new Promise((resolve, reject) => {
    pool.query('INSERT INTO confirmations (user_id, type, token, data) VALUES ($1, $2, $3, $4)', [userId, type, token, data], (err, res) => {
      if (err) {
        reject(err);
      }
      resolve(res);
    })
  })
}

const GetUserEmail = (userId) => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT email FROM users WHERE id = $1', [userId], (err, res) => {
            if (err) {
                reject(err);
            }
            resolve(res.rows[0].email);
        })
    })
}

module.exports = {
    WriteConfirmationToken,
    GetUserEmail
}